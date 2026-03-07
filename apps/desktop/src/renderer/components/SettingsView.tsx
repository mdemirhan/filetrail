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

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-storage" aria-hidden>
              Aa
            </div>
            <div>
              <h3>Appearance</h3>
              <p>Theme and typography used throughout the explorer UI.</p>
            </div>
          </div>
          <div className="settings-section-body">
            <div className="settings-form-grid">
              <label className="settings-field">
                <span className="settings-field-label">Theme</span>
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
              </label>
              <label className="settings-field">
                <span className="settings-field-label">UI font</span>
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
                <span className="settings-field-label">UI size</span>
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
                <span className="settings-field-label">UI weight</span>
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
              <label className="settings-field">
                <span className="settings-field-label">Monospaced font</span>
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
                <span className="settings-field-label">Monospaced size</span>
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
                <span className="settings-field-label">Monospaced weight</span>
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
              <label className="settings-field">
                <span className="settings-field-label">Primary text color</span>
                <span className="settings-color-control">
                  <input
                    type="color"
                    className="settings-color-input"
                    value={effectiveTextPrimaryColor}
                    onChange={(event) => onTextPrimaryColorChange(event.currentTarget.value)}
                  />
                  <span className="settings-color-value">{effectiveTextPrimaryColor}</span>
                </span>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Secondary metadata color</span>
                <span className="settings-color-control">
                  <input
                    type="color"
                    className="settings-color-input"
                    value={effectiveTextSecondaryColor}
                    onChange={(event) => onTextSecondaryColorChange(event.currentTarget.value)}
                  />
                  <span className="settings-color-value">{effectiveTextSecondaryColor}</span>
                </span>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Muted label color</span>
                <span className="settings-color-control">
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
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-storage" aria-hidden>
              ::
            </div>
            <div>
              <h3>Startup</h3>
              <p>Restore explorer context and behavior when File Trail launches.</p>
            </div>
          </div>
          <div className="settings-section-body">
            <label className="settings-checkbox-card">
              <input
                type="checkbox"
                className="settings-checkbox-card-input"
                checked={restoreLastVisitedFolderOnStartup}
                onChange={(event) =>
                  onRestoreLastVisitedFolderOnStartupChange(event.currentTarget.checked)
                }
              />
              <span className="settings-checkbox-card-copy">
                <span className="settings-checkbox-card-title">
                  Restore last visited folder on startup
                </span>
                <span className="settings-checkbox-card-description">
                  Reopen the last folder you navigated to instead of always starting at your home
                  folder.
                </span>
              </span>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
