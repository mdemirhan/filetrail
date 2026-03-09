import { useState, type ReactNode } from "react";

import type {
  AccentMode,
  DetailColumnVisibility,
  ThemeMode,
  UiFontFamily,
  UiFontWeight,
} from "../../shared/appPreferences";
import { generateAccentTokens } from "../lib/accent";

const mono = "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace";
const sans = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif";

const settingsBaseThemes = {
  light: {
    page: { bg: "#edeef4" },
    header: { title: "#2a2a34", desc: "#a0a2ae" },
    card: { bg: "#f7f8fb", border: "rgba(0,0,0,0.06)", shadow: "0 1px 3px rgba(0,0,0,0.04)" },
    section: { title: "#2a2a34" },
    label: { primary: "#3a3a4a", secondary: "#8a8c9a" },
    input: {
      bg: "#fff",
      border: "rgba(0,0,0,0.1)",
      text: "#2a2a34",
    },
    select: {
      bg: "#fff",
      border: "rgba(0,0,0,0.1)",
      text: "#3a3a4a",
      arrow: "#a0a2ae",
    },
    toggle: { trackOff: "#d0d2da", knob: "#fff" },
    checkbox: {
      border: "rgba(0,0,0,0.15)",
      check: "#fff",
      uncheckedBg: "#fff",
    },
    color: {
      swatchBorder: "rgba(0,0,0,0.1)",
      inputBg: "#fff",
      inputBorder: "rgba(0,0,0,0.08)",
      text: "#5a5a6a",
    },
    separator: "rgba(0,0,0,0.05)",
    reset: {
      text: "#8a8c9a",
      bg: "transparent",
      border: "rgba(0,0,0,0.1)",
    },
    footer: "#a0a2ae",
  },
  dark: {
    page: { bg: "#181b22" },
    header: { title: "#dcdee8", desc: "#6a6d78" },
    card: {
      bg: "#1f222a",
      border: "rgba(255,255,255,0.05)",
      shadow: "0 1px 4px rgba(0,0,0,0.2)",
    },
    section: { title: "#dcdee8" },
    label: { primary: "#c0c4d0", secondary: "#7a7d8e" },
    input: {
      bg: "rgba(255,255,255,0.04)",
      border: "rgba(255,255,255,0.07)",
      text: "#d4d6e0",
    },
    select: {
      bg: "rgba(255,255,255,0.04)",
      border: "rgba(255,255,255,0.07)",
      text: "#c0c4d0",
      arrow: "#6a6d78",
    },
    toggle: { trackOff: "#333640", knob: "#1c1f26" },
    checkbox: {
      border: "rgba(255,255,255,0.08)",
      check: "#1c1f26",
      uncheckedBg: "rgba(255,255,255,0.04)",
    },
    color: {
      swatchBorder: "rgba(255,255,255,0.08)",
      inputBg: "rgba(255,255,255,0.04)",
      inputBorder: "rgba(255,255,255,0.06)",
      text: "#a0a4b4",
    },
    separator: "rgba(255,255,255,0.04)",
    reset: {
      text: "#7a7d8e",
      bg: "transparent",
      border: "rgba(255,255,255,0.07)",
    },
    footer: "#6a6d78",
  },
  "tomorrow-night": {
    page: { bg: "#151617" },
    header: { title: "#d8d9e0", desc: "#62636a" },
    card: {
      bg: "#1c1d1f",
      border: "rgba(255,255,255,0.04)",
      shadow: "0 1px 4px rgba(0,0,0,0.25)",
    },
    section: { title: "#d8d9e0" },
    label: { primary: "#b8b9c2", secondary: "#74757c" },
    input: {
      bg: "rgba(255,255,255,0.03)",
      border: "rgba(255,255,255,0.06)",
      text: "#d0d1d8",
    },
    select: {
      bg: "rgba(255,255,255,0.03)",
      border: "rgba(255,255,255,0.06)",
      text: "#b8b9c2",
      arrow: "#6a6b72",
    },
    toggle: { trackOff: "#2e2f32", knob: "#18191b" },
    checkbox: {
      border: "rgba(255,255,255,0.06)",
      check: "#18191b",
      uncheckedBg: "rgba(255,255,255,0.03)",
    },
    color: {
      swatchBorder: "rgba(255,255,255,0.06)",
      inputBg: "rgba(255,255,255,0.03)",
      inputBorder: "rgba(255,255,255,0.05)",
      text: "#9a9ba4",
    },
    separator: "rgba(255,255,255,0.035)",
    reset: {
      text: "#74757c",
      bg: "transparent",
      border: "rgba(255,255,255,0.06)",
    },
    footer: "#62636a",
  },
  "catppuccin-mocha": {
    page: { bg: "#0e0e18" },
    header: { title: "#dde4ff", desc: "#585878" },
    card: {
      bg: "#141420",
      border: "rgba(255,255,255,0.04)",
      shadow: "0 1px 4px rgba(0,0,0,0.3)",
    },
    section: { title: "#dde4ff" },
    label: { primary: "#b8bee0", secondary: "#707090" },
    input: {
      bg: "rgba(255,255,255,0.025)",
      border: "rgba(255,255,255,0.05)",
      text: "#dde4ff",
    },
    select: {
      bg: "rgba(255,255,255,0.025)",
      border: "rgba(255,255,255,0.05)",
      text: "#b8bee0",
      arrow: "#686888",
    },
    toggle: { trackOff: "#2a2a40", knob: "#11111b" },
    checkbox: {
      border: "rgba(255,255,255,0.05)",
      check: "#11111b",
      uncheckedBg: "rgba(255,255,255,0.025)",
    },
    color: {
      swatchBorder: "rgba(255,255,255,0.06)",
      inputBg: "rgba(255,255,255,0.025)",
      inputBorder: "rgba(255,255,255,0.04)",
      text: "#9a9ac0",
    },
    separator: "rgba(255,255,255,0.03)",
    reset: {
      text: "#707090",
      bg: "transparent",
      border: "rgba(255,255,255,0.05)",
    },
    footer: "#585878",
  },
} as const satisfies Record<ThemeMode, unknown>;

type ResolvedSettingsTheme = ReturnType<typeof resolveSettingsTheme>;

function resolveSettingsTheme(theme: ThemeMode, accent: AccentMode) {
  const base = settingsBaseThemes[theme];
  const accentTokens = generateAccentTokens(accent, theme);

  return {
    ...base,
    header: {
      ...base.header,
      subtitle: accentTokens.solid,
    },
    section: {
      ...base.section,
      iconBg: accentTokens.heroIconBg,
    },
    label: {
      ...base.label,
      category: accentTokens.pathCrumbHover,
    },
    input: {
      ...base.input,
      borderFocus: accentTokens.focusBorder,
      caret: accentTokens.solid,
    },
    toggle: {
      ...base.toggle,
      trackOn: accentTokens.solid,
    },
    checkbox: {
      ...base.checkbox,
      bg: accentTokens.solid,
    },
    reset: {
      ...base.reset,
      textHover: accentTokens.pathCrumbHover,
      bgHover: accentTokens.softBg,
      borderHover: accentTokens.border,
    },
    accent: accentTokens,
  };
}

function getTypographyColumns(layoutMode: "wide" | "narrow" | "compact") {
  if (layoutMode === "compact") {
    return "1fr";
  }
  if (layoutMode === "narrow") {
    return "minmax(0, 1fr) repeat(2, minmax(110px, 1fr))";
  }
  return "minmax(0, 2fr) repeat(2, minmax(132px, 1fr))";
}

function Toggle({
  checked,
  onToggle,
  theme,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  theme: ResolvedSettingsTheme;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      style={{
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        padding: "2px",
        background: checked ? theme.toggle.trackOn : theme.toggle.trackOff,
        border: "none",
        cursor: "pointer",
        transition: "background 0.2s ease",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        outline: "none",
      }}
    >
      <div
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "50%",
          background: theme.toggle.knob,
          transform: checked ? "translateX(16px)" : "translateX(0)",
          transition: "transform 0.2s ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }}
      />
    </button>
  );
}

function CheckboxChip({
  checked,
  onToggle,
  label,
  theme,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  theme: ResolvedSettingsTheme;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 10px 4px 4px",
        outline: "none",
        borderRadius: "4px",
      }}
    >
      <div
        style={{
          width: "16px",
          height: "16px",
          borderRadius: "4px",
          background: checked ? theme.checkbox.bg : theme.checkbox.uncheckedBg,
          border: `1.5px solid ${checked ? theme.checkbox.bg : theme.checkbox.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s ease",
          flexShrink: 0,
        }}
      >
        {checked ? (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke={theme.checkbox.check}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
      </div>
      <span
        style={{
          fontSize: "12px",
          fontFamily: sans,
          fontWeight: 450,
          color: theme.label.primary,
        }}
      >
        {label}
      </span>
    </button>
  );
}

function SelectControl({
  value,
  options,
  theme,
  width = "100%",
  onChange,
  ariaLabel,
  disabled = false,
  formatOption,
}: {
  value: string | number;
  options: ReadonlyArray<string | number>;
  theme: ResolvedSettingsTheme;
  width?: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  formatOption?: (value: string | number) => string;
}) {
  return (
    <div style={{ position: "relative", width }}>
      <select
        value={String(value)}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          width: "100%",
          height: "32px",
          padding: "0 28px 0 10px",
          borderRadius: "6px",
          background: theme.select.bg,
          border: `1px solid ${theme.select.border}`,
          color: disabled ? theme.label.secondary : theme.select.text,
          fontSize: "12px",
          fontFamily: mono,
          fontWeight: 500,
          cursor: disabled ? "default" : "pointer",
          outline: "none",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {formatOption ? formatOption(option) : String(option)}
          </option>
        ))}
      </select>
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke={theme.select.arrow}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{
          position: "absolute",
          right: "10px",
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

function ColorRow({
  label,
  value,
  theme,
  onChange,
}: {
  label: string;
  value: string;
  theme: ResolvedSettingsTheme;
  onChange: (value: string) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontSize: "12.5px",
          fontFamily: sans,
          fontWeight: 450,
          color: theme.label.primary,
        }}
      >
        {label}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
        <span
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "5px",
            background: value,
            border: `1.5px solid ${theme.color.swatchBorder}`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <input
            type="color"
            aria-label={label}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
            }}
          />
        </span>
        <span
          style={{
            padding: "3px 8px",
            borderRadius: "4px",
            background: theme.color.inputBg,
            border: `1px solid ${theme.color.inputBorder}`,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontFamily: mono,
              color: theme.color.text,
              fontWeight: 500,
            }}
          >
            {value}
          </span>
        </span>
      </span>
    </label>
  );
}

function AccentSelector({
  accent,
  accentOptions,
  theme,
  onChange,
}: {
  accent: AccentMode;
  accentOptions: ReadonlyArray<{
    value: AccentMode;
    label: string;
    primary: string;
  }>;
  theme: ResolvedSettingsTheme;
  onChange: (value: AccentMode) => void;
}) {
  const selected = accentOptions.find((option) => option.value === accent);

  return (
    <div style={{ display: "grid", gap: "8px", width: "100%" }}>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {accentOptions.map((option) => {
          const active = option.value === accent;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`Accent color ${option.label}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                border: `1px solid ${active ? theme.accent.border : theme.color.swatchBorder}`,
                background: option.primary,
                boxShadow: active
                  ? `0 0 0 2px ${theme.card.bg}, 0 0 0 4px ${theme.accent.focusBorder}`
                  : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                cursor: "pointer",
                transition: "box-shadow 0.14s ease, border-color 0.14s ease, transform 0.14s ease",
              }}
            />
          );
        })}
      </div>
      <span
        style={{
          fontSize: "11px",
          fontFamily: mono,
          fontWeight: 500,
          color: theme.label.secondary,
        }}
      >
        {selected?.label ?? accent}
      </span>
    </div>
  );
}

function TextInput({
  value,
  placeholder,
  theme,
  onChange,
}: {
  value: string;
  placeholder: string;
  theme: ResolvedSettingsTheme;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label="Terminal app"
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
      style={{
        width: "100%",
        height: "32px",
        padding: "0 10px",
        borderRadius: "6px",
        background: theme.input.bg,
        border: `1px solid ${theme.input.border}`,
        color: theme.input.text,
        fontSize: "12px",
        fontFamily: mono,
        fontWeight: 450,
        outline: "none",
        caretColor: theme.input.caret,
      }}
      onFocus={(event) => {
        event.currentTarget.style.borderColor = theme.input.borderFocus;
      }}
      onBlur={(event) => {
        event.currentTarget.style.borderColor = theme.input.border;
      }}
    />
  );
}

function SettingRow({
  title,
  desc,
  right,
  theme,
  isLast = false,
}: {
  title: string;
  desc?: string;
  right: ReactNode;
  theme: ResolvedSettingsTheme;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        gap: "16px",
        borderBottom: isLast ? "none" : `1px solid ${theme.separator}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "12.5px",
            fontFamily: sans,
            fontWeight: 500,
            color: theme.label.primary,
            marginBottom: desc ? "2px" : 0,
          }}
        >
          {title}
        </div>
        {desc ? (
          <div
            style={{
              fontSize: "11px",
              fontFamily: sans,
              fontWeight: 400,
              color: theme.label.secondary,
              lineHeight: "1.4",
            }}
          >
            {desc}
          </div>
        ) : null}
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  theme,
  resetButton,
  children,
}: {
  icon: string;
  title: string;
  theme: ResolvedSettingsTheme;
  resetButton?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: theme.card.bg,
        border: `1px solid ${theme.card.border}`,
        borderRadius: "10px",
        boxShadow: theme.card.shadow,
        marginBottom: "12px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: `1px solid ${theme.separator}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "5px",
              background: theme.section.iconBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: "10px" }}>{icon}</span>
          </div>
          <span
            style={{
              fontSize: "11px",
              fontFamily: mono,
              fontWeight: 600,
              color: theme.section.title,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>
        {resetButton}
      </div>
      <div style={{ padding: "4px 16px 12px" }}>{children}</div>
    </div>
  );
}

export function SettingsView({
  theme,
  accent,
  accentToolbarButtons,
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
  accentOptions,
  uiFontOptions,
  uiFontSizeOptions,
  uiFontWeightOptions,
  typeaheadDebounceOptions,
  onThemeChange,
  onAccentChange,
  onAccentToolbarButtonsChange,
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
  accent: AccentMode;
  accentToolbarButtons: boolean;
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
  accentOptions: ReadonlyArray<{
    value: AccentMode;
    label: string;
    primary: string;
  }>;
  uiFontOptions: ReadonlyArray<{ value: UiFontFamily; label: string }>;
  uiFontSizeOptions: ReadonlyArray<number>;
  uiFontWeightOptions: ReadonlyArray<number>;
  typeaheadDebounceOptions: ReadonlyArray<number>;
  onThemeChange: (value: ThemeMode) => void;
  onAccentChange: (value: AccentMode) => void;
  onAccentToolbarButtonsChange: (value: boolean) => void;
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
  const palette = resolveSettingsTheme(theme, accent);
  const [resetHover, setResetHover] = useState(false);

  return (
    <div
      className="settings-view"
      data-layout={layoutMode}
      style={{
        background: palette.page.bg,
        padding:
          layoutMode === "compact" ? "20px 16px 16px" : layoutMode === "narrow" ? "24px 18px 18px" : "28px 24px 20px",
        minHeight: "100%",
        overflowY: "auto",
      }}
    >
      <div
        className="settings-page"
        style={{
          maxWidth: "640px",
          margin: "0 auto",
        }}
      >
        <header className="settings-page-header" style={{ marginBottom: "20px" }}>
          <div className="settings-page-header-left">
            <span
              className="settings-page-eyebrow"
              style={{
                fontSize: "10px",
                fontFamily: mono,
                fontWeight: 600,
                color: palette.header.subtitle,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              File Trail
            </span>
            <h2
              style={{
                fontSize: "20px",
                fontFamily: sans,
                fontWeight: 700,
                color: palette.header.title,
                margin: "2px 0 3px",
                letterSpacing: "-0.02em",
              }}
            >
              Settings
            </h2>
            <p
              style={{
                fontSize: "11.5px",
                fontFamily: sans,
                color: palette.header.desc,
                fontWeight: 400,
                margin: 0,
              }}
            >
              Application preferences and configuration
            </p>
          </div>
        </header>

        <SectionCard
          icon="Aa"
          title="Appearance"
          theme={palette}
          resetButton={
            <button
              type="button"
              onClick={onResetAppearance}
              onMouseEnter={() => setResetHover(true)}
              onMouseLeave={() => setResetHover(false)}
              style={{
                fontSize: "11px",
                fontFamily: mono,
                fontWeight: 500,
                color: resetHover ? palette.reset.textHover : palette.reset.text,
                background: resetHover ? palette.reset.bgHover : palette.reset.bg,
                border: `1px solid ${resetHover ? palette.reset.borderHover : palette.reset.border}`,
                borderRadius: "5px",
                padding: "3px 10px",
                cursor: "pointer",
                transition: "all 0.12s ease",
                outline: "none",
              }}
            >
              Reset
            </button>
          }
        >
          <SettingRow
            title="Theme"
            theme={palette}
            right={
              <SelectControl
                value={theme}
                options={themeOptions.map((option) => option.value)}
                theme={palette}
                width="150px"
                ariaLabel="Theme"
                onChange={(value) => onThemeChange(value as ThemeMode)}
                formatOption={(value) =>
                  themeOptions.find((option) => option.value === value)?.label ?? String(value)
                }
              />
            }
          />

          <SettingRow
            title="Accent color"
            theme={palette}
            right={
              <div style={{ width: "228px", maxWidth: "100%" }}>
                <AccentSelector
                  accent={accent}
                  accentOptions={accentOptions}
                  theme={palette}
                  onChange={onAccentChange}
                />
              </div>
            }
          />

          <SettingRow
            title="Accent toolbar buttons"
            desc="Use the selected accent for primary toolbar actions."
            theme={palette}
            right={
              <Toggle
                checked={accentToolbarButtons}
                onToggle={() => onAccentToolbarButtonsChange(!accentToolbarButtons)}
                theme={palette}
                label="Accent toolbar buttons"
              />
            }
          />

          <div style={{ paddingTop: "8px", paddingBottom: "4px" }}>
            <span
              style={{
                fontSize: "10px",
                fontFamily: mono,
                fontWeight: 600,
                color: palette.label.category,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              UI Typography
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: getTypographyColumns(layoutMode),
              gap: "8px",
              paddingBottom: "8px",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "10.5px",
                  fontFamily: mono,
                  color: palette.label.secondary,
                  marginBottom: "4px",
                  fontWeight: 500,
                }}
              >
                Font
              </div>
              <SelectControl
                value={uiFontFamily}
                options={uiFontOptions.map((option) => option.value)}
                theme={palette}
                ariaLabel="Font"
                onChange={(value) => onUiFontFamilyChange(value as UiFontFamily)}
                formatOption={(value) =>
                  uiFontOptions.find((option) => option.value === value)?.label ?? String(value)
                }
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "10.5px",
                  fontFamily: mono,
                  color: palette.label.secondary,
                  marginBottom: "4px",
                  fontWeight: 500,
                }}
              >
                Size
              </div>
              <SelectControl
                value={uiFontSize}
                options={uiFontSizeOptions}
                theme={palette}
                ariaLabel="Size"
                onChange={(value) => onUiFontSizeChange(Number(value))}
                formatOption={(value) => `${value}px`}
              />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: "10.5px",
                  fontFamily: mono,
                  color: palette.label.secondary,
                  marginBottom: "4px",
                  fontWeight: 500,
                }}
              >
                Weight
              </div>
              <SelectControl
                value={uiFontWeight}
                options={uiFontWeightOptions}
                theme={palette}
                ariaLabel="Weight"
                onChange={(value) => onUiFontWeightChange(Number(value) as UiFontWeight)}
              />
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${palette.separator}`, paddingTop: "8px" }}>
            <span
              style={{
                fontSize: "10px",
                fontFamily: mono,
                fontWeight: 600,
                color: palette.label.category,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Colors
            </span>
          </div>
          <ColorRow
            label="Primary text"
            value={effectiveTextPrimaryColor}
            theme={palette}
            onChange={(value) => onTextPrimaryColorChange(value)}
          />
          <ColorRow
            label="Secondary"
            value={effectiveTextSecondaryColor}
            theme={palette}
            onChange={(value) => onTextSecondaryColorChange(value)}
          />
          <ColorRow
            label="Muted"
            value={effectiveTextMutedColor}
            theme={palette}
            onChange={(value) => onTextMutedColorChange(value)}
          />
        </SectionCard>

        <SectionCard icon="≡" title="Explorer" theme={palette}>
          <SettingRow
            title="Compact list view"
            desc="Reduce list row height and spacing while keeping horizontal scrolling."
            theme={palette}
            right={
              <Toggle
                checked={compactListView}
                onToggle={() => onCompactListViewChange(!compactListView)}
                theme={palette}
                label="Compact list view"
              />
            }
          />
          <SettingRow
            title="Compact tree view"
            desc="Reduce tree row height and spacing in the folders pane."
            theme={palette}
            right={
              <Toggle
                checked={compactTreeView}
                onToggle={() => onCompactTreeViewChange(!compactTreeView)}
                theme={palette}
                label="Compact tree view"
              />
            }
          />
          <SettingRow
            title="Compact detail view"
            desc="Use the same denser row height as compact list view in detail mode."
            theme={palette}
            right={
              <Toggle
                checked={compactDetailsView}
                onToggle={() => onCompactDetailsViewChange(!compactDetailsView)}
                theme={palette}
                label="Compact detail view"
              />
            }
          />

          <div
            style={{
              borderTop: `1px solid ${palette.separator}`,
              paddingTop: "8px",
              marginTop: "4px",
            }}
          >
            <span
              style={{
                fontSize: "10px",
                fontFamily: mono,
                fontWeight: 600,
                color: palette.label.category,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Detail View Columns
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: "4px",
              paddingTop: "8px",
              paddingBottom: "4px",
              flexWrap: "wrap",
            }}
          >
            {(
              [
                ["size", "Size"],
                ["modified", "Modified"],
                ["permissions", "Permissions"],
              ] as const
            ).map(([key, label]) => (
              <CheckboxChip
                key={key}
                checked={detailColumns[key]}
                label={label}
                theme={palette}
                onToggle={() =>
                  onDetailColumnsChange({
                    ...detailColumns,
                    [key]: !detailColumns[key],
                  })
                }
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard icon="⌨" title="Keyboard" theme={palette}>
          <SettingRow
            title="Tab switches between panes"
            desc="Use Tab and Shift+Tab to move between the folder tree and file list while keeping native Tab behavior in dialogs and standard controls."
            theme={palette}
            right={
              <Toggle
                checked={tabSwitchesExplorerPanes}
                onToggle={() => onTabSwitchesExplorerPanesChange(!tabSwitchesExplorerPanes)}
                theme={palette}
                label="Tab switches between panes"
              />
            }
          />
          <SettingRow
            title="Type to select"
            desc="Jump to the first visible matching item while typing in the tree, list, or detail view."
            theme={palette}
            right={
              <Toggle
                checked={typeaheadEnabled}
                onToggle={() => onTypeaheadEnabledChange(!typeaheadEnabled)}
                theme={palette}
                label="Type to select"
              />
            }
          />
          <SettingRow
            title="Reset delay"
            theme={palette}
            isLast
            right={
              <SelectControl
                value={typeaheadDebounceMs}
                options={typeaheadDebounceOptions}
                theme={palette}
                width="110px"
                ariaLabel="Reset delay"
                disabled={!typeaheadEnabled}
                onChange={(value) => onTypeaheadDebounceMsChange(Number(value))}
                formatOption={(value) => `${value} ms`}
              />
            }
          />
        </SectionCard>

        <SectionCard icon="⚡" title="Startup" theme={palette}>
          <SettingRow
            title="Restore last visited folder"
            desc="Reopen the last folder instead of starting at home."
            theme={palette}
            right={
              <Toggle
                checked={restoreLastVisitedFolderOnStartup}
                onToggle={() =>
                  onRestoreLastVisitedFolderOnStartupChange(!restoreLastVisitedFolderOnStartup)
                }
                theme={palette}
                label="Restore last visited folder"
              />
            }
          />

          <div
            style={{
              borderTop: `1px solid ${palette.separator}`,
              paddingTop: "8px",
              marginTop: "4px",
            }}
          >
            <div
              style={{
                fontSize: "12.5px",
                fontFamily: sans,
                fontWeight: 500,
                color: palette.label.primary,
                marginBottom: "6px",
              }}
            >
              Terminal app
            </div>
            <TextInput
              value={terminalApp ?? ""}
              placeholder="Terminal"
              theme={palette}
              onChange={(value) => {
                const trimmed = value.trim();
                onTerminalAppChange(trimmed.length > 0 ? trimmed : null);
              }}
            />
            <div
              style={{
                fontSize: "10.5px",
                fontFamily: sans,
                color: palette.label.secondary,
                marginTop: "6px",
                lineHeight: "1.4",
              }}
            >
              Leave blank to use Terminal. Enter another app name such as iTerm to override.
            </div>
          </div>
        </SectionCard>

        <div
          className="settings-footer-note"
          style={{ textAlign: "center", padding: "8px 0 4px" }}
        >
          <span
            style={{
              fontSize: "10.5px",
              fontFamily: mono,
              color: palette.footer,
              fontWeight: 400,
            }}
          >
            Changes are saved automatically
          </span>
        </div>
      </div>
    </div>
  );
}
