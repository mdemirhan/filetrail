const fs = require("node:fs");
const binding = require("node-gyp-build")(__dirname);

/*
 * The C addon supports at most one active folder size calculation (a single
 * `active_work` slot drives cancellation). Serialize calls here: the first
 * call starts the native work synchronously (so an immediate cancel targets
 * it), later calls queue and start after the active one settles.
 */
let activeFolderSize = null;
const folderSizeQueue = [];

function startFolderSize(folderPath) {
  const promise = binding.nativeFolderSize(folderPath);
  activeFolderSize = promise;
  const onSettled = () => {
    activeFolderSize = null;
    const next = folderSizeQueue.shift();
    if (next) {
      startFolderSize(next.folderPath).then(next.resolve, next.reject);
    }
  };
  promise.then(onSettled, onSettled);
  return promise;
}

function nativeFolderSize(folderPath) {
  if (activeFolderSize === null) {
    return startFolderSize(folderPath);
  }
  return new Promise((resolve, reject) => {
    folderSizeQueue.push({ folderPath, resolve, reject });
  });
}

/*
 * Fallbacks for a binary built before these functions existed. The rename one checks
 * first, which leaves a tiny window the native RENAME_EXCL version doesn't have.
 */
async function renameExclusiveFallback(from, to) {
  try {
    await fs.promises.lstat(to);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      await fs.promises.rename(from, to);
      return;
    }
    throw error;
  }
  throw Object.assign(new Error(`EEXIST: file already exists, rename '${from}' -> '${to}'`), {
    code: "EEXIST",
    syscall: "rename",
    path: from,
    dest: to,
  });
}

// Without it, callers fall back to setting the mode and dates themselves.
const copyMetadataFallback = undefined;

async function isCaseSensitiveFallback() {
  return null;
}

async function getFileThumbnailFallback() {
  return null;
}

function kindForPathFallback() {
  return null;
}

module.exports = {
  nativeCopyFile: binding.nativeCopyFile,
  nativeCopyMetadata: binding.nativeCopyMetadata ?? copyMetadataFallback,
  nativeGetFileIcon: binding.nativeGetFileIcon,
  nativeGetFileThumbnail: binding.nativeGetFileThumbnail ?? getFileThumbnailFallback,
  nativeKindForPath: binding.nativeKindForPath ?? kindForPathFallback,
  nativeFolderSize,
  nativeFolderSizeCancel: binding.nativeFolderSizeCancel,
  nativeRenameExclusive: binding.nativeRenameExclusive ?? renameExclusiveFallback,
  nativeIsCaseSensitive: binding.nativeIsCaseSensitive ?? isCaseSensitiveFallback,
};
