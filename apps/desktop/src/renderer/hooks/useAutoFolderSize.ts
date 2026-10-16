import { useEffect, useRef } from "react";

import { isFolderSizeEligibleKind } from "../lib/explorerAppUtils";
import type { DirectoryEntry } from "../lib/explorerTypes";
import type { FolderSizeEntry } from "./useFolderSizeCache";

// How long a folder stays selected (or in the Info panel) before it is measured, so moving
// through the list with the arrow keys does not start a calculation for every folder
// passed. The Info panel and the Info Row both wait it out: they share one measurement.
export const AUTO_FOLDER_SIZE_DELAY_MS = 500;

// The folder the Info panel or the Info Row measures by itself: the item Show Info put in
// the panel, or else the one item selected, when it is a folder in the home folder or a
// bundle (an app) anywhere. Not the folder on screen, nor several items, nor a folder
// outside home (a disk, Macintosh HD), where a walk can take minutes.
export function getAutoFolderSizePath(args: {
  infoPanelOpen: boolean;
  // The Info Row shows the selection, never Show Info's item.
  infoRowOpen?: boolean;
  selectedPaths: readonly string[];
  selectedEntry: Pick<DirectoryEntry, "path" | "kind"> | null;
  // The path Show Info put in the panel, null while the panel follows the selection, and
  // the item the panel shows.
  showInfoPath?: string | null;
  infoItem?: Pick<DirectoryEntry, "path" | "kind"> | null;
  homePath: string;
}): string | null {
  const { infoPanelOpen, selectedPaths, selectedEntry, homePath } = args;
  const { infoRowOpen = false, showInfoPath = null, infoItem = null } = args;
  if (!infoPanelOpen && !infoRowOpen) {
    return null;
  }
  // With both open, the panel's item: one measurement at a time.
  const item =
    infoPanelOpen && showInfoPath !== null
      ? infoItem?.path === showInfoPath
        ? infoItem
        : null
      : selectedPaths.length === 1 && selectedEntry?.path === selectedPaths[0]
        ? selectedEntry
        : null;
  if (!item || !isFolderSizeEligibleKind(item.kind)) {
    return null;
  }
  if (item.kind === "bundle") {
    return item.path;
  }
  const home = homePath.replace(/\/+$/u, "");
  return home.length > 0 && item.path.startsWith(`${home}/`) ? item.path : null;
}

type FolderSizes = {
  getEntry: (path: string) => FolderSizeEntry;
  isCalculating: () => boolean;
  calculateFolderSize: (
    path: string,
    recalculate: boolean,
    options: { automatic: boolean },
  ) => Promise<void>;
  cancelFolderSize: (path: string) => Promise<void>;
};

// Measures `path` once it has stayed the same for a moment, unless its size is known, being
// measured, or failed, or another folder is being measured (a new calculation would stop
// that one). When `path` changes or goes, a calculation started here and still running is
// stopped; one started by Calculate Size is left alone. What it measured inside is kept.
export function useAutoFolderSize(path: string | null, folderSizes: FolderSizes): void {
  const folderSizesRef = useRef(folderSizes);
  folderSizesRef.current = folderSizes;

  useEffect(() => {
    if (path === null) {
      return;
    }
    let left = false;
    let startedJobId: string | null = null;
    const stopIfOurs = (jobId: string) => {
      const entry = folderSizesRef.current.getEntry(path);
      if (entry.status === "calculating" && entry.jobId === jobId) {
        void folderSizesRef.current.cancelFolderSize(path);
      }
    };
    const timer = window.setTimeout(() => {
      const sizes = folderSizesRef.current;
      if (sizes.isCalculating() || sizes.getEntry(path).status !== "idle") {
        return;
      }
      void sizes.calculateFolderSize(path, false, { automatic: true }).then(() => {
        const entry = folderSizesRef.current.getEntry(path);
        if (entry.status !== "calculating" || entry.jobId.length === 0) {
          return;
        }
        if (left) {
          stopIfOurs(entry.jobId);
          return;
        }
        startedJobId = entry.jobId;
      });
    }, AUTO_FOLDER_SIZE_DELAY_MS);
    return () => {
      left = true;
      window.clearTimeout(timer);
      if (startedJobId !== null) {
        stopIfOurs(startedJobId);
      }
    };
  }, [path]);
}
