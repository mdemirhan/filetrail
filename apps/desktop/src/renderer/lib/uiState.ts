export type ExplorerViewMode = "list" | "details";

export type StoredUiState = {
  viewMode: ExplorerViewMode;
  treeOpen: boolean;
  propertiesOpen: boolean;
  includeHidden: boolean;
  treeWidth: number;
  inspectorWidth: number;
};

const STORAGE_KEY = "filetrail.ui";

export const DEFAULT_UI_STATE: StoredUiState = {
  viewMode: "list",
  treeOpen: true,
  propertiesOpen: true,
  includeHidden: false,
  treeWidth: 280,
  inspectorWidth: 320,
};

export function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function readStoredUiState(): StoredUiState {
  if (typeof window === "undefined") {
    return DEFAULT_UI_STATE;
  }
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_UI_STATE;
    }
    const parsed = JSON.parse(rawValue) as Partial<StoredUiState>;
    return {
      viewMode: parsed.viewMode === "details" ? "details" : "list",
      treeOpen: parsed.treeOpen ?? DEFAULT_UI_STATE.treeOpen,
      propertiesOpen: parsed.propertiesOpen ?? DEFAULT_UI_STATE.propertiesOpen,
      includeHidden: parsed.includeHidden ?? DEFAULT_UI_STATE.includeHidden,
      treeWidth: clampPaneWidth(parsed.treeWidth ?? DEFAULT_UI_STATE.treeWidth, 220, 520),
      inspectorWidth: clampPaneWidth(
        parsed.inspectorWidth ?? DEFAULT_UI_STATE.inspectorWidth,
        260,
        480,
      ),
    };
  } catch {
    return DEFAULT_UI_STATE;
  }
}

export function persistUiState(state: StoredUiState): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
