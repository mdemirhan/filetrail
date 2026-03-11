import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createActionLogRecorder,
  createActionLogStore,
  resolveActionLogFilePath,
} from "./actionLog";

describe("actionLog", () => {
  it("appends and lists entries newest first", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-action-log-"));
    const store = createActionLogStore(resolveActionLogFilePath(root));
    const recorder = createActionLogRecorder(store);

    await recorder.recordOpenPath({
      path: "/Users/demo/a.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T09:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T09:00:00.010Z"),
    });
    await recorder.recordOpenWithApplication({
      applicationPath: "/Applications/Zed.app",
      applicationName: "Zed",
      paths: ["/Users/demo/b.txt"],
      ok: false,
      error: "Application not found",
      startedAtMs: Date.parse("2026-03-10T10:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T10:00:00.010Z"),
    });

    const items = await store.list();

    expect(items).toHaveLength(2);
    expect(items[0]?.action).toBe("open_with");
    expect(items[1]?.action).toBe("open");
    expect(items[0]?.error).toBe("Application not found");
  });

  it("rotates files when the active log exceeds the size limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-action-log-rotate-"));
    const store = createActionLogStore(resolveActionLogFilePath(root), {
      maxBytes: 250,
      maxFiles: 3,
    });
    const recorder = createActionLogRecorder(store);

    await recorder.recordOpenPath({
      path: "/Users/demo/first-long-name.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T09:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T09:00:00.010Z"),
    });
    await recorder.recordOpenPath({
      path: "/Users/demo/second-long-name.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T10:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T10:00:00.010Z"),
    });
    await recorder.recordOpenPath({
      path: "/Users/demo/third-long-name.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T11:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T11:00:00.010Z"),
    });

    const currentFile = await readFile(resolveActionLogFilePath(root), "utf8");
    const rotatedFile = await readFile(join(root, "logs", "action-log.1.jsonl"), "utf8");

    expect(currentFile.length).toBeGreaterThan(0);
    expect(rotatedFile.length).toBeGreaterThan(0);
  });
});
