import { execFile, spawn } from "node:child_process";
import { basename } from "node:path";

import type { IpcResponse } from "@filetrail/contracts";

// Opening a disk image: File Trail mounts it itself, with hdiutil, so that no Finder window
// opens on the disk (as one does when macOS's DiskImageMounter mounts it), and the window
// opens the disk in a tab instead. An image that asks for something first, a password or
// agreeing to a licence, is handed to DiskImageMounter, which asks in its own windows:
// hdiutil would ask in a Terminal it doesn't have.

const HDIUTIL_PATH = "/usr/bin/hdiutil";
const DISK_IMAGE_MOUNTER_PATH = "/System/Library/CoreServices/DiskImageMounter.app";

export type HdiutilResult = { ok: boolean; stdout: string; stderr: string };

// Runs hdiutil with nothing to read from: a question it asks on the command line (a licence
// to agree to) is answered with "no" instead of waiting.
export type RunHdiutil = (args: string[]) => Promise<HdiutilResult>;

type OpenDiskImageResponse = IpcResponse<"system:openDiskImage">;

export type DiskImageOpenerDeps = {
  runHdiutil?: RunHdiutil;
  // Opens the image with DiskImageMounter, as Finder would. It is named, not left to
  // macOS's choice of app: File Trail may be the one chosen for disk images.
  openWithDiskImageMounter?: (imagePath: string) => Promise<void>;
  // A disk was mounted: the list of disks is read again, so it shows at once.
  onMounted: () => void;
  logger?: { error: (message: string, details?: unknown) => void };
};

export type DiskImageOpener = {
  open: (imagePath: string) => Promise<OpenDiskImageResponse>;
};

export function createDiskImageOpener(deps: DiskImageOpenerDeps): DiskImageOpener {
  const runHdiutil = deps.runHdiutil ?? runHdiutilProcess;
  const openWithDiskImageMounter = deps.openWithDiskImageMounter ?? openWithDiskImageMounterApp;
  // Images being mounted now: opening one again meanwhile (a second double-click) does
  // nothing, rather than opening its disk twice.
  const opening = new Set<string>();

  const handOff = async (imagePath: string): Promise<OpenDiskImageResponse> => {
    try {
      await openWithDiskImageMounter(imagePath);
      return { status: "handedOff", volumePath: null, reason: null };
    } catch (error) {
      deps.logger?.error("opening a disk image with DiskImageMounter failed", {
        imagePath,
        error: String(error),
      });
      return { status: "failed", volumePath: null, reason: null };
    }
  };

  const open = async (imagePath: string): Promise<OpenDiskImageResponse> => {
    // A password is asked for before hdiutil reads anything else of the image, in a window
    // of its own that File Trail can't tell apart from a stuck mount: it is checked first,
    // and only this check never asks.
    const encrypted = await runHdiutil(["isencrypted", "-plist", imagePath]);
    if (encrypted.ok && readPlistBoolean(encrypted.stdout, "encrypted") === true) {
      return handOff(imagePath);
    }
    const info = await runHdiutil(["imageinfo", "-plist", imagePath]);
    if (info.ok && readPlistBoolean(info.stdout, "Software License Agreement") === true) {
      return handOff(imagePath);
    }
    // An image already mounted is attached again in a moment, which tells where its disk is.
    const attached = await runHdiutil(["attach", "-plist", "-noautoopen", imagePath]);
    if (!attached.ok) {
      const failure = readAttachFailure(attached.stderr);
      // Something it would have asked, which the checks above didn't foresee.
      if (failure.canceled) {
        return handOff(imagePath);
      }
      deps.logger?.error("mounting a disk image failed", { imagePath, stderr: attached.stderr });
      return { status: "failed", volumePath: null, reason: failure.reason };
    }
    deps.onMounted();
    // An image with several volumes opens the first by name, as the sidebar lists them;
    // the others are there under Locations.
    const volumePath = firstByName(readPlistStrings(attached.stdout, "mount-point"));
    if (volumePath === null) {
      return { status: "failed", volumePath: null, reason: "no mountable file systems" };
    }
    return { status: "opened", volumePath, reason: null };
  };

  return {
    open: async (imagePath) => {
      if (opening.has(imagePath)) {
        return { status: "busy", volumePath: null, reason: null };
      }
      opening.add(imagePath);
      try {
        return await open(imagePath);
      } finally {
        opening.delete(imagePath);
      }
    },
  };
}

function firstByName(paths: string[]): string | null {
  const sorted = [...paths].sort((first, second) =>
    basename(first).localeCompare(basename(second), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
  return sorted[0] ?? null;
}

// hdiutil says why it didn't attach on its last line: "hdiutil: attach failed - no mountable
// file systems", or "hdiutil: attach canceled" when a question went unanswered.
export function readAttachFailure(stderr: string): { canceled: boolean; reason: string | null } {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("WARNING"));
  if (lines.some((line) => /^hdiutil: attach canceled/u.test(line))) {
    return { canceled: true, reason: null };
  }
  for (const line of [...lines].reverse()) {
    const match = /^hdiutil: attach failed - (.+)$/u.exec(line);
    if (match?.[1]) {
      return { canceled: false, reason: match[1] };
    }
  }
  return { canceled: false, reason: null };
}

// The values hdiutil's plist output gives a key, wherever it is in the plist.
export function readPlistStrings(plist: string, key: string): string[] {
  const pattern = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>([^<]*)</string>`, "gu");
  return [...plist.matchAll(pattern)].map((match) => decodeXmlText(match[1] ?? ""));
}

export function readPlistBoolean(plist: string, key: string): boolean | null {
  const match = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<(true|false)/>`, "u").exec(plist);
  return match ? match[1] === "true" : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function decodeXmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/giu, (entity, name: string) => {
    const lower = name.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const code = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
  });
}

function runHdiutilProcess(args: string[]): Promise<HdiutilResult> {
  return new Promise((resolve) => {
    const child = spawn(HDIUTIL_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => resolve({ ok: false, stdout, stderr: stderr || String(error) }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}

function openWithDiskImageMounterApp(imagePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/open", ["-a", DISK_IMAGE_MOUNTER_PATH, imagePath], (error) =>
      error ? reject(error) : resolve(),
    );
  });
}
