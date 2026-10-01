import type { TreeNodeState } from "../components/TreePane";
import { flattenVisibleTree } from "./treeView";

// Printable, non-whitespace characters start or extend the list filter and the sidebar's
// type-to-select.
// Navigation and modifier shortcuts are handled elsewhere.
export function isTypeaheadCharacterKey(key: string): boolean {
  return key.length === 1 && key.trim().length > 0;
}

// Tree typeahead only searches visible nodes. Collapsed descendants are excluded so
// results always map to something the user can immediately see and select.
export function findTreeTypeaheadMatch(args: {
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
  query: string;
}): TreeNodeState | null {
  const { rootPath, nodes, query } = args;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return null;
  }
  const visibleNodes = flattenVisibleTree({ rootPath, nodes });
  for (const visibleNode of visibleNodes) {
    const node = nodes[visibleNode.path];
    if (node?.name.toLocaleLowerCase().startsWith(normalizedQuery)) {
      return node;
    }
  }
  return null;
}
