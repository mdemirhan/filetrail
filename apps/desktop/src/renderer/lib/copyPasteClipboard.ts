import { type IpcRequest, isFollowedMove } from "@filetrail/contracts";

import {
  collectFollowedMoves,
  getPathLeafName,
  movedItems,
  removedByWrite,
  replacePathPrefix,
} from "./explorerAppUtils";
import type { DirectoryEntry, WriteOperationResult } from "./explorerTypes";

export type ClipboardMode = IpcRequest<"copyPaste:analyzeStart">["mode"];

// What was known about an item when it was copied: enough to draw its icon and to say
// whether it is a folder. Items copied from somewhere that does not say (a path alone) have
// no entry here.
export type ClipboardSourceEntry = Pick<DirectoryEntry, "kind" | "isSymlink" | "isExecutable">;

export type CopyPasteClipboardState =
  | {
      type: "empty";
    }
  | {
      type: "ready";
      mode: ClipboardMode;
      sourcePaths: string[];
      sourceEntries: Record<string, ClipboardSourceEntry>;
      capturedAt: string;
    };

export const EMPTY_COPY_PASTE_CLIPBOARD: CopyPasteClipboardState = {
  type: "empty",
};

export function setCopyPasteClipboard(
  mode: ClipboardMode,
  sourcePaths: string[],
  nowIsoString: string,
  sourceEntries: Record<string, ClipboardSourceEntry> = {},
): CopyPasteClipboardState {
  const normalizedPaths = Array.from(new Set(sourcePaths)).filter((path) => path.length > 0);
  if (normalizedPaths.length === 0) {
    return EMPTY_COPY_PASTE_CLIPBOARD;
  }
  const knownEntries: Record<string, ClipboardSourceEntry> = {};
  for (const path of normalizedPaths) {
    const entry = sourceEntries[path];
    if (entry) {
      knownEntries[path] = entry;
    }
  }
  return {
    type: "ready",
    mode,
    sourcePaths: normalizedPaths,
    sourceEntries: knownEntries,
    capturedAt: nowIsoString,
  };
}

// Takes one item off the clipboard. `capturedAt` stays: what is left was copied when it was.
export function removeClipboardItem(
  clipboard: CopyPasteClipboardState,
  path: string,
): CopyPasteClipboardState {
  if (clipboard.type !== "ready" || !clipboard.sourcePaths.includes(path)) {
    return clipboard;
  }
  const sourcePaths = clipboard.sourcePaths.filter((sourcePath) => sourcePath !== path);
  if (sourcePaths.length === 0) {
    return EMPTY_COPY_PASTE_CLIPBOARD;
  }
  const { [path]: _removed, ...sourceEntries } = clipboard.sourceEntries;
  return { ...clipboard, sourcePaths, sourceEntries };
}

// Takes items off the clipboard, with anything on it from inside them (a file copied from a
// folder that was then put in the Trash goes with the folder).
export function dropClipboardPaths(
  clipboard: CopyPasteClipboardState,
  removedPaths: readonly string[],
): CopyPasteClipboardState {
  if (clipboard.type !== "ready" || removedPaths.length === 0) {
    return clipboard;
  }
  const isRemoved = (path: string) =>
    removedPaths.some((removed) => path === removed || path.startsWith(`${removed}/`));
  const sourcePaths = clipboard.sourcePaths.filter((path) => !isRemoved(path));
  if (sourcePaths.length === clipboard.sourcePaths.length) {
    return clipboard;
  }
  if (sourcePaths.length === 0) {
    return EMPTY_COPY_PASTE_CLIPBOARD;
  }
  const sourceEntries: Record<string, ClipboardSourceEntry> = {};
  for (const path of sourcePaths) {
    const entry = clipboard.sourceEntries[path];
    if (entry) {
      sourceEntries[path] = entry;
    }
  }
  return { ...clipboard, sourcePaths, sourceEntries };
}

// Follows items the app itself renamed or moved: an item on the clipboard, or the folder it
// is in, now has a new path, and a paste should still find it. `capturedAt` stays, so the
// clipboard is still the one that was copied. Items the write left where they were (`left`)
// stay, even inside a folder that moved.
export function remapClipboardPaths(
  clipboard: CopyPasteClipboardState,
  moves: ReadonlyArray<{ from: string; to: string }>,
  left: LeftInPlace = NOTHING_LEFT_IN_PLACE,
): CopyPasteClipboardState {
  if (clipboard.type !== "ready" || moves.length === 0) {
    return clipboard;
  }
  const remap = (path: string) => remappedPath(path, moves, left) ?? path;
  let changed = false;
  const sourcePaths: string[] = [];
  const keptPaths = new Set<string>();
  const sourceEntries: Record<string, ClipboardSourceEntry> = {};
  for (const path of clipboard.sourcePaths) {
    const nextPath = remap(path);
    changed ||= nextPath !== path;
    if (keptPaths.has(nextPath)) {
      continue;
    }
    keptPaths.add(nextPath);
    sourcePaths.push(nextPath);
    const entry = clipboard.sourceEntries[path];
    if (entry) {
      sourceEntries[nextPath] = entry;
    }
  }
  return changed ? { ...clipboard, sourcePaths, sourceEntries } : clipboard;
}

// Where `path` is after `moves`, or null when none of them moved it. The deepest move that
// holds the path decides, in case a folder and an item inside it were both moved.
function remappedPath(
  path: string,
  moves: ReadonlyArray<{ from: string; to: string }>,
  left: LeftInPlace,
): string | null {
  const move = moves
    .filter(({ from }) => path === from || path.startsWith(`${from}/`))
    .sort((one, other) => other.from.length - one.from.length)[0];
  return move && !staysInPlace(path, move.from, left)
    ? replacePathPrefix(path, move.from, move.to)
    : null;
}

// What a write that moved items left where they were: the items it skipped, or that failed
// or were stopped, and every folder holding one. A folder merged into one already at the
// destination is reported done, yet it is still at its old path while anything in it is,
// and the folder of that name at the destination is another.
export type LeftInPlace = {
  items: ReadonlySet<string>;
  itemsAndHolders: ReadonlySet<string>;
};

const NOTHING_LEFT_IN_PLACE: LeftInPlace = { items: new Set(), itemsAndHolders: new Set() };

function leftInPlaceBy(result: WriteOperationResult): LeftInPlace {
  const items = new Set<string>();
  const itemsAndHolders = new Set<string>();
  for (const item of result.items) {
    if (!item.sourcePath || item.status === "completed" || isFollowedMove(item, result.action)) {
      continue;
    }
    items.add(item.sourcePath);
    let path = item.sourcePath;
    while (path.length > 0 && !itemsAndHolders.has(path)) {
      itemsAndHolders.add(path);
      path = path.slice(0, Math.max(0, path.lastIndexOf("/")));
    }
  }
  return items.size === 0 ? NOTHING_LEFT_IN_PLACE : { items, itemsAndHolders };
}

// Whether `path`, inside (or at) `movedFrom`, is still where it was: it is, or holds, an
// item the write left in place, or one left in place inside what moved holds it.
function staysInPlace(path: string, movedFrom: string, left: LeftInPlace): boolean {
  if (left.items.size === 0) {
    return false;
  }
  if (left.itemsAndHolders.has(path)) {
    return true;
  }
  for (
    let holder = path.slice(0, path.lastIndexOf("/"));
    holder.length >= movedFrom.length;
    holder = holder.slice(0, holder.lastIndexOf("/"))
  ) {
    if (left.items.has(holder)) {
      return true;
    }
  }
  return false;
}

// What a finished write did to the items on the clipboard. Copied items that were renamed
// or moved are followed to where they are now, as Finder does, and those put in the Trash
// or deleted are taken off. A cut is a move not made yet: once any item in it is renamed,
// moved, put in the Trash or deleted, the whole cut is cancelled, so a later paste doesn't
// move what was already dealt with, or only part of what was cut. Only what actually
// happened counts; an item that failed is still where it was, unless its result says it
// was put back elsewhere.
export function followClipboardThroughWrite(
  clipboard: CopyPasteClipboardState,
  result: WriteOperationResult,
): CopyPasteClipboardState {
  const moves = movedItems(result) ? collectFollowedMoves(result) : [];
  const left = moves.length > 0 ? leftInPlaceBy(result) : NOTHING_LEFT_IN_PLACE;
  return followClipboard(clipboard, moves, removedByWrite(result), left);
}

// The paths `followClipboardThroughWrite` takes items on `clipboard` to: where the write
// moved them. Only items on it that moved, not others already where they went (a folder
// merged into).
export function clipboardPathsMovedBy(
  clipboard: CopyPasteClipboardState,
  result: WriteOperationResult,
): string[] {
  if (clipboard.type !== "ready" || !movedItems(result)) {
    return [];
  }
  const moves = collectFollowedMoves(result);
  const left = leftInPlaceBy(result);
  const kept = dropClipboardPaths(clipboard, removedByWrite(result));
  return kept.type === "ready"
    ? kept.sourcePaths.flatMap((path) => {
        const moved = remappedPath(path, moves, left);
        return moved === null ? [] : [moved];
      })
    : [];
}

// What another app moving items away, or putting them in the Trash, did to the clipboard:
// they are no longer where it says, so they are taken off, and a cut of any is cancelled.
export function followClipboardThroughRemoval(
  clipboard: CopyPasteClipboardState,
  removedPaths: readonly string[],
): CopyPasteClipboardState {
  return followClipboard(clipboard, [], removedPaths);
}

function followClipboard(
  clipboard: CopyPasteClipboardState,
  moves: ReturnType<typeof collectFollowedMoves>,
  removedPaths: readonly string[],
  left: LeftInPlace = NOTHING_LEFT_IN_PLACE,
): CopyPasteClipboardState {
  if (clipboard.type !== "ready") {
    return clipboard;
  }
  if (clipboard.mode === "cut") {
    const changedPaths = [...moves.map(({ from }) => from), ...removedPaths];
    const changesAnItem = clipboard.sourcePaths.some((path) =>
      changedPaths.some((changed) => path === changed || path.startsWith(`${changed}/`)),
    );
    return changesAnItem ? EMPTY_COPY_PASTE_CLIPBOARD : clipboard;
  }
  // What was removed first: an item moved onto a removed item's path (a Replace) is
  // followed there, and isn't taken for the item it replaced.
  return remapClipboardPaths(dropClipboardPaths(clipboard, removedPaths), moves, left);
}

export function clearCopyPasteClipboard(): CopyPasteClipboardState {
  return EMPTY_COPY_PASTE_CLIPBOARD;
}

export function buildPasteRequest(
  clipboard: CopyPasteClipboardState,
  destinationDirectoryPath: string,
): IpcRequest<"copyPaste:analyzeStart"> | null {
  if (clipboard.type !== "ready") {
    return null;
  }
  return {
    mode: clipboard.mode,
    sourcePaths: clipboard.sourcePaths,
    destinationDirectoryPath,
    action: "paste",
  };
}

export function clearClipboardAfterSuccessfulPaste(
  clipboard: CopyPasteClipboardState,
): CopyPasteClipboardState {
  if (clipboard.type !== "ready") {
    return clipboard;
  }
  return EMPTY_COPY_PASTE_CLIPBOARD;
}

export function hasClipboardItems(clipboard: CopyPasteClipboardState): boolean {
  return clipboard.type === "ready" && clipboard.sourcePaths.length > 0;
}

export type ClipboardItem = {
  path: string;
  name: string;
  /** The folder the item is in. */
  parentPath: string;
  /** The item as the file list would describe it, for its icon. */
  entry: DirectoryEntry;
  /** Null when the item was copied without saying what it is. */
  isFolder: boolean | null;
};

// The icon that stands for what is on the clipboard: the item's own for one item, a pair
// of the generic ones for several.
export type ClipboardIcon =
  | { type: "item"; entry: DirectoryEntry }
  | { type: "items"; contains: "files" | "folders" | "mixed" };

export type ClipboardSummary = {
  mode: ClipboardMode;
  count: number;
  /** "3 items copied", "1 item cut". */
  countLabel: string;
  /** One item is called by its name ("notes.md copied"); several are counted. */
  label: string;
  /** "3 folders and 342 files": only for several items whose kinds are all known. */
  breakdown: string | null;
  icon: ClipboardIcon;
  items: ClipboardItem[];
};

function getNameExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : "";
}

function getParentPath(path: string): string {
  const trimmedPath = path.replace(/\/+$/u, "");
  const slashIndex = trimmedPath.lastIndexOf("/");
  return slashIndex <= 0 ? "/" : trimmedPath.slice(0, slashIndex);
}

function isFolderKind(kind: DirectoryEntry["kind"]): boolean {
  return kind === "directory" || kind === "symlink_directory";
}

function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function listClipboardItems(clipboard: CopyPasteClipboardState): ClipboardItem[] {
  if (clipboard.type !== "ready") {
    return [];
  }
  return clipboard.sourcePaths.map((path) => {
    const name = getPathLeafName(path);
    const known = clipboard.sourceEntries[path];
    return {
      path,
      name,
      parentPath: getParentPath(path),
      entry: {
        path,
        name,
        extension: known && isFolderKind(known.kind) ? "" : getNameExtension(name),
        // An item of unknown kind is drawn with the icon macOS has for its path.
        kind: known?.kind ?? "other",
        isHidden: name.startsWith("."),
        isSymlink: known?.isSymlink ?? false,
        ...(known?.isExecutable === undefined ? {} : { isExecutable: known.isExecutable }),
      },
      isFolder: known ? isFolderKind(known.kind) : null,
    };
  });
}

// What the window says about the clipboard while it holds files. The items may be in a tab
// or a folder that is not on screen.
export function describeClipboard(clipboard: CopyPasteClipboardState): ClipboardSummary | null {
  const items = listClipboardItems(clipboard);
  const firstItem = items[0];
  if (clipboard.type !== "ready" || !firstItem) {
    return null;
  }
  const count = items.length;
  const verb = clipboard.mode === "cut" ? "cut" : "copied";
  const countLabel = `${pluralize(count, "item")} ${verb}`;
  const folderCount = items.filter((item) => item.isFolder === true).length;
  const fileCount = items.filter((item) => item.isFolder === false).length;
  const kindsKnown = folderCount + fileCount === count;
  const breakdownParts = [
    ...(folderCount > 0 ? [pluralize(folderCount, "folder")] : []),
    ...(fileCount > 0 ? [pluralize(fileCount, "file")] : []),
  ];
  return {
    mode: clipboard.mode,
    count,
    countLabel,
    label: count === 1 ? `${firstItem.name} ${verb}` : countLabel,
    breakdown: count > 1 && kindsKnown ? breakdownParts.join(" and ") : null,
    icon:
      count === 1
        ? { type: "item", entry: firstItem.entry }
        : {
            type: "items",
            contains:
              kindsKnown && fileCount === 0
                ? "folders"
                : kindsKnown && folderCount === 0
                  ? "files"
                  : "mixed",
          },
    items,
  };
}

export type ClipboardItemGroup = {
  parentPath: string;
  /** The folder's name. */
  label: string;
  items: ClipboardItem[];
};

// The items under the folder each came from, in the order the folders first appear.
export function groupClipboardItemsByFolder(items: ClipboardItem[]): ClipboardItemGroup[] {
  const groups = new Map<string, ClipboardItemGroup>();
  for (const item of items) {
    const group = groups.get(item.parentPath);
    if (group) {
      group.items.push(item);
      continue;
    }
    groups.set(item.parentPath, {
      parentPath: item.parentPath,
      label: item.parentPath === "/" ? "/" : getPathLeafName(item.parentPath),
      items: [item],
    });
  }
  return [...groups.values()];
}
