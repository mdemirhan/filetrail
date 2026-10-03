import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "playwright";
import { expect, test } from "playwright/test";

// File operations in the built app, from the keyboard, with what happens checked on disk:
// what the unit tests check against mocks and the main process's tests check against the
// disk, joined up through the real window.

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
    // A profile of its own, opened on the test's folder.
    args: [appDir, `--user-data-dir=${userDataDir}`, "--folder", folder],
    cwd: appDir,
  });
  window = await electronApp.firstWindow();
  await expect(window.locator("main.app-shell")).toBeVisible({ timeout: 30_000 });
  await expect(item("a.txt")).toBeVisible({ timeout: 30_000 });
});

test.afterEach(async () => {
  await electronApp.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

function item(name: string) {
  return window.locator(`[data-selectable-entry-path="${join(folder, name)}"]`).first();
}

function namesOnDisk(): string[] {
  return readdirSync(folder)
    .filter((name) => !name.startsWith("."))
    .sort();
}

test("copies and pastes into the same folder, making a copy", async () => {
  await item("a.txt").click();
  await window.keyboard.press("Meta+c");
  await window.keyboard.press("Meta+v");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a copy.txt", "a.txt", "b.txt"]);
  expect(readFileSync(join(folder, "a copy.txt"), "utf8")).toBe("alpha");
  // The copy is selected once it is listed.
  await expect(item("a copy.txt")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
});

test("duplicates with Command-D", async () => {
  await item("b.txt").click();
  await window.keyboard.press("Meta+d");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b copy.txt", "b.txt"]);
});

test("renames in the list with F2", async () => {
  await item("a.txt").click();
  await window.keyboard.press("F2");
  const field = window.getByLabel("Rename a.txt");
  await expect(field).toBeVisible();
  await field.fill("renamed.txt");
  await field.press("Enter");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["b.txt", "renamed.txt"]);
  expect(readFileSync(join(folder, "renamed.txt"), "utf8")).toBe("alpha");
});

test("makes a new folder in the folder on screen and names it in its row", async () => {
  // A selected folder is not where ⇧⌘N goes (as in Finder): the folder on screen is.
  await item("a.txt").click();
  await window.keyboard.press("Meta+Shift+n");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["New Folder", "a.txt", "b.txt"]);
  const field = window.getByLabel("Rename New Folder");
  await expect(field).toBeVisible({ timeout: 15_000 });
  await field.fill("Made");
  await field.press("Enter");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["Made", "a.txt", "b.txt"]);
});

// The item really goes to the Trash. Its name is unique to this run, so it is found there
// afterwards and removed, leaving nothing behind.
test("moves an item to the Trash with Command-Delete", async () => {
  const name = `filetrail-e2e-${Date.now()}-${process.pid}.txt`;
  writeFileSync(join(folder, name), "to be trashed");
  await window.keyboard.press("Meta+r");
  await expect(item(name)).toBeVisible({ timeout: 15_000 });

  await item(name).click();
  await window.keyboard.press("Meta+Backspace");

  try {
    await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b.txt"]);
    expect(existsSync(join(folder, name))).toBe(false);
  } finally {
    rmSync(join(homedir(), ".Trash", name), { force: true });
  }
});
