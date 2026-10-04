import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type AppPreferences,
  type ApplicationSelection,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  DEFAULT_OPEN_WITH_APPLICATIONS,
  DEFAULT_TEXT_EDITOR,
  DETAIL_COLUMN_KEYS,
  type ExplorerViewMode,
  FAVORITE_ICON_OPTIONS,
  type FavoriteIconId,
  type FavoritePreference,
  OPEN_TABS_LIMIT,
  OPTIONAL_DETAIL_COLUMN_KEYS,
  type OpenTabPreference,
  type ThemePreference,
  clampDetailColumnWidth,
  clampOpenItemLimit,
  clampPaneWidth,
  clampZoomPercent,
  normalizeAccentColor,
  normalizeDetailColumnOrder,
} from "../shared/appPreferences";
import { sanitizeBatchRenamePresets, sanitizeBatchRenameSettings } from "../shared/batchRename";
import { sanitizeShortcutOverrides } from "../shared/shortcuts";
import { sanitizeTopToolbarItems } from "../shared/toolbarItems";
import {
  type FolderVisitKind,
  type VisitedFolder,
  forgetVisitedFolder,
  recordFolderVisit,
  sanitizeVisitedFolders,
  serializeVisitedFolders,
} from "../shared/visitedFolders";

export type StoredWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
};

type AppState = {
  preferences?: AppPreferences;
  window?: StoredWindowState;
};

// The two files the store keeps, so that a change to one does not rewrite the other.
type StoreFile = "state" | "visits";

type AppStateStoreFileSystem = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: true }) => void;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, data: string, encoding: "utf8") => void;
  renameSync: (oldPath: string, newPath: string) => void;
};

type AppStateStoreTimer = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type AppStateStoreDependencies = {
  defaultTheme?: ThemePreference;
  fs?: AppStateStoreFileSystem;
  timer?: AppStateStoreTimer;
  onReadError?: (error: unknown) => void;
  onPersistError?: (error: unknown) => void;
};

const DEFAULT_WINDOW_STATE: StoredWindowState = {
  width: 1480,
  height: 920,
  maximized: false,
};

const DEFAULT_FILE_SYSTEM: AppStateStoreFileSystem = {
  existsSync: (path) => existsSync(path),
  mkdirSync: (path, options) => mkdirSync(path, options),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, data, encoding) => writeFileSync(path, data, encoding),
  renameSync: (oldPath, newPath) => renameSync(oldPath, newPath),
};

const DEFAULT_TIMER: AppStateStoreTimer = {
  setTimeout,
  clearTimeout,
};

// How long after a deliberate change (a setting, a favorite) the file is written. Short,
// so the change survives a crash; long enough that a burst of changes is one write.
const PROMPT_SAVE_DELAY_MS = 150;
// State that only follows where the user is: it changes with every folder opened and every
// window move, and losing the latest of it to a crash costs nothing. It is written when the
// app quits, or along with the next deliberate change. A session can stay open for days,
// so it is also written once this long after the first unsaved change.
const DEFERRED_SAVE_DELAY_MS = 5 * 60 * 1000;
// The view mode and the sort orders belong to the tab on screen, so they change whenever
// another tab comes to the front; they are saved with the tabs.
const NAVIGATION_PREFERENCE_KEYS: ReadonlySet<string> = new Set<keyof AppPreferences>([
  "lastVisitedPath",
  "lastVisitedFavoritePath",
  "treeRootPath",
  "openTabs",
  "activeTabIndex",
  "viewMode",
  "sortBy",
  "sortDirection",
  "searchResultsSortBy",
  "searchResultsSortDirection",
]);

// The persisted store intentionally contains only restart-worthy UI state. Directory data,
// caches, and other ephemeral runtime state should stay out of this file.
export class AppStateStore {
  private readonly filePath: string;
  // What a new install starts with: the platform's first-launch theme, and only the
  // Open With applications that are installed on this Mac.
  private readonly defaults: AppPreferences;
  private readonly fileSystem: AppStateStoreFileSystem;
  private readonly timer: AppStateStoreTimer;
  private readonly onReadError: (error: unknown) => void;
  private readonly onPersistError: (error: unknown) => void;
  private readonly visitsFilePath: string;
  private state: AppState;
  private visitedFolders: VisitedFolder[];
  private readonly unsavedFiles = new Set<StoreFile>();
  private promptSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, dependencies: AppStateStoreDependencies = {}) {
    this.filePath = filePath;
    this.fileSystem = dependencies.fs ?? DEFAULT_FILE_SYSTEM;
    this.defaults = createDefaultPreferences(
      dependencies.defaultTheme ?? DEFAULT_APP_PREFERENCES.theme,
      this.fileSystem,
    );
    this.timer = dependencies.timer ?? DEFAULT_TIMER;
    this.onReadError =
      dependencies.onReadError ??
      ((error) => {
        console.error("[filetrail] failed reading app state", error);
      });
    this.onPersistError =
      dependencies.onPersistError ??
      ((error) => {
        console.error("[filetrail] failed persisting app state", error);
      });
    this.visitsFilePath = resolveVisitedFoldersPath(filePath);
    const { state, legacyVisitedFolders } = readState(
      filePath,
      this.fileSystem,
      this.defaults,
      this.onReadError,
    );
    this.state = state;
    if (this.fileSystem.existsSync(this.visitsFilePath) || legacyVisitedFolders === undefined) {
      this.visitedFolders = readVisitedFolders(
        this.visitsFilePath,
        this.fileSystem,
        this.onReadError,
      );
    } else {
      // Visits used to be kept in the state file: they move to their own, which is written
      // before the state file loses them.
      this.visitedFolders = legacyVisitedFolders;
      this.markUnsaved("visits");
      this.markUnsaved("state");
      this.saveSoon();
    }
  }

  getFilePath(): string {
    return this.filePath;
  }

  getPreferences(): AppPreferences {
    return this.state.preferences ?? this.defaults;
  }

  updatePreferences(value: Partial<AppPreferences>): AppPreferences {
    const current = this.getPreferences();
    const next = sanitizePreferences(
      {
        ...current,
        ...value,
      },
      this.defaults,
    );
    const changedKeys = (Object.keys(next) as Array<keyof AppPreferences>).filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]),
    );
    this.state = {
      ...this.state,
      preferences: next,
    };
    if (changedKeys.length > 0) {
      this.markUnsaved("state");
    }
    if (changedKeys.some((key) => !NAVIGATION_PREFERENCE_KEYS.has(key))) {
      this.saveSoon();
    } else if (changedKeys.length > 0) {
      this.saveLater();
    }
    return next;
  }

  getVisitedFolders(): VisitedFolder[] {
    return this.visitedFolders;
  }

  // Visits follow where the user goes, so they wait like the window state does: a crash
  // loses at most a few minutes of them.
  recordFolderVisit(path: string, kind: FolderVisitKind, now: number = Date.now()): void {
    const visitedFolders = recordFolderVisit(this.visitedFolders, path, kind, now);
    if (visitedFolders === this.visitedFolders) {
      return;
    }
    this.visitedFolders = visitedFolders;
    this.markUnsaved("visits");
    this.saveLater();
  }

  // Removing a folder from Go To is something the user did on purpose.
  forgetVisitedFolder(path: string): VisitedFolder[] {
    const visitedFolders = forgetVisitedFolder(this.visitedFolders, path);
    if (visitedFolders.length !== this.visitedFolders.length) {
      this.markUnsaved("visits");
      this.saveSoon();
    }
    this.visitedFolders = visitedFolders;
    return visitedFolders;
  }

  getWindowState(): StoredWindowState {
    return this.state.window ?? DEFAULT_WINDOW_STATE;
  }

  setWindowState(value: StoredWindowState): void {
    const window = sanitizeWindowState(value);
    if (JSON.stringify(window) === JSON.stringify(this.state.window)) {
      return;
    }
    this.state = {
      ...this.state,
      window,
    };
    this.markUnsaved("state");
    this.saveLater();
  }

  /** Writes whatever has not been written yet. Called when the app quits. */
  flush(): void {
    if (this.unsavedFiles.size === 0) {
      return;
    }
    this.save();
  }

  // Writes only the files that changed since they were last written; visits first, so a
  // move of them out of the state file never loses them.
  private save(): void {
    if (this.promptSaveTimer !== null) {
      this.timer.clearTimeout(this.promptSaveTimer);
      this.promptSaveTimer = null;
    }
    if (this.deferredSaveTimer !== null) {
      this.timer.clearTimeout(this.deferredSaveTimer);
      this.deferredSaveTimer = null;
    }
    if (this.unsavedFiles.has("visits")) {
      writeFileAtomically(
        this.visitsFilePath,
        serializeVisitedFolders(this.visitedFolders),
        this.fileSystem,
        this.onPersistError,
      );
    }
    if (this.unsavedFiles.has("state")) {
      writeFileAtomically(
        this.filePath,
        `${JSON.stringify(this.state, null, 2)}\n`,
        this.fileSystem,
        this.onPersistError,
      );
    }
    this.unsavedFiles.clear();
  }

  private markUnsaved(file: StoreFile): void {
    this.unsavedFiles.add(file);
  }

  private saveSoon(): void {
    if (this.promptSaveTimer !== null) {
      this.timer.clearTimeout(this.promptSaveTimer);
    }
    if (this.deferredSaveTimer !== null) {
      this.timer.clearTimeout(this.deferredSaveTimer);
      this.deferredSaveTimer = null;
    }
    // Debounced so a burst of changes (a drag, repeated toggles) is one write.
    this.promptSaveTimer = this.timer.setTimeout(() => this.save(), PROMPT_SAVE_DELAY_MS);
  }

  private saveLater(): void {
    // Not pushed back by later changes: it bounds how much a crash can lose.
    if (this.promptSaveTimer === null && this.deferredSaveTimer === null) {
      this.deferredSaveTimer = this.timer.setTimeout(() => this.save(), DEFERRED_SAVE_DELAY_MS);
    }
  }
}

export function createAppStateStore(
  filePath: string,
  dependencies: AppStateStoreDependencies = {},
): AppStateStore {
  return new AppStateStore(filePath, dependencies);
}

export function resolveAppStatePath(userDataPath: string): string {
  return join(userDataPath, "app-state.json");
}

// The opened folders for the Go To box, next to the state file.
export function resolveVisitedFoldersPath(appStatePath: string): string {
  return join(dirname(appStatePath), "visited-folders.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Loading is best-effort. Corrupt state should never block startup.
// `legacyVisitedFolders` is the list of opened folders from a state file written before
// they had a file of their own; undefined when there is none.
function readState(
  filePath: string,
  fileSystem: AppStateStoreFileSystem,
  defaults: AppPreferences,
  onReadError: (error: unknown) => void,
): { state: AppState; legacyVisitedFolders: VisitedFolder[] | undefined } {
  const empty = { state: {}, legacyVisitedFolders: undefined };
  if (!fileSystem.existsSync(filePath)) {
    return empty;
  }
  try {
    const raw = fileSystem.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return empty;
    }
    const record = parsed;
    const preferences = sanitizePreferences(record.preferences, defaults);
    const window = sanitizeWindowState(record.window);
    return {
      state: { preferences, window },
      legacyVisitedFolders:
        record.visitedFolders === undefined
          ? undefined
          : sanitizeVisitedFolders(record.visitedFolders),
    };
  } catch (error) {
    onReadError(error);
    return empty;
  }
}

function readVisitedFolders(
  filePath: string,
  fileSystem: AppStateStoreFileSystem,
  onReadError: (error: unknown) => void,
): VisitedFolder[] {
  if (!fileSystem.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fileSystem.readFileSync(filePath, "utf8")) as unknown;
    return isPlainObject(parsed) ? sanitizeVisitedFolders(parsed.folders) : [];
  } catch (error) {
    onReadError(error);
    return [];
  }
}

// JSON rewrite is good enough here and keeps the persisted format easy to inspect manually.
// Write a sibling temp file and rename it over the target so a crash mid-write
// leaves the previous state intact instead of a truncated file.
function writeFileAtomically(
  filePath: string,
  contents: string,
  fileSystem: AppStateStoreFileSystem,
  onPersistError: (error: unknown) => void,
): void {
  const tempPath = `${filePath}.tmp`;
  try {
    fileSystem.mkdirSync(dirname(filePath), { recursive: true });
    fileSystem.writeFileSync(tempPath, contents, "utf8");
    fileSystem.renameSync(tempPath, filePath);
  } catch (error) {
    onPersistError(error);
  }
}

// A saved view mode, or the default one (List, Finder's table) for anything else.
function sanitizeViewMode(value: unknown): ExplorerViewMode {
  return value === "icons" || value === "list" || value === "details"
    ? value
    : DEFAULT_APP_PREFERENCES.viewMode;
}

// Tabs from a damaged file are kept as far as they make sense; a tab that does not is
// dropped rather than failing the whole list.
function sanitizeOpenTabs(
  value: unknown,
  fallback: Pick<OpenTabPreference, "includeHidden" | "foldersFirst">,
): OpenTabPreference[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const nonEmptyString = (candidate: unknown) =>
    typeof candidate === "string" && candidate.length > 0 ? candidate : null;
  const tabs: OpenTabPreference[] = [];
  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      continue;
    }
    tabs.push({
      path: nonEmptyString(candidate.path),
      treeRootPath: nonEmptyString(candidate.treeRootPath),
      favoritePath: nonEmptyString(candidate.favoritePath),
      viewMode: sanitizeViewMode(candidate.viewMode),
      sortBy:
        candidate.sortBy === "modified" ||
        candidate.sortBy === "kind" ||
        candidate.sortBy === "size"
          ? candidate.sortBy
          : "name",
      sortDirection: candidate.sortDirection === "desc" ? "desc" : "asc",
      includeHidden:
        typeof candidate.includeHidden === "boolean"
          ? candidate.includeHidden
          : fallback.includeHidden,
      foldersFirst:
        typeof candidate.foldersFirst === "boolean"
          ? candidate.foldersFirst
          : fallback.foldersFirst,
    });
    if (tabs.length === OPEN_TABS_LIMIT) {
      break;
    }
  }
  return tabs;
}

// Every saved value is checked here; one that is missing or invalid takes its default.
function sanitizePreferences(value: unknown, currentDefaults: AppPreferences): AppPreferences {
  if (!isPlainObject(value)) {
    return currentDefaults;
  }
  const record = value;
  return {
    theme:
      record.theme === "auto" || record.theme === "light" || record.theme === "dark"
        ? record.theme
        : currentDefaults.theme,
    accent:
      typeof record.accent === "string"
        ? (normalizeAccentColor(record.accent) ?? currentDefaults.accent)
        : currentDefaults.accent,
    zoomPercent: clampZoomPercent(
      typeof record.zoomPercent === "number" ? record.zoomPercent : currentDefaults.zoomPercent,
    ),
    viewMode: sanitizeViewMode(record.viewMode),
    sortBy:
      record.sortBy === "modified" ||
      record.sortBy === "kind" ||
      record.sortBy === "size" ||
      record.sortBy === "name"
        ? record.sortBy
        : currentDefaults.sortBy,
    sortDirection:
      record.sortDirection === "desc" || record.sortDirection === "asc"
        ? record.sortDirection
        : currentDefaults.sortDirection,
    foldersFirst:
      typeof record.foldersFirst === "boolean" ? record.foldersFirst : currentDefaults.foldersFirst,
    compactListView:
      typeof record.compactListView === "boolean"
        ? record.compactListView
        : currentDefaults.compactListView,
    compactDetailsView:
      typeof record.compactDetailsView === "boolean"
        ? record.compactDetailsView
        : currentDefaults.compactDetailsView,
    compactIconView:
      typeof record.compactIconView === "boolean"
        ? record.compactIconView
        : currentDefaults.compactIconView,
    compactTreeView:
      typeof record.compactTreeView === "boolean"
        ? record.compactTreeView
        : currentDefaults.compactTreeView,
    detailColumns: sanitizeDetailColumns(record.detailColumns, currentDefaults.detailColumns),
    detailColumnOrder:
      record.detailColumnOrder === undefined
        ? currentDefaults.detailColumnOrder
        : normalizeDetailColumnOrder(record.detailColumnOrder),
    detailColumnWidths: sanitizeDetailColumnWidths(
      record.detailColumnWidths,
      currentDefaults.detailColumnWidths,
    ),
    notificationsEnabled:
      typeof record.notificationsEnabled === "boolean"
        ? record.notificationsEnabled
        : currentDefaults.notificationsEnabled,
    markClipboardItems:
      typeof record.markClipboardItems === "boolean"
        ? record.markClipboardItems
        : currentDefaults.markClipboardItems,
    folderTreeOpen:
      typeof record.folderTreeOpen === "boolean"
        ? record.folderTreeOpen
        : currentDefaults.folderTreeOpen,
    propertiesOpen:
      typeof record.propertiesOpen === "boolean"
        ? record.propertiesOpen
        : currentDefaults.propertiesOpen,
    detailRowOpen:
      typeof record.detailRowOpen === "boolean"
        ? record.detailRowOpen
        : currentDefaults.detailRowOpen,
    topToolbarItems: Array.isArray(record.topToolbarItems)
      ? sanitizeTopToolbarItems(record.topToolbarItems)
      : [...currentDefaults.topToolbarItems],
    terminalApp: sanitizeTerminalApplicationSelection(record.terminalApp),
    defaultTextEditor: sanitizeApplicationSelection(
      record.defaultTextEditor,
      currentDefaults.defaultTextEditor,
    ),
    openWithApplications: sanitizeOpenWithApplications(
      record.openWithApplications,
      currentDefaults.openWithApplications,
    ),
    fileActivationAction:
      record.fileActivationAction === "edit" || record.fileActivationAction === "open"
        ? record.fileActivationAction
        : currentDefaults.fileActivationAction,
    returnKeyAction:
      record.returnKeyAction === "rename" || record.returnKeyAction === "open"
        ? record.returnKeyAction
        : currentDefaults.returnKeyAction,
    shortcutOverrides: sanitizeShortcutOverrides(record.shortcutOverrides),
    openItemLimit: clampOpenItemLimit(
      typeof record.openItemLimit === "number"
        ? record.openItemLimit
        : currentDefaults.openItemLimit,
    ),
    includeHidden:
      typeof record.includeHidden === "boolean"
        ? record.includeHidden
        : currentDefaults.includeHidden,
    searchPatternMode:
      record.searchPatternMode === "text" ||
      record.searchPatternMode === "glob" ||
      record.searchPatternMode === "regex"
        ? record.searchPatternMode
        : currentDefaults.searchPatternMode,
    searchMatchScope:
      record.searchMatchScope === "name" || record.searchMatchScope === "path"
        ? record.searchMatchScope
        : currentDefaults.searchMatchScope,
    searchRecursive:
      typeof record.searchRecursive === "boolean"
        ? record.searchRecursive
        : currentDefaults.searchRecursive,
    searchSkipGitFolders:
      typeof record.searchSkipGitFolders === "boolean"
        ? record.searchSkipGitFolders
        : currentDefaults.searchSkipGitFolders,
    searchSkipGitIgnored:
      typeof record.searchSkipGitIgnored === "boolean"
        ? record.searchSkipGitIgnored
        : currentDefaults.searchSkipGitIgnored,
    searchResultsSortBy:
      record.searchResultsSortBy === "name" || record.searchResultsSortBy === "path"
        ? record.searchResultsSortBy
        : currentDefaults.searchResultsSortBy,
    searchResultsSortDirection:
      record.searchResultsSortDirection === "desc" || record.searchResultsSortDirection === "asc"
        ? record.searchResultsSortDirection
        : currentDefaults.searchResultsSortDirection,
    treeWidth: clampPaneWidth(
      typeof record.treeWidth === "number" ? record.treeWidth : currentDefaults.treeWidth,
      220,
      520,
    ),
    inspectorWidth: clampPaneWidth(
      typeof record.inspectorWidth === "number"
        ? record.inspectorWidth
        : currentDefaults.inspectorWidth,
      260,
      480,
    ),
    restoreSessionOnStartup:
      typeof record.restoreSessionOnStartup === "boolean"
        ? record.restoreSessionOnStartup
        : currentDefaults.restoreSessionOnStartup,
    openTabs: sanitizeOpenTabs(record.openTabs, currentDefaults),
    activeTabIndex:
      typeof record.activeTabIndex === "number" &&
      Number.isInteger(record.activeTabIndex) &&
      record.activeTabIndex >= 0
        ? record.activeTabIndex
        : 0,
    treeRootPath:
      typeof record.treeRootPath === "string" && record.treeRootPath.length > 0
        ? record.treeRootPath
        : null,
    lastVisitedPath:
      typeof record.lastVisitedPath === "string" && record.lastVisitedPath.length > 0
        ? record.lastVisitedPath
        : null,
    lastVisitedFavoritePath:
      typeof record.lastVisitedFavoritePath === "string" &&
      record.lastVisitedFavoritePath.length > 0
        ? record.lastVisitedFavoritePath
        : null,
    favorites: sanitizeFavorites(record.favorites, currentDefaults.favorites),
    favoritesPlacement:
      record.favoritesPlacement === "separate" || record.favoritesPlacement === "integrated"
        ? record.favoritesPlacement
        : currentDefaults.favoritesPlacement,
    favoritesExpanded:
      typeof record.favoritesExpanded === "boolean"
        ? record.favoritesExpanded
        : currentDefaults.favoritesExpanded,
    favoritesInitialized:
      typeof record.favoritesInitialized === "boolean"
        ? record.favoritesInitialized
        : currentDefaults.favoritesInitialized,
    singleClickExpandTreeItems:
      typeof record.singleClickExpandTreeItems === "boolean"
        ? record.singleClickExpandTreeItems
        : currentDefaults.singleClickExpandTreeItems,
    batchRenameSettings: sanitizeBatchRenameSettings(record.batchRenameSettings),
    batchRenamePresets: sanitizeBatchRenamePresets(record.batchRenamePresets),
  };
}

function sanitizeFavorites(value: unknown, fallback: FavoritePreference[]): FavoritePreference[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const favorites = value
    .map((entry) => sanitizeFavoritePreference(entry))
    .filter((entry): entry is FavoritePreference => entry !== null);
  return dedupeFavorites(favorites);
}

function sanitizeFavoritePreference(value: unknown): FavoritePreference | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const path = typeof value.path === "string" ? value.path.trim() : "";
  const icon = typeof value.icon === "string" ? value.icon : "";
  if (path.length === 0 || !isFavoriteIconId(icon)) {
    return null;
  }
  return {
    path,
    icon,
  };
}

function dedupeFavorites(favorites: FavoritePreference[]): FavoritePreference[] {
  const seen = new Set<string>();
  return favorites.filter((favorite) => {
    if (seen.has(favorite.path)) {
      return false;
    }
    seen.add(favorite.path);
    return true;
  });
}

function isFavoriteIconId(value: string): value is FavoriteIconId {
  return FAVORITE_ICON_OPTIONS.some((option) => option.value === value);
}

function sanitizeTerminalApplicationSelection(value: unknown): ApplicationSelection | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const record = value;
  const appPath = typeof record.appPath === "string" ? record.appPath.trim() : "";
  const appName = typeof record.appName === "string" ? record.appName.trim() : "";
  if (appPath.length === 0 || appName.length === 0) {
    return null;
  }
  return {
    appPath,
    appName,
  };
}

function sanitizeApplicationSelection(
  value: unknown,
  defaults = DEFAULT_TEXT_EDITOR,
): ApplicationSelection {
  if (!isPlainObject(value)) {
    return { ...defaults };
  }
  const record = value;
  const appPath = typeof record.appPath === "string" ? record.appPath.trim() : "";
  const appName = typeof record.appName === "string" ? record.appName.trim() : "";
  if (appPath.length === 0 || appName.length === 0) {
    return { ...defaults };
  }
  return {
    appPath,
    appName,
  };
}

function sanitizeOpenWithApplications(
  value: unknown,
  defaults = DEFAULT_OPEN_WITH_APPLICATIONS,
): AppPreferences["openWithApplications"] {
  if (!Array.isArray(value)) {
    return defaults.map((entry) => ({ ...entry }));
  }
  if (value.length === 0) {
    return [];
  }
  const entries = value.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }
    const record = entry;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const appPath = typeof record.appPath === "string" ? record.appPath.trim() : "";
    const appName = typeof record.appName === "string" ? record.appName.trim() : "";
    if (id.length === 0 || appPath.length === 0 || appName.length === 0) {
      return [];
    }
    return [
      {
        id,
        appPath,
        appName,
      },
    ];
  });
  return entries.length === value.length ? entries : defaults.map((entry) => ({ ...entry }));
}

function sanitizeDetailColumns(
  value: unknown,
  defaults = DEFAULT_DETAIL_COLUMN_VISIBILITY,
): AppPreferences["detailColumns"] {
  // Optional detail columns are stored as booleans, but the runtime expects a full record.
  if (!isPlainObject(value)) {
    return defaults;
  }
  const record = value;
  return Object.fromEntries(
    OPTIONAL_DETAIL_COLUMN_KEYS.map((key) => [
      key,
      typeof record[key] === "boolean" ? record[key] : defaults[key],
    ]),
  ) as AppPreferences["detailColumns"];
}

function sanitizeDetailColumnWidths(
  value: unknown,
  defaults = DEFAULT_DETAIL_COLUMN_WIDTHS,
): AppPreferences["detailColumnWidths"] {
  // Widths are clamped per column so a bad saved value cannot collapse or explode the table.
  if (!isPlainObject(value)) {
    return defaults;
  }
  const record = value;
  return Object.fromEntries(
    DETAIL_COLUMN_KEYS.map((key) => [
      key,
      clampDetailColumnWidth(key, typeof record[key] === "number" ? record[key] : defaults[key]),
    ]),
  ) as AppPreferences["detailColumnWidths"];
}

function sanitizeWindowState(value: unknown): StoredWindowState {
  // Window position is optional, but dimensions are always normalized into a safe range.
  if (!isPlainObject(value)) {
    return DEFAULT_WINDOW_STATE;
  }
  const record = value;
  return {
    width:
      typeof record.width === "number" && record.width >= 320 && record.width <= 6000
        ? record.width
        : DEFAULT_WINDOW_STATE.width,
    height:
      typeof record.height === "number" && record.height >= 320 && record.height <= 6000
        ? record.height
        : DEFAULT_WINDOW_STATE.height,
    maximized: record.maximized === true,
    ...(typeof record.x === "number" ? { x: record.x } : {}),
    ...(typeof record.y === "number" ? { y: record.y } : {}),
  };
}

function createDefaultPreferences(
  defaultTheme: ThemePreference,
  fileSystem: AppStateStoreFileSystem,
): AppPreferences {
  return {
    ...DEFAULT_APP_PREFERENCES,
    theme: defaultTheme,
    openWithApplications: DEFAULT_OPEN_WITH_APPLICATIONS.filter((entry) =>
      fileSystem.existsSync(entry.appPath),
    ).map((entry) => ({ ...entry })),
  };
}
