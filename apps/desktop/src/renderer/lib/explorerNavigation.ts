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
