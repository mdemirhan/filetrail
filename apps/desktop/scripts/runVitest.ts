// Runs vitest on Electron's node (ELECTRON_RUN_AS_NODE): the tests need its `original-fs`
// and the native addon built for it. On macOS each test worker would be an app with an
// icon in the Dock, so they run on a copy of Electron marked as a background app
// (LSUIElement), made once per Electron version under node_modules/.cache.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptDir, "..");
const repoDir = join(appDir, "..", "..");
const require = createRequire(join(appDir, "package.json"));
const electronPath: string = require("electron");
const electronVersion: string = require("electron/package.json").version;

const runtimePath =
  process.platform === "darwin" ? backgroundElectronPath(electronPath) : electronPath;
const child = spawn(
  runtimePath,
  [join(repoDir, "node_modules", "vitest", "vitest.mjs"), ...process.argv.slice(2)],
  { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
);
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

function backgroundElectronPath(binaryPath: string): string {
  const bundlePath = binaryPath.slice(0, binaryPath.indexOf(".app/") + ".app".length);
  const cacheDir = join(repoDir, "node_modules", ".cache", "filetrail-test-electron");
  const copyPath = join(cacheDir, electronVersion, "Electron.app");
  const copyBinaryPath = join(copyPath, binaryPath.slice(bundlePath.length + 1));
  if (existsSync(copyBinaryPath)) {
    return copyBinaryPath;
  }

  console.log(`Making a background copy of Electron ${electronVersion} for the tests (once).`);
  // Copies for other Electron versions are no longer used.
  if (existsSync(cacheDir)) {
    for (const version of readdirSync(cacheDir)) {
      rmSync(join(cacheDir, version), { recursive: true, force: true });
    }
  }
  // Made beside its final place and renamed into it, so a run that stops halfway, or two
  // runs at once, never leave a broken copy.
  const partialPath = join(cacheDir, electronVersion, `Electron.app.partial-${process.pid}`);
  execFileSync("ditto", [bundlePath, partialPath]);
  execFileSync("plutil", [
    "-replace",
    "LSUIElement",
    "-bool",
    "true",
    join(partialPath, "Contents", "Info.plist"),
  ]);
  // The changed Info.plist no longer matches Electron's signature: sign the copy again.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", partialPath], {
    stdio: "ignore",
  });
  if (existsSync(copyPath)) {
    rmSync(partialPath, { recursive: true, force: true });
  } else {
    renameSync(partialPath, copyPath);
  }
  return copyBinaryPath;
}
