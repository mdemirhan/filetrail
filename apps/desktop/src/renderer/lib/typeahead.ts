import type { IpcResponse } from "@filetrail/contracts";

import type { TreeNodeState } from "../components/TreePane";
import { flattenVisibleTree } from "./treeView";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];

// Printable, non-whitespace characters participate in file-selection typeahead.
// Navigation and modifier shortcuts are handled elsewhere.
export function isTypeaheadCharacterKey(key: string): boolean {
  return key.length === 1 && key.trim().length > 0;
}

// Content-pane typeahead is deliberately simple and predictable: prefix-match against the
// rendered entry names in their current order.
export function findContentTypeaheadMatch(
  entries: DirectoryEntry[],
  query: string,
): DirectoryEntry | null {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return null;
  }
  return (
    entries.find((entry) => entry.name.toLocaleLowerCase().startsWith(normalizedQuery)) ?? null
  );
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
