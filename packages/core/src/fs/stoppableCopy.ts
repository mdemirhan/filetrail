// The native copy (copyfile(3)) checks a stop flag between chunks, so Stop takes effect
// part way through a large file instead of once it has been copied in full. It also writes
// the bytes copied so far next to the flag, so a large file shows progress as it goes.

export type NativeCopyFile = (
  sourcePath: string,
  destinationPath: string,
  stopFlag?: Int32Array,
) => Promise<void>;

// How often the bytes copied so far are read while a file is being copied.
export const COPY_PROGRESS_INTERVAL_MS = 250;

/** Wraps the native copy so an AbortSignal stops it; a stopped copy rejects with the
 *  signal's AbortError and leaves no partial file. `onProgress` is told the bytes of the
 *  file copied so far, at most every COPY_PROGRESS_INTERVAL_MS and only when it grew. */
export function createStoppableCopyFile(copy: NativeCopyFile) {
  return async (
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal,
    onProgress?: (copiedBytes: number) => void,
  ): Promise<void> => {
    if (!signal && !onProgress) {
      await copy(sourcePath, destinationPath);
      return;
    }
    signal?.throwIfAborted();
    // Element 0 is the stop flag; elements 2-3 are the 64-bit count the copy writes.
    const stopFlag = new Int32Array(4);
    const copied = new BigInt64Array(stopFlag.buffer, 8, 1);
    const stop = () => {
      stopFlag[0] = 1;
    };
    signal?.addEventListener("abort", stop, { once: true });
    let reported = 0;
    const timer = onProgress
      ? setInterval(() => {
          const bytes = Number(copied[0]);
          if (bytes > reported) {
            reported = bytes;
            onProgress(bytes);
          }
        }, COPY_PROGRESS_INTERVAL_MS)
      : null;
    try {
      await copy(sourcePath, destinationPath, stopFlag);
    } catch (error) {
      if (signal?.aborted && (error as NodeJS.ErrnoException | null)?.code === "ECANCELED") {
        signal.throwIfAborted();
      }
      throw error;
    } finally {
      if (timer !== null) {
        clearInterval(timer);
      }
      signal?.removeEventListener("abort", stop);
    }
  };
}
