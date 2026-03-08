export type ContentSelectionState = {
  paths: string[];
  anchorPath: string | null;
  leadPath: string | null;
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
export function sanitizeContentSelection<T extends PathEntry>(
  selection: ContentSelectionState,
  entries: T[],
): ContentSelectionState {
  const availablePaths = new Set(entries.map((entry) => entry.path));
  const nextPaths = selection.paths.filter((path) => availablePaths.has(path));
  if (nextPaths.length === 0) {
    return EMPTY_CONTENT_SELECTION;
  }
  const leadPath =
    selection.leadPath && availablePaths.has(selection.leadPath)
      ? selection.leadPath
      : nextPaths.at(-1) ?? null;
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
    const nextLeadPath = current.leadPath === path ? nextPaths.at(-1) ?? null : current.leadPath;
    return {
      paths: nextPaths,
      anchorPath: current.anchorPath === path ? nextLeadPath : current.anchorPath ?? nextLeadPath,
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
