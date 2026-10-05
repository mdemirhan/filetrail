import type { ContentSelectionState } from "./contentSelection";

// The elements that scroll the file list (in every view) and the folder tree.
export const CONTENT_SCROLL_SELECTOR = ".content-scroll";
export const TREE_SCROLL_SELECTOR = ".tree-scroll";

// How a folder looked when it was left: what was selected and where the list was
// scrolled. Back and Forward show it that way again.
export type FolderViewMemory = {
  selection: ContentSelectionState;
  contentScroll: { top: number; left: number };
};

// Keyed by folder. Only the folders in the tab's history are kept: no other folder can be
// gone back to.
export type FolderViewMemories = Record<string, FolderViewMemory>;

export function rememberFolderView(
  memories: FolderViewMemories,
  path: string,
  memory: FolderViewMemory,
  historyPaths: string[],
): FolderViewMemories {
  const kept = new Set(historyPaths);
  const next: FolderViewMemories = {};
  for (const [memoryPath, existing] of Object.entries(memories)) {
    if (kept.has(memoryPath)) {
      next[memoryPath] = existing;
    }
  }
  next[path] = memory;
  return next;
}
