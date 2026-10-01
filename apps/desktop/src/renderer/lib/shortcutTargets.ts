export function resolveOpenInTerminalPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
  selectedTreePath?: string | null;
  currentPath: string;
}): string[] {
  if (input.contextMenuPaths.length > 0) {
    return input.contextMenuPaths;
  }

  const activePane = input.focusedPane ?? input.lastFocusedPane;
  if (activePane === "tree") {
    if (input.selectedTreePath) {
      return [input.selectedTreePath];
    }
    return input.currentPath ? [input.currentPath] : [];
  }
  if (input.selectedContentPaths.length > 0) {
    return input.selectedContentPaths;
  }
  return input.currentPath ? [input.currentPath] : [];
}

function resolveSelectionPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
  selectedTreePath?: string | null;
  currentPath?: string;
}): string[] {
  if (input.contextMenuPaths.length > 0) {
    return input.contextMenuPaths;
  }

  const activePane = input.focusedPane ?? input.lastFocusedPane;
  if (activePane === "tree") {
    if (input.selectedTreePath) {
      return [input.selectedTreePath];
    }
    return [];
  }

  return [...input.selectedContentPaths];
}

export function resolveOpenSelectionPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
  selectedTreePath?: string | null;
  currentPath: string;
}): string[] {
  return resolveSelectionPaths(input);
}

export function resolveEditSelectionPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
  selectedTreePath?: string | null;
}): string[] {
  return resolveSelectionPaths(input);
}

// The folder "Root Tree at Selected Folder" acts on: the folder selected in the focused
// pane, or the folder on screen when the selection is not a single folder.
export function resolveRootTreeTargetPath(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuFolderPath: string | null;
  selectedContentFolderPath: string | null;
  selectedTreePath?: string | null;
  currentPath: string;
}): string | null {
  if (input.contextMenuFolderPath) {
    return input.contextMenuFolderPath;
  }

  const activePane = input.focusedPane ?? input.lastFocusedPane;
  const selectedPath =
    activePane === "tree" ? input.selectedTreePath : input.selectedContentFolderPath;
  return selectedPath || input.currentPath || null;
}
