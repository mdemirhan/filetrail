import { basename, dirname, join } from "node:path";

// A mount in the mount table: where it is mounted, and whether it is a local disk.
export type Mount = { path: string; isLocal: boolean };

// Whether the disk holding a path has a Trash, for telling if copies made there can be
// undone. macOS can't be asked without making a Trash folder on the disk, so this goes by
// the kind of disk: a network share is taken to have none (Finder deletes there at once),
// anything else to have one. Wrong either way is safe: copies on a share can't be undone,
// and a copy on a disk that turns out to have no Trash is left where it is, never deleted.
// The path is followed through symlinks first (~/NAS may be /Volumes/NAS), and compared
// with every mount, wherever it is mounted, ignoring case as the startup disk does.
export function createDiskHasTrash(
  listMounts: () => readonly Mount[],
  realpath: (path: string) => string,
): (path: string) => boolean {
  return (path) => {
    const key = realPathOf(path, realpath).toLowerCase();
    let holding: Mount | null = null;
    for (const mount of listMounts()) {
      const mountKey = mount.path.toLowerCase();
      const inside =
        key === mountKey || key.startsWith(mountKey.endsWith("/") ? mountKey : `${mountKey}/`);
      if (inside && (holding === null || mount.path.length > holding.path.length)) {
        holding = mount;
      }
    }
    return holding?.isLocal ?? true;
  };
}

// Where a path really is: the nearest part of it that exists, followed through symlinks,
// with the rest added back.
function realPathOf(path: string, realpath: (path: string) => string): string {
  const rest: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(realpath(current), ...rest);
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return path;
      }
      rest.unshift(basename(current));
      current = parent;
    }
  }
}
