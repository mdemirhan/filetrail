import {
  appendFileSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "playwright";
import { expect, test } from "playwright/test";
import { quitApp } from "./quitApp";

// Changes made outside the app to the folder on screen show without a refresh: the folder
// is changed on disk by the test, as another app would change it.

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronExecutablePath = require("electron") as unknown as string;

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let folder: string;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), "filetrail-e2e-profile-"));
  folder = realpathSync(mkdtempSync(join(tmpdir(), "filetrail-e2e-folder-")));
  writeFileSync(join(folder, "a.txt"), "alpha");
  writeFileSync(join(folder, "b.txt"), "beta");
  electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir, `--user-data-dir=${userDataDir}`, "--folder", folder],
    cwd: appDir,
  });
  window = await electronApp.firstWindow();
  await waitUntil(
    () => window.evaluate(() => document.querySelector("main.app-shell") !== null),
    30_000,
  );
  await waitUntil(() => isListed("a.txt"), 30_000);
});

test.afterEach(async () => {
  try {
    await closeApp();
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  }
});

async function closeApp(): Promise<void> {
  await quitApp(electronApp, userDataDir);
}

function item(name: string) {
  return window.locator(`[data-selectable-entry-path="${join(folder, name)}"]`).first();
}

// Waits by reading the page (see fileOperations.spec.ts for why).
async function waitUntil(check: () => Promise<boolean>, timeout = 15_000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true);
}

function isListed(name: string): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector) !== null,
    `[data-selectable-entry-path="${join(folder, name)}"]`,
  );
}

function isSelected(name: string): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute("aria-selected") === "true",
    `[data-selectable-entry-path="${join(folder, name)}"]`,
  );
}

function rowText(name: string): Promise<string> {
  return window.evaluate(
    (selector) => document.querySelector(selector)?.textContent ?? "",
    `[data-selectable-entry-path="${join(folder, name)}"]`,
  );
}

test("shows items made, renamed and removed outside the app, keeping the selection", async () => {
  await item("a.txt").click();
  await waitUntil(() => isSelected("a.txt"));

  writeFileSync(join(folder, "made outside.txt"), "new");
  await waitUntil(() => isListed("made outside.txt"), 5_000);

  renameSync(join(folder, "b.txt"), join(folder, "renamed outside.txt"));
  await waitUntil(() => isListed("renamed outside.txt"), 5_000);
  expect(await isListed("b.txt")).toBe(false);

  unlinkSync(join(folder, "made outside.txt"));
  await waitUntil(async () => !(await isListed("made outside.txt")), 5_000);

  expect(await isSelected("a.txt")).toBe(true);
});

test("shows a file's new size when it grows outside the app", async () => {
  await window.keyboard.press("Meta+2");
  await waitUntil(async () => (await rowText("a.txt")).includes("5 B"));

  appendFileSync(join(folder, "a.txt"), "-more-text");
  await waitUntil(async () => (await rowText("a.txt")).includes("15 B"), 5_000);
});
