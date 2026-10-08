import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ElectronApplication, type Page, _electron as electron } from "playwright";
import { expect, test } from "playwright/test";

// Quitting while the app works in the background: the process ends at once, and leaves
// nothing running after it. The windows closed straight away before, but a folder
// measurement kept the process alive with no window until it finished, and a search's fd
// went on searching the disk after the app had gone.

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const electronExecutablePath = require("electron") as unknown as string;

// Long enough for an app with nothing left to do, far shorter than measuring a disk.
const QUIT_WITHIN_MS = 3_000;

let electronApp: ElectronApplication;
let appPid: number | null = null;
let userDataDir: string;
// The query of the search started, whose fd is ended after the test if it was left.
let searchQuery: string | null = null;

test.beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), "filetrail-e2e-quit-"));
  electronApp = await electron.launch({
    executablePath: electronExecutablePath,
    args: [appDir, `--user-data-dir=${userDataDir}`],
    cwd: appDir,
  });
  appPid = electronApp.process().pid ?? null;
});

test.afterEach(() => {
  try {
    if (appPid !== null && isRunning(appPid)) {
      process.kill(appPid, "SIGKILL");
    }
    if (searchQuery) {
      for (const pid of fdProcessesFor(searchQuery)) {
        process.kill(Number(pid), "SIGKILL");
      }
    }
  } finally {
    appPid = null;
    searchQuery = null;
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

async function ready(): Promise<Page> {
  const page = await electronApp.firstWindow();
  await expect
    .poll(() => page.evaluate(() => "filetrail" in window).catch(() => false), {
      timeout: 30_000,
    })
    .toBe(true);
  return page;
}

function invoke(page: Page, channel: string, payload: object): Promise<Record<string, unknown>> {
  return page.evaluate(
    ([channel, payload]) =>
      (
        window as unknown as {
          filetrail: { invoke(channel: string, payload: object): Promise<Record<string, unknown>> };
        }
      ).filetrail.invoke(channel, payload),
    [channel, payload] as const,
  );
}

// Quits as ⌘Q does, and resolves with how long the process took to end.
async function quitAndTime(): Promise<number> {
  const pid = appPid as number;
  const started = Date.now();
  await electronApp
    .evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0);
    })
    .catch(() => undefined);
  while (isRunning(pid) && Date.now() - started < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return Date.now() - started;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("quitting while a folder is measured ends the process at once", async () => {
  const page = await ready();
  // The whole startup disk: seconds to minutes to measure.
  const { jobId } = await invoke(page, "folderSize:start", {
    path: "/System/Volumes/Data",
    recalculate: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const { status } = await invoke(page, "folderSize:getStatus", { jobId: jobId as string });
  test.skip(status !== "running", "The disk was measured before the app quit.");

  expect(await quitAndTime()).toBeLessThan(QUIT_WITHIN_MS);
});

test("quitting while a search runs leaves no fd behind", async () => {
  const page = await ready();
  // Matches nothing, so fd searches the whole disk without writing a line.
  const query = `filetrail-quit-${Date.now()}-nomatch`;
  searchQuery = query;
  await invoke(page, "search:start", {
    rootPath: "/",
    query,
    includeHidden: true,
    skipGitFolders: false,
  });
  await expect.poll(() => fdProcessesFor(query), { timeout: 5_000 }).not.toHaveLength(0);

  expect(await quitAndTime()).toBeLessThan(QUIT_WITHIN_MS);
  await expect.poll(() => fdProcessesFor(query), { timeout: 2_000 }).toHaveLength(0);
});

function fdProcessesFor(query: string): string[] {
  try {
    return execFileSync("pgrep", ["-f", query], { encoding: "utf8" }).trim().split("\n");
  } catch {
    // pgrep exits with 1 when nothing matches.
    return [];
  }
}
