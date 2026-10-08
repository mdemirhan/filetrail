const binding = require("node-gyp-build")(__dirname);

/*
 * The C addon supports at most one active folder size calculation (a single
 * `active_work` slot drives cancellation). Serialize calls here: the first
 * call starts the native work synchronously (so an immediate cancel targets
 * it), later calls queue and start after the active one settles.
 */
let activeFolderSize = null;
const folderSizeQueue = [];

// How often the folders a walk has finished are taken while it runs.
const FINISHED_FOLDERS_INTERVAL_MS = 200;

// Hands folders a walk finished to `onFinished`, which must not stop the walk by throwing.
function deliverFinished(onFinished, json) {
  if (json === null || json === undefined) {
    return;
  }
  try {
    onFinished(json);
  } catch (error) {
    console.error("[native-fs] handling finished folders failed", error);
  }
}

function startFolderSize(folderPath, onFinished, options) {
  const promise = binding.nativeFolderSize(folderPath, options?.background === true);
  activeFolderSize = promise;
  // Taken only while this walk is the active one: each take empties the list, and what is
  // left when the walk ends comes with its result (or, when cancelled, with its error).
  const timer = onFinished
    ? setInterval(() => {
        let json = null;
        try {
          json = binding.nativeFolderSizeTakeFinished();
        } catch (error) {
          console.error("[native-fs] taking finished folders failed", error);
        }
        deliverFinished(onFinished, json);
      }, FINISHED_FOLDERS_INTERVAL_MS)
    : null;
  const onSettled = () => {
    activeFolderSize = null;
    const next = folderSizeQueue.shift();
    if (next) {
      startFolderSize(next.folderPath, next.onFinished, next.options).then(
        next.resolve,
        next.reject,
      );
    }
  };
  promise.then(onSettled, onSettled);
  return promise.then(
    (json) => {
      if (timer !== null) {
        clearInterval(timer);
      }
      return json;
    },
    (error) => {
      if (timer !== null) {
        clearInterval(timer);
      }
      // Folders finished before a cancel or a failure are whole: they are handed over before
      // the error.
      if (error && typeof error.finished === "string") {
        const finished = error.finished;
        error.finished = undefined;
        if (onFinished) {
          deliverFinished(onFinished, finished);
        }
      }
      throw error;
    },
  );
}

function nativeFolderSize(folderPath, onFinished, options) {
  if (activeFolderSize === null) {
    return startFolderSize(folderPath, onFinished, options);
  }
  return new Promise((resolve, reject) => {
    folderSizeQueue.push({ folderPath, onFinished, options, resolve, reject });
  });
}

module.exports = {
  nativeDatesTaken: binding.nativeDatesTaken,
  nativeCopyFile: binding.nativeCopyFile,
  nativeCopyMetadata: binding.nativeCopyMetadata,
  nativeGetFileIcon: binding.nativeGetFileIcon,
  nativeStartFileDrag: binding.nativeStartFileDrag,
  nativeReadDragPasteboard: binding.nativeReadDragPasteboard,
  nativeGetFileThumbnail: binding.nativeGetFileThumbnail,
  nativeKindForPath: binding.nativeKindForPath,
  nativeFolderSize,
  nativeFolderSizeCancel: binding.nativeFolderSizeCancel,
  nativeItemSize: binding.nativeItemSize,
  nativeRenameExclusive: binding.nativeRenameExclusive,
  nativeIsCaseSensitive: binding.nativeIsCaseSensitive,
  nativeIsPackage: binding.nativeIsPackage,
  nativeGetFlags: binding.nativeGetFlags,
  nativeSetFlags: binding.nativeSetFlags,
  nativeListVolumes: binding.nativeListVolumes,
  nativeTrashItem: binding.nativeTrashItem,
};
