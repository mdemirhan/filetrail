import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry } from "./explorerTypes";
import { isOnSameVolume } from "./volumes";

export type InternalMoveSourceSurface = "content" | "search";
// "tab" is a tab in the strip: what is dropped on it goes into the folder the tab is on.
export type InternalDropTargetSurface = "content" | "tree" | "favorite" | "tab";

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

// What a drop does with the dragged items, and the cursor the drag shows for it.
export type InternalDropOperation = "move" | "copy";

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

// Finder's rules: items dragged to a folder on the same disk move, and to another disk they
// are copied. Option forces a copy and Command forces a move, whatever the disks. Finder
// makes an alias for Option-Command; there are no aliases here, so that copies, which
// never takes anything away from where it was.
export function resolveInternalDropOperation(args: {
  sourcePaths: readonly string[];
  targetPath: string;
  altKey: boolean;
  metaKey: boolean;
}): InternalDropOperation {
  if (args.altKey) {
    return "copy";
  }
  if (args.metaKey) {
    return "move";
  }
  // Search results can come from several disks; they move only if all are on the target's.
  return args.sourcePaths.every((path) => isOnSameVolume(path, args.targetPath)) ? "move" : "copy";
}

export function validateInternalDrop(args: {
  session: InternalDragSession | null;
  blocked: boolean;
  targetSurface: InternalDropTargetSurface;
  targetPath: string | null;
  targetSupportsMove: boolean;
  targetIsSelected?: boolean | undefined;
  operation?: InternalDropOperation | undefined;
}): InternalDropValidationResult {
  const {
    session,
    blocked,
    targetSurface,
    targetPath,
    targetSupportsMove,
    targetIsSelected = false,
    operation = "move",
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
  // Moving items into the folder they are in does nothing; copying them there makes
  // duplicates ("name copy"), as an Option-drag does in Finder.
  if (
    operation === "move" &&
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
