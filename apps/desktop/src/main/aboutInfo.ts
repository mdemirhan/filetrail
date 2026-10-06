import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { IpcResponse } from "@filetrail/contracts";

type Acknowledgement = IpcResponse<"app:getAcknowledgements">["components"][number];

type LicenseIndexEntry = Omit<Acknowledgement, "text"> & { file: string | null };

const CHROMIUM_ID = "chromium";
const CHROMIUM_NOTICES_FILE = "LICENSES.chromium.html";

// The build's output folder, where the build leaves `build-info.json` and the licenses.
export function resolveDistDir(
  options: { moduleUrl?: string; resourcesPath?: string; cwd?: string } = {},
): string | null {
  const moduleDir = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url));
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const candidates = [
    join(moduleDir, ".."),
    ...(resourcesPath ? [join(resourcesPath, "app", "dist")] : []),
    join(options.cwd ?? process.cwd(), "dist"),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "build-info.json"))) ?? null;
}

// The commit the app was built from, as the build recorded it.
export function readBuildCommit(distDir: string | null): string | null {
  return readBuildInfoField(distDir, "commit");
}

// The app's version, as the build took it from the release tag ("0.2.0"), or from the last
// release before an untagged commit ("0.1.0+dev.4"). package.json's version is a placeholder.
export function readBuildVersion(distDir: string | null): string | null {
  return readBuildInfoField(distDir, "version");
}

function readBuildInfoField(distDir: string | null, field: "commit" | "version"): string | null {
  if (!distDir) {
    return null;
  }
  try {
    const info = JSON.parse(readFileSync(join(distDir, "build-info.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const value = info[field];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// macOS names its versions without a last zero: "27.0", then "27.0.1".
export function formatMacosVersion(systemVersion: string): string {
  return systemVersion.replace(/^(\d+\.\d+)\.0$/, "$1");
}

// The bundled software in the build's order, each with the license text shipped beside it.
export function readAcknowledgements(
  distDir: string | null,
  versions: { chromium: string },
): Acknowledgement[] {
  if (!distDir) {
    return [];
  }
  const licensesDir = join(distDir, "assets", "licenses");
  const index = JSON.parse(
    readFileSync(join(licensesDir, "index.json"), "utf8"),
  ) as LicenseIndexEntry[];
  return index.map(({ file, ...component }) => ({
    ...component,
    version: component.id === CHROMIUM_ID ? versions.chromium : component.version,
    text: file ? readFileSync(join(licensesDir, file), "utf8") : null,
  }));
}

// Chromium's notices: inside the packaged app, or beside Electron's own app in a
// development run.
export function resolveChromiumNoticesPath(
  resourcesPath: string = process.resourcesPath,
): string | null {
  const candidates = [
    join(resourcesPath, CHROMIUM_NOTICES_FILE),
    join(resourcesPath, "..", "..", "..", CHROMIUM_NOTICES_FILE),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// The file a component's separately shipped notices are in; only Chromium has one.
export function resolveNoticesPath(id: string, resourcesPath?: string): string | null {
  return id === CHROMIUM_ID ? resolveChromiumNoticesPath(resourcesPath) : null;
}
