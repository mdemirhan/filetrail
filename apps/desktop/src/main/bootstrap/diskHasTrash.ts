import type { Volume } from "@filetrail/contracts";

// Whether the disk holding a path has a Trash, for telling if copies made there can be
// undone. macOS can't be asked without making a Trash folder on the disk, so this goes by
// the kind of disk: a network share is taken to have none (Finder deletes there at once),
// anything else to have one. Wrong either way is safe: copies on a share can't be undone,
// and a copy on a disk that turns out to have no Trash is left where it is, never deleted.
export function createDiskHasTrash(
  listVolumes: () => readonly Volume[],
): (path: string) => boolean {
  return (path) => {
    let holding: Volume | null = null;
    for (const volume of listVolumes()) {
      const inside = path === volume.path || path.startsWith(`${volume.path}/`);
      if (inside && (holding === null || volume.path.length > holding.path.length)) {
        holding = volume;
      }
    }
    return holding?.isLocal ?? true;
  };
}
