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
  type ThemeMode,
  type ThemePreference,
  UI_FONT_OPTIONS,
  clampDetailColumnWidth,
  clampNotificationDurationSeconds,
  clampOpenItemLimit,
  clampPaneWidth,
  clampZoomPercent,
  isThemeInGroup,
  normalizeAccentColor,
  resolveSavedTheme,
} from "../shared/appPreferences";
import {
  DEFAULT_TOP_TOOLBAR_ITEMS,
  LEGACY_DEFAULT_TOP_TOOLBAR_ITEMS,
  type ToolbarItemId,
  sanitizeLeftToolbarItems,
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
  private readonly defaultTheme: ThemePreference;
  private readonly fileSystem: AppStateStoreFileSystem;
  private readonly timer: AppStateStoreTimer;
  private readonly onReadError: (error: unknown) => void;
  private readonly onPersistError: (error: unknown) => void;
  private state: AppState;
  private promptSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, dependencies: AppStateStoreDependencies = {}) {
    this.filePath = filePath;
    this.defaultTheme = dependencies.defaultTheme ?? DEFAULT_APP_PREFERENCES.theme;
    this.fileSystem = dependencies.fs ?? DEFAULT_FILE_SYSTEM;
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
    this.state = readState(filePath, this.fileSystem, this.defaultTheme, this.onReadError);
  }

  getFilePath(): string {
    return this.filePath;
  }

  getPreferences(): AppPreferences {
    return this.state.preferences ?? withDefaultTheme(DEFAULT_APP_PREFERENCES, this.defaultTheme);
  }

  updatePreferences(value: Partial<AppPreferences>): AppPreferences {
    const current = this.getPreferences();
    const next = sanitizePreferences(
      {
        ...current,
        ...value,
      },
      this.defaultTheme,
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
  defaultTheme: ThemePreference,
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
    const preferences = sanitizePreferences(record.preferences, defaultTheme);
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

function sanitizeViewMode(value: unknown): ExplorerViewMode {
  return value === "icons" || value === "details" ? value : "list";
}

// Tabs saved by an older or damaged file are kept as far as they make sense; a tab that
// does not is dropped rather than failing the whole list.
function sanitizeOpenTabs(value: unknown): OpenTabPreference[] {
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
    });
    if (tabs.length === OPEN_TABS_LIMIT) {
      break;
    }
  }
  return tabs;
}

// This is the migration boundary for persisted preferences. When keys are renamed or
// removed, normalize legacy shapes here instead of letting stale values leak outward.
function sanitizePreferences(value: unknown, defaultTheme: ThemePreference): AppPreferences {
  const currentDefaults = withDefaultTheme(DEFAULT_APP_PREFERENCES, defaultTheme);
  if (!isPlainObject(value)) {
    return currentDefaults;
  }
  const record = value;
  return {
    // A removed palette is replaced by the closest remaining one (`resolveSavedTheme`).
    theme: record.theme === "auto" ? "auto" : (resolveSavedTheme(record.theme) ?? defaultTheme),
    autoLightTheme: resolveSavedThemeInGroup(
      record.autoLightTheme,
      "light",
      currentDefaults.autoLightTheme,
    ),
    autoDarkTheme: resolveSavedThemeInGroup(
      record.autoDarkTheme,
      "dark",
      currentDefaults.autoDarkTheme,
    ),
    accent:
      typeof record.accent === "string"
        ? (normalizeAccentColor(record.accent) ?? currentDefaults.accent)
        : currentDefaults.accent,
    zoomPercent: clampZoomPercent(
      typeof record.zoomPercent === "number" ? record.zoomPercent : currentDefaults.zoomPercent,
    ),
    uiFontFamily:
      typeof record.uiFontFamily === "string" &&
      UI_FONT_OPTIONS.some((option) => option.value === record.uiFontFamily)
        ? (record.uiFontFamily as AppPreferences["uiFontFamily"])
        : currentDefaults.uiFontFamily,
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
    highlightHoveredItems:
      typeof record.highlightHoveredItems === "boolean"
        ? record.highlightHoveredItems
        : currentDefaults.highlightHoveredItems,
    detailColumns: sanitizeDetailColumns(record.detailColumns, currentDefaults.detailColumns),
    detailColumnWidths: sanitizeDetailColumnWidths(
      record.detailColumnWidths,
      currentDefaults.detailColumnWidths,
    ),
    notificationsEnabled:
      typeof record.notificationsEnabled === "boolean"
        ? record.notificationsEnabled
        : currentDefaults.notificationsEnabled,
    notificationDurationSeconds: clampNotificationDurationSeconds(
      typeof record.notificationDurationSeconds === "number"
        ? record.notificationDurationSeconds
        : currentDefaults.notificationDurationSeconds,
    ),
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
        ? upgradeLegacyDefaultTopToolbar(sanitizeTopToolbarItems(record.topToolbarItems))
        : [...currentDefaults.topToolbarItems],
    leftToolbarItems:
      record.leftToolbarItems !== undefined
        ? sanitizeLeftToolbarItems(record.leftToolbarItems)
        : {
            main: [...currentDefaults.leftToolbarItems.main],
            utility: [...currentDefaults.leftToolbarItems.utility],
          },
    showSidebarRail:
      typeof record.showSidebarRail === "boolean"
        ? record.showSidebarRail
        : currentDefaults.showSidebarRail,
    showSidebarBottomRail:
      typeof record.showSidebarBottomRail === "boolean"
        ? record.showSidebarBottomRail
        : currentDefaults.showSidebarBottomRail,
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
    restoreLastVisitedFolderOnStartup:
      typeof record.restoreLastVisitedFolderOnStartup === "boolean"
        ? record.restoreLastVisitedFolderOnStartup
        : currentDefaults.restoreLastVisitedFolderOnStartup,
    restoreOpenTabsOnStartup:
      typeof record.restoreOpenTabsOnStartup === "boolean"
        ? record.restoreOpenTabsOnStartup
        : currentDefaults.restoreOpenTabsOnStartup,
    openTabs: sanitizeOpenTabs(record.openTabs),
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

// A saved palette for one side of Auto: kept when it still exists on that side, replaced
// when it was removed, and otherwise the default for that side.
function resolveSavedThemeInGroup(
  value: unknown,
  group: "light" | "dark",
  fallback: ThemeMode,
): ThemeMode {
  const theme = resolveSavedTheme(value);
  return theme && isThemeInGroup(theme, group) ? theme : fallback;
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
// before that change (no `showSidebarRail` yet, or a `locationsExpanded` flag, which is no
// longer written) gets it once; afterwards the user can remove it like any other favorite.
function upgradeFavoritesWithRootVolume(
  record: Record<string, unknown>,
  favorites: FavoritePreference[],
): FavoritePreference[] {
  const savedBeforeRootFavorite =
    record.showSidebarRail === undefined || record.locationsExpanded !== undefined;
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

// A toolbar identical to the old default was never customized; give it the new default.
function upgradeLegacyDefaultTopToolbar(items: ToolbarItemId[]): ToolbarItemId[] {
  const isLegacyDefault =
    items.length === LEGACY_DEFAULT_TOP_TOOLBAR_ITEMS.length &&
    items.every((item, index) => item === LEGACY_DEFAULT_TOP_TOOLBAR_ITEMS[index]);
  return isLegacyDefault ? [...DEFAULT_TOP_TOOLBAR_ITEMS] : items;
}

function withDefaultTheme(
  preferences: AppPreferences,
  defaultTheme: ThemePreference,
): AppPreferences {
  // The first-launch theme can be injected by the platform, but persisted preferences should
  // otherwise carry the entire state.
  return {
    ...preferences,
    theme: defaultTheme,
  };
}
