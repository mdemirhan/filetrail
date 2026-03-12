import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  FAVORITE_ICON_OPTIONS,
  type FavoriteIconId,
  type FavoritePreference,
  ICON_THEME_OPTIONS,
  THEME_OPTIONS,
  TYPEAHEAD_DEBOUNCE_MAX_MS,
  TYPEAHEAD_DEBOUNCE_MIN_MS,
  type ThemeMode,
  UI_FONT_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
  clampDetailColumnWidth,
  clampFontSize,
  clampFontWeight,
  clampNotificationDurationSeconds,
  clampOpenItemLimit,
  clampPaneWidth,
  clampTypeaheadDebounceMs,
  clampZoomPercent,
  normalizeAccentColor,
} from "../shared/appPreferences";
import { sanitizeLeftToolbarItems, sanitizeTopToolbarItems } from "../shared/toolbarItems";

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

type AppStateStoreFileSystem = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: true }) => void;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, data: string, encoding: "utf8") => void;
};

type AppStateStoreTimer = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type AppStateStoreDependencies = {
  defaultTheme?: ThemeMode;
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
};

const DEFAULT_TIMER: AppStateStoreTimer = {
  setTimeout,
  clearTimeout,
};

// The persisted store intentionally contains only restart-worthy UI state. Directory data,
// caches, and other ephemeral runtime state should stay out of this file.
export class AppStateStore {
  private readonly filePath: string;
  private readonly defaultTheme: ThemeMode;
  private readonly fileSystem: AppStateStoreFileSystem;
  private readonly timer: AppStateStoreTimer;
  private readonly onReadError: (error: unknown) => void;
  private readonly onPersistError: (error: unknown) => void;
  private state: AppState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.state = {
      ...this.state,
      preferences: next,
    };
    this.schedulePersist();
    return next;
  }

  getWindowState(): StoredWindowState {
    return this.state.window ?? DEFAULT_WINDOW_STATE;
  }

  setWindowState(value: StoredWindowState): void {
    const window = sanitizeWindowState(value);
    this.state = {
      ...this.state,
      window,
    };
    this.schedulePersist();
  }

  flush(): void {
    if (this.persistTimer) {
      this.timer.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    persistState(this.filePath, this.state, this.fileSystem, this.onPersistError);
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      this.timer.clearTimeout(this.persistTimer);
    }
    // Debounce writes so resize drags and repeated toggles do not hammer the filesystem.
    this.persistTimer = this.timer.setTimeout(() => {
      this.persistTimer = null;
      persistState(this.filePath, this.state, this.fileSystem, this.onPersistError);
    }, 150);
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
  defaultTheme: ThemeMode,
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
  try {
    fileSystem.mkdirSync(dirname(filePath), { recursive: true });
    fileSystem.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    onPersistError(error);
  }
}

// This is the migration boundary for persisted preferences. When keys are renamed or
// removed, normalize legacy shapes here instead of letting stale values leak outward.
function sanitizePreferences(value: unknown, defaultTheme: ThemeMode): AppPreferences {
  const currentDefaults = withDefaultTheme(DEFAULT_APP_PREFERENCES, defaultTheme);
  if (!isPlainObject(value)) {
    return currentDefaults;
  }
  const record = value;
  return {
    theme:
      typeof record.theme === "string" &&
      THEME_OPTIONS.some((option) => option.value === record.theme)
        ? (record.theme as AppPreferences["theme"])
        : defaultTheme,
    iconTheme:
      typeof record.iconTheme === "string" &&
      ICON_THEME_OPTIONS.some((option) => option.value === record.iconTheme)
        ? (record.iconTheme as AppPreferences["iconTheme"])
        : currentDefaults.iconTheme,
    accent:
      typeof record.accent === "string"
        ? (normalizeAccentColor(record.accent) ?? currentDefaults.accent)
        : currentDefaults.accent,
    accentToolbarButtons:
      typeof record.accentToolbarButtons === "boolean"
        ? record.accentToolbarButtons
        : currentDefaults.accentToolbarButtons,
    toolbarAccent:
      typeof record.toolbarAccent === "string"
        ? (normalizeAccentColor(record.toolbarAccent) ?? currentDefaults.toolbarAccent)
        : currentDefaults.toolbarAccent,
    accentFavoriteItems:
      typeof record.accentFavoriteItems === "boolean"
        ? record.accentFavoriteItems
        : currentDefaults.accentFavoriteItems,
    accentFavoriteText:
      typeof record.accentFavoriteText === "boolean"
        ? record.accentFavoriteText
        : currentDefaults.accentFavoriteText,
    favoriteAccent:
      typeof record.favoriteAccent === "string"
        ? (normalizeAccentColor(record.favoriteAccent) ?? currentDefaults.favoriteAccent)
        : currentDefaults.favoriteAccent,
    zoomPercent: clampZoomPercent(
      typeof record.zoomPercent === "number" ? record.zoomPercent : currentDefaults.zoomPercent,
    ),
    uiFontFamily:
      typeof record.uiFontFamily === "string" &&
      UI_FONT_OPTIONS.some((option) => option.value === record.uiFontFamily)
        ? (record.uiFontFamily as AppPreferences["uiFontFamily"])
        : currentDefaults.uiFontFamily,
    uiFontSize: clampFontSize(
      typeof record.uiFontSize === "number" ? record.uiFontSize : currentDefaults.uiFontSize,
      12,
      15,
    ),
    uiFontWeight: clampFontWeight(
      typeof record.uiFontWeight === "number" ? record.uiFontWeight : currentDefaults.uiFontWeight,
      UI_FONT_WEIGHT_OPTIONS,
      currentDefaults.uiFontWeight,
    ) as AppPreferences["uiFontWeight"],
    textPrimaryOverride: normalizeColorOverride(record.textPrimaryOverride),
    textSecondaryOverride: normalizeColorOverride(record.textSecondaryOverride),
    textMutedOverride: normalizeColorOverride(record.textMutedOverride),
    viewMode: record.viewMode === "details" ? "details" : "list",
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
    tabSwitchesExplorerPanes:
      typeof record.tabSwitchesExplorerPanes === "boolean"
        ? record.tabSwitchesExplorerPanes
        : currentDefaults.tabSwitchesExplorerPanes,
    typeaheadEnabled:
      typeof record.typeaheadEnabled === "boolean"
        ? record.typeaheadEnabled
        : currentDefaults.typeaheadEnabled,
    typeaheadDebounceMs: clampTypeaheadDebounceMs(
      typeof record.typeaheadDebounceMs === "number"
        ? record.typeaheadDebounceMs
        : currentDefaults.typeaheadDebounceMs,
      TYPEAHEAD_DEBOUNCE_MIN_MS,
      TYPEAHEAD_DEBOUNCE_MAX_MS,
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
    actionLogEnabled:
      typeof record.actionLogEnabled === "boolean"
        ? record.actionLogEnabled
        : currentDefaults.actionLogEnabled,
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
        ? sanitizeTopToolbarItems(record.topToolbarItems)
        : [...currentDefaults.topToolbarItems],
    leftToolbarItems:
      record.leftToolbarItems !== undefined
        ? sanitizeLeftToolbarItems(record.leftToolbarItems)
        : {
            main: [...currentDefaults.leftToolbarItems.main],
            utility: [...currentDefaults.leftToolbarItems.utility],
          },
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
      record.searchPatternMode === "glob" || record.searchPatternMode === "regex"
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
    searchIncludeHidden:
      typeof record.searchIncludeHidden === "boolean"
        ? record.searchIncludeHidden
        : currentDefaults.searchIncludeHidden,
    searchResultsSortBy:
      record.searchResultsSortBy === "name" || record.searchResultsSortBy === "path"
        ? record.searchResultsSortBy
        : currentDefaults.searchResultsSortBy,
    searchResultsSortDirection:
      record.searchResultsSortDirection === "desc" || record.searchResultsSortDirection === "asc"
        ? record.searchResultsSortDirection
        : currentDefaults.searchResultsSortDirection,
    searchResultsFilterScope:
      record.searchResultsFilterScope === "name" || record.searchResultsFilterScope === "path"
        ? record.searchResultsFilterScope
        : currentDefaults.searchResultsFilterScope,
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
    lastGoToFolderPath:
      typeof record.lastGoToFolderPath === "string" && record.lastGoToFolderPath.length > 0
        ? record.lastGoToFolderPath
        : currentDefaults.lastGoToFolderPath,
    favorites: sanitizeFavorites(record.favorites, record.favoritePaths, currentDefaults.favorites),
    favoritesPlacement:
      record.favoritesPlacement === "separate" || record.favoritesPlacement === "integrated"
        ? record.favoritesPlacement
        : currentDefaults.favoritesPlacement,
    favoritesPaneHeight:
      typeof record.favoritesPaneHeight === "number" &&
      Number.isFinite(record.favoritesPaneHeight) &&
      record.favoritesPaneHeight >= 96 &&
      record.favoritesPaneHeight <= 2400
        ? Math.round(record.favoritesPaneHeight)
        : currentDefaults.favoritesPaneHeight,
    favoritesExpanded:
      typeof record.favoritesExpanded === "boolean"
        ? record.favoritesExpanded
        : currentDefaults.favoritesExpanded,
    favoritesInitialized:
      typeof record.favoritesInitialized === "boolean"
        ? record.favoritesInitialized
        : currentDefaults.favoritesInitialized,
    copyPasteReviewDialogSize:
      isPlainObject(record.copyPasteReviewDialogSize) &&
      typeof record.copyPasteReviewDialogSize.width === "number" &&
      Number.isFinite(record.copyPasteReviewDialogSize.width) &&
      typeof record.copyPasteReviewDialogSize.height === "number" &&
      Number.isFinite(record.copyPasteReviewDialogSize.height) &&
      record.copyPasteReviewDialogSize.width >= 520 &&
      record.copyPasteReviewDialogSize.width <= 3200 &&
      record.copyPasteReviewDialogSize.height >= 420 &&
      record.copyPasteReviewDialogSize.height <= 2400
        ? {
            width: Math.round(record.copyPasteReviewDialogSize.width),
            height: Math.round(record.copyPasteReviewDialogSize.height),
          }
        : currentDefaults.copyPasteReviewDialogSize,
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

function normalizeColorOverride(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : null;
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

function sanitizeDetailColumns(
  value: unknown,
  defaults = DEFAULT_DETAIL_COLUMN_VISIBILITY,
): AppPreferences["detailColumns"] {
  // Optional detail columns are stored as booleans, but the runtime expects a full record.
  if (!isPlainObject(value)) {
    return defaults;
  }
  const record = value;
  return {
    size: typeof record.size === "boolean" ? record.size : defaults.size,
    modified: typeof record.modified === "boolean" ? record.modified : defaults.modified,
    permissions:
      typeof record.permissions === "boolean" ? record.permissions : defaults.permissions,
  };
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

function withDefaultTheme(preferences: AppPreferences, defaultTheme: ThemeMode): AppPreferences {
  // The first-launch theme can be injected by the platform, but persisted preferences should
  // otherwise carry the entire state.
  return {
    ...preferences,
    theme: defaultTheme,
  };
}
