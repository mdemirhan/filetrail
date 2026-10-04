import type { Volume } from "@filetrail/contracts";

import { createVolumeWatcher, sortVolumes } from "./volumes";

function volume(name: string, overrides: Partial<Volume> = {}): Volume {
  return {
    path: `/Volumes/${name}`,
    name,
    isLocal: true,
    isReadOnly: false,
    fileSystem: "apfs",
    ...overrides,
  };
}

function setup(initial: Volume[]) {
  let mounted = initial;
  let folderChanged: (() => void) | null = null;
  const timers: Array<() => void> = [];
  const onVolumesChanged = vi.fn();
  const stopWatching = vi.fn();
  const watcher = createVolumeWatcher({
    listVolumes: () => mounted,
    watchVolumesFolder: (onChange) => {
      folderChanged = onChange;
      return stopWatching;
    },
    onVolumesChanged,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length - 1;
    },
    clearTimeout: (handle) => {
      timers[handle as number] = () => undefined;
    },
  });
  return {
    watcher,
    onVolumesChanged,
    stopWatching,
    mount: (next: Volume[]) => {
      mounted = next;
    },
    changeFolder: () => folderChanged?.(),
    settle: () => {
      for (const timer of timers.splice(0)) {
        timer();
      }
    },
  };
}

describe("volumes", () => {
  it("lists disks by name, numbers in order and letter case aside", () => {
    expect(
      sortVolumes([volume("disk 10"), volume("Backup"), volume("disk 9"), volume("archive")]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["archive", "Backup", "disk 9", "disk 10"]);
  });

  it("reads the list once a burst of changes to /Volumes settles, and tells of real changes only", () => {
    const { watcher, onVolumesChanged, mount, changeFolder, settle } = setup([volume("Backup")]);
    expect(watcher.getVolumes().map((entry) => entry.name)).toEqual(["Backup"]);

    mount([volume("Backup"), volume("Archive")]);
    changeFolder();
    changeFolder();
    expect(onVolumesChanged).not.toHaveBeenCalled();
    settle();
    expect(onVolumesChanged).toHaveBeenCalledTimes(1);
    expect(watcher.getVolumes().map((entry) => entry.name)).toEqual(["Archive", "Backup"]);

    // /Volumes changed, but not the disks on it.
    changeFolder();
    settle();
    expect(onVolumesChanged).toHaveBeenCalledTimes(1);
  });

  it("finds a disk the watch missed when asked to look again", () => {
    const { watcher, onVolumesChanged, mount } = setup([]);
    mount([volume("Install Xcode", { isReadOnly: true, fileSystem: "hfs" })]);
    watcher.refresh();
    expect(onVolumesChanged).toHaveBeenCalledWith([
      volume("Install Xcode", { isReadOnly: true, fileSystem: "hfs" }),
    ]);
  });

  it("stops watching, and drops a change still settling", () => {
    const { watcher, onVolumesChanged, stopWatching, mount, changeFolder, settle } = setup([]);
    mount([volume("Backup")]);
    changeFolder();
    watcher.stop();
    settle();
    expect(stopWatching).toHaveBeenCalled();
    expect(onVolumesChanged).not.toHaveBeenCalled();
  });
});
