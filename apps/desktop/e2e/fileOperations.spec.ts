import {
  existsSync,
  mkdirSync,
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
  await waitUntil(
    () => window.evaluate(() => document.querySelector("main.app-shell") !== null),
    30_000,
  );
  await waitUntil(() => isListed("a.txt"), 30_000);
});

test.afterEach(async () => {
  await electronApp.close();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

function item(name: string) {
  return window.locator(`[data-selectable-entry-path="${join(folder, name)}"]`).first();
}

// Waits by reading the page, not with the locator's own waiting: that waits on animation
// frames, which macOS stops for a window it considers hidden (an unattended Mac with its
// screen locked), so a list that changes after the first look is never seen to change.
async function waitUntil(check: () => Promise<boolean>, timeout = 15_000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true);
}

function isListed(name: string, path = folder): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector) !== null,
    `[data-selectable-entry-path="${join(path, name)}"]`,
  );
}

function isSelected(name: string): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute("aria-selected") === "true",
    `[data-selectable-entry-path="${join(folder, name)}"]`,
  );
}

function hasField(label: string): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector) !== null,
    `input[aria-label="${label}"]`,
  );
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
  await waitUntil(() => isSelected("a copy.txt"));
});

test("duplicates with Command-D", async () => {
  await item("b.txt").click();
  await window.keyboard.press("Meta+d");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b copy.txt", "b.txt"]);
});

test("renames in the list with F2", async () => {
  await item("a.txt").click();
  await window.keyboard.press("F2");
  await waitUntil(() => hasField("Rename a.txt"));
  const field = window.getByLabel("Rename a.txt");
  await field.fill("renamed.txt");
  await field.press("Enter");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["b.txt", "renamed.txt"]);
  expect(readFileSync(join(folder, "renamed.txt"), "utf8")).toBe("alpha");
});

test("makes a new folder in the folder on screen and names it in its row", async () => {
  // A selected folder is not where ⇧⌘N goes (as in Finder): the folder on screen is.
  await item("a.txt").click();
  await window.keyboard.press("Meta+Shift+n");

  await expect
    .poll(namesOnDisk, { timeout: 15_000 })
    .toEqual(["a.txt", "b.txt", "untitled folder"]);
  await waitUntil(() => hasField("Rename untitled folder"));
  const field = window.getByLabel("Rename untitled folder");
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
  await waitUntil(() => isListed(name));

  await item(name).click();
  await window.keyboard.press("Meta+Backspace");

  try {
    await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b.txt"]);
    expect(existsSync(join(folder, name))).toBe(false);
    // In the Trash, not deleted for good (where macOS lets this process look there).
    if (trashIsReadable()) {
      expect(existsSync(join(homedir(), ".Trash", name))).toBe(true);
    }
  } finally {
    rmSync(join(homedir(), ".Trash", name), { force: true });
  }
});

function trashIsReadable(): boolean {
  try {
    readdirSync(join(homedir(), ".Trash"));
    return true;
  } catch {
    return false;
  }
}

async function openFolderOnScreen(name: string): Promise<void> {
  await item(name).dblclick();
  await waitUntil(() =>
    window.evaluate(
      (prefix) => document.querySelector(`[data-selectable-entry-path^="${prefix}"]`) !== null,
      `${join(folder, name)}/`,
    ),
  );
}

test("cuts an item and pastes it into another folder, moving it", async () => {
  mkdirSync(join(folder, "Sub"));
  writeFileSync(join(folder, "Sub", "already.txt"), "here");
  await window.keyboard.press("Meta+r");
  await waitUntil(() => isListed("Sub"));

  await item("a.txt").click();
  await window.keyboard.press("Meta+x");
  await openFolderOnScreen("Sub");
  await window.keyboard.press("Meta+v");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["Sub", "b.txt"]);
  expect(readdirSync(join(folder, "Sub")).sort()).toEqual(["a.txt", "already.txt"]);
  expect(readFileSync(join(folder, "Sub", "a.txt"), "utf8")).toBe("alpha");
});

test("asks about a name already taken, and keeps both when told to", async () => {
  mkdirSync(join(folder, "Sub"));
  writeFileSync(join(folder, "Sub", "a.txt"), "older alpha");
  await window.keyboard.press("Meta+r");
  await waitUntil(() => isListed("Sub"));

  await item("a.txt").click();
  await window.keyboard.press("Meta+c");
  await openFolderOnScreen("Sub");
  await window.keyboard.press("Meta+v");

  await waitUntil(() => window.evaluate(() => document.querySelector("dialog[open]") !== null));
  // One item that already exists: a plain alert, as in Finder.
  const alert = window.getByRole("dialog");
  await alert.getByRole("button", { name: "Keep Both" }).click();

  await expect
    .poll(
      () =>
        readdirSync(join(folder, "Sub"))
          .filter((n) => !n.startsWith("."))
          .sort(),
      {
        timeout: 15_000,
      },
    )
    .toEqual(["a copy.txt", "a.txt"]);
  expect(readFileSync(join(folder, "Sub", "a.txt"), "utf8")).toBe("older alpha");
  expect(readFileSync(join(folder, "Sub", "a copy.txt"), "utf8")).toBe("alpha");
});

test("refuses a name that is taken, keeping the field open to fix it", async () => {
  await item("a.txt").click();
  await window.keyboard.press("F2");
  await waitUntil(() => hasField("Rename a.txt"));
  const field = window.getByLabel("Rename a.txt");
  await field.fill("b.txt");
  await field.press("Enter");

  await waitUntil(() =>
    window.evaluate(
      () =>
        document.querySelector("[role=alert]")?.textContent ===
        "An item named “b.txt” already exists.",
    ),
  );
  expect(await hasField("Rename a.txt")).toBe(true);
  expect(namesOnDisk()).toEqual(["a.txt", "b.txt"]);
  expect(readFileSync(join(folder, "b.txt"), "utf8")).toBe("beta");

  await field.fill("c.txt");
  await field.press("Enter");
  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["b.txt", "c.txt"]);
});
