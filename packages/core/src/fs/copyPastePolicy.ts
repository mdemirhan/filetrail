import { basename, dirname } from "node:path";

import { destinationPathKey, resolveDuplicateName } from "./copyPasteNames";
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
  return resolveSiblings(args.report.nodes, args.policy, args.fileSystem, undefined, null);
}

export async function resolveSingleNodeWithAction(args: {
  node: CopyPasteAnalysisNode;
  action: CopyPasteRuntimeResolutionAction;
  // The paste's policy, used for nested conflicts when the action is "merge".
  policy: CopyPastePolicy | null;
  fileSystem: WriteServiceFileSystem;
}): Promise<ResolvedCopyPasteNode> {
  return resolveNode(args.node, args.policy, args.fileSystem, new Set(), args.action);
}

// Resolves the items of one destination folder. Items keeping their own name claim it
// first, so a "Keep Both" copy never picks a name another item of this paste will use.
async function resolveSiblings(
  nodes: CopyPasteAnalysisNode[],
  policy: CopyPastePolicy | null,
  fileSystem: WriteServiceFileSystem,
  explicitAction: ResolvedCopyPasteNode["action"] | undefined,
  parentDestinationPath: string | null,
): Promise<ResolvedCopyPasteNode[]> {
  const destinationPathFor = (node: CopyPasteAnalysisNode) =>
    parentDestinationPath === null
      ? node.destinationPath
      : joinChildDestinationPath(parentDestinationPath, node.sourcePath);
  const reservedPaths = new Set<string>();
  for (const node of nodes) {
    reservedPaths.add(destinationPathKey(destinationPathFor(node)));
  }
  const resolved: ResolvedCopyPasteNode[] = [];
  for (const node of nodes) {
    resolved.push(
      await resolveNode(
        node,
        policy,
        fileSystem,
        reservedPaths,
        explicitAction,
        parentDestinationPath === null ? undefined : destinationPathFor(node),
      ),
    );
  }
  return resolved;
}

async function resolveNode(
  node: CopyPasteAnalysisNode,
  policy: CopyPastePolicy | null,
  fileSystem: WriteServiceFileSystem,
  reservedPaths: Set<string>,
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
  let destinationPath = baseDestinationPath;
  if (action === "keep_both") {
    destinationPath = await resolveDuplicateName(
      basename(node.sourcePath),
      dirname(baseDestinationPath),
      fileSystem,
      reservedPaths,
    );
    reservedPaths.add(destinationPathKey(destinationPath));
  }

  // "overwrite" keeps the destination state seen at review time so execution can
  // notice if it changed before anything is replaced.
  const shouldNormalizeDestination =
    action === "create" ||
    action === "keep_both" ||
    (action !== "overwrite" && destinationPath !== node.destinationPath);
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
    : { ...node, destinationPath };

  const childAction =
    explicitAction === "create" || action === "keep_both" || action === "overwrite"
      ? "create"
      : action === "merge" || action === "create"
        ? undefined
        : action;
  const children = await resolveSiblings(
    node.children,
    policy,
    fileSystem,
    childAction,
    destinationPath,
  );

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
