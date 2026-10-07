import { execFileSync } from "node:child_process";
import {
  mkdirSync,
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

// Files dragged in from another app, in the built app, with what happens checked on disk.
// A test can't move the mouse, so the other app's drag is played in two halves: what it
// carries is written to the system's drag pasteboard, as any app's drag writes it, and the
// window is sent the drag's events, as Chromium sends them while it is over the window.

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronExecutablePath = require("electron") as unknown as string;

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
// The folder on screen, and one of another app's (the same disk).
let folder: string;
let outside: string;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), "filetrail-e2e-profile-"));
  folder = realpathSync(mkdtempSync(join(tmpdir(), "filetrail-e2e-folder-")));
  outside = realpathSync(mkdtempSync(join(tmpdir(), "filetrail-e2e-outside-")));
  writeFileSync(join(folder, "here.txt"), "here");
  mkdirSync(join(folder, "Sub"));
  writeFileSync(join(outside, "a.txt"), "alpha");
  mkdirSync(join(outside, "Pics"));
  writeFileSync(join(outside, "Pics", "p.txt"), "pic");
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
  await waitUntil(() => isListed("here.txt"), 30_000);
});

test.afterEach(async () => {
  try {
    await electronApp.close();
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// Waits by reading the page: animation frames stop while the Mac counts the window as
// hidden (see fileOperations.spec.ts).
async function waitUntil(check: () => Promise<boolean>, timeout = 15_000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true);
}

function isListed(name: string, path = folder): Promise<boolean> {
  return window.evaluate(
    (selector) => document.querySelector(selector) !== null,
    `[data-selectable-entry-path="${join(path, name)}"]`,
  );
}

function namesIn(path: string): string[] {
  return readdirSync(path)
    .filter((name) => !name.startsWith("."))
    .sort();
}

// What another app's drag of `paths` writes to the drag pasteboard.
function startOtherAppDrag(paths: string[]): void {
  const urls = paths.map((path) => `$.NSURL.fileURLWithPath(${JSON.stringify(path)})`).join(",");
  execFileSync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    `ObjC.import("AppKit");
     const pasteboard = $.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag);
     pasteboard.clearContents;
     pasteboard.writeObjects($([${urls}]));`,
  ]);
}

// Sends the window a drag event of files at the element `selector` picks, and answers with
// the cursor the window chose (its drop effect). A page can't set what a drag allows or
// read the cursor back on a DataTransfer of its own making, so the event carries a stand-in
// with what Chromium's has: the types, what the other app allows, and the cursor.
function sendDragEvent(
  type: "dragenter" | "dragover" | "drop",
  selector: string,
  effectAllowed = "all",
): Promise<string> {
  return window.evaluate(
    ({ type, selector, effectAllowed }) => {
      const target = document.querySelector(selector);
      if (!target) {
        throw new Error(`Nothing at ${selector}`);
      }
      const dataTransfer = { types: ["Files"], effectAllowed, dropEffect: "none", files: [] };
      const rect = target.getBoundingClientRect();
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 4,
        clientY: rect.top + 4,
      });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      target.dispatchEvent(event);
      return dataTransfer.dropEffect;
    },
    { type, selector, effectAllowed },
  );
}

// Holds the drag over `selector`: drag-overs every 50 ms, as a window gets them while a
// drag is over it (sent from here: the page's own timers slow down while the Mac is
// locked), until the window shows `until` as the cursor, or for `forMs`.
async function holdDrag(
  selector: string,
  options: { effectAllowed?: string; until?: string; forMs?: number },
): Promise<string> {
  const endAt = Date.now() + (options.until ? 10_000 : (options.forMs ?? 0));
  let cursor = await sendDragEvent("dragover", selector, options.effectAllowed);
  while (Date.now() < endAt && cursor !== options.until) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    cursor = await sendDragEvent("dragover", selector, options.effectAllowed);
  }
  return cursor;
}

// Drags in from the other app over `selector` until the window takes it, then drops.
async function dropAt(selector: string, cursor: "move" | "copy", effectAllowed = "all") {
  await sendDragEvent("dragenter", selector, effectAllowed);
  expect(await holdDrag(selector, { effectAllowed, until: cursor })).toBe(cursor);
  await sendDragEvent("drop", selector, effectAllowed);
}

const pane = ".content-viewport";
const row = (path: string) => `[data-selectable-entry-path="${path}"]`;

test("moves files dragged in from another app into the folder on screen, and Undo takes them back", async () => {
  startOtherAppDrag([join(outside, "a.txt"), join(outside, "Pics")]);

  await dropAt(pane, "move");

  await expect
    .poll(() => namesIn(folder), { timeout: 15_000 })
    .toEqual(["Pics", "Sub", "a.txt", "here.txt"]);
  expect(namesIn(outside)).toEqual([]);
  expect(readFileSync(join(folder, "Pics", "p.txt"), "utf8")).toBe("pic");
  await waitUntil(() => isListed("a.txt"));
  await waitUntil(() =>
    window.evaluate(
      (selector) => document.querySelector(selector)?.getAttribute("aria-selected") === "true",
      row(join(folder, "a.txt")),
    ),
  );

  // Chosen from the Edit menu, which names the move, as a click there does.
  await expect
    .poll(() =>
      electronApp.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById("undo")?.label ?? null,
      ),
    )
    .toBe("Undo Move of 2 Items");
  await electronApp.evaluate(({ BrowserWindow, Menu }) => {
    const target = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    Menu.getApplicationMenu()
      ?.getMenuItemById("undo")
      ?.click(undefined, target, target?.webContents);
  });

  await expect.poll(() => namesIn(outside), { timeout: 15_000 }).toEqual(["Pics", "a.txt"]);
  expect(namesIn(folder)).toEqual(["Sub", "here.txt"]);
});

test("copies from an app that lets its files be copied only, into a folder in the list", async () => {
  startOtherAppDrag([join(outside, "a.txt")]);

  await dropAt(row(join(folder, "Sub")), "copy", "copy");

  await expect.poll(() => namesIn(join(folder, "Sub")), { timeout: 15_000 }).toEqual(["a.txt"]);
  expect(namesIn(outside)).toEqual(["Pics", "a.txt"]);
});

test("takes no files on the path bar, nor items already in the folder", async () => {
  startOtherAppDrag([join(folder, "here.txt")]);
  await sendDragEvent("dragenter", pane);
  // Read, then refused: moving an item into its own folder does nothing.
  expect(await holdDrag(pane, { forMs: 1000 })).toBe("none");

  startOtherAppDrag([join(outside, "a.txt")]);
  // The last drag has left (no drag-overs for a while); this is a new one.
  await window.waitForTimeout(600);
  await sendDragEvent("dragenter", pane);
  expect(await holdDrag(pane, { until: "move" })).toBe("move");
  const pathField = await window.evaluate(() => {
    const field = document.querySelector("input");
    field?.setAttribute("data-test-field", "true");
    return field !== null;
  });
  expect(pathField).toBe(true);
  expect(await holdDrag("input[data-test-field]", { forMs: 300 })).toBe("none");
  await sendDragEvent("drop", "input[data-test-field]");
  await window.waitForTimeout(500);
  expect(namesIn(folder)).toEqual(["Sub", "here.txt"]);
  expect(namesIn(outside)).toEqual(["Pics", "a.txt"]);
});
