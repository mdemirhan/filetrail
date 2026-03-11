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
  destinationPathOverride?: string,
): Promise<ResolvedCopyPasteNode> {
  const baseDestinationPath = destinationPathOverride ?? node.destinationPath;
  let action: ResolvedCopyPasteNode["action"];
  if (explicitAction) {
    action = explicitAction;
  } else if (node.conflictClass === null) {
    action = "create";
  } else if (node.conflictClass === "directory_conflict") {
    if (!policy?.directory) {
      throw new Error("Missing directory conflict policy.");
    }
    action = policy.directory;
  } else if (node.conflictClass === "type_mismatch") {
    if (!policy?.mismatch) {
      throw new Error("Missing mismatch conflict policy.");
    }
    action = policy.mismatch;
  } else {
    if (!policy?.file) {
      throw new Error("Missing file conflict policy.");
    }
    action = policy.file;
  }
  const destinationPath =
    action === "keep_both"
      ? await resolveDuplicateName(
          basename(node.sourcePath),
          dirname(baseDestinationPath),
          fileSystem,
        )
      : baseDestinationPath;

  const shouldNormalizeDestination =
    action === "create" ||
    action === "keep_both" ||
    action === "overwrite" ||
    destinationPath !== node.destinationPath;
  const normalizedNode = shouldNormalizeDestination
    ? {
        ...node,
        destinationPath,
        disposition: "new" as const,
        conflictClass: null,
        destinationKind: "missing" as const,
        destinationFingerprint: {
          exists: false,
          kind: "missing" as const,
          size: null,
          mtimeMs: null,
          mode: null,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
      }
    : node;

  const childAction =
    explicitAction === "create" || action === "keep_both" || action === "overwrite"
      ? "create"
      : action === "merge" || action === "create"
        ? undefined
        : action;
  const children: ResolvedCopyPasteNode[] = [];
  for (const child of node.children) {
    children.push(
      await resolveNode(
        child,
        policy,
        fileSystem,
        childAction,
        joinChildDestinationPath(destinationPath, child.sourcePath),
      ),
    );
  }

  return {
    node: normalizedNode,
    action,
    destinationPath,
    children,
  };
}

function joinChildDestinationPath(parentDestinationPath: string, childSourcePath: string): string {
  return parentDestinationPath === "/"
    ? `/${basename(childSourcePath)}`
    : `${parentDestinationPath}/${basename(childSourcePath)}`;
}
