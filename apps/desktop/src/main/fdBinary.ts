import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import bundledFdManifest from "../../assets/vendor/fd/manifest.json";

type FdManifest = {
  tool: "fd";
  version: string;
  macos: {
    arm64: {
      archiveSha256: string;
      relativeBinaryPath: string;
    };
    x64: {
      archiveSha256: string;
      relativeBinaryPath: string;
    };
  };
};

const BUNDLED_FD_MANIFEST = bundledFdManifest as FdManifest;

export function resolveBundledFdBinaryPath(
  options: {
    arch?: NodeJS.Architecture;
    moduleUrl?: string;
    resourcesPath?: string;
    cwd?: string;
  } = {},
): string {
  const arch = options.arch ?? process.arch;
  const manifest = readBundledFdManifest();
  const relativeBinaryPath =
    arch === "arm64"
      ? manifest.macos.arm64.relativeBinaryPath
      : arch === "x64"
        ? manifest.macos.x64.relativeBinaryPath
        : null;

  if (!relativeBinaryPath) {
    throw new Error(`Unsupported macOS architecture for bundled fd: ${arch}`);
  }

  const moduleDir = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url));
  const candidates = [
    join(moduleDir, "..", "..", "dist", "assets", relativeBinaryPath),
    join(options.cwd ?? process.cwd(), "dist", "assets", relativeBinaryPath),
    join(options.cwd ?? process.cwd(), "assets", relativeBinaryPath),
  ];
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath.length > 0) {
    candidates.splice(1, 0, join(resourcesPath, "app", "dist", "assets", relativeBinaryPath));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Bundled fd binary not found for ${arch}.`);
}

export function readBundledFdManifest(): FdManifest {
  return BUNDLED_FD_MANIFEST;
}
