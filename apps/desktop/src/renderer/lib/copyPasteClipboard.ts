import type { IpcRequest } from "@filetrail/contracts";

import { getPathLeafName } from "./explorerAppUtils";
import type { DirectoryEntry } from "./explorerTypes";

export type ClipboardMode = IpcRequest<"copyPaste:plan">["mode"];

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

export function clearCopyPasteClipboard(): CopyPasteClipboardState {
  return EMPTY_COPY_PASTE_CLIPBOARD;
}

export function buildPasteRequest(
  clipboard: CopyPasteClipboardState,
  destinationDirectoryPath: string,
  conflictResolution: IpcRequest<"copyPaste:plan">["conflictResolution"] = "error",
): IpcRequest<"copyPaste:plan"> | null {
  if (clipboard.type !== "ready") {
    return null;
  }
  return {
    mode: clipboard.mode,
    sourcePaths: clipboard.sourcePaths,
    destinationDirectoryPath,
    conflictResolution,
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
