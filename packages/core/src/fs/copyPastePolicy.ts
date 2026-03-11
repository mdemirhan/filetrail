import { basename, dirname } from "node:path";

import { resolveDuplicateName } from "./copyPasteNames";
import type {
  CopyPasteAnalysisNode,
  CopyPasteAnalysisReport,
  CopyPastePolicy,
  CopyPasteRuntimeResolutionAction,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

export type ResolvedCopyPasteNode = {
  node: CopyPasteAnalysisNode;
  action: "create" | CopyPasteRuntimeResolutionAction;
  destinationPath: string;
  children: ResolvedCopyPasteNode[];
};

export async function resolveAnalysisWithPolicy(args: {
  report: CopyPasteAnalysisReport;
  policy: CopyPastePolicy;
  fileSystem: WriteServiceFileSystem;
}): Promise<ResolvedCopyPasteNode[]> {
  const nodes: ResolvedCopyPasteNode[] = [];
  for (const node of args.report.nodes) {
    nodes.push(await resolveNode(node, args.policy, args.fileSystem));
  }
  return nodes;
}

export async function resolveSingleNodeWithAction(args: {
  node: CopyPasteAnalysisNode;
  action: CopyPasteRuntimeResolutionAction;
  fileSystem: WriteServiceFileSystem;
}): Promise<ResolvedCopyPasteNode> {
  return resolveNode(args.node, null, args.fileSystem, args.action);
}

async function resolveNode(
  node: CopyPasteAnalysisNode,
  policy: CopyPastePolicy | null,
  fileSystem: WriteServiceFileSystem,
  explicitAction?: ResolvedCopyPasteNode["action"],
): Promise<ResolvedCopyPasteNode> {
  let action: ResolvedCopyPasteNode["action"];
  if (explicitAction) {
    action = explicitAction;
  } else if (node.conflictClass === null) {
    action = "create";
  } else if (node.conflictClass === "directory_conflict") {
    action = policy!.directory;
  } else if (node.conflictClass === "type_mismatch") {
    action = policy!.mismatch;
  } else {
    action = policy!.file;
  }
  const destinationPath =
    action === "keep_both"
      ? await resolveDuplicateName(basename(node.sourcePath), dirname(node.destinationPath), fileSystem)
      : node.destinationPath;

  const childAction =
    action === "keep_both" || action === "overwrite"
      ? "create"
      : action === "merge" || action === "create"
        ? undefined
        : action;
  const children: ResolvedCopyPasteNode[] = [];
  for (const child of node.children) {
    children.push(await resolveNode(child, policy, fileSystem, childAction));
  }

  return {
    node,
    action,
    destinationPath,
    children,
  };
}
