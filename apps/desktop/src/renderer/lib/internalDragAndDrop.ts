import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry } from "./explorerTypes";
import { isOnSameVolume } from "./volumes";

// "external" is a drag from Finder or another app, its items read from the drag itself.
export type InternalMoveSourceSurface = "content" | "search" | "external";
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
  // Whether every item is on the target's disk, as the disks themselves say (see
  // `system:getDiskIds`); undefined until they have answered, when the paths decide.
  onSameDisk?: boolean | undefined;
}): InternalDropOperation {
  if (args.altKey) {
    return "copy";
  }
  if (args.metaKey) {
    return "move";
  }
  if (args.onSameDisk !== undefined) {
    return args.onSameDisk ? "move" : "copy";
  }
  // Search results can come from several disks; they move only if all are on the target's.
  return args.sourcePaths.every((path) => isOnSameVolume(path, args.targetPath)) ? "move" : "copy";
}

// What another app's drag allows (`effectAllowed`), from what that app offers and the keys
// held. One that offers no move (Mail and some editors offer copies only) gets a copy,
// without a question, as Finder does; a move it didn't offer would be refused.
const EFFECTS_WITH_MOVE = new Set(["move", "copyMove", "linkMove", "all", "uninitialized"]);

export function allowedBySource(
  operation: InternalDropOperation,
  effectAllowed: string | undefined,
): InternalDropOperation {
  if (
    operation === "move" &&
    effectAllowed !== undefined &&
    !EFFECTS_WITH_MOVE.has(effectAllowed)
  ) {
    return "copy";
  }
  return operation;
}

// A drag of files, from this app or another: the page sees "Files" among its types.
export function isFileDrag(dataTransfer: Pick<DataTransfer, "types"> | null): boolean {
  return dataTransfer !== null && Array.from(dataTransfer.types ?? []).includes("Files");
}

// The folders that hold the dragged items: which disk an item is on is the disk of its
// folder (a dragged symlink is the link, wherever it points).
export function getSourceFolderPaths(sourcePaths: readonly string[]): string[] {
  return [
    ...new Set(
      sourcePaths.map((path) => {
        const index = path.lastIndexOf("/");
        return index <= 0 ? "/" : path.slice(0, index);
      }),
    ),
  ];
}

// Whether the items' folders and the target are all on one disk, from the disk ids known so
// far; undefined while one is unknown or can't be read.
export function resolveOnSameDisk(
  sourceFolderPaths: readonly string[],
  targetPath: string,
  diskIds: ReadonlyMap<string, number | null>,
): boolean | undefined {
  const targetId = diskIds.get(targetPath);
  if (targetId === undefined || targetId === null) {
    return undefined;
  }
  let same = true;
  for (const folder of sourceFolderPaths) {
    const id = diskIds.get(folder);
    if (id === undefined || id === null) {
      return undefined;
    }
    same &&= id === targetId;
  }
  return same;
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
