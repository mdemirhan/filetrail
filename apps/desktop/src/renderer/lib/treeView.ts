import type { TreeNodeState } from "../components/TreePane";

export type FlattenedTreeNode = {
  path: string;
  depth: number;
};

export type TreeKeyboardAction =
  | { type: "navigate"; path: string }
  | { type: "expand"; path: string }
  | { type: "collapse"; path: string }
  | { type: "load"; path: string }
  | { type: "none" };

// Produces the exact visual order of the expanded tree, including depth, for keyboard
// navigation and typeahead. Collapsed descendants are intentionally excluded.
export function flattenVisibleTree(args: {
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
}): FlattenedTreeNode[] {
  const { rootPath, nodes } = args;
  const root = nodes[rootPath];
  if (!root) {
    return [];
  }

  const flattened: FlattenedTreeNode[] = [];
  const walk = (path: string, depth: number) => {
    const node = nodes[path];
    if (!node) {
      return;
    }
    flattened.push({ path, depth });
    if (!node.expanded) {
      return;
    }
    for (const childPath of node.childPaths) {
      walk(childPath, depth + 1);
    }
  };

  walk(rootPath, 0);
  return flattened;
}

// Maps arrow/home/end keys to high-level tree actions instead of mutating state directly.
// The caller decides how to execute `load`, `expand`, `collapse`, or `navigate`.
export function getTreeKeyboardAction(args: {
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";
  currentPath: string;
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
}): TreeKeyboardAction {
  const { currentPath, key, nodes, rootPath } = args;
  const visibleNodes = flattenVisibleTree({ rootPath, nodes });
  if (visibleNodes.length === 0) {
    return { type: "none" };
  }

  const currentIndex = visibleNodes.findIndex((node) => node.path === currentPath);
  const fallbackPath = visibleNodes[0]?.path;
  const currentNodePath = currentIndex >= 0 ? currentPath : fallbackPath;
  if (!currentNodePath) {
    return { type: "none" };
  }
  const currentNode = nodes[currentNodePath];
  if (!currentNode) {
    return { type: "none" };
  }

  if (key === "Home") {
    return { type: "navigate", path: visibleNodes[0]?.path ?? currentNodePath };
  }
  if (key === "End") {
    return { type: "navigate", path: visibleNodes.at(-1)?.path ?? currentNodePath };
  }
  if (key === "ArrowUp") {
    const nextPath = visibleNodes[Math.max(0, (currentIndex >= 0 ? currentIndex : 0) - 1)]?.path;
    return nextPath ? { type: "navigate", path: nextPath } : { type: "none" };
  }
  if (key === "ArrowDown") {
    const nextPath =
      visibleNodes[Math.min(visibleNodes.length - 1, (currentIndex >= 0 ? currentIndex : 0) + 1)]
        ?.path;
    return nextPath ? { type: "navigate", path: nextPath } : { type: "none" };
  }
  if (key === "ArrowRight") {
    if (currentNode.isSymlink) {
      return { type: "none" };
    }
    // Right arrow lazily loads directories before trying to expand or enter them.
    if (!currentNode.loaded) {
      return { type: "load", path: currentNode.path };
    }
    if (!currentNode.expanded && currentNode.childPaths.length > 0) {
      return { type: "expand", path: currentNode.path };
    }
    if (currentNode.expanded && currentNode.childPaths.length > 0) {
      const firstChildPath = currentNode.childPaths[0];
      return firstChildPath ? { type: "navigate", path: firstChildPath } : { type: "none" };
    }
    return { type: "none" };
  }

  // Left arrow collapses first; only once already collapsed does it move to the parent.
  if (currentNode.expanded && currentNode.childPaths.length > 0) {
    return { type: "collapse", path: currentNode.path };
  }
  if (currentNode.path === rootPath) {
    return { type: "none" };
  }

  const parentPath = parentDirectoryPath(currentNode.path);
  if (!isPathWithinRoot(parentPath, rootPath)) {
    return { type: "none" };
  }
  return { type: "navigate", path: parentPath };
}

function parentDirectoryPath(path: string): string {
  if (path === "/") {
    return "/";
  }
  return path.split("/").slice(0, -1).join("/") || "/";
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
