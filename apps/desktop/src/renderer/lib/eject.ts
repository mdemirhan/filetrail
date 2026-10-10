import type { Volume } from "@filetrail/contracts";

import { type TreeItemId, getFileSystemItemPath, getLocationItemPath } from "./favorites";

// Eject, as Finder's sidebar button, its right-click menu and File ▸ Eject (⌘E) do it.

// What Eject does with a disk: eject it at once, or first ask whether to eject the other
// volumes on the same physical disk too (a partitioned drive), as Finder asks.
export type EjectPlan =
  | { kind: "eject"; path: string }
  | { kind: "askWhichVolumes"; path: string; name: string; otherNames: string[] };

export function planEject(volumes: readonly Volume[], path: string): EjectPlan | null {
  const volume = volumes.find((candidate) => candidate.path === path);
  if (!volume?.canEject) {
    return null;
  }
  const others =
    volume.disk === null
      ? []
      : volumes.filter((other) => other.disk === volume.disk && other.path !== volume.path);
  return others.length === 0
    ? { kind: "eject", path }
    : {
        kind: "askWhichVolumes",
        path,
        name: volume.name,
        otherNames: others.map((other) => other.name),
      };
}

// The disk ⌘E ejects: the sidebar's selected row, when it is a disk that can be ejected
// (its Locations row, or the top of a tree rooted at it). With the file list in front, ⌘E
// would act on its selection, which never holds a disk, so nothing is ejected.
export function resolveEjectTargetPath(args: {
  focusedPane: "tree" | "content" | null;
  selectedTreeItemId: TreeItemId | null;
  volumes: readonly Volume[];
}): string | null {
  if (args.focusedPane === "content") {
    return null;
  }
  const path =
    getLocationItemPath(args.selectedTreeItemId) ?? getFileSystemItemPath(args.selectedTreeItemId);
  return path !== null && args.volumes.some((volume) => volume.path === path && volume.canEject)
    ? path
    : null;
}

export function isEjectablePath(volumes: readonly Volume[], path: string | null): boolean {
  return path !== null && volumes.some((volume) => volume.path === path && volume.canEject);
}

function volumeName(volumes: readonly Volume[], path: string): string {
  return (
    volumes.find((volume) => volume.path === path)?.name ??
    path.split("/").filter(Boolean).at(-1) ??
    path
  );
}

// "disk" for a drive or a disk image, "volume" for a network share, as Finder words it.
function noun(volumes: readonly Volume[], path: string): "disk" | "volume" {
  return volumes.find((volume) => volume.path === path)?.isLocal === false ? "volume" : "disk";
}

const LISTED_NAMES = 3;

function listNames(names: readonly string[]): string {
  const quoted = names.slice(0, LISTED_NAMES).map((name) => `“${name}”`);
  const unlisted = names.length - quoted.length;
  if (unlisted > 0) {
    return `${quoted.join(", ")} and ${unlisted.toLocaleString()} more`;
  }
  if (quoted.length <= 1) {
    return quoted.join("");
  }
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

// Finder's question for one volume of a disk that holds others: Eject All is the default.
export function describeWhichVolumesQuestion(
  name: string,
  otherNames: readonly string[],
): { title: string; message: string } {
  const total = otherNames.length + 1;
  return {
    title: `Do you want to eject “${name}” only, or all ${total.toLocaleString()} volumes on its disk?`,
    message: `The disk also holds ${listNames(otherNames)}. Eject All lets you disconnect it; Eject leaves the others mounted.`,
  };
}

// Finder's alert for a disk that something still has a file open on.
export function describeEjectBusy(
  volumes: readonly Volume[],
  busyPath: string,
): { title: string; message: string } {
  const kind = noun(volumes, busyPath);
  return {
    title: `The ${kind} “${volumeName(volumes, busyPath)}” wasn’t ejected because one or more programs may be using it.`,
    message: `To eject the ${kind} immediately, click Force Eject. A program using it may lose changes it hasn’t saved.`,
  };
}

export function describeEjectFailure(
  volumes: readonly Volume[],
  path: string,
  failure: { failedPath: string | null; code: string | null; reason: string | null },
): { title: string; message: string } {
  // A failure after the volumes were unmounted is the disk's own (/dev/diskN): it is named
  // by the volume asked for.
  const failedVolume = failure.failedPath?.startsWith("/Volumes/") ? failure.failedPath : path;
  const kind = noun(volumes, failedVolume);
  const title = `The ${kind} “${volumeName(volumes, failedVolume)}” couldn’t be ejected.`;
  if (failure.reason) {
    return { title, message: failure.reason };
  }
  switch (failure.code) {
    case "ETIMEDOUT":
      return { title, message: `The ${kind} didn’t answer in time. Try again in a moment.` };
    case "EPERM":
    case "EACCES":
      return { title, message: "macOS didn’t allow File Trail to eject it." };
    default:
      return {
        title,
        message: failure.code
          ? `An unexpected error occurred (${failure.code}).`
          : "An unexpected error occurred.",
      };
  }
}
