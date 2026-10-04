import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "playwright";
import { expect, test } from "playwright/test";

// Renaming several items in the built app, through the Rename sheet, with what happens
// checked on disk.

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronExecutablePath = require("electron") as unknown as string;

let electronApp: ElectronApplication | null = null;
let window: Page;
let userDataDir: string;
let folder: string;

async function launch(): Promise<void> {
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
}

async function quit(): Promise<void> {
  await electronApp?.close();
  electronApp = null;
}

function makeFiles(files: Record<string, string>): void {
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(folder, name), contents);
  }
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), "filetrail-e2e-profile-"));
  folder = realpathSync(mkdtempSync(join(tmpdir(), "filetrail-e2e-folder-")));
});

test.afterEach(async () => {
  await quit();
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
});

// Waits by reading the page (see fileOperations.spec.ts): animation frames stop while the
// Mac counts the window as hidden.
async function waitUntil(check: () => Promise<boolean>, timeout = 15_000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true);
}

function item(name: string) {
  return window.locator(`[data-selectable-entry-path="${join(folder, name)}"]`).first();
}

function isListed(name: string): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector) !== null,
    `[data-selectable-entry-path="${join(folder, name)}"]`,
  );
}

function namesOnDisk(): string[] {
  return readdirSync(folder)
    .filter((name) => !name.startsWith("."))
    .sort();
}

function sheetIsOpen(): Promise<boolean> {
  return window.evaluate(() => document.querySelector("dialog.batch-rename-sheet") !== null);
}

function previewText(): Promise<string> {
  return window.evaluate(() => document.querySelector(".batch-rename-rows")?.textContent ?? "");
}

// Selects the items (in the list's order) and opens the Rename sheet with F2.
async function openSheetFor(names: string[]): Promise<void> {
  await waitUntil(() => isListed(names[0] ?? ""), 30_000);
  const [first, ...rest] = names;
  await item(first ?? "").click();
  for (const name of rest) {
    await item(name).click({ modifiers: ["Meta"] });
  }
  await window.keyboard.press("F2");
  await waitUntil(sheetIsOpen);
  // The checks have come back once no row says it is being checked.
  await waitUntil(async () =>
    window.evaluate(
      () => !document.querySelector(".batch-rename-summary")?.textContent?.includes("Checking"),
    ),
  );
}

const sheet = () => window.locator("dialog.batch-rename-sheet");

async function chooseMode(label: string): Promise<void> {
  await sheet().locator("label.segmented-item", { hasText: label }).click();
}

async function clickRename(): Promise<void> {
  await sheet().locator(".batch-rename-footer .push-button.is-default").click();
  await waitUntil(async () => !(await sheetIsOpen()));
}

test("adds text to the names of several files", async () => {
  makeFiles({ "a.txt": "alpha", "b.txt": "beta" });
  await launch();
  await openSheetFor(["a.txt", "b.txt"]);
  await chooseMode("Add Text");
  await sheet().getByLabel("Text", { exact: true }).fill("-old");
  await waitUntil(async () => (await previewText()).includes("b-old.txt"));
  // Return in a field renames, as the sheet's default button.
  await sheet().getByLabel("Text", { exact: true }).press("Enter");
  await waitUntil(async () => !(await sheetIsOpen()));

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["a-old.txt", "b-old.txt"]);
  expect(readFileSync(join(folder, "a-old.txt"), "utf8")).toBe("alpha");
  expect(readFileSync(join(folder, "b-old.txt"), "utf8")).toBe("beta");
});

test("adds a number to a name another file in the folder has", async () => {
  makeFiles({ "a.txt": "alpha", "b.txt": "beta", "a-old.txt": "already here" });
  await launch();
  await openSheetFor(["a.txt", "b.txt"]);
  await chooseMode("Add Text");
  await sheet().getByLabel("Text", { exact: true }).fill("-old");
  await waitUntil(async () => (await previewText()).includes("a-old 2.txt"));
  await clickRename();

  await expect
    .poll(namesOnDisk, { timeout: 15_000 })
    .toEqual(["a-old 2.txt", "a-old.txt", "b-old.txt"]);
  expect(readFileSync(join(folder, "a-old.txt"), "utf8")).toBe("already here");
  expect(readFileSync(join(folder, "a-old 2.txt"), "utf8")).toBe("alpha");
});

test("passes names along: one file takes the name another gives up", async () => {
  makeFiles({ "y 1.txt": "first", "y 2.txt": "second" });
  await launch();
  await openSheetFor(["y 1.txt", "y 2.txt"]);
  await chooseMode("Format");
  await sheet().getByLabel("Custom Format").fill("y");
  await sheet().getByLabel("Start numbers at").fill("2");
  await waitUntil(async () => (await previewText()).includes("y 3.txt"));
  await clickRename();

  await expect.poll(namesOnDisk, { timeout: 15_000 }).toEqual(["y 2.txt", "y 3.txt"]);
  expect(readFileSync(join(folder, "y 2.txt"), "utf8")).toBe("first");
  expect(readFileSync(join(folder, "y 3.txt"), "utf8")).toBe("second");
  // Nothing is left under a temporary name.
  expect(readdirSync(folder).filter((name) => name.startsWith(".filetrail"))).toEqual([]);
});

test("names files by the date they were created, numbering repeats", async () => {
  makeFiles({ "a.txt": "alpha", "b.txt": "beta" });
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  await launch();
  await openSheetFor(["a.txt", "b.txt"]);
  await chooseMode("Format");
  await sheet().getByLabel("Name Format").selectOption("date");
  await sheet().getByLabel("Date Separator").selectOption("");
  await sheet().getByLabel("Custom Format").fill("Notes");
  await waitUntil(async () => (await previewText()).includes(`Notes ${stamp} 2.txt`));
  await clickRename();

  await expect
    .poll(namesOnDisk, { timeout: 15_000 })
    .toEqual([`Notes ${stamp} 2.txt`, `Notes ${stamp}.txt`]);
});

test("keeps the settings and presets after the app quits", async () => {
  makeFiles({ "a.txt": "alpha", "b.txt": "beta" });
  await launch();
  await openSheetFor(["a.txt", "b.txt"]);
  await chooseMode("Add Text");
  await sheet().getByLabel("Text", { exact: true }).fill("-draft");
  await sheet().getByLabel("Presets").selectOption("save");
  await sheet().getByLabel("Preset name").fill("Drafts");
  await sheet().getByLabel("Preset name").press("Enter");
  await waitUntil(async () =>
    window.evaluate(() => document.querySelector('input[aria-label="Preset name"]') === null),
  );
  // The keyboard is back on the Presets pop-up, so Escape closes the sheet.
  await waitUntil(async () =>
    window.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Presets"),
  );
  await window.keyboard.press("Escape");
  await waitUntil(async () => !(await sheetIsOpen()));
  await quit();

  await launch();
  await openSheetFor(["a.txt", "b.txt"]);
  // The mode and text as left, and the preset saved.
  await waitUntil(async () => (await previewText()).includes("a-draft.txt"));
  await expect(sheet().getByLabel("Text", { exact: true })).toHaveValue("-draft");
  await expect(sheet().getByLabel("Presets").locator("option", { hasText: "Drafts" })).toHaveCount(
    1,
  );
  expect(namesOnDisk()).toEqual(["a.txt", "b.txt"]);
});
