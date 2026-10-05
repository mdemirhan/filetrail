export type ContentSelectionState = {
  paths: string[];
  anchorPath: string | null;
  leadPath: string | null;
  // Set only when nothing is selected because the selected items left the list (moved to
  // the Trash, say): how many of the items still shown came before them. The arrow keys
  // carry on from there instead of from the top.
  gapIndex?: number;
};

// `anchorPath` is the fixed origin for shift-range extension.
// `leadPath` is the most recent focus target and the row that reveal/activation logic uses.
export const EMPTY_CONTENT_SELECTION: ContentSelectionState = {
  paths: [],
  anchorPath: null,
  leadPath: null,
};

type PathEntry = {
  path: string;
};

// Selection is stored independently from directory contents, so it must be sanitized each
// time the visible entry set changes due to navigation, sorting, filtering, or search.
// `previousEntries`, the list the selection was made in, lets a selection whose items have
// all gone keep their place (see `gapIndex`).
export function sanitizeContentSelection<T extends PathEntry>(
  selection: ContentSelectionState,
  entries: T[],
  previousEntries?: T[],
): ContentSelectionState {
  const availablePaths = new Set(entries.map((entry) => entry.path));
  const nextPaths = selection.paths.filter((path) => availablePaths.has(path));
  if (nextPaths.length === 0) {
    const gapIndex =
      selection.paths.length > 0
        ? findSelectionGapIndex(selection, availablePaths, previousEntries ?? [])
        : selection.gapIndex;
    return gapIndex === undefined
      ? EMPTY_CONTENT_SELECTION
      : { ...EMPTY_CONTENT_SELECTION, gapIndex: Math.min(gapIndex, entries.length) };
  }
  const leadPath =
    selection.leadPath && availablePaths.has(selection.leadPath)
      ? selection.leadPath
      : (nextPaths.at(-1) ?? null);
  const anchorPath =
    selection.anchorPath && availablePaths.has(selection.anchorPath)
      ? selection.anchorPath
      : leadPath;
  return {
    paths: nextPaths,
    anchorPath,
    leadPath,
  };
}

// Where the lead item stood among the items that are still there.
function findSelectionGapIndex<T extends PathEntry>(
  selection: ContentSelectionState,
  availablePaths: Set<string>,
  previousEntries: T[],
): number | undefined {
  const leadPath = selection.leadPath ?? selection.paths[0];
  const leadIndex = previousEntries.findIndex((entry) => entry.path === leadPath);
  if (leadIndex < 0) {
    return undefined;
  }
  return previousEntries.slice(0, leadIndex).filter((entry) => availablePaths.has(entry.path))
    .length;
}

// Shift-range selection is based on visual order, not lexical path ordering.
export function getSelectionRangePaths<T extends PathEntry>(
  entries: T[],
  anchorPath: string,
  targetPath: string,
): string[] {
  const anchorIndex = entries.findIndex((entry) => entry.path === anchorPath);
  const targetIndex = entries.findIndex((entry) => entry.path === targetPath);
  if (anchorIndex < 0 || targetIndex < 0) {
    return targetPath ? [targetPath] : [];
  }
  const [startIndex, endIndex] =
    anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return entries.slice(startIndex, endIndex + 1).map((entry) => entry.path);
}

// Multi-selection merges are normalized back into current entry order so keyboard
// navigation, clipboard actions, and context menus all see a stable ordering.
export function mergeSelectionPathsInEntryOrder<T extends PathEntry>(
  entries: T[],
  currentPaths: string[],
  nextPaths: string[],
): string[] {
  const mergedPaths = new Set([...currentPaths, ...nextPaths]);
  return entries.filter((entry) => mergedPaths.has(entry.path)).map((entry) => entry.path);
}

export function setSingleContentSelection(path: string): ContentSelectionState {
  return {
    paths: [path],
    anchorPath: path,
    leadPath: path,
  };
}

// Cmd-click style toggling preserves the existing anchor when possible so a subsequent
// shift-range still behaves like desktop file managers.
export function toggleContentSelection<T extends PathEntry>(
  current: ContentSelectionState,
  entries: T[],
  path: string,
): ContentSelectionState {
  if (current.paths.includes(path)) {
    const nextPaths = current.paths.filter((currentPath) => currentPath !== path);
    if (nextPaths.length === 0) {
      return EMPTY_CONTENT_SELECTION;
    }
    const nextLeadPath = current.leadPath === path ? (nextPaths.at(-1) ?? null) : current.leadPath;
    return {
      paths: nextPaths,
      anchorPath: current.anchorPath === path ? nextLeadPath : (current.anchorPath ?? nextLeadPath),
      leadPath: nextLeadPath,
    };
  }

  return {
    paths: mergeSelectionPathsInEntryOrder(entries, current.paths, [path]),
    anchorPath: path,
    leadPath: path,
  };
}

// Range extension can either replace the existing selection or add to it, matching the
// difference between plain Shift-click and additive selection gestures.
export function extendContentSelectionToPath<T extends PathEntry>(
  current: ContentSelectionState,
  entries: T[],
  path: string,
  additive = false,
): ContentSelectionState {
  const anchorPath = current.anchorPath ?? current.leadPath ?? path;
  const rangePaths = getSelectionRangePaths(entries, anchorPath, path);
  return {
    paths: additive
      ? mergeSelectionPathsInEntryOrder(entries, current.paths, rangePaths)
      : rangePaths,
    anchorPath,
    leadPath: path,
  };
}

export function selectAllContentEntries<T extends PathEntry>(entries: T[]): ContentSelectionState {
  if (entries.length === 0) {
    return EMPTY_CONTENT_SELECTION;
  }
  return {
    paths: entries.map((entry) => entry.path),
    anchorPath: entries[0]?.path ?? null,
    leadPath: entries.at(-1)?.path ?? null,
  };
}

type SelectionClickEvent = {
  button: number;
  detail: number;
  metaKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
};

// A plain click on one of several selected items narrows the selection to that item. Rows
// act on the click rather than on pointer down, so pressing a selected item can still
// start a drag of the whole selection. `detail` is 0 for keyboard-generated clicks.
export function isSelectionNarrowingClick(
  event: SelectionClickEvent,
  selectedCount: number,
  isSelected: boolean,
): boolean {
  return (
    isSelected &&
    selectedCount > 1 &&
    event.button === 0 &&
    event.detail > 0 &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.ctrlKey
  );
}
