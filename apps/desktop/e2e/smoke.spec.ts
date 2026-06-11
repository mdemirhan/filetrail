import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";
import { expect, test } from "playwright/test";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
// The electron package's main export is the path to the Electron binary.
const electronExecutablePath = require("electron") as unknown as string;

test("built app launches, shows the File Trail window, and renders the explorer shell", async () => {
  const electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir],
    cwd: appDir,
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveTitle("File Trail", { timeout: 30_000 });
    await expect(window.locator("main.app-shell")).toBeVisible({ timeout: 30_000 });
  } finally {
    await electronApp.close();
  }
});
