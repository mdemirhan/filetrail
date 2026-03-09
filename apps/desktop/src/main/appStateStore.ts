import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ACCENT_OPTIONS,
  type AppPreferences,
  type ApplicationSelection,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  DEFAULT_OPEN_WITH_APPLICATIONS,
  DEFAULT_TEXT_EDITOR,
  DETAIL_COLUMN_KEYS,
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
} from "../shared/appPreferences";

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
  private readonly onPersistError: (error: unknown) => void;
  private state: AppState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(filePath: string, dependencies: AppStateStoreDependencies = {}) {
    this.filePath = filePath;
    this.defaultTheme = dependencies.defaultTheme ?? DEFAULT_APP_PREFERENCES.theme;
    this.fileSystem = dependencies.fs ?? DEFAULT_FILE_SYSTEM;
    this.timer = dependencies.timer ?? DEFAULT_TIMER;
    this.onPersistError =
      dependencies.onPersistError ??
      ((error) => {
        console.error("[filetrail] failed persisting app state", error);
      });
    this.state = readState(filePath, this.fileSystem, this.defaultTheme);
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

// Loading is best-effort. Corrupt or old state should never block startup.
function readState(
  filePath: string,
  fileSystem: AppStateStoreFileSystem,
  defaultTheme: ThemeMode,
): AppState {
  if (!fileSystem.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fileSystem.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const preferences = sanitizePreferences(record.preferences, defaultTheme);
    const window = sanitizeWindowState(record.window);
    return {
      preferences,
      window,
    };
  } catch {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return currentDefaults;
  }
  const record = value as Record<string, unknown>;
  return {
    theme:
      typeof record.theme === "string" &&
      THEME_OPTIONS.some((option) => option.value === record.theme)
        ? (record.theme as AppPreferences["theme"])
        : defaultTheme,
    accent:
      typeof record.accent === "string" &&
      ACCENT_OPTIONS.some((option) => option.value === record.accent)
        ? (record.accent as AppPreferences["accent"])
        : currentDefaults.accent,
    accentToolbarButtons:
      typeof record.accentToolbarButtons === "boolean"
        ? record.accentToolbarButtons
        : currentDefaults.accentToolbarButtons,
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
    propertiesOpen:
      typeof record.propertiesOpen === "boolean"
        ? record.propertiesOpen
        : currentDefaults.propertiesOpen,
    detailRowOpen:
      typeof record.detailRowOpen === "boolean"
        ? record.detailRowOpen
        : currentDefaults.detailRowOpen,
    terminalApp: normalizeTerminalAppPreference(record.terminalApp),
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
  };
}

function normalizeColorOverride(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeTerminalAppPreference(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeApplicationSelection(
  value: unknown,
  defaults = DEFAULT_TEXT_EDITOR,
): ApplicationSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaults };
  }
  const record = value as Record<string, unknown>;
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
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const record = value as Record<string, unknown>;
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    DETAIL_COLUMN_KEYS.map((key) => [
      key,
      clampDetailColumnWidth(key, typeof record[key] === "number" ? record[key] : defaults[key]),
    ]),
  ) as AppPreferences["detailColumnWidths"];
}

function sanitizeWindowState(value: unknown): StoredWindowState {
  // Window position is optional, but dimensions are always normalized into a safe range.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_WINDOW_STATE;
  }
  const record = value as Record<string, unknown>;
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
