import { createStoppableCopyFile } from "./stoppableCopy";

describe("createStoppableCopyFile", () => {
  it("copies without a stop flag when nothing can stop it", async () => {
    const copy = vi.fn(async () => undefined);
    await createStoppableCopyFile(copy)("/a", "/b");
    expect(copy).toHaveBeenCalledWith("/a", "/b");
  });

  it("raises the stop flag when stopped, and rejects with the stop", async () => {
    const controller = new AbortController();
    let flag: Int32Array | undefined;
    const copy = vi.fn(async (_from: string, _to: string, stopFlag?: Int32Array) => {
      flag = stopFlag;
      controller.abort();
      throw Object.assign(new Error("ECANCELED"), { code: "ECANCELED" });
    });

    await expect(
      createStoppableCopyFile(copy)("/a", "/b", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(flag?.[0]).toBe(1);
  });

  // A disk error that comes as the copy is stopped is still that error, not "stopped".
  it("passes on another error even after a stop", async () => {
    const controller = new AbortController();
    const copy = vi.fn(async () => {
      controller.abort();
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    });

    await expect(
      createStoppableCopyFile(copy)("/a", "/b", controller.signal),
    ).rejects.toMatchObject({ code: "EIO" });
  });

  it("doesn't start a copy already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const copy = vi.fn(async () => undefined);

    await expect(createStoppableCopyFile(copy)("/a", "/b", controller.signal)).rejects.toThrow();
    expect(copy).not.toHaveBeenCalled();
  });
});
