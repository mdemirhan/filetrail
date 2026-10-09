import { COPY_PROGRESS_INTERVAL_MS, createStoppableCopyFile } from "./stoppableCopy";

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

  // The native copy writes the bytes copied so far as one 64-bit count after the flag.
  it("reports the bytes copied so far while the copy runs, and stops reading after", async () => {
    vi.useFakeTimers();
    try {
      let flag: Int32Array | undefined;
      let finish: () => void = () => undefined;
      const copy = vi.fn(
        (_from: string, _to: string, stopFlag?: Int32Array) =>
          new Promise<void>((resolve) => {
            flag = stopFlag;
            finish = resolve;
          }),
      );
      const progress: number[] = [];
      const copying = createStoppableCopyFile(copy)("/a", "/b", undefined, (bytes) =>
        progress.push(bytes),
      );
      const copied = new BigInt64Array(flag?.buffer as ArrayBuffer, 8, 1);

      // Past what one 32-bit number holds, as a large video is.
      copied[0] = 5_000_000_000n;
      await vi.advanceTimersByTimeAsync(COPY_PROGRESS_INTERVAL_MS);
      // Not told again while the count stands still.
      await vi.advanceTimersByTimeAsync(COPY_PROGRESS_INTERVAL_MS);
      copied[0] = 20_000_000_000n;
      await vi.advanceTimersByTimeAsync(COPY_PROGRESS_INTERVAL_MS);
      finish();
      await copying;
      copied[0] = 30_000_000_000n;
      await vi.advanceTimersByTimeAsync(COPY_PROGRESS_INTERVAL_MS * 4);

      expect(progress).toEqual([5_000_000_000, 20_000_000_000]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't start a copy already stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const copy = vi.fn(async () => undefined);

    await expect(createStoppableCopyFile(copy)("/a", "/b", controller.signal)).rejects.toThrow();
    expect(copy).not.toHaveBeenCalled();
  });
});
