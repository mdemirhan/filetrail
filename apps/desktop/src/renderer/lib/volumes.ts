// Which disk a path is on, told from the path alone so a drag can show its cursor at once.
// macOS mounts every other volume at /Volumes/<name>; everything else is on the startup disk.
// (The startup disk's own entry in /Volumes is a link back to "/", but nothing in the app
// hands out paths through it.)
export function getVolumeRootPath(path: string): string {
  const match = /^\/Volumes\/([^/]+)/u.exec(path);
  return match ? `/Volumes/${match[1]}` : "/";
}

// The root of a volume: the startup disk ("/") or a disk mounted at /Volumes/<name>.
export function isVolumeRootPath(path: string): boolean {
  return getVolumeRootPath(path) === path;
}

export function isOnSameVolume(firstPath: string, secondPath: string): boolean {
  return getVolumeRootPath(firstPath) === getVolumeRootPath(secondPath);
}
