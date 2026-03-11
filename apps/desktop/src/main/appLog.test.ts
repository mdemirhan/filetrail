import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAppLogger, resolveAppLogFilePath } from "./appLog";

describe("appLog", () => {
  it("persists regular log lines to disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-app-log-"));
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = createAppLogger(resolveAppLogFilePath(root), {
      sink,
    });

    logger.info("[filetrail] app start", {
      pid: 1234,
      platform: "darwin",
    });
    logger.error("[filetrail] ipc directory:getSnapshot failed", new Error("boom"));
    logger.warn("[filetrail] renderer process unresponsive", { windowId: 1 });
    await logger.flush();

    const raw = await readFile(resolveAppLogFilePath(root), "utf8");
    expect(raw).toContain("INFO [filetrail] app start");
    expect(raw).toContain("pid: 1234");
    expect(raw).toContain("ERROR [filetrail] ipc directory:getSnapshot failed");
    expect(raw).toContain("WARN [filetrail] renderer process unresponsive");
    expect(raw).toContain("Error: boom");
    expect(sink.info).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
    expect(sink.warn).toHaveBeenCalledTimes(1);
  });

  it("skips debug logs unless debug mode is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-app-log-debug-off-"));
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = createAppLogger(resolveAppLogFilePath(root), {
      debugEnabled: false,
      sink,
    });

    logger.debug("[filetrail] tree:getChildren /Users/demo 180ms");
    logger.info("[filetrail] app start");
    await logger.flush();

    const raw = await readFile(resolveAppLogFilePath(root), "utf8");
    expect(raw).toContain("INFO [filetrail] app start");
    expect(raw).not.toContain("DEBUG");
    expect(sink.debug).not.toHaveBeenCalled();
  });

  it("persists debug logs when debug mode is enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-app-log-debug-on-"));
    const sink = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = createAppLogger(resolveAppLogFilePath(root), {
      debugEnabled: true,
      sink,
    });

    logger.debug("[filetrail] tree:getChildren /Users/demo 180ms");
    await logger.flush();

    const raw = await readFile(resolveAppLogFilePath(root), "utf8");
    expect(raw).toContain("DEBUG [filetrail] tree:getChildren /Users/demo 180ms");
    expect(sink.debug).toHaveBeenCalledTimes(1);
  });

  it("rotates the persisted app log when the file exceeds the size limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-app-log-rotate-"));
    const logger = createAppLogger(resolveAppLogFilePath(root), {
      maxBytes: 140,
      maxFiles: 3,
      sink: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    logger.info("[filetrail] first entry", { path: "/Users/demo/first-long-path.txt" });
    logger.info("[filetrail] second entry", { path: "/Users/demo/second-long-path.txt" });
    logger.info("[filetrail] third entry", { path: "/Users/demo/third-long-path.txt" });
    await logger.flush();

    const current = await readFile(resolveAppLogFilePath(root), "utf8");
    const rotated = await readFile(join(root, "logs", "app.1.log"), "utf8");

    expect(current).toContain("third entry");
    expect(rotated.length).toBeGreaterThan(0);
  });
});
