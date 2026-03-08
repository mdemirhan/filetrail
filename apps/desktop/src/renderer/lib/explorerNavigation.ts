// Returns the parent directory, treating `/` as the root sentinel with no parent.
export function parentDirectoryPath(path: string): string | null {
  if (path === "/") {
    return null;
  }
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return "/";
  }
  return `/${parts.slice(0, -1).join("/")}`;
}

// Builds the ancestor chain from the active root down to the target path. If the target
// sits outside the root, callers get a safe fallback chain containing just the root.
export function getAncestorChain(rootPath: string, path: string): string[] {
  if (!isPathWithinRoot(path, rootPath)) {
    return [rootPath];
  }
  if (rootPath === path) {
    return [rootPath];
  }

  const ancestors: string[] = [];
  let current: string | null = path;
  while (current && current !== rootPath) {
    ancestors.push(current);
    current = parentDirectoryPath(current);
  }
  ancestors.push(rootPath);
  return ancestors.reverse();
}

// Tree bootstrapping needs both each ancestor and the immediate child that should be
// opened under it. This shape lets the loader eagerly expand just the branch leading
// to the focused path.
export function getTreeSeedChain(
  rootPath: string,
  focusPath: string,
): Array<{ path: string; childPath: string | null }> {
  const chain = getAncestorChain(rootPath, focusPath);
  return chain.map((path, index) => ({
    path,
    childPath: chain[index + 1] ?? null,
  }));
}

// Hidden-file mode can be off while the current selection still lives under a hidden
// segment. This helper detects that case so the tree/content views can keep the active
// branch visible instead of making the current path disappear.
export function pathHasHiddenSegmentWithinRoot(path: string, rootPath: string): boolean {
  if (!isPathWithinRoot(path, rootPath)) {
    return false;
  }
  if (rootPath === path) {
    return pathSegmentName(path).startsWith(".");
  }

  const relativePath =
    rootPath === "/" ? path.slice(1) : path.slice(rootPath.length + (path === rootPath ? 0 : 1));
  return relativePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .some((segment) => segment.startsWith("."));
}

// Returns only the first hidden child that must remain visible under `parentPath` in
// order to preserve the active path while hidden-file filtering is disabled.
export function getForcedVisibleHiddenChildPath(parentPath: string, activePath: string): string | null {
  if (!isPathWithinRoot(activePath, parentPath) || activePath === parentPath) {
    return null;
  }

  const relativePath =
    parentPath === "/" ? activePath.slice(1) : activePath.slice(parentPath.length + 1);
  const [nextSegment] = relativePath.split("/").filter((segment) => segment.length > 0);
  if (!nextSegment || !nextSegment.startsWith(".")) {
    return null;
  }

  return parentPath === "/" ? `/${nextSegment}` : `${parentPath}/${nextSegment}`;
}

// Arrow-key movement differs by view mode: list view uses columns for left/right jumps,
// while details/search behave as a single vertical sequence regardless of visual columns.
export function getNextSelectionIndex(args: {
  itemCount: number;
  currentIndex: number;
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";
  columns: number;
  viewMode: "list" | "details";
}): number {
  const { itemCount, currentIndex, key, columns, viewMode } = args;
  if (itemCount === 0) {
    return -1;
  }

  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return itemCount - 1;
  }

  const safeIndex = currentIndex < 0 ? 0 : currentIndex;
  const step = Math.max(1, columns);

  if (viewMode === "details") {
    if (key === "ArrowUp") {
      return clampIndex(safeIndex - 1, itemCount);
    }
    if (key === "ArrowDown") {
      return clampIndex(safeIndex + 1, itemCount);
    }
    if (key === "ArrowLeft") {
      return clampIndex(safeIndex - 1, itemCount);
    }
    return clampIndex(safeIndex + 1, itemCount);
  }

  if (key === "ArrowUp") {
    return clampIndex(safeIndex - 1, itemCount);
  }
  if (key === "ArrowDown") {
    return clampIndex(safeIndex + 1, itemCount);
  }
  if (key === "ArrowLeft") {
    return clampIndex(safeIndex - step, itemCount);
  }
  return clampIndex(safeIndex + step, itemCount);
}

// Page-wise selection intentionally overlaps by one visible item so Ctrl+U / Ctrl+D
// preserve orientation instead of jumping to a completely disjoint set of entries.
export function getPageStepItemCount(viewportSize: number, itemExtent: number): number {
  const safeExtent = Math.max(1, itemExtent);
  const visibleItems = Math.max(1, Math.floor(Math.max(0, viewportSize) / safeExtent));
  return Math.max(1, visibleItems - 1);
}

// Mirrors the page-step math used for scrolling so selection movement and viewport
// movement stay aligned.
export function getPagedSelectionIndex(args: {
  itemCount: number;
  currentIndex: number;
  stepItems: number;
  direction: "backward" | "forward";
}): number {
  const { itemCount, currentIndex, stepItems, direction } = args;
  if (itemCount <= 0) {
    return -1;
  }
  const safeIndex = currentIndex < 0 ? 0 : currentIndex;
  const safeStep = Math.max(1, stepItems);
  return clampIndex(
    direction === "forward" ? safeIndex + safeStep : safeIndex - safeStep,
    itemCount,
  );
}

// Flattens the expanded tree into the same visual order the user sees on screen.
// Keyboard navigation and paged movement depend on this pre-order traversal.
export function flattenVisibleTreePaths(
  rootPath: string,
  nodes: Record<
    string,
    {
      path: string;
      expanded: boolean;
      childPaths: string[];
    }
  >,
): string[] {
  const root = nodes[rootPath];
  if (!root) {
    return [];
  }

  const ordered: string[] = [];
  const visit = (path: string) => {
    const node = nodes[path];
    if (!node) {
      return;
    }
    ordered.push(path);
    if (!node.expanded) {
      return;
    }
    for (const childPath of node.childPaths) {
      visit(childPath);
    }
  };

  visit(rootPath);
  return ordered;
}

function clampIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(itemCount - 1, index));
}

function pathSegmentName(path: string): string {
  if (path === "/") {
    return "/";
  }
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts.at(-1) ?? path;
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
