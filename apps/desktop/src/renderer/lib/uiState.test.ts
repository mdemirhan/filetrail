// @vitest-environment jsdom

import { DEFAULT_UI_STATE, clampPaneWidth, persistUiState, readStoredUiState } from "./uiState";

describe("uiState", () => {
  it("returns defaults when storage is empty", () => {
    expect(readStoredUiState()).toEqual(DEFAULT_UI_STATE);
  });

  it("persists and restores explorer ui state", () => {
    persistUiState({
      viewMode: "details",
      treeOpen: false,
      propertiesOpen: true,
      includeHidden: true,
      treeWidth: 301,
      inspectorWidth: 377,
    });

    expect(readStoredUiState()).toEqual({
      viewMode: "details",
      treeOpen: false,
      propertiesOpen: true,
      includeHidden: true,
      treeWidth: 301,
      inspectorWidth: 377,
    });
  });

  it("clamps pane widths into safe bounds", () => {
    expect(clampPaneWidth(100, 220, 520)).toBe(220);
    expect(clampPaneWidth(999, 220, 520)).toBe(520);
  });
});
