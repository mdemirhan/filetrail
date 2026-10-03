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
  LEGACY_DEFAULT_DETAIL_COLUMN_VISIBILITY,
  OPEN_TABS_LIMIT,
  OPTIONAL_DETAIL_COLUMN_KEYS,
  type OpenTabPreference,
  type ThemePreference,
  clampDetailColumnWidth,
  clampOpenItemLimit,
  clampPaneWidth,
  clampZoomPercent,
  normalizeAccentColor,
  resolveSavedTheme,
} from "../shared/appPreferences";
import { sanitizeShortcutOverrides } from "../shared/shortcuts";
import {
  DEFAULT_TOP_TOOLBAR_ITEMS,
  PREVIOUS_DEFAULT_TOP_TOOLBARS,
  type ToolbarItemId,
  sanitizeTopToolbarItems,
} from "../shared/toolbarItems";
import {
  type VisitedFolder,
  forgetVisitedFolder,
  recordFolderVisit,
  sanitizeVisitedFolders,
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
  visitedFolders?: VisitedFolder[];
};

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
  private state: AppState;
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
    this.state = readState(filePath, this.fileSystem, this.defaults, this.onReadError);
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
    if (changedKeys.some((key) => !NAVIGATION_PREFERENCE_KEYS.has(key))) {
      this.saveSoon();
    } else if (changedKeys.length > 0) {
      this.saveLater();
    }
    return next;
  }

  getVisitedFolders(): VisitedFolder[] {
    return this.state.visitedFolders ?? [];
  }

  recordFolderVisit(path: string, now: number = Date.now()): void {
    this.state = {
      ...this.state,
      visitedFolders: recordFolderVisit(this.getVisitedFolders(), path, now),
    };
    this.saveLater();
  }

  // Removing a folder from Go To is something the user did on purpose.
  forgetVisitedFolder(path: string): VisitedFolder[] {
    const visitedFolders = forgetVisitedFolder(this.getVisitedFolders(), path);
    this.state = { ...this.state, visitedFolders };
    this.saveSoon();
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
    this.saveLater();
  }

  /** Writes whatever has not been written yet. Called when the app quits. */
  flush(): void {
    if (this.promptSaveTimer === null && this.deferredSaveTimer === null) {
      return;
    }
    this.save();
  }

  private save(): void {
    if (this.promptSaveTimer !== null) {
      this.timer.clearTimeout(this.promptSaveTimer);
      this.promptSaveTimer = null;
    }
    if (this.deferredSaveTimer !== null) {
      this.timer.clearTimeout(this.deferredSaveTimer);
      this.deferredSaveTimer = null;
    }
    persistState(this.filePath, this.state, this.fileSystem, this.onPersistError);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Loading is best-effort. Corrupt or old state should never block startup.
function readState(
  filePath: string,
  fileSystem: AppStateStoreFileSystem,
  defaults: AppPreferences,
  onReadError: (error: unknown) => void,
): AppState {
  if (!fileSystem.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fileSystem.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }
    const record = parsed;
    const preferences = sanitizePreferences(record.preferences, defaults);
    const window = sanitizeWindowState(record.window);
    return {
      preferences,
      window,
      visitedFolders: sanitizeVisitedFolders(record.visitedFolders),
    };
  } catch (error) {
    onReadError(error);
    return {};
  }
}

function persistState(
  filePath: string,
  state: AppState,
  fileSystem: AppStateStoreFileSystem,
  onPersistError: (error: unknown) => void,
): void {
  // JSON rewrite is good enough here and keeps the persisted format easy to inspect manually.
  // Write a sibling temp file and rename it over the target so a crash mid-write
  // leaves the previous state intact instead of a truncated file.
  const tempPath = `${filePath}.tmp`;
  try {
    fileSystem.mkdirSync(dirname(filePath), { recursive: true });
    fileSystem.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

// Tabs saved by an older or damaged file are kept as far as they make sense; a tab that
// does not is dropped rather than failing the whole list.
// A tab saved before tabs kept their own hidden-files and Folders First settings takes the
// window's, which is what it showed then.
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

// This is the migration boundary for persisted preferences. When keys are renamed or
// removed, normalize legacy shapes here instead of letting stale values leak outward.
function sanitizePreferences(value: unknown, currentDefaults: AppPreferences): AppPreferences {
  if (!isPlainObject(value)) {
    return currentDefaults;
  }
  const record = value;
  return {
    // A palette the app no longer has becomes its side, light or dark (`resolveSavedTheme`).
    theme: resolveSavedTheme(record.theme) ?? currentDefaults.theme,
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
    detailColumnWidths: sanitizeDetailColumnWidths(
      record.detailColumnWidths,
      currentDefaults.detailColumnWidths,
    ),
    notificationsEnabled:
      typeof record.notificationsEnabled === "boolean"
        ? record.notificationsEnabled
        : currentDefaults.notificationsEnabled,
    markClipboardItems: sanitizeMarkClipboardItems(record, currentDefaults.markClipboardItems),
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
    topToolbarItems:
      record.topToolbarItems !== undefined
        ? isPreviousDefaultTopToolbar(record.topToolbarItems)
          ? [...DEFAULT_TOP_TOOLBAR_ITEMS]
          : addFolderTreeButtonOnce(record, sanitizeTopToolbarItems(record.topToolbarItems))
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
    restoreSessionOnStartup: sanitizeRestoreSessionOnStartup(
      record,
      currentDefaults.restoreSessionOnStartup,
    ),
    openTabs: sanitizeOpenTabs(record.openTabs, {
      includeHidden:
        typeof record.includeHidden === "boolean"
          ? record.includeHidden
          : currentDefaults.includeHidden,
      foldersFirst:
        typeof record.foldersFirst === "boolean"
          ? record.foldersFirst
          : currentDefaults.foldersFirst,
    }),
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
    favorites: upgradeFavoritesWithRootVolume(
      record,
      sanitizeFavorites(record.favorites, record.favoritePaths, currentDefaults.favorites),
    ),
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
  };
}

function sanitizeFavorites(
  value: unknown,
  legacyFavoritePaths: unknown,
  fallback: FavoritePreference[],
): FavoritePreference[] {
  if (Array.isArray(value)) {
    const favorites = value
      .map((entry) => sanitizeFavoritePreference(entry))
      .filter((entry): entry is FavoritePreference => entry !== null);
    return dedupeFavorites(favorites);
  }
  if (Array.isArray(legacyFavoritePaths)) {
    const favorites = legacyFavoritePaths
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .map((path) => ({
        path,
        icon: inferLegacyFavoriteIcon(path),
      }));
    return dedupeFavorites(favorites);
  }
  return fallback;
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

function inferLegacyFavoriteIcon(path: string): FavoriteIconId {
  if (path === "/") {
    return "drive";
  }
  if (path === "/Applications") {
    return "applications";
  }
  const normalizedPath = path.replace(/\/+$/u, "");
  const leaf = normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
  if (leaf === "Desktop") {
    return "desktop";
  }
  if (leaf === "Documents") {
    return "documents";
  }
  if (leaf === "Downloads") {
    return "downloads";
  }
  if (leaf === "Music") {
    return "music";
  }
  if (leaf === "Pictures" || leaf === "Photos") {
    return "photos";
  }
  if (leaf === "Movies" || leaf === "Videos") {
    return "videos";
  }
  if (leaf === "Projects") {
    return "projects";
  }
  if (leaf === ".Trash") {
    return "trash";
  }
  return "folder";
}

function sanitizeTerminalApplicationSelection(value: unknown): ApplicationSelection | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }
    return {
      appPath: normalized,
      appName: normalized,
    };
  }
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

// A customized toolbar saved before the folder tree could be hidden gets the tree's button
// at its start, once: from then on `folderTreeOpen` is saved with it, and a button taken
// off stays off.
function addFolderTreeButtonOnce(
  record: Record<string, unknown>,
  items: ToolbarItemId[],
): ToolbarItemId[] {
  if (record.folderTreeOpen !== undefined || items.includes("folderTree")) {
    return items;
  }
  return ["folderTree", ...items];
}

// Copied and cut items used to be marked in the tree and in the file list separately; a
// profile saved then keeps its marks unless both were off.
function sanitizeMarkClipboardItems(record: Record<string, unknown>, fallback: boolean): boolean {
  if (typeof record.markClipboardItems === "boolean") {
    return record.markClipboardItems;
  }
  const tree = record.highlightClipboardItemsInTree;
  const content = record.highlightClipboardItemsInContent;
  if (typeof tree === "boolean" || typeof content === "boolean") {
    return tree !== false || content !== false;
  }
  return fallback;
}

// Reopening the last folder and reopening the tabs used to be two settings; the folder one
// decided where a session started, so a profile saved then keeps that choice.
function sanitizeRestoreSessionOnStartup(
  record: Record<string, unknown>,
  fallback: boolean,
): boolean {
  if (typeof record.restoreSessionOnStartup === "boolean") {
    return record.restoreSessionOnStartup;
  }
  if (typeof record.restoreLastVisitedFolderOnStartup === "boolean") {
    return record.restoreLastVisitedFolderOnStartup;
  }
  return fallback;
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
  // State saved before Kind and Date Created existed has neither key. If its three
  // columns are still the old defaults, nothing was customized: use the new defaults.
  const predatesKindColumn = record.kind === undefined && record.created === undefined;
  if (
    predatesKindColumn &&
    record.size === LEGACY_DEFAULT_DETAIL_COLUMN_VISIBILITY.size &&
    record.modified === LEGACY_DEFAULT_DETAIL_COLUMN_VISIBILITY.modified &&
    record.permissions === LEGACY_DEFAULT_DETAIL_COLUMN_VISIBILITY.permissions
  ) {
    return defaults;
  }
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

// Macintosh HD used to be a fixed sidebar location and is now a default favorite. State saved
// before that change gets it once; afterwards the user can remove it like any other favorite.
// Such state has a `locationsExpanded` flag, which is no longer written, or neither
// `autoLightTheme` (which arrived with the change and was written until the palettes went)
// nor `restoreSessionOnStartup` (written since).
function upgradeFavoritesWithRootVolume(
  record: Record<string, unknown>,
  favorites: FavoritePreference[],
): FavoritePreference[] {
  const savedBeforeRootFavorite =
    record.locationsExpanded !== undefined ||
    (record.autoLightTheme === undefined && record.restoreSessionOnStartup === undefined);
  if (
    record.favoritesInitialized !== true ||
    !savedBeforeRootFavorite ||
    favorites.some((favorite) => favorite.path === "/")
  ) {
    return favorites;
  }
  const rootFavorite: FavoritePreference = { path: "/", icon: "drive" };
  const trashIndex = favorites.findIndex((favorite) => favorite.path.endsWith("/.Trash"));
  return trashIndex === -1
    ? [...favorites, rootFavorite]
    : [...favorites.slice(0, trashIndex), rootFavorite, ...favorites.slice(trashIndex)];
}

// A saved toolbar identical to an earlier default was never customized; it gets the new one.
function isPreviousDefaultTopToolbar(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    PREVIOUS_DEFAULT_TOP_TOOLBARS.some(
      (previous) =>
        value.length === previous.length && value.every((item, index) => item === previous[index]),
    )
  );
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
