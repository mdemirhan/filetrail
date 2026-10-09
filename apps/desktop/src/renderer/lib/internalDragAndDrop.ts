import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry } from "./explorerTypes";
import { getVolumeRootPath } from "./volumes";

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
  const targetVolume = getVolumeRootPath(args.targetPath);
  for (const volume of getVolumeRoots(args.sourcePaths)) {
    if (volume !== targetVolume) {
      return "copy";
    }
  }
  return "move";
}

// The disks the paths are on, by their paths: asked on every drag-over, so worked out once
// for each list of paths (a drag's own list stays the same while it goes on).
const volumeRootsByPaths = new WeakMap<readonly string[], ReadonlySet<string>>();

function getVolumeRoots(paths: readonly string[]): ReadonlySet<string> {
  let roots = volumeRootsByPaths.get(paths);
  if (!roots) {
    roots = new Set(paths.map(getVolumeRootPath));
    volumeRootsByPaths.set(paths, roots);
  }
  return roots;
}

// What the drag-overs of a drag ask about its items, worked out once per drag: they come
// many times a second, and a drag may carry tens of thousands of items.
export type DragFacts = {
  sourcePaths: string[];
  paths: ReadonlySet<string>;
  // The folders whose disks decide a move (see getSourceFolderPaths).
  folderPaths: string[];
  // The folder each item is in; null for "/".
  parentPaths: ReadonlySet<string | null>;
  // The folders, apps and packages among the items, which can't go into themselves.
  containerPaths: ReadonlySet<string>;
};

const dragFactsBySession = new WeakMap<InternalDragSession, DragFacts>();

export function getDragFacts(session: InternalDragSession): DragFacts {
  let facts = dragFactsBySession.get(session);
  if (!facts) {
    const sourcePaths = session.sourceItems.map((item) => item.path);
    facts = {
      sourcePaths,
      paths: new Set(sourcePaths),
      folderPaths: getSourceFolderPaths(session.sourceItems),
      parentPaths: new Set(sourcePaths.map(parentDirectoryPath)),
      containerPaths: new Set(
        session.sourceItems
          .filter((item) => item.kind === "directory" || item.kind === "bundle")
          .map((item) => item.path),
      ),
    };
    dragFactsBySession.set(session, facts);
  }
  return facts;
}

// Whether `path` is one of the folders or inside one: it and each folder above it are
// looked up, rather than every folder compared with it.
function isInsideAny(path: string, folderPaths: ReadonlySet<string>): boolean {
  if (folderPaths.size === 0) {
    return false;
  }
  if (folderPaths.has(path)) {
    return true;
  }
  for (let index = path.indexOf("/", 1); index > 0; index = path.indexOf("/", index + 1)) {
    if (folderPaths.has(path.slice(0, index))) {
      return true;
    }
  }
  return false;
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

// The folders whose disks decide whether the dragged items move: which disk an item is on
// is the disk of its folder (a dragged symlink is the link, wherever it points). A dragged
// folder is asked about too: a disk's own folder (/Volumes/USB, a share) is on that disk,
// not on the disk of the folder it is mounted in.
export function getSourceFolderPaths(sourceItems: readonly InternalDragItem[]): string[] {
  const paths = new Set<string>();
  for (const { path, kind } of sourceItems) {
    const index = path.lastIndexOf("/");
    paths.add(index <= 0 ? "/" : path.slice(0, index));
    if (kind === "directory") {
      paths.add(path);
    }
  }
  return [...paths];
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
  const facts = getDragFacts(session);
  if (facts.paths.has(targetPath)) {
    return { ok: false, code: "same_path" };
  }
  // Moving items into the folder they are in does nothing; copying them there makes
  // duplicates ("name copy"), as an Option-drag does in Finder.
  if (operation === "move" && facts.parentPaths.size === 1 && facts.parentPaths.has(targetPath)) {
    return { ok: false, code: "already_in_target" };
  }
  // An app or package is a folder too, which can't go into a folder inside itself.
  if (isInsideAny(targetPath, facts.containerPaths)) {
    return { ok: false, code: "parent_into_child" };
  }
  return { ok: true };
}
