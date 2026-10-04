import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import { formatSize } from "./formatting";
import { formatItemCount } from "./listFilter";
import type { SelectionSize } from "./selectionSize";

// The size the status bar shows: the selection's, or the folder on screen's with nothing
// selected. Null while it is neither known nor being calculated.
export type StatusSize = { status: "ready"; sizeBytes: number } | { status: "calculating" } | null;

// The selection's size once every size in it is known; while a folder in it is being
// calculated, that it is.
export function selectionStatusSize(selection: SelectionSize): StatusSize {
  if (selection.totalBytes !== null) {
    return { status: "ready", sizeBytes: selection.totalBytes };
  }
  return selection.folderSizeEntry?.status === "calculating" ? { status: "calculating" } : null;
}

export function folderStatusSize(entry: FolderSizeEntry): StatusSize {
  if (entry.status === "ready") {
    return { status: "ready", sizeBytes: entry.sizeBytes };
  }
  return entry.status === "calculating" ? { status: "calculating" } : null;
}

export function formatStatusSize(size: StatusSize): string | null {
  if (size === null) {
    return null;
  }
  return size.status === "ready" ? formatSize(size.sizeBytes, "ready") : "Calculating…";
}

// The path bar's right-hand summary replaces Finder's separate status bar: item or selection
// count, and the size of the selection, or of the folder on screen with nothing selected,
// when it is known. Free space is in the Info panel, for a volume's root.
export function buildContentStatusSummary({
  itemCount,
  shownCount = itemCount,
  selectedCount,
  size,
}: {
  itemCount: number;
  // How many of them the list shows, when typing has narrowed it.
  shownCount?: number;
  selectedCount: number;
  size: StatusSize;
}): string {
  const parts = [
    selectedCount === 0
      ? formatItemCount(shownCount, itemCount)
      : `${selectedCount} of ${itemCount} selected`,
  ];
  const sizeText = formatStatusSize(size);
  if (sizeText) {
    parts.push(sizeText);
  }
  return parts.join(" · ");
}
