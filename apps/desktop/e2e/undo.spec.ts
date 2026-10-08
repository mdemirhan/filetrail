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
import { quitApp } from "./quitApp";

// Undo and Redo in the built app, chosen from the real Edit menu, with what happens checked
// on disk. The keys themselves can't be pressed here: the test's keys reach the page, not
// the menu, so the menu items are chosen as a click would choose them.

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
    await quitApp(electronApp, userDataDir);
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  }
});

function item(name: string) {
  return window.locator(`[data-selectable-entry-path="${join(folder, name)}"]`).first();
}

async function waitUntil(check: () => Promise<boolean>, timeout = 15_000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true);
}

function isListed(name: string): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector) !== null,
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

// What Undo or Redo in the Edit menu says, and whether it can be chosen: of its two items
// (the files' and a text field's own, "undo:text"), the one shown.
function menuItem(id: "undo" | "redo"): Promise<{ label: string; enabled: boolean } | null> {
  return electronApp.evaluate(({ Menu }, itemId) => {
    const menu = Menu.getApplicationMenu();
    const found = [itemId, `${itemId}:text`]
      .map((candidate) => menu?.getMenuItemById(candidate))
      .find((candidate) => candidate?.visible);
    return found ? { label: found.label, enabled: found.enabled } : null;
  }, id);
}

// Chooses the item shown as a click on it in the menu bar does.
async function choose(id: "undo" | "redo"): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, Menu }, itemId) => {
    const menu = Menu.getApplicationMenu();
    const found = [itemId, `${itemId}:text`]
      .map((candidate) => menu?.getMenuItemById(candidate))
      .find((candidate) => candidate?.visible);
    const focused = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    found?.click(undefined, focused, focused?.webContents);
  }, id);
}

async function rename(name: string, newName: string): Promise<void> {
  await item(name).click();
  await window.keyboard.press("F2");
  await waitUntil(() => hasField(`Rename ${name}`));
  const field = window.getByLabel(`Rename ${name}`);
  await field.fill(newName);
  await field.press("Enter");
}

function trashIsReadable(): boolean {
  try {
    readdirSync(join(homedir(), ".Trash"));
    return true;
  } catch {
    return false;
  }
}

test("undoes and redoes a rename from the Edit menu, which names it", async () => {
  await expect.poll(() => menuItem("undo")).toEqual({ label: "Undo", enabled: false });
  await rename("a.txt", "renamed.txt");
  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["b.txt", "renamed.txt"]);
  await expect.poll(() => menuItem("undo")).toEqual({ label: "Undo Rename", enabled: true });

  await choose("undo");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b.txt"]);
  expect(readFileSync(join(folder, "a.txt"), "utf8")).toBe("alpha");
  await expect.poll(() => menuItem("redo")).toEqual({ label: "Redo Rename", enabled: true });
  await expect.poll(() => menuItem("undo")).toEqual({ label: "Undo", enabled: false });

  await choose("redo");

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["b.txt", "renamed.txt"]);
});

test("puts an item back from the Trash", async () => {
  const name = `filetrail-e2e-${Date.now()}-${process.pid}.txt`;
  writeFileSync(join(folder, name), "to be put back");
  await window.keyboard.press("Meta+r");
  await waitUntil(() => isListed(name));
  await item(name).click();
  await window.keyboard.press("Meta+Backspace");
  try {
    await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b.txt"]);
    await expect
      .poll(() => menuItem("undo"))
      .toEqual({ label: `Undo Move to Trash of “${name}”`, enabled: true });

    await choose("undo");

    await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a.txt", "b.txt", name].sort());
    expect(readFileSync(join(folder, name), "utf8")).toBe("to be put back");
    if (trashIsReadable()) {
      expect(existsSync(join(homedir(), ".Trash", name))).toBe(false);
    }
    // What came back is selected.
    await waitUntil(() =>
      window.evaluate(
        (selector) => document.querySelector(selector)?.getAttribute("aria-selected") === "true",
        `[data-selectable-entry-path="${join(folder, name)}"]`,
      ),
    );
  } finally {
    rmSync(join(homedir(), ".Trash", name), { force: true });
  }
});

test("undoes the typing in the rename field, never the files", async () => {
  await rename("a.txt", "renamed.txt");
  await expect.poll(() => menuItem("undo")).toEqual({ label: "Undo Rename", enabled: true });
  await item("b.txt").click();
  await window.keyboard.press("F2");
  await waitUntil(() => hasField("Rename b.txt"));
  const field = window.getByLabel("Rename b.txt");
  // The name without its extension is selected; typing replaces it.
  await window.keyboard.type("zz");
  await expect(field).toHaveValue("zz.txt");
  // While the field has the keyboard, Undo is its own.
  await expect.poll(() => menuItem("undo")).toEqual({ label: "Undo", enabled: true });

  await choose("undo");

  await expect(field).toHaveValue("b.txt");
  expect(namesOnDisk()).toEqual(["b.txt", "renamed.txt"]);
  await field.press("Escape");
  await expect.poll(() => menuItem("undo")).toEqual({ label: "Undo Rename", enabled: true });
});
