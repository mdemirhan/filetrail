export function resolveOpenInTerminalPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
  currentPath: string;
}): string[] {
  if (input.contextMenuPaths.length > 0) {
    return input.contextMenuPaths;
  }

  const activePane = input.focusedPane ?? input.lastFocusedPane;
  if (activePane === "tree") {
    return [];
  }
  if (activePane === "content") {
    if (input.selectedContentPaths.length > 0) {
      return input.selectedContentPaths;
    }
    return input.currentPath ? [input.currentPath] : [];
  }

  if (input.selectedContentPaths.length > 0) {
    return input.selectedContentPaths;
  }
  return input.currentPath ? [input.currentPath] : [];
}

export function resolveOpenSelectionPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
  currentPath: string;
}): string[] {
  if (input.contextMenuPaths.length > 0) {
    return input.contextMenuPaths;
  }

  const activePane = input.focusedPane ?? input.lastFocusedPane;
  if (activePane === "tree") {
    return [];
  }

  return [...input.selectedContentPaths];
}

export function resolveEditSelectionPaths(input: {
  focusedPane: "tree" | "content" | null;
  lastFocusedPane: "tree" | "content" | null;
  contextMenuPaths: string[];
  selectedContentPaths: string[];
}): string[] {
  if (input.contextMenuPaths.length > 0) {
    return input.contextMenuPaths;
  }

  const activePane = input.focusedPane ?? input.lastFocusedPane;
  if (activePane === "tree") {
    return [];
  }

  return [...input.selectedContentPaths];
}
