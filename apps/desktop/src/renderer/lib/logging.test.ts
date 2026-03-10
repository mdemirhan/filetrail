// @vitest-environment jsdom

import {
  createRendererLogger,
  installGlobalRendererErrorHandlers,
  toErrorMessage,
} from "./logging";

describe("logging helpers", () => {
  const originalFiletrail = window.filetrail;

  afterEach(() => {
    if (originalFiletrail === undefined) {
      delete window.filetrail;
    } else {
      window.filetrail = originalFiletrail;
    }
    delete (window as Window & { __filetrailGlobalLogHandlersInstalled?: boolean })
      .__filetrailGlobalLogHandlersInstalled;
    vi.restoreAllMocks();
  });

  it("normalizes arbitrary errors to messages", () => {
    expect(toErrorMessage(new Error("bad input"))).toContain("bad input");
    expect(toErrorMessage("plain string")).toBe("plain string");
    expect(toErrorMessage(42)).toBe("42");
  });

  it("forwards renderer logs to the preload bridge when available", async () => {
    const log = vi.fn<(entry: unknown) => Promise<void>>(async () => undefined);
    window.filetrail = {
      invoke: vi.fn(),
      log,
      onCommand: vi.fn(() => () => undefined),
      onWriteOperationProgress: vi.fn(() => () => undefined),
      onCopyPasteProgress: vi.fn(() => () => undefined),
    };
    const logger = createRendererLogger("renderer");

    logger.error("failed to load", new Error("disk full"));
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith({
      level: "error",
      namespace: "renderer",
      message: "failed to load",
      error: expect.stringContaining("disk full"),
      context: {},
    });
  });

  it("treats a plain object second argument as structured context", async () => {
    const log = vi.fn<(entry: unknown) => Promise<void>>(async () => undefined);
    window.filetrail = {
      invoke: vi.fn(),
      log,
      onCommand: vi.fn(() => () => undefined),
      onWriteOperationProgress: vi.fn(() => () => undefined),
      onCopyPasteProgress: vi.fn(() => () => undefined),
    };
    const logger = createRendererLogger("renderer");

    logger.error("failed to load", { code: 42, path: "/tmp/demo" });
    await Promise.resolve();

    expect(log).toHaveBeenCalledWith({
      level: "error",
      namespace: "renderer",
      message: "failed to load",
      error: null,
      context: {
        code: 42,
        path: "/tmp/demo",
      },
    });
  });

  it("falls back to console formatting when the preload bridge is unavailable", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createRendererLogger("renderer");

    logger.error("failed to load", new Error("disk full"));
    expect(errorSpy).toHaveBeenCalledWith(
      "[renderer] failed to load",
      expect.stringContaining("disk full"),
    );
  });

  it("installs global renderer error handlers once and forwards uncaught errors", async () => {
    const log = vi.fn<(entry: unknown) => Promise<void>>(async () => undefined);
    window.filetrail = {
      invoke: vi.fn(),
      log,
      onCommand: vi.fn(() => () => undefined),
      onWriteOperationProgress: vi.fn(() => () => undefined),
      onCopyPasteProgress: vi.fn(() => () => undefined),
    };

    installGlobalRendererErrorHandlers("filetrail.renderer");
    installGlobalRendererErrorHandlers("filetrail.renderer");

    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom",
        filename: "App.tsx",
        lineno: 10,
        colno: 4,
        error: new Error("boom"),
      }),
    );
    const rejectionEvent = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejectionEvent, "reason", {
      value: new Error("rejected"),
    });
    window.dispatchEvent(rejectionEvent);
    await Promise.resolve();

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      level: "error",
      namespace: "filetrail.renderer",
      message: "uncaught renderer error",
    });
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      level: "error",
      namespace: "filetrail.renderer",
      message: "unhandled renderer rejection",
    });
  });
});
