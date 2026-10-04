import type { Volume } from "@filetrail/contracts";

// The disks mounted besides the startup disk, and word of each change to them. macOS mounts
// every disk at /Volumes/<name>, so a change to that folder is a disk mounted or unmounted;
// the list itself comes from the mount table (see nativeListVolumes).

// Mounting a disk can change /Volumes several times in a row (its folder made, then the disk
// put on it): the list is read once they settle.
const SETTLE_MS = 250;

export type VolumeWatcherDeps = {
  listVolumes: () => Volume[];
  // Calls `onChange` whenever the folder changes; returns a function that stops watching.
  watchVolumesFolder: (onChange: () => void) => () => void;
  onVolumesChanged: (volumes: Volume[]) => void;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type VolumeWatcher = {
  getVolumes: () => Volume[];
  // Reads the list again now, telling of a change: for a mount the folder watch missed.
  refresh: () => void;
  stop: () => void;
};

export function sortVolumes(volumes: Volume[]): Volume[] {
  return [...volumes].sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function sameVolumes(first: Volume[], second: Volume[]): boolean {
  return (
    first.length === second.length &&
    first.every((volume, index) => {
      const other = second[index];
      return (
        other !== undefined &&
        volume.path === other.path &&
        volume.name === other.name &&
        volume.isLocal === other.isLocal &&
        volume.isReadOnly === other.isReadOnly &&
        volume.fileSystem === other.fileSystem
      );
    })
  );
}

export function createVolumeWatcher(deps: VolumeWatcherDeps): VolumeWatcher {
  const schedule = deps.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel =
    deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const read = () => {
    try {
      return sortVolumes(deps.listVolumes());
    } catch {
      return [];
    }
  };
  let volumes = read();
  let pending: unknown = null;

  const refresh = () => {
    const next = read();
    if (sameVolumes(volumes, next)) {
      return;
    }
    volumes = next;
    deps.onVolumesChanged(volumes);
  };

  const stopWatching = deps.watchVolumesFolder(() => {
    if (pending !== null) {
      cancel(pending);
    }
    pending = schedule(() => {
      pending = null;
      refresh();
    }, SETTLE_MS);
  });

  return {
    getVolumes: () => volumes,
    refresh,
    stop: () => {
      if (pending !== null) {
        cancel(pending);
        pending = null;
      }
      stopWatching();
    },
  };
}
