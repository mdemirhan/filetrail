// The native copy (copyfile(3)) checks a stop flag between chunks, so Stop takes effect
// part way through a large file instead of once it has been copied in full.

export type NativeCopyFile = (
  sourcePath: string,
  destinationPath: string,
  stopFlag?: Int32Array,
) => Promise<void>;

/** Wraps the native copy so an AbortSignal stops it; a stopped copy rejects with the
 *  signal's AbortError and leaves no partial file. */
export function createStoppableCopyFile(copy: NativeCopyFile) {
  return async (
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (!signal) {
      await copy(sourcePath, destinationPath);
      return;
    }
    signal.throwIfAborted();
    const stopFlag = new Int32Array(1);
    const stop = () => {
      stopFlag[0] = 1;
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await copy(sourcePath, destinationPath, stopFlag);
    } catch (error) {
      if (signal.aborted && (error as NodeJS.ErrnoException | null)?.code === "ECANCELED") {
        signal.throwIfAborted();
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", stop);
    }
  };
}
