import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import { isFolderSizeEligibleKind } from "./explorerAppUtils";
import type { DirectoryEntry } from "./explorerTypes";

// The size of several selected items, for the Info Row and the Info panel: known only once
// the size of every one of them is, files from the list and folders from the folder size
// cache.
export type SelectionSize = {
  /** The total, when the size of every item is known. */
  totalBytes: number | null;
  /** The selected folders and packages, whose sizes are calculated. */
  folderPaths: string[];
  /**
   * The selection's folder sizes as one, for the same controls as one folder's: calculating
   * while any is, Calculate while any is not known, and the totals once all are. Null when
   * nothing is selected that is calculated, or while a file's size is still unknown.
   */
  folderSizeEntry: FolderSizeEntry | null;
};

export function summarizeSelectionSize(
  entries: readonly Pick<DirectoryEntry, "path" | "kind">[],
  getFileSizeBytes: (path: string) => number | null,
  getFolderSizeEntry: (path: string) => FolderSizeEntry,
): SelectionSize {
  const folderPaths: string[] = [];
  const folderEntries: FolderSizeEntry[] = [];
  let fileBytes = 0;
  let filesKnown = true;
  let fileCount = 0;
  for (const entry of entries) {
    if (isFolderSizeEligibleKind(entry.kind)) {
      folderPaths.push(entry.path);
      folderEntries.push(getFolderSizeEntry(entry.path));
      continue;
    }
    fileCount += 1;
    const sizeBytes = getFileSizeBytes(entry.path);
    if (sizeBytes === null) {
      filesKnown = false;
    } else {
      fileBytes += sizeBytes;
    }
  }

  let sizeBytes = fileBytes;
  // Files have no size on disk in the list: it is shown only for folders alone.
  let diskBytes = fileCount === 0 ? 0 : null;
  let innerFileCount = 0;
  let innerFolderCount = 0;
  let foldersKnown = true;
  let anyCalculating = false;
  for (const folder of folderEntries) {
    if (folder.status === "calculating") {
      anyCalculating = true;
    }
    if (folder.status !== "ready") {
      foldersKnown = false;
      continue;
    }
    sizeBytes += folder.sizeBytes;
    if (diskBytes !== null) {
      diskBytes += folder.diskBytes;
    }
    innerFileCount += folder.fileCount;
    innerFolderCount += folder.folderCount;
  }

  const totalBytes = filesKnown && foldersKnown ? sizeBytes : null;
  let folderSizeEntry: FolderSizeEntry | null = null;
  if (folderPaths.length > 0) {
    if (anyCalculating) {
      folderSizeEntry = { status: "calculating", jobId: "" };
    } else if (!foldersKnown) {
      folderSizeEntry = { status: "idle" };
    } else if (totalBytes !== null) {
      // Everything selected and everything inside it, as Finder counts a selection.
      folderSizeEntry = {
        status: "ready",
        sizeBytes: totalBytes,
        diskBytes: diskBytes ?? totalBytes,
        fileCount: fileCount + innerFileCount,
        folderCount: folderPaths.length + innerFolderCount,
      };
    }
  }
  return { totalBytes, folderPaths, folderSizeEntry };
}
