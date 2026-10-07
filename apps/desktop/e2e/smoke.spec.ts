import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { expect, test } from "playwright/test";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// The electron package's main export is the path to the Electron binary.
const electronExecutablePath = require("electron") as unknown as string;

test("built app launches, shows the File Trail window, and renders the explorer shell", async () => {
  // A profile of its own: the test neither reads nor writes the real one, and it still
  // starts while a copy of the app is open (which holds the single-instance lock).
  const userDataDir = mkdtempSync(join(tmpdir(), "filetrail-smoke-"));
  const electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir, `--user-data-dir=${userDataDir}`],
    cwd: appDir,
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window.locator("main.app-shell")).toBeVisible({ timeout: 30_000 });
    // A window goes by its front tab's folder, the home folder on a first launch.
    await expect(window).toHaveTitle(basename(homedir()), { timeout: 30_000 });
  } finally {
    await electronApp.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
