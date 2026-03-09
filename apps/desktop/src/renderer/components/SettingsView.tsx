import type {
  DetailColumnVisibility,
  ThemeMode,
  UiFontFamily,
  UiFontWeight,
} from "../../shared/appPreferences";

// SettingsView is a fully controlled form. Every field reflects the current preference
// snapshot and forwards edits upward immediately instead of maintaining local drafts.
export function SettingsView({
  theme,
  uiFontFamily,
  uiFontSize,
  uiFontWeight,
  effectiveTextPrimaryColor,
  effectiveTextSecondaryColor,
  effectiveTextMutedColor,
  compactListView,
  compactDetailsView,
  compactTreeView,
  detailColumns,
  layoutMode = "wide",
  tabSwitchesExplorerPanes,
  typeaheadEnabled,
  typeaheadDebounceMs,
  restoreLastVisitedFolderOnStartup,
  terminalApp,
  themeOptions,
  uiFontOptions,
  uiFontSizeOptions,
  uiFontWeightOptions,
  typeaheadDebounceOptions,
  onThemeChange,
  onUiFontFamilyChange,
  onUiFontSizeChange,
  onUiFontWeightChange,
  onTextPrimaryColorChange,
  onTextSecondaryColorChange,
  onTextMutedColorChange,
  onResetAppearance,
  onCompactListViewChange,
  onCompactDetailsViewChange,
  onCompactTreeViewChange,
  onDetailColumnsChange,
  onTabSwitchesExplorerPanesChange,
  onTypeaheadEnabledChange,
  onTypeaheadDebounceMsChange,
  onRestoreLastVisitedFolderOnStartupChange,
  onTerminalAppChange,
}: {
  theme: ThemeMode;
  uiFontFamily: UiFontFamily;
  uiFontSize: number;
  uiFontWeight: UiFontWeight;
  effectiveTextPrimaryColor: string;
  effectiveTextSecondaryColor: string;
  effectiveTextMutedColor: string;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactTreeView: boolean;
  detailColumns: DetailColumnVisibility;
  layoutMode?: "wide" | "narrow" | "compact";
  tabSwitchesExplorerPanes: boolean;
  typeaheadEnabled: boolean;
  typeaheadDebounceMs: number;
  restoreLastVisitedFolderOnStartup: boolean;
  terminalApp: string | null;
  themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }>;
  uiFontOptions: ReadonlyArray<{ value: UiFontFamily; label: string }>;
  uiFontSizeOptions: ReadonlyArray<number>;
  uiFontWeightOptions: ReadonlyArray<number>;
  typeaheadDebounceOptions: ReadonlyArray<number>;
  onThemeChange: (value: ThemeMode) => void;
  onUiFontFamilyChange: (value: UiFontFamily) => void;
  onUiFontSizeChange: (value: number) => void;
  onUiFontWeightChange: (value: UiFontWeight) => void;
  onTextPrimaryColorChange: (value: string | null) => void;
  onTextSecondaryColorChange: (value: string | null) => void;
  onTextMutedColorChange: (value: string | null) => void;
  onResetAppearance: () => void;
  onCompactListViewChange: (value: boolean) => void;
  onCompactDetailsViewChange: (value: boolean) => void;
  onCompactTreeViewChange: (value: boolean) => void;
  onDetailColumnsChange: (value: DetailColumnVisibility) => void;
  onTabSwitchesExplorerPanesChange: (value: boolean) => void;
  onTypeaheadEnabledChange: (value: boolean) => void;
  onTypeaheadDebounceMsChange: (value: number) => void;
  onRestoreLastVisitedFolderOnStartupChange: (value: boolean) => void;
  onTerminalAppChange: (value: string | null) => void;
}) {
  return (
    <div className="settings-view" data-layout={layoutMode}>
      <div className="settings-page">
        <header className="settings-page-header">
          <div className="settings-page-header-left">
            <span className="settings-page-eyebrow">File Trail</span>
            <h2>Settings</h2>
            <p>Application preferences and configuration</p>
          </div>
        </header>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <div className="settings-panel-title">
              <span className="settings-panel-icon settings-section-icon-storage" aria-hidden>
                Aa
              </span>
              <span>Appearance</span>
            </div>
            <button type="button" className="settings-section-action" onClick={onResetAppearance}>
              Reset
            </button>
          </div>

          <div className="settings-panel-body">
            <div className="settings-field-row">
              <div className="settings-field-row-label">Theme</div>
              <div className="settings-field-row-control">
                <select
                  className="settings-select"
                  value={theme}
                  onChange={(event) => onThemeChange(event.currentTarget.value as ThemeMode)}
                >
                  {themeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="settings-subsection">
              <div className="settings-subsection-title">UI Typography</div>
              <div className="settings-inline-grid">
                <label className="settings-field settings-field-wide">
                  <span className="settings-field-label">Font</span>
                  <select
                    className="settings-select"
                    value={uiFontFamily}
                    onChange={(event) =>
                      onUiFontFamilyChange(event.currentTarget.value as UiFontFamily)
                    }
                  >
                    {uiFontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="settings-field-label">Size</span>
                  <select
                    className="settings-select"
                    value={uiFontSize}
                    onChange={(event) => onUiFontSizeChange(Number(event.currentTarget.value))}
                  >
                    {uiFontSizeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}px
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-field">
                  <span className="settings-field-label">Weight</span>
                  <select
                    className="settings-select"
                    value={uiFontWeight}
                    onChange={(event) =>
                      onUiFontWeightChange(Number(event.currentTarget.value) as UiFontWeight)
                    }
                  >
                    {uiFontWeightOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="settings-subsection">
              <div className="settings-subsection-title">Colors</div>
              <div className="settings-color-stack">
                <label className="settings-field-row">
                  <span className="settings-field-row-label">Primary text</span>
                  <span className="settings-field-row-control settings-color-control">
                    <input
                      type="color"
                      className="settings-color-input"
                      value={effectiveTextPrimaryColor}
                      onChange={(event) => onTextPrimaryColorChange(event.currentTarget.value)}
                    />
                    <span className="settings-color-value">{effectiveTextPrimaryColor}</span>
                  </span>
                </label>
                <label className="settings-field-row">
                  <span className="settings-field-row-label">Secondary</span>
                  <span className="settings-field-row-control settings-color-control">
                    <input
                      type="color"
                      className="settings-color-input"
                      value={effectiveTextSecondaryColor}
                      onChange={(event) => onTextSecondaryColorChange(event.currentTarget.value)}
                    />
                    <span className="settings-color-value">{effectiveTextSecondaryColor}</span>
                  </span>
                </label>
                <label className="settings-field-row">
                  <span className="settings-field-row-label">Muted</span>
                  <span className="settings-field-row-control settings-color-control">
                    <input
                      type="color"
                      className="settings-color-input"
                      value={effectiveTextMutedColor}
                      onChange={(event) => onTextMutedColorChange(event.currentTarget.value)}
                    />
                    <span className="settings-color-value">{effectiveTextMutedColor}</span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <div className="settings-panel-title">
              <span className="settings-panel-icon settings-section-icon-storage" aria-hidden>
                ≡
              </span>
              <span>Explorer</span>
            </div>
          </div>
          <div className="settings-panel-body">
            <label className="settings-toggle-row">
              <span className="settings-toggle-copy">
                <span className="settings-toggle-title">Compact list view</span>
                <span className="settings-toggle-description">
                  Reduce list row height and spacing while keeping horizontal scrolling.
                </span>
              </span>
              <span className="settings-toggle-control">
                <input
                  type="checkbox"
                  className="settings-toggle-input"
                  checked={compactListView}
                  onChange={(event) => onCompactListViewChange(event.currentTarget.checked)}
                />
                <span className="settings-toggle-track" aria-hidden />
              </span>
            </label>
            <label className="settings-toggle-row">
              <span className="settings-toggle-copy">
                <span className="settings-toggle-title">Compact tree view</span>
                <span className="settings-toggle-description">
                  Reduce tree row height and spacing in the folders pane.
                </span>
              </span>
              <span className="settings-toggle-control">
                <input
                  type="checkbox"
                  className="settings-toggle-input"
                  checked={compactTreeView}
                  onChange={(event) => onCompactTreeViewChange(event.currentTarget.checked)}
                />
                <span className="settings-toggle-track" aria-hidden />
              </span>
            </label>
            <label className="settings-toggle-row">
              <span className="settings-toggle-copy">
                <span className="settings-toggle-title">Compact detail view</span>
                <span className="settings-toggle-description">
                  Use the same denser row height as compact list view in detail mode.
                </span>
              </span>
              <span className="settings-toggle-control">
                <input
                  type="checkbox"
                  className="settings-toggle-input"
                  checked={compactDetailsView}
                  onChange={(event) => onCompactDetailsViewChange(event.currentTarget.checked)}
                />
                <span className="settings-toggle-track" aria-hidden />
              </span>
            </label>
            <div className="settings-subsection">
              <div className="settings-subsection-title">Detail view columns</div>
              <div className="settings-check-grid">
                {(
                  [
                    ["size", "Size"],
                    ["modified", "Modified"],
                    ["permissions", "Permissions"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="settings-check-chip">
                    <input
                      type="checkbox"
                      checked={detailColumns[key]}
                      onChange={(event) =>
                        onDetailColumnsChange({
                          ...detailColumns,
                          [key]: event.currentTarget.checked,
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="settings-panel">
          <div className="settings-panel-header">
            <div className="settings-panel-title">
              <span className="settings-panel-icon settings-panel-icon-startup" aria-hidden>
                ⌨
              </span>
              <span>Keyboard</span>
            </div>
          </div>
          <div className="settings-panel-body">
            <label className="settings-toggle-row">
              <span className="settings-toggle-copy">
                <span className="settings-toggle-title">Tab switches between panes</span>
                <span className="settings-toggle-description">
                  Use Tab and Shift+Tab to move between the folder tree and file list while keeping
                  native Tab behavior in dialogs and standard controls.
                </span>
              </span>
              <span className="settings-toggle-control">
                <input
                  type="checkbox"
                  className="settings-toggle-input"
                  checked={tabSwitchesExplorerPanes}
                  onChange={(event) =>
                    onTabSwitchesExplorerPanesChange(event.currentTarget.checked)
                  }
                />
                <span className="settings-toggle-track" aria-hidden />
              </span>
            </label>

            <label className="settings-toggle-row">
              <span className="settings-toggle-copy">
                <span className="settings-toggle-title">Type to select</span>
                <span className="settings-toggle-description">
                  Jump to the first visible matching item while typing in the tree, list view, or
                  detail view.
                </span>
              </span>
              <span className="settings-toggle-control">
                <input
                  type="checkbox"
                  className="settings-toggle-input"
                  checked={typeaheadEnabled}
                  onChange={(event) => onTypeaheadEnabledChange(event.currentTarget.checked)}
                />
                <span className="settings-toggle-track" aria-hidden />
              </span>
            </label>

            <div className="settings-field-row">
              <div className="settings-field-row-label">Reset delay</div>
              <div className="settings-field-row-control">
                <select
                  className="settings-select"
                  value={typeaheadDebounceMs}
                  disabled={!typeaheadEnabled}
                  onChange={(event) =>
                    onTypeaheadDebounceMsChange(Number(event.currentTarget.value))
                  }
                >
                  {typeaheadDebounceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} ms
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-panel settings-panel-startup">
          <div className="settings-panel-header">
            <div className="settings-panel-title">
              <span className="settings-panel-icon settings-panel-icon-startup" aria-hidden>
                ⚡
              </span>
              <span>Startup</span>
            </div>
          </div>
          <div className="settings-panel-body">
            <label className="settings-toggle-row">
              <span className="settings-toggle-copy">
                <span className="settings-toggle-title">Restore last visited folder</span>
                <span className="settings-toggle-description">
                  Reopen the last folder instead of starting at home.
                </span>
              </span>
              <span className="settings-toggle-control">
                <input
                  type="checkbox"
                  className="settings-toggle-input"
                  checked={restoreLastVisitedFolderOnStartup}
                  onChange={(event) =>
                    onRestoreLastVisitedFolderOnStartupChange(event.currentTarget.checked)
                  }
                />
                <span className="settings-toggle-track" aria-hidden />
              </span>
            </label>

            <label className="settings-field settings-field-wide">
              <span className="settings-field-label">Terminal app</span>
              <input
                type="text"
                className="settings-text-input"
                aria-label="Terminal app"
                value={terminalApp ?? ""}
                placeholder="Terminal"
                onChange={(event) => {
                  const nextValue = event.currentTarget.value.trim();
                  onTerminalAppChange(nextValue.length > 0 ? nextValue : null);
                }}
              />
              <span className="settings-field-help">
                Leave blank to use Terminal. Enter another app name such as iTerm to override the
                default terminal launcher.
              </span>
            </label>
          </div>
        </section>

        <div className="settings-footer-note">Changes are saved automatically</div>
      </div>
    </div>
  );
}
