import { formatSize } from "./formatting";

// The path bar's right-hand summary replaces Finder's separate status bar: item or selection
// count, the selection's total size when every selected size is known, and free space.
export function buildContentStatusSummary({
  itemCount,
  selectedPaths,
  getKnownSizeBytes,
  availableBytes,
}: {
  itemCount: number;
  selectedPaths: readonly string[];
  // Size of a path when known (file metadata or a calculated folder size), else null.
  getKnownSizeBytes: (path: string) => number | null;
  availableBytes: number | null;
}): string {
  const parts: string[] = [];
  if (selectedPaths.length === 0) {
    parts.push(`${itemCount} ${itemCount === 1 ? "item" : "items"}`);
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
    parts.push(allKnown ? `${count}, ${formatSize(totalBytes, "ready")}` : count);
  }
  if (availableBytes !== null) {
    parts.push(`${formatSize(availableBytes, "ready")} available`);
  }
  return parts.join(" · ");
}
