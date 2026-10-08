import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication } from "playwright";

// How long the wait for a running operation may take, and then quitting.
const WITHIN_MS = 15_000;

// Quits the app at the end of a test.
//
// A test that waits on the disk sees the work done a moment before the operation is over:
// the Trash answers after the item has left its folder, and the operation is then recorded
// for Undo. Quitting in between asks whether to stop the operation, a question nobody
// answers here, so the app is quit only once no operation runs.
//
// Quitting should then take a moment. When it doesn't (a question left open, an operation
// that never ends), the test fails with the end of the app's log, rather than at the test's
// time limit with nothing to go on.
export async function quitApp(
  electronApp: ElectronApplication,
  userDataDir: string,
): Promise<void> {
  await waitForOperationsToEnd(electronApp);
  const closed = electronApp.close().then(() => true);
  const waited = new Promise<false>((resolve) => setTimeout(() => resolve(false), WITHIN_MS));
  if (await Promise.race([closed, waited])) {
    return;
  }
  let log: string;
  try {
    log = readFileSync(join(userDataDir, "logs", "app.log"), "utf8")
      .split("\n")
      .slice(-60)
      .join("\n");
  } catch (error) {
    log = `(no log: ${String(error)})`;
  }
  electronApp.process().kill("SIGKILL");
  throw new Error(`The app didn't quit within 15 seconds. The end of its log:\n${log}`);
}

// Asks a window whether a file operation is running, until none is. With no window left to
// ask (or one whose page is going away), quitting goes ahead and says what it finds.
async function waitForOperationsToEnd(electronApp: ElectronApplication): Promise<void> {
  const deadline = Date.now() + WITHIN_MS;
  while (Date.now() < deadline) {
    const page = electronApp.windows().find((candidate) => !candidate.isClosed());
    if (!page) {
      return;
    }
    let running: boolean;
    try {
      running = await page.evaluate(async () => {
        const api = (
          window as unknown as {
            filetrail?: {
              invoke(channel: string, payload: object): Promise<{ operationId: string | null }>;
            };
          }
        ).filetrail;
        return api
          ? (await api.invoke("writeOperation:getActive", {})).operationId !== null
          : false;
      });
    } catch {
      return;
    }
    if (!running) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
