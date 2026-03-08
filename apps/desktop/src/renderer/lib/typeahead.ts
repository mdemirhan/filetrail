import type { IpcResponse } from "@filetrail/contracts";

import type { TreeNodeState } from "../components/TreePane";
import { flattenVisibleTree } from "./treeView";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];

export function isTypeaheadCharacterKey(key: string): boolean {
  return key.length === 1 && key.trim().length > 0;
}

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
