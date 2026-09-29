import { basename, dirname } from "node:path";

import { isChoiceAllowedForConflict } from "@filetrail/contracts";

import { destinationPathKey, resolveDuplicateName } from "./copyPasteNames";
import type {
  CopyPasteAnalysisNode,
  CopyPasteAnalysisReport,
  CopyPasteNodeOverride,
  CopyPastePolicy,
  CopyPasteRuntimeResolutionAction,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

type OverrideMap = ReadonlyMap<string, CopyPasteRuntimeResolutionAction>;
const NO_OVERRIDES: OverrideMap = new Map();

export type ResolvedCopyPasteNode = {
  node: CopyPasteAnalysisNode;
  action: "create" | CopyPasteRuntimeResolutionAction;
  destinationPath: string;
  children: ResolvedCopyPasteNode[];
};

export async function resolveAnalysisWithPolicy(args: {
  report: CopyPasteAnalysisReport;
  policy: CopyPastePolicy;
  // Per-item choices; items without one follow the policy for their kind.
  overrides?: CopyPasteNodeOverride[];
  fileSystem: WriteServiceFileSystem;
}): Promise<ResolvedCopyPasteNode[]> {
  const overrides: OverrideMap = new Map(
    (args.overrides ?? []).map((override) => [override.nodeId, override.action]),
  );
  return resolveSiblings(
    args.report.nodes,
    args.policy,
    overrides,
    args.fileSystem,
    undefined,
    null,
  );
}

export async function resolveSingleNodeWithAction(args: {
  node: CopyPasteAnalysisNode;
  action: CopyPasteRuntimeResolutionAction;
  // The paste's policy, used for nested conflicts when the action is "merge".
  policy: CopyPastePolicy | null;
  fileSystem: WriteServiceFileSystem;
}): Promise<ResolvedCopyPasteNode> {
  return resolveNode(args.node, args.policy, NO_OVERRIDES, args.fileSystem, new Set(), args.action);
}

// Resolves the items of one destination folder. Items keeping their own name claim it
// first, so a "Keep Both" copy never picks a name another item of this paste will use.
async function resolveSiblings(
  nodes: CopyPasteAnalysisNode[],
  policy: CopyPastePolicy | null,
  overrides: OverrideMap,
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
        overrides,
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
  overrides: OverrideMap,
  fileSystem: WriteServiceFileSystem,
  reservedPaths: Set<string>,
  explicitAction?: ResolvedCopyPasteNode["action"],
  destinationPathOverride?: string,
): Promise<ResolvedCopyPasteNode> {
  const baseDestinationPath = destinationPathOverride ?? node.destinationPath;
  const override = node.conflictClass === null ? undefined : overrides.get(node.id);
  let action: ResolvedCopyPasteNode["action"];
  if (explicitAction) {
    action = explicitAction;
  } else if (
    override !== undefined &&
    node.conflictClass !== null &&
    isChoiceAllowedForConflict(node.conflictClass, override)
  ) {
    action = override;
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
    overrides,
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
