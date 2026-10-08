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
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "playwright";
import { expect, test } from "playwright/test";
import { quitApp } from "./quitApp";

// Several windows in the built app: opening them, what comes back at the next launch,
// moving tabs between them, and the clipboard they share.

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronExecutablePath = require("electron") as unknown as string;

let electronApp: ElectronApplication;
let userDataDir: string;
let folder: string;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), "filetrail-e2e-profile-"));
  folder = realpathSync(mkdtempSync(join(tmpdir(), "filetrail-e2e-folder-")));
  writeFileSync(join(folder, "a.txt"), "alpha");
  mkdirSync(join(folder, "Sub"));
  writeFileSync(join(folder, "Sub", "inside.txt"), "inside");
  electronApp = await launch(["--folder", folder]);
  await waitForListing(await electronApp.firstWindow(), join(folder, "a.txt"));
});

test.afterEach(async () => {
  try {
    await closeApp();
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(folder, { recursive: true, force: true });
  }
});

async function launch(extraArgs: string[] = []): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir, `--user-data-dir=${userDataDir}`, ...extraArgs],
    cwd: appDir,
  });
}

async function closeApp(): Promise<void> {
  await quitApp(electronApp, userDataDir);
}

// Waits by reading the page, not with the locator's own waiting, which stalls while the
// Mac's screen is locked (see fileOperations.spec.ts).
async function waitUntil(check: () => Promise<boolean>, timeout = 15_000): Promise<void> {
  await expect.poll(check, { timeout }).toBe(true);
}

// A new window can be handed over while its page is still blank: reading it while the
// app's page loads in its place fails, and is tried again.
async function waitForListing(page: Page, path: string): Promise<void> {
  await waitUntil(
    () =>
      page
        .evaluate(
          (selector) => document.querySelector(selector) !== null,
          `[data-selectable-entry-path="${path}"]`,
        )
        .catch(() => false),
    30_000,
  );
}

// The explorer windows' titles and places, front to back as macOS stacks them doesn't
// matter here: sorted by title.
async function explorerWindows(): Promise<
  Array<{ title: string; x: number; y: number; width: number; height: number }>
> {
  const windows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((window) => !window.isDestroyed() && window.getTitle() !== "Settings")
      .map((window) => ({ title: window.getTitle(), ...window.getBounds() })),
  );
  return windows.sort((left, right) => left.title.localeCompare(right.title));
}

async function pageTitled(title: string): Promise<Page> {
  let found: Page | undefined;
  await waitUntil(async () => {
    for (const page of electronApp.windows()) {
      if ((await page.title()) === title) {
        found = page;
        return true;
      }
    }
    return false;
  });
  return found as Page;
}

// Sends a menu command to one window, as the menu does to the window that has the
// keyboard (which window that is can't be relied on in a test).
async function sendCommand(page: Page, type: string): Promise<void> {
  const window = await electronApp.browserWindow(page);
  await window.evaluate((browserWindow, commandType) => {
    browserWindow.webContents.send("filetrail:command", { type: commandType });
  }, type);
}

function tabCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[role="tab"]').length);
}

function item(page: Page, path: string) {
  return page.locator(`[data-selectable-entry-path="${path}"]`).first();
}

test("opens windows on the folder on screen, and brings back those open at quit", async () => {
  const first = await electronApp.firstWindow();
  const folderName = basename(folder);
  await waitUntil(async () => (await first.title()) === folderName);

  // File › New Window, from the menu.
  const opened = electronApp.waitForEvent("window");
  await electronApp.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("newWindow")?.click();
  });
  const second = await opened;
  await waitForListing(second, join(folder, "a.txt"));
  const [one, two] = await explorerWindows();
  expect(one?.title).toBe(folderName);
  expect(two?.title).toBe(folderName);
  // Same size, a step down and to the right of the first (or back at the top left).
  expect(two?.width).toBe(one?.width);
  expect(Math.abs((two?.x ?? 0) - (one?.x ?? 0))).toBeGreaterThan(0);

  // Open in New Window, on a selected folder.
  await item(first, join(folder, "Sub")).click();
  const third = electronApp.waitForEvent("window");
  await sendCommand(first, "openSelectionInNewWindow");
  await waitForListing(await third, join(folder, "Sub", "inside.txt"));
  await pageTitled("Sub");
  expect((await explorerWindows()).map((window) => window.title)).toEqual([
    folderName,
    folderName,
    "Sub",
  ]);

  // Closing a window that isn't the last leaves the app running, and the window doesn't
  // come back.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.getTitle() === "Sub")
      ?.close();
  });
  await waitUntil(async () => (await explorerWindows()).length === 2);

  await closeApp();
  const saved = JSON.parse(readFileSync(join(userDataDir, "app-state.json"), "utf8"));
  expect(saved.windows).toHaveLength(2);

  electronApp = await launch();
  await waitUntil(async () => (await explorerWindows()).length === 2, 30_000);
  await waitUntil(async () =>
    (await explorerWindows()).every((window) => window.title === folderName),
  );
});

test("brings back each window's place and which was in front", async () => {
  const first = await electronApp.firstWindow();
  await item(first, join(folder, "Sub")).click();
  const opened = electronApp.waitForEvent("window");
  await sendCommand(first, "openSelectionInNewWindow");
  await waitForListing(await opened, join(folder, "Sub", "inside.txt"));
  await pageTitled("Sub");
  // Each window somewhere of its own; the first one in front.
  await electronApp.evaluate(({ BrowserWindow }, folderName) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.getTitle() === "Sub") {
        window.setBounds({ x: 220, y: 140, width: 900, height: 620 });
      } else if (window.getTitle() === folderName) {
        window.setBounds({ x: 60, y: 60, width: 1000, height: 700 });
      }
    }
    BrowserWindow.getAllWindows()
      .find((window) => window.getTitle() === folderName)
      ?.focus();
  }, basename(folder));
  await waitUntil(async () => {
    const saved = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getFocusedWindow()?.getTitle(),
    );
    return saved === basename(folder);
  });

  await closeApp();
  const saved = JSON.parse(readFileSync(join(userDataDir, "app-state.json"), "utf8"));
  expect(saved.windows.map((window: { bounds: { x: number } }) => window.bounds.x)).toEqual([
    60, 220,
  ]);

  electronApp = await launch();
  await waitUntil(async () => (await explorerWindows()).length === 2, 30_000);
  await waitUntil(async () => (await explorerWindows()).some((window) => window.title === "Sub"));
  const windows = await explorerWindows();
  expect(windows.find((window) => window.title === "Sub")).toMatchObject({
    x: 220,
    y: 140,
    width: 900,
    height: 620,
  });
  expect(windows.find((window) => window.title === basename(folder))).toMatchObject({
    x: 60,
    y: 60,
    width: 1000,
    height: 700,
  });
  await waitUntil(async () =>
    electronApp
      .evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle() ?? null)
      .then((title) => title === basename(folder)),
  );
});

test("moves a tab to a window of its own, and merges the windows back", async () => {
  const first = await electronApp.firstWindow();
  await item(first, join(folder, "Sub")).click();
  await sendCommand(first, "openSelectionInNewTab");
  await waitUntil(async () => (await tabCount(first)) === 2);

  const moved = electronApp.waitForEvent("window");
  await sendCommand(first, "moveTabToNewWindow");
  await waitForListing(await moved, join(folder, "Sub", "inside.txt"));
  await waitUntil(async () => (await tabCount(first)) === 0);
  expect((await explorerWindows()).map((window) => window.title)).toEqual([
    basename(folder),
    "Sub",
  ]);

  await sendCommand(first, "mergeAllWindows");
  await waitUntil(async () => (await explorerWindows()).length === 1);
  await waitUntil(async () => (await tabCount(first)) === 2);
});

test("pastes in one window what was copied in another", async () => {
  const first = await electronApp.firstWindow();
  await item(first, join(folder, "Sub")).click();
  const opened = electronApp.waitForEvent("window");
  await sendCommand(first, "openSelectionInNewWindow");
  const second = await opened;
  await waitForListing(second, join(folder, "Sub", "inside.txt"));

  await item(first, join(folder, "a.txt")).click();
  await first.keyboard.press("Meta+c");
  // The other window shows it is waiting to be pasted, and pastes it into its folder.
  await waitUntil(() =>
    second.evaluate(() =>
      Array.from(document.querySelectorAll("button")).some((button) =>
        button.getAttribute("aria-label")?.startsWith("Clipboard: 1 item copied"),
      ),
    ),
  );
  await second.keyboard.press("Meta+v");

  await expect
    .poll(() => readdirSync(join(folder, "Sub")).sort(), { timeout: 15_000 })
    .toEqual(["a.txt", "inside.txt"]);
  expect(readFileSync(join(folder, "Sub", "a.txt"), "utf8")).toBe("alpha");
});

test("stays open with no window, and opens one where the last one closed", async () => {
  const first = await electronApp.firstWindow();
  await item(first, join(folder, "Sub")).dblclick();
  await waitForListing(first, join(folder, "Sub", "inside.txt"));
  const allWindowCount = () =>
    electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const menuItemEnabled = (id: string) =>
    electronApp.evaluate(
      ({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.enabled ?? null,
      id,
    );
  const closeOnlyWindow = async () => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.close();
      }
    });
    await waitUntil(async () => (await allWindowCount()) === 0);
  };

  await closeOnlyWindow();
  // Still running, with only what opens a window on offer.
  expect(await menuItemEnabled("newWindow")).toBe(true);
  expect(await menuItemEnabled("goDesktop")).toBe(true);
  expect(await menuItemEnabled("goBack")).toBe(false);
  expect(await menuItemEnabled("emptyTrash")).toBe(false);

  // The Dock icon is clicked: a window opens where the last one was.
  const reopened = electronApp.waitForEvent("window");
  await electronApp.evaluate(({ app }) => {
    app.emit("activate");
  });
  await waitForListing(await reopened, join(folder, "Sub", "inside.txt"));
  await closeOnlyWindow();

  // A place in the Go menu opens a window there.
  const toDesktop = electronApp.waitForEvent("window");
  await electronApp.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById("goDesktop")?.click();
  });
  const desktopWindow = await toDesktop;
  await waitUntil(async () => (await desktopWindow.title().catch(() => "")) === "Desktop", 30_000);
  // Then the one window open is closed, and the app quits.
  await closeOnlyWindow();
  await closeApp();

  // The next launch opens one window, where the last one was.
  electronApp = await launch();
  await waitUntil(async () => (await explorerWindows()).length === 1, 30_000);
  await waitUntil(async () => (await explorerWindows())[0]?.title === "Desktop", 30_000);
});
