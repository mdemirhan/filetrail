import type {
  MonoFontFamily,
  MonoFontWeight,
  ThemeMode,
  UiFontFamily,
  UiFontWeight,
} from "../../shared/appPreferences";

export function SettingsView({
  theme,
  uiFontFamily,
  uiFontSize,
  uiFontWeight,
  monoFontFamily,
  monoFontSize,
  monoFontWeight,
  effectiveTextPrimaryColor,
  effectiveTextSecondaryColor,
  effectiveTextMutedColor,
  restoreLastVisitedFolderOnStartup,
  themeOptions,
  uiFontOptions,
  uiFontSizeOptions,
  uiFontWeightOptions,
  monoFontOptions,
  monoFontSizeOptions,
  monoFontWeightOptions,
  onThemeChange,
  onUiFontFamilyChange,
  onUiFontSizeChange,
  onUiFontWeightChange,
  onMonoFontFamilyChange,
  onMonoFontSizeChange,
  onMonoFontWeightChange,
  onTextPrimaryColorChange,
  onTextSecondaryColorChange,
  onTextMutedColorChange,
  onResetAppearance,
  onRestoreLastVisitedFolderOnStartupChange,
}: {
  theme: ThemeMode;
  uiFontFamily: UiFontFamily;
  uiFontSize: number;
  uiFontWeight: UiFontWeight;
  monoFontFamily: MonoFontFamily;
  monoFontSize: number;
  monoFontWeight: MonoFontWeight;
  effectiveTextPrimaryColor: string;
  effectiveTextSecondaryColor: string;
  effectiveTextMutedColor: string;
  restoreLastVisitedFolderOnStartup: boolean;
  themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }>;
  uiFontOptions: ReadonlyArray<{ value: UiFontFamily; label: string }>;
  uiFontSizeOptions: ReadonlyArray<number>;
  uiFontWeightOptions: ReadonlyArray<number>;
  monoFontOptions: ReadonlyArray<{ value: MonoFontFamily; label: string }>;
  monoFontSizeOptions: ReadonlyArray<number>;
  monoFontWeightOptions: ReadonlyArray<number>;
  onThemeChange: (value: ThemeMode) => void;
  onUiFontFamilyChange: (value: UiFontFamily) => void;
  onUiFontSizeChange: (value: number) => void;
  onUiFontWeightChange: (value: UiFontWeight) => void;
  onMonoFontFamilyChange: (value: MonoFontFamily) => void;
  onMonoFontSizeChange: (value: number) => void;
  onMonoFontWeightChange: (value: MonoFontWeight) => void;
  onTextPrimaryColorChange: (value: string | null) => void;
  onTextSecondaryColorChange: (value: string | null) => void;
  onTextMutedColorChange: (value: string | null) => void;
  onResetAppearance: () => void;
  onRestoreLastVisitedFolderOnStartupChange: (value: boolean) => void;
}) {
  return (
    <div className="settings-view">
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
              <div className="settings-subsection-title">Monospaced Typography</div>
              <div className="settings-inline-grid">
                <label className="settings-field settings-field-wide">
                  <span className="settings-field-label">Font</span>
                  <select
                    className="settings-select"
                    value={monoFontFamily}
                    onChange={(event) =>
                      onMonoFontFamilyChange(event.currentTarget.value as MonoFontFamily)
                    }
                  >
                    {monoFontOptions.map((option) => (
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
                    value={monoFontSize}
                    onChange={(event) => onMonoFontSizeChange(Number(event.currentTarget.value))}
                  >
                    {monoFontSizeOptions.map((option) => (
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
                    value={monoFontWeight}
                    onChange={(event) =>
                      onMonoFontWeightChange(Number(event.currentTarget.value) as MonoFontWeight)
                    }
                  >
                    {monoFontWeightOptions.map((option) => (
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
          </div>
        </section>

        <div className="settings-footer-note">Changes are saved automatically</div>
      </div>
    </div>
  );
}
