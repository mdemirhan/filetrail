import { createRendererLogger, toErrorMessage } from "./logging";

describe("logging helpers", () => {
  it("normalizes arbitrary errors to messages", () => {
    expect(toErrorMessage(new Error("bad input"))).toBe("bad input");
    expect(toErrorMessage("plain string")).toBe("plain string");
    expect(toErrorMessage(42)).toBe("42");
  });

  it("suppresses debug logs when renderer debugging is disabled", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const logger = createRendererLogger("renderer");

    logger.debug("ignored", { ok: true });

    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });

  it("formats renderer error logs with namespace and normalized error text", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createRendererLogger("renderer");

    logger.error("failed to load", new Error("disk full"));
    expect(errorSpy).toHaveBeenCalledWith("[renderer] failed to load: disk full");

    errorSpy.mockRestore();
  });
});
