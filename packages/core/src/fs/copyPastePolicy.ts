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

type ResolveContext = {
  policy: CopyPastePolicy | null;
  overrides: OverrideMap;
  fileSystem: WriteServiceFileSystem;
  caseSensitive: boolean;
  // Names claimed across the whole paste (keyed by `destinationPathKey`), when resolving
  // one item while the paste is running; null resolves each folder's items on their own.
  operationReservedPaths: Set<string> | null;
};

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
  return resolveSiblings(
    args.report.nodes,
    {
      policy: args.policy,
      overrides: toOverrideMap(args.overrides),
      fileSystem: args.fileSystem,
      caseSensitive: args.report.destinationCaseSensitive ?? false,
      operationReservedPaths: null,
    },
    undefined,
    null,
  );
}

// Re-resolves one item with the answer given while the paste runs.
export async function resolveSingleNodeWithAction(args: {
  node: CopyPasteAnalysisNode;
  action: CopyPasteRuntimeResolutionAction;
  // The paste's policy, used for nested conflicts when the action is "merge".
  policy: CopyPastePolicy | null;
  // The review's per-item choices, which still apply to the items inside a merged folder.
  overrides?: CopyPasteNodeOverride[];
  fileSystem: WriteServiceFileSystem;
  caseSensitive?: boolean;
  // Every name this paste has planned or already written (keyed by `destinationPathKey`),
  // so a "Keep Both" copy never takes a name another item will use. New names are added.
  reservedPaths?: Set<string>;
}): Promise<ResolvedCopyPasteNode> {
  const reservedPaths = args.reservedPaths ?? new Set<string>();
  return resolveNode(
    args.node,
    {
      policy: args.policy,
      overrides: toOverrideMap(args.overrides),
      fileSystem: args.fileSystem,
      caseSensitive: args.caseSensitive ?? false,
      operationReservedPaths: reservedPaths,
    },
    reservedPaths,
    args.action,
  );
}

// The keys of every destination a resolved paste will write to.
export function collectDestinationPathKeys(
  nodes: ResolvedCopyPasteNode[],
  caseSensitive: boolean,
  into: Set<string> = new Set(),
): Set<string> {
  for (const node of nodes) {
    into.add(destinationPathKey(node.destinationPath, caseSensitive));
    collectDestinationPathKeys(node.children, caseSensitive, into);
  }
  return into;
}

function toOverrideMap(overrides: CopyPasteNodeOverride[] | undefined): OverrideMap {
  return new Map((overrides ?? []).map((override) => [override.nodeId, override.action]));
}

// Resolves the items of one destination folder. Items keeping their own name claim it
// first, so a "Keep Both" copy never picks a name another item of this paste will use.
async function resolveSiblings(
  nodes: CopyPasteAnalysisNode[],
  context: ResolveContext,
  explicitAction: ResolvedCopyPasteNode["action"] | undefined,
  parentDestinationPath: string | null,
): Promise<ResolvedCopyPasteNode[]> {
  const destinationPathFor = (node: CopyPasteAnalysisNode) =>
    parentDestinationPath === null
      ? node.destinationPath
      : joinChildDestinationPath(parentDestinationPath, node.sourcePath);
  // Keys are whole paths, so one set can serve every folder of a running paste.
  const reservedPaths = context.operationReservedPaths ?? new Set<string>();
  for (const node of nodes) {
    reservedPaths.add(destinationPathKey(destinationPathFor(node), context.caseSensitive));
  }
  const resolved: ResolvedCopyPasteNode[] = [];
  for (const node of nodes) {
    resolved.push(
      await resolveNode(
        node,
        context,
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
  context: ResolveContext,
  reservedPaths: Set<string>,
  explicitAction?: ResolvedCopyPasteNode["action"],
  destinationPathOverride?: string,
): Promise<ResolvedCopyPasteNode> {
  const { policy, overrides } = context;
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
      context.fileSystem,
      reservedPaths,
      { isDirectory: node.sourceKind === "directory", caseSensitive: context.caseSensitive },
    );
    reservedPaths.add(destinationPathKey(destinationPath, context.caseSensitive));
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
  const children = await resolveSiblings(node.children, context, childAction, destinationPath);

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
