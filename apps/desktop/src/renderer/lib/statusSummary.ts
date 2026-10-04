import { formatSize } from "./formatting";
import { formatItemCount } from "./listFilter";

// The path bar's right-hand summary replaces Finder's separate status bar: item or selection
// count, and the selection's total size when every selected size is known. Free space is in
// the Info panel, for a volume's root.
export function buildContentStatusSummary({
  itemCount,
  shownCount = itemCount,
  selectedPaths,
  getKnownSizeBytes,
}: {
  itemCount: number;
  // How many of them the list shows, when typing has narrowed it.
  shownCount?: number;
  selectedPaths: readonly string[];
  // Size of a path when known (file metadata or a calculated folder size), else null.
  getKnownSizeBytes: (path: string) => number | null;
}): string {
  const parts: string[] = [];
  if (selectedPaths.length === 0) {
    parts.push(formatItemCount(shownCount, itemCount));
  } else {
    const count =
      selectedPaths.length === 1 && itemCount > 1
        ? `1 of ${itemCount} selected`
        : `${selectedPaths.length} of ${itemCount} selected`;
    let totalBytes = 0;
    let allKnown = true;
    for (const path of selectedPaths) {
      const size = getKnownSizeBytes(path);
      if (size === null) {
        allKnown = false;
        break;
      }
      totalBytes += size;
    }
    parts.push(count);
    if (allKnown) {
      parts.push(formatSize(totalBytes, "ready"));
    }
  }
  return parts.join(" · ");
}
