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

module.exports = {
  nativeDatesTaken: binding.nativeDatesTaken,
  nativeCopyFile: binding.nativeCopyFile,
  nativeCopyMetadata: binding.nativeCopyMetadata,
  nativeGetFileIcon: binding.nativeGetFileIcon,
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
};
