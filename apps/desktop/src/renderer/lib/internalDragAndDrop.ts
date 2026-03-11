import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry } from "./explorerTypes";

export type InternalMoveSourceSurface = "content" | "search";
export type InternalDropTargetSurface = "content" | "tree" | "favorite";

export type InternalDragItem = {
  path: string;
  kind: DirectoryEntry["kind"];
};

export type InternalDragSession = {
  sourceSurface: InternalMoveSourceSurface;
  sourceItems: InternalDragItem[];
  leadPath: string;
  leadKind: DirectoryEntry["kind"];
};

export type InternalDropValidationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "blocked"
        | "empty"
        | "target_missing"
        | "unsupported_target"
        | "invalid_target"
        | "target_selected"
        | "same_path"
        | "already_in_target"
        | "parent_into_child";
    };

export function isRealDirectoryEntry(
  entry: Pick<DirectoryEntry, "kind" | "isSymlink"> | null,
): boolean {
  return entry?.kind === "directory" && entry.isSymlink === false;
}

export function buildInternalDragSession(args: {
  sourceSurface: InternalMoveSourceSurface;
  draggedPath: string;
  selectedPathsInViewOrder: string[];
  entriesByPath: Map<string, DirectoryEntry>;
}): InternalDragSession | null {
  const draggedEntry = args.entriesByPath.get(args.draggedPath);
  if (!draggedEntry) {
    return null;
  }

  const sourcePaths = args.selectedPathsInViewOrder.includes(args.draggedPath)
    ? args.selectedPathsInViewOrder
    : [args.draggedPath];
  const sourceItems = sourcePaths
    .map((path) => args.entriesByPath.get(path))
    .filter((entry): entry is DirectoryEntry => entry !== undefined)
    .map((entry) => ({
      path: entry.path,
      kind: entry.kind,
    }));

  if (sourceItems.length === 0) {
    return null;
  }

  return {
    sourceSurface: args.sourceSurface,
    sourceItems,
    leadPath: draggedEntry.path,
    leadKind: draggedEntry.kind,
  };
}

export function validateInternalDrop(args: {
  session: InternalDragSession | null;
  blocked: boolean;
  targetSurface: InternalDropTargetSurface;
  targetPath: string | null;
  targetSupportsMove: boolean;
  targetIsSelected?: boolean | undefined;
}): InternalDropValidationResult {
  const {
    session,
    blocked,
    targetSurface,
    targetPath,
    targetSupportsMove,
    targetIsSelected = false,
  } = args;

  if (blocked) {
    return { ok: false, code: "blocked" };
  }
  if (!session || session.sourceItems.length === 0) {
    return { ok: false, code: "empty" };
  }
  if (!targetPath) {
    return { ok: false, code: "target_missing" };
  }
  if (!targetSupportsMove) {
    return { ok: false, code: "invalid_target" };
  }
  if (session.sourceSurface === "search" && targetSurface === "content") {
    return { ok: false, code: "unsupported_target" };
  }
  if (targetSurface === "content" && targetIsSelected) {
    return { ok: false, code: "target_selected" };
  }
  if (session.sourceItems.some((item) => item.path === targetPath)) {
    return { ok: false, code: "same_path" };
  }
  if (
    session.sourceItems.length > 0 &&
    session.sourceItems.every((item) => parentDirectoryPath(item.path) === targetPath)
  ) {
    return { ok: false, code: "already_in_target" };
  }
  if (
    session.sourceItems.some(
      (item) =>
        item.kind === "directory" &&
        (targetPath === item.path || targetPath.startsWith(`${item.path}/`)),
    )
  ) {
    return { ok: false, code: "parent_into_child" };
  }
  return { ok: true };
}
