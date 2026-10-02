import {
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { SettingsTab as IpcSettingsTab } from "@filetrail/contracts";

import type {
  AccentMode,
  ApplicationSelection,
  DetailColumnVisibility,
  FavoriteIconId,
  FavoritePreference,
  FavoritesPlacement,
  FileActivationAction,
  OpenWithApplication,
  ReturnKeyAction,
  SearchPatternModePreference,
  TabStyle,
  ThemeMode,
  ThemePreference,
  ToolbarItemId,
  UiFontFamily,
} from "../../shared/appPreferences";
import {
  DARK_THEME_OPTIONS,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TERMINAL_APPLICATION,
  DEFAULT_TEXT_EDITOR,
  DETAIL_COLUMN_LABELS,
  FAVORITE_ICON_OPTIONS,
  LIGHT_THEME_OPTIONS,
  OPTIONAL_DETAIL_COLUMN_KEYS,
  SEARCH_PATTERN_MODES,
  SEARCH_PATTERN_MODE_LABELS,
  ZOOM_PERCENT_MAX,
  ZOOM_PERCENT_MIN,
  clampOpenItemLimit,
  clampZoomPercent,
  getThemeLabel,
  isThemeInGroup,
  normalizeAccentColor,
} from "../../shared/appPreferences";
import { type ShortcutOverrides, resolveShortcuts } from "../../shared/shortcuts";
import {
  DEFAULT_TOP_TOOLBAR_ITEMS,
  TOOLBAR_ITEM_IDS,
  addTopToolbarItem,
  getToolbarItemDefinition,
  isRequiredTopToolbarItem,
  sanitizeTopToolbarItems,
} from "../../shared/toolbarItems";
import { generateAccentTokens } from "../lib/accent";
import { getFavoriteLabel, getTrashPath } from "../lib/favorites";
import { FavoriteItemIcon } from "../lib/fileIcons";
import { createShortcutDisplay } from "../lib/shortcutDisplay";
import { type ThemeCssBase, getThemeVariant, resolveThemeCssBase } from "../lib/themeVariants";
import { VIEW_TEXT } from "../lib/viewColors";
import { uiMonoFontStack as mono, uiSansFontStack as sans } from "../lib/viewFonts";
import {
  ActionButton,
  SETTINGS_CONTROL_HEIGHT,
  SETTINGS_CONTROL_SHADOW,
  SectionCard,
  settingsControlBorder,
} from "./SettingsControls";
import { ShortcutSettings } from "./ShortcutSettings";
import { ToolbarIcon } from "./ToolbarIcon";

// Settings follows the Font preference; paths and color values are monospaced.

export type SettingsTab = IpcSettingsTab;

export type SearchDefaults = {
  searchPatternMode: SearchPatternModePreference;
  searchMatchScope: "name" | "path";
  searchRecursive: boolean;
  searchSkipGitFolders: boolean;
  searchSkipGitIgnored: boolean;
};

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
    footer: "#585878",
  },
} as const satisfies Record<ThemeCssBase, unknown>;

type ResolvedSettingsTheme = ReturnType<typeof resolveSettingsTheme>;

const NO_REQUIRED_TOOLBAR_ITEMS: ReadonlySet<ToolbarItemId> = new Set();
// The four items every toolbar has (the title, the clipboard button, View Options and search).
const REQUIRED_TOP_TOOLBAR_ITEMS: ReadonlySet<ToolbarItemId> = new Set(
  TOOLBAR_ITEM_IDS.filter(isRequiredTopToolbarItem),
);

// The order of the items that can be added: moving about, how the list is shown, what can
// be done with the selection, and the app itself.
const TOP_TOOLBAR_AVAILABLE_ITEM_ORDER: ToolbarItemId[] = [
  "topSeparator",
  "back",
  "forward",
  "up",
  "goToFolder",
  "refresh",
  "newTab",
  "view",
  "sort",
  "foldersFirst",
  "hidden",
  "infoPanel",
  "infoRow",
  "openSelection",
  "quickLook",
  "editSelection",
  "copySelection",
  "cutSelection",
  "pasteSelection",
  "renameSelection",
  "moveSelection",
  "duplicateSelection",
  "newFolder",
  "trashSelection",
  "openInTerminal",
  "showInFinder",
  "copyPath",
  "theme",
  "settings",
  "help",
];

// The keys a sentence names, or nothing when none of them is set: " (⌘+, ⌘−, ⌘0)".
function describeKeys(
  labels: ReadonlyArray<string | null>,
  before: string,
  after: string,
  separator = ", ",
): string {
  const keys = labels.filter((label): label is string => label !== null);
  return keys.length > 0 ? `${before}${keys.join(separator)}${after}` : "";
}

function sortToolbarAvailableItems(items: ToolbarItemId[], order: readonly ToolbarItemId[]) {
  const orderMap = new Map(order.map((itemId, index) => [itemId, index]));
  return [...items].sort((left, right) => {
    const leftIndex = orderMap.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderMap.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return getToolbarItemDefinition(left).label.localeCompare(
      getToolbarItemDefinition(right).label,
    );
  });
}

function resolveSettingsTheme(theme: ThemeMode, accent: AccentMode) {
  const base = resolveSettingsBaseTheme(theme);
  const accentTokens = generateAccentTokens(accent, theme);

  // Text uses the root tokens, so it follows the palette like the rest of the app.
  return {
    ...base,
    header: {
      title: VIEW_TEXT.primary,
      desc: VIEW_TEXT.muted,
      subtitle: accentTokens.solid,
    },
    section: {
      title: VIEW_TEXT.primary,
      iconBg: accentTokens.heroIconBg,
    },
    label: {
      primary: VIEW_TEXT.secondary,
      secondary: VIEW_TEXT.muted,
    },
    input: {
      ...base.input,
      text: VIEW_TEXT.primary,
      borderFocus: accentTokens.focusBorder,
      caret: accentTokens.solid,
    },
    select: { ...base.select, text: VIEW_TEXT.primary },
    color: { ...base.color, text: VIEW_TEXT.muted },
    footer: VIEW_TEXT.muted,
    toggle: {
      ...base.toggle,
      trackOn: accentTokens.solid,
    },
    checkbox: {
      ...base.checkbox,
      bg: accentTokens.solid,
    },
    accent: accentTokens,
  };
}

function resolveSettingsBaseTheme(theme: ThemeMode) {
  const cssBase = resolveThemeCssBase(theme);
  const base = settingsBaseThemes[cssBase];
  const variant = getThemeVariant(theme);
  if (!variant) {
    return base;
  }
  return {
    ...base,
    page: { bg: variant.surfaces.page },
    header: {
      title: variant.text.primary,
      desc: variant.text.muted,
    },
    card: {
      ...base.card,
      bg: variant.surfaces.card,
      border: variant.surfaces.cardBorder,
    },
    section: { title: variant.text.primary },
    label: {
      primary: variant.text.secondary,
      secondary: variant.text.muted,
    },
    input: {
      bg: variant.controls.inputBg,
      border: variant.controls.inputBorder,
      text: variant.text.primary,
    },
    select: {
      bg: variant.controls.selectBg,
      border: variant.controls.selectBorder,
      text: variant.controls.selectText,
      arrow: variant.controls.selectArrow,
    },
    toggle: {
      trackOff: variant.controls.toggleOff,
      knob: base.toggle.knob,
    },
    checkbox: {
      border: variant.controls.checkBorder,
      check: base.checkbox.check,
      uncheckedBg: variant.controls.checkOff,
    },
    color: {
      swatchBorder: variant.controls.inputBorder,
      inputBg: variant.controls.inputBg,
      inputBorder: variant.controls.inputBorder,
      text: variant.text.tertiary,
    },
    separator: variant.separator,
    footer: variant.text.muted,
  };
}

function Toggle({
  checked,
  onToggle,
  theme,
  label,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  theme: ResolvedSettingsTheme;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      style={{
        width: "36px",
        height: "20px",
        borderRadius: "10px",
        padding: "2px",
        background: checked ? theme.toggle.trackOn : theme.toggle.trackOff,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.2s ease",
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
        outline: "none",
        opacity: disabled ? 0.5 : 1,
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
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: "4px 10px 4px 4px",
        borderRadius: "4px",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{
          position: "absolute",
          opacity: 0,
          width: "1px",
          height: "1px",
          pointerEvents: "none",
        }}
      />
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
            aria-hidden="true"
            focusable="false"
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
    </label>
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
          height: SETTINGS_CONTROL_HEIGHT,
          padding: "0 28px 0 10px",
          borderRadius: "6px",
          background: theme.select.bg,
          border: settingsControlBorder(theme.select.border),
          color: disabled ? theme.label.secondary : theme.select.text,
          fontSize: "13px",
          fontFamily: sans,
          fontWeight: 400,
          boxShadow: SETTINGS_CONTROL_SHADOW,
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
        aria-hidden="true"
        focusable="false"
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
        <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />
      </svg>
    </div>
  );
}

function AppearanceThumbnail({ mode }: { mode: "auto" | "light" | "dark" }) {
  const light = { side: "#e4e4e9", main: "#ffffff", bar: "#d4d4da" };
  const dark = { side: "#2c2c30", main: "#1e1e20", bar: "#3c3c41" };
  const half = (colors: typeof light, clip?: string) => (
    <span style={{ position: "absolute", inset: 0, display: "flex", clipPath: clip }}>
      <span style={{ width: "22px", background: colors.side }} />
      <span
        style={{
          flex: 1,
          background: colors.main,
          display: "flex",
          flexDirection: "column",
          gap: "5px",
          padding: "8px 6px",
        }}
      >
        <span
          style={{ height: "5px", width: "70%", borderRadius: "3px", background: colors.bar }}
        />
        <span
          style={{
            height: "5px",
            width: "90%",
            borderRadius: "3px",
            background: "var(--ft-accent-solid)",
          }}
        />
        <span
          style={{ height: "5px", width: "55%", borderRadius: "3px", background: colors.bar }}
        />
      </span>
    </span>
  );
  return (
    <span
      style={{
        position: "relative",
        display: "block",
        width: "80px",
        height: "52px",
        borderRadius: "7px",
        overflow: "hidden",
        boxShadow: "0 0 0 0.5px rgba(0,0,0,0.25)",
      }}
    >
      {mode === "dark" ? half(dark) : half(light)}
      {mode === "auto" ? half(dark, "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)") : null}
    </span>
  );
}

// Auto / Light / Dark, like System Settings. Light and Dark use the palette chosen for that
// appearance, so switching back to Auto restores the same colors.
function AppearanceModePicker({
  theme,
  autoLightTheme,
  autoDarkTheme,
  palette,
  onChange,
}: {
  theme: ThemePreference;
  autoLightTheme: ThemeMode;
  autoDarkTheme: ThemeMode;
  palette: ResolvedSettingsTheme;
  onChange: (value: ThemePreference) => void;
}) {
  const current: "auto" | "light" | "dark" =
    theme === "auto"
      ? "auto"
      : LIGHT_THEME_OPTIONS.some((option) => option.value === theme)
        ? "light"
        : "dark";
  const modes: ReadonlyArray<{
    id: "auto" | "light" | "dark";
    label: string;
    value: ThemePreference;
  }> = [
    { id: "auto", label: "Auto", value: "auto" },
    { id: "light", label: "Light", value: autoLightTheme },
    { id: "dark", label: "Dark", value: autoDarkTheme },
  ];
  return (
    <div style={{ display: "flex", gap: "14px" }}>
      {modes.map((mode) => {
        const selected = current === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(mode.value)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "6px",
              padding: 0,
              border: 0,
              background: "transparent",
              color: selected ? palette.label.primary : palette.label.secondary,
              fontFamily: sans,
              fontSize: "11px",
              fontWeight: selected ? 600 : 400,
              cursor: "default",
            }}
          >
            <span
              style={{
                display: "flex",
                padding: "2px",
                borderRadius: "9px",
                boxShadow: selected ? "0 0 0 2.5px var(--ft-accent-solid)" : "none",
              }}
            >
              <AppearanceThumbnail mode={mode.id} />
            </span>
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}

// The accent color as a row of swatches, with a custom color at the end.
function AccentSelector({
  accent,
  accentOptions,
  theme,
  onChange,
}: {
  accent: AccentMode;
  accentOptions: ReadonlyArray<{ value: AccentMode; label: string }>;
  theme: ResolvedSettingsTheme;
  onChange: (value: AccentMode) => void;
}) {
  const selected = accentOptions.find((option) => option.value === accent);
  const isCustom = !selected;
  const customInputRef = useRef<HTMLInputElement | null>(null);

  const customButtonShadow =
    "conic-gradient(from 210deg, #d84a4a, #f0b236, #23c7d9, #9580ff, #e8729a, #d84a4a)";
  const customPickerValue = normalizeAccentColor(accent) ?? DEFAULT_APP_PREFERENCES.accent;

  const openColorPicker = useCallback((input: HTMLInputElement | null) => {
    if (!input) {
      return;
    }
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.click();
  }, []);

  return (
    <div style={{ display: "grid", gap: "8px", width: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${accentOptions.length + 1}, 28px)`,
          gridAutoRows: "28px",
          gap: "8px",
        }}
      >
        {accentOptions.map((option) => {
          const active = option.value === accent;
          return (
            <button
              key={option.value}
              type="button"
              title={option.label}
              aria-label={`Accent color ${option.label}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "999px",
                border: `1px solid ${active ? theme.accent.border : theme.color.swatchBorder}`,
                background: option.value,
                boxShadow: active
                  ? `0 0 0 2px ${theme.card.bg}, 0 0 0 4px ${theme.accent.focusBorder}`
                  : "inset 0 0 0 1px rgba(255,255,255,0.08)",
                cursor: "pointer",
                transition: "box-shadow 0.14s ease, border-color 0.14s ease, transform 0.14s ease",
                outline: "none",
              }}
            />
          );
        })}
        <button
          type="button"
          title="Custom Color"
          aria-label="Accent color Custom"
          aria-pressed={isCustom}
          onClick={() => openColorPicker(customInputRef.current)}
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "999px",
            border: "none",
            background: customButtonShadow,
            boxShadow: isCustom
              ? `0 0 0 2px ${theme.card.bg}, 0 0 0 4px ${theme.accent.focusBorder}`
              : `inset 0 0 0 1px ${theme.color.swatchBorder}`,
            cursor: "pointer",
            transition: "box-shadow 0.14s ease, border-color 0.14s ease, transform 0.14s ease",
            outline: "none",
            padding: isCustom ? "3px" : 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {isCustom ? (
            <span
              aria-hidden="true"
              style={{
                width: "100%",
                height: "100%",
                borderRadius: "999px",
                background: customPickerValue,
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
              }}
            />
          ) : null}
          <input
            ref={customInputRef}
            type="color"
            aria-label="Accent color Custom value"
            value={customPickerValue}
            onChange={(event) => {
              const next = normalizeAccentColor(event.currentTarget.value);
              if (next) {
                onChange(next);
              }
            }}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              pointerEvents: "none",
            }}
          />
        </button>
      </div>
      <span
        style={{
          fontSize: "11px",
          fontFamily: sans,
          fontWeight: 500,
          color: theme.label.secondary,
        }}
      >
        {selected?.label ?? "Custom"}
      </span>
    </div>
  );
}

function FavoriteIconPicker({
  selectedIcon,
  theme,
  ariaLabel,
  onChange,
}: {
  selectedIcon: FavoriteIconId;
  theme: ResolvedSettingsTheme;
  ariaLabel: string;
  onChange: (icon: FavoriteIconId) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDialogElement | null>(null);
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ left: 0, top: 0 });

  const popupColumns = 6;
  const popupWidth = 20 + popupColumns * 34 + (popupColumns - 1) * 8;
  const popupRows = Math.ceil(FAVORITE_ICON_OPTIONS.length / popupColumns);
  const popupHeight = 20 + popupRows * 34 + (popupRows - 1) * 8;

  const updatePopupPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 10;
    const preferredLeft = rect.left;
    const maxLeft = Math.max(margin, viewportWidth - popupWidth - margin);
    const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
    const fitsBelow = rect.bottom + gap + popupHeight <= viewportHeight - margin;
    const top = fitsBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - popupHeight);
    setPopupPosition({ left, top });
  }, [popupHeight, popupWidth]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        containerRef.current?.contains(target) ||
        popupRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleWindowChange = () => {
      updatePopupPosition();
    };
    // Capture phase and preventDefault: Escape closes this pop-up, and the window's own
    // Escape handling (which closes Settings) sees that the key is already used.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    updatePopupPosition();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [open, updatePopupPosition]);

  return (
    <div
      ref={containerRef}
      style={{
        display: "inline-flex",
        position: "relative",
        alignItems: "center",
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        title="Choose Icon"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            updatePopupPosition();
          }
          setOpen((current) => !current);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "34px",
          height: SETTINGS_CONTROL_HEIGHT,
          padding: "0",
          borderRadius: "6px",
          border: settingsControlBorder(theme.input.border),
          background: theme.input.bg,
          boxShadow: open ? `0 0 0 1px ${theme.accent.focusBorder}` : SETTINGS_CONTROL_SHADOW,
          outline: "none",
        }}
      >
        <FavoriteItemIcon icon={selectedIcon} />
      </button>
      {open
        ? createPortal(
            <dialog
              ref={popupRef}
              open
              aria-label={`${ariaLabel} options`}
              onCancel={(event) => {
                event.preventDefault();
              }}
              style={{
                position: "fixed",
                top: `${popupPosition.top}px`,
                left: `${popupPosition.left}px`,
                zIndex: 1000,
                width: `${popupWidth}px`,
                margin: 0,
                padding: "10px",
                borderRadius: "12px",
                background: theme.card.bg,
                border: `1px solid ${theme.input.border}`,
                boxShadow: theme.card.shadow,
                display: "grid",
                gridTemplateColumns: "repeat(6, 34px)",
                gridAutoRows: "34px",
                gap: "8px",
              }}
            >
              {FAVORITE_ICON_OPTIONS.map((option) => {
                const active = option.value === selectedIcon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    aria-label={`${ariaLabel}: ${option.label}`}
                    aria-pressed={active}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "34px",
                      height: "34px",
                      padding: "0",
                      borderRadius: "8px",
                      border: `1px solid ${active ? theme.accent.border : theme.input.border}`,
                      background: active ? theme.accent.softBg : theme.input.bg,
                      color: active ? theme.accent.pathCrumbHover : theme.label.primary,
                      boxShadow: active ? `0 0 0 1px ${theme.accent.focusBorder}` : "none",
                      transition:
                        "border-color 0.14s ease, box-shadow 0.14s ease, background 0.14s ease",
                      outline: "none",
                    }}
                  >
                    <FavoriteItemIcon icon={option.value} />
                  </button>
                );
              })}
            </dialog>,
            document.body,
          )
        : null}
    </div>
  );
}

// A toolbar item in the Toolbars editor: an icon tile with its name under it, so the item
// can be told apart without hovering.
const TOOLBAR_TILE_WIDTH = "66px";
// The title and the search field are not buttons, and their tiles say so: each is two tiles
// wide and drawn as what it is. Like every tile they have one size wherever they are put:
// the strip shows the order of the items, not how wide the toolbar will draw them.
const TOOLBAR_WIDE_TILE_WIDTH = "134px";

type ToolbarTileShape = "icon" | "title" | "search";

function getToolbarTileShape(itemId: ToolbarItemId): ToolbarTileShape {
  return itemId === "title" || itemId === "search" ? itemId : "icon";
}

const toolbarTileButtonStyle = {
  width: TOOLBAR_TILE_WIDTH,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "4px",
  border: 0,
  background: "transparent",
  padding: 0,
  transition: "opacity 0.12s ease",
} as const;

// Room around a group's tiles: over them for the remove button and the add mark, which
// stand a little above a tile, and under them for a name that takes two lines. A tile is
// wider than the box its icon is in, to leave room for the name: the tiles are pulled out by
// that difference, so the first box of a row starts where the text of every other group
// starts.
const TOOLBAR_TILE_BOX_INSET = 13;
const toolbarTileAreaStyle = {
  margin: `0 -${TOOLBAR_TILE_BOX_INSET}px`,
  padding: "20px 0 10px",
} as const;

const toolbarTileIconStyle = {
  width: "40px",
  height: "38px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "8px",
  flexShrink: 0,
  transition: "all 0.12s ease",
} as const;

function ToolbarTileLabel({ label, theme }: { label: string; theme: ResolvedSettingsTheme }) {
  return (
    <span
      // The button carries the name; this copy is for the eye.
      aria-hidden="true"
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
        maxWidth: "100%",
        minHeight: "24px",
        color: theme.label.secondary,
        fontFamily: sans,
        fontSize: "10px",
        lineHeight: 1.2,
        textAlign: "center",
      }}
    >
      {label}
    </span>
  );
}

// The mark on an item that is always in the toolbar.
function ToolbarTileRequiredBadge({ theme }: { theme: ResolvedSettingsTheme }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        right: "-5px",
        bottom: "-5px",
        width: "15px",
        height: "15px",
        borderRadius: "999px",
        background: theme.label.secondary,
        color: theme.page.bg,
        boxShadow: `0 0 0 2px ${theme.page.bg}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg viewBox="0 0 16 16" width="9" height="9" fill="none" aria-hidden="true">
        <rect x="3.5" y="7.5" width="9" height="6" rx="1.4" fill="currentColor" />
        <path
          d="M5.6 7.5V5.4a2.4 2.4 0 0 1 4.8 0v2.1"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function ToolbarEditor({
  title,
  items,
  availableItems,
  requiredItems = NO_REQUIRED_TOOLBAR_ITEMS,
  itemNotes = {},
  theme,
  onReorderItem,
  onRemoveItem,
  onAddItem,
  onReset,
  resetDisabled = false,
}: {
  title: string;
  items: ToolbarItemId[];
  availableItems: ToolbarItemId[];
  // Items that are always in the toolbar: they can be dragged to a new place, not removed.
  requiredItems?: ReadonlySet<ToolbarItemId>;
  // What to say about an item when the pointer rests on its tile.
  itemNotes?: Partial<Record<ToolbarItemId, string>>;
  theme: ResolvedSettingsTheme;
  onReorderItem: (sourceIndex: number, targetIndex: number) => void;
  onRemoveItem: (index: number) => void;
  onAddItem: (itemId: ToolbarItemId) => void;
  onReset?: () => void;
  // True while the toolbar is the default one, which Reset would leave as it is.
  resetDisabled?: boolean;
}) {
  const rootRef = useRef<HTMLFieldSetElement | null>(null);
  const activeStripRef = useRef<HTMLDivElement | null>(null);
  const dragCounterRef = useRef<Record<number, number>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [hoveredActiveIndex, setHoveredActiveIndex] = useState<number | null>(null);
  const [hoveredAvailableId, setHoveredAvailableId] = useState<ToolbarItemId | null>(null);

  const itemDefinitions = items.map((itemId, index) => ({
    definition: getToolbarItemDefinition(itemId),
    index,
  }));
  const availableDefinitions = availableItems.map((itemId) => getToolbarItemDefinition(itemId));

  // Every tile is drawn alike, whatever kind of control it stands for: a paler icon would
  // read as an item that is switched off.
  const appearance = { icon: theme.accent.solid, hover: theme.accent.softBg };

  const getInsertSide = useCallback(
    (index: number) => {
      if (draggedIndex === null || dragOverIndex !== index || draggedIndex === index) {
        return null;
      }
      return draggedIndex < index ? "right" : "left";
    },
    [draggedIndex, dragOverIndex],
  );

  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLButtonElement>, index: number) => {
      if (!items[index]) {
        event.preventDefault();
        return;
      }
      setDraggedIndex(index);
      event.dataTransfer.effectAllowed = "move";
      const ghost = document.createElement("div");
      ghost.style.cssText = [
        "position:absolute",
        "top:-1000px",
        "width:40px",
        "height:38px",
        `background:${theme.input.bg}`,
        `border:1px solid ${theme.input.border}`,
        "border-radius:8px",
      ].join(";");
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 20, 19);
      window.setTimeout(() => ghost.remove(), 0);
    },
    [items, theme.input.bg, theme.input.border],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLButtonElement>, targetIndex: number) => {
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = {};
      if (draggedIndex === null || draggedIndex === targetIndex) {
        setDraggedIndex(null);
        setDragOverIndex(null);
        return;
      }
      onReorderItem(draggedIndex, targetIndex);
      setDraggedIndex(null);
      setDragOverIndex(null);
    },
    [draggedIndex, onReorderItem],
  );

  return (
    <fieldset
      aria-label={title}
      ref={rootRef}
      onDragOver={(event) => {
        if (draggedIndex === null) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (draggedIndex === null) {
          return;
        }
        event.preventDefault();
        dragCounterRef.current = {};
        if (
          activeStripRef.current &&
          event.target instanceof Node &&
          activeStripRef.current.contains(event.target)
        ) {
          return;
        }
        // Dropped outside the strip: the item comes off, unless it is one that always stays.
        const itemId = items[draggedIndex];
        if (itemId && !requiredItems.has(itemId)) {
          onRemoveItem(draggedIndex);
        }
        setDraggedIndex(null);
        setDragOverIndex(null);
      }}
      style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}
    >
      <SectionCard
        title="In the Toolbar"
        note="Drag to reorder"
        theme={theme}
        resetButton={
          onReset ? (
            <ActionButton
              label="Reset"
              ariaLabel={`Reset ${title}`}
              theme={theme}
              disabled={resetDisabled}
              onClick={onReset}
            />
          ) : undefined
        }
      >
        <div ref={activeStripRef} style={toolbarTileAreaStyle}>
          <div style={{ display: "flex", gap: "8px 2px", flexWrap: "wrap", minHeight: "58px" }}>
            {itemDefinitions.map(({ definition, index }) => {
              const itemId = definition.id;
              const required = requiredItems.has(itemId);
              const shape = getToolbarTileShape(itemId);
              const isHovered = hoveredActiveIndex === index && draggedIndex === null;
              const isDragged = draggedIndex === index;
              const insertSide = getInsertSide(index);
              const swatchBorder = isHovered ? appearance.hover : theme.separator;
              const swatchStyle = {
                ...toolbarTileIconStyle,
                position: "relative",
                border: `1px solid ${swatchBorder}`,
                background: isHovered ? appearance.hover : theme.page.bg,
                color: appearance.icon,
              } as const;
              const wideSwatchStyle = {
                ...swatchStyle,
                // As far in from the tile's edges as an icon's box is, so the boxes line up.
                width: `calc(100% - ${2 * TOOLBAR_TILE_BOX_INSET}px)`,
                padding: "0 10px",
                justifyContent: "flex-start",
              } as const;
              return (
                <div
                  key={`${title}-${itemId}-${index}`}
                  data-toolbar-tile={itemId}
                  onMouseEnter={() => setHoveredActiveIndex(index)}
                  onMouseLeave={() =>
                    setHoveredActiveIndex((current) => (current === index ? null : current))
                  }
                  style={{
                    position: "relative",
                    display: "flex",
                    alignItems: "flex-start",
                    flex: "0 0 auto",
                  }}
                >
                  {insertSide === "left" ? (
                    <div
                      style={{
                        width: "3px",
                        height: "26px",
                        background: theme.accent.solid,
                        borderRadius: "999px",
                        margin: "6px -1px 0",
                        boxShadow: `0 0 10px ${theme.accent.softBg}`,
                      }}
                    />
                  ) : null}
                  <div
                    style={{
                      position: "relative",
                      flexShrink: 0,
                      width: shape === "icon" ? TOOLBAR_TILE_WIDTH : TOOLBAR_WIDE_TILE_WIDTH,
                    }}
                  >
                    <button
                      type="button"
                      draggable
                      aria-label={definition.label}
                      title={itemNotes[itemId]}
                      onDragStart={(event) => handleDragStart(event, index)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (draggedIndex !== null && draggedIndex !== index) {
                          setDragOverIndex(index);
                        }
                      }}
                      onDragEnter={() => {
                        dragCounterRef.current[index] = (dragCounterRef.current[index] ?? 0) + 1;
                        if (draggedIndex !== null && draggedIndex !== index) {
                          setDragOverIndex(index);
                        }
                      }}
                      onDragLeave={() => {
                        dragCounterRef.current[index] = Math.max(
                          0,
                          (dragCounterRef.current[index] ?? 1) - 1,
                        );
                        if (dragCounterRef.current[index] === 0 && dragOverIndex === index) {
                          setDragOverIndex(null);
                        }
                      }}
                      onDrop={(event) => handleDrop(event, index)}
                      onDragEnd={() => {
                        setDraggedIndex(null);
                        setDragOverIndex(null);
                        dragCounterRef.current = {};
                        setHoveredActiveIndex(null);
                      }}
                      style={{
                        ...toolbarTileButtonStyle,
                        width: "100%",
                        cursor: "grab",
                        opacity: isDragged ? 0.22 : 1,
                      }}
                    >
                      {shape === "title" ? (
                        // A stand-in for the folder's name and the line under it.
                        <span
                          style={{
                            ...wideSwatchStyle,
                            borderStyle: "dashed",
                            borderColor: isHovered ? theme.accent.border : theme.label.secondary,
                            flexDirection: "column",
                            alignItems: "flex-start",
                            justifyContent: "center",
                            gap: "1px",
                            fontFamily: sans,
                            lineHeight: 1.2,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              fontSize: "11.5px",
                              fontWeight: 700,
                              color: theme.section.title,
                            }}
                          >
                            Folder Name
                          </span>
                          <span
                            aria-hidden="true"
                            style={{ fontSize: "9.5px", color: theme.label.secondary }}
                          >
                            12 items
                          </span>
                          {required ? <ToolbarTileRequiredBadge theme={theme} /> : null}
                        </span>
                      ) : (
                        <span
                          style={
                            shape === "search"
                              ? { ...wideSwatchStyle, background: theme.input.bg }
                              : swatchStyle
                          }
                        >
                          <ToolbarIcon name={definition.icon} />
                          {required ? <ToolbarTileRequiredBadge theme={theme} /> : null}
                        </span>
                      )}
                      <ToolbarTileLabel label={definition.label} theme={theme} />
                    </button>
                    {isHovered && !required ? (
                      <button
                        type="button"
                        title="Remove"
                        aria-label={`Remove ${definition.label} from ${title}`}
                        onClick={() => onRemoveItem(index)}
                        style={{
                          position: "absolute",
                          top: "-6px",
                          right: "8px",
                          width: "18px",
                          height: "18px",
                          borderRadius: "999px",
                          border: "none",
                          background: "#dc2626",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                          fontSize: "10px",
                          fontWeight: 800,
                          padding: 0,
                          zIndex: 2,
                        }}
                      >
                        x
                      </button>
                    ) : null}
                  </div>
                  {insertSide === "right" ? (
                    <div
                      style={{
                        width: "3px",
                        height: "26px",
                        background: theme.accent.solid,
                        borderRadius: "999px",
                        margin: "6px -1px 0",
                        boxShadow: `0 0 10px ${theme.accent.softBg}`,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
            {itemDefinitions.length === 0 ? (
              <div
                style={{
                  padding: "8px 10px",
                  fontSize: "11px",
                  fontFamily: sans,
                  color: theme.label.secondary,
                  whiteSpace: "nowrap",
                }}
              >
                No items configured.
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Available Items" note="Click to add" theme={theme}>
        <div style={toolbarTileAreaStyle}>
          {availableDefinitions.length === 0 ? (
            <div
              style={{
                padding: "8px 0",
                color: theme.label.secondary,
                fontSize: "12px",
                fontFamily: sans,
              }}
            >
              Every item is in the toolbar.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, ${TOOLBAR_TILE_WIDTH})`,
                gap: "8px 2px",
                justifyContent: "start",
              }}
            >
              {availableDefinitions.map((definition) => {
                const isHovered = hoveredAvailableId === definition.id;
                return (
                  <button
                    key={`${title}-add-${definition.id}`}
                    type="button"
                    aria-label={`Add ${definition.label} to ${title}`}
                    onClick={() => onAddItem(definition.id)}
                    onMouseEnter={() => setHoveredAvailableId(definition.id)}
                    onMouseLeave={() => setHoveredAvailableId(null)}
                    style={{ ...toolbarTileButtonStyle, position: "relative", cursor: "pointer" }}
                  >
                    <span
                      style={{
                        ...toolbarTileIconStyle,
                        border: `1px solid ${isHovered ? appearance.hover : theme.separator}`,
                        background: isHovered ? appearance.hover : theme.input.bg,
                        color: isHovered ? appearance.icon : theme.label.secondary,
                      }}
                    >
                      <ToolbarIcon name={definition.icon} />
                    </span>
                    <ToolbarTileLabel label={definition.label} theme={theme} />
                    {isHovered ? (
                      <div
                        style={{
                          position: "absolute",
                          top: "-4px",
                          right: "10px",
                          width: "14px",
                          height: "14px",
                          borderRadius: "999px",
                          background: theme.accent.solid,
                          color: theme.page.bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.28)",
                          fontSize: "10px",
                          fontWeight: 700,
                        }}
                      >
                        +
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </SectionCard>
    </fieldset>
  );
}

function ApplicationSelectionDisplay({
  title,
  ariaLabel,
  application,
  theme,
  actions,
}: {
  title: string;
  ariaLabel: string;
  application: ApplicationSelection;
  theme: ResolvedSettingsTheme;
  actions: ReactNode;
}) {
  return (
    <div
      style={{
        paddingTop: "8px",
        marginTop: "4px",
      }}
    >
      <div
        style={{
          fontSize: "12.5px",
          fontFamily: sans,
          fontWeight: 500,
          color: theme.label.primary,
          marginBottom: "6px",
        }}
      >
        {title}
      </div>
      <fieldset
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "12px 0",
          margin: 0,
          border: 0,
          minInlineSize: 0,
        }}
      >
        <legend className="sr-only">{ariaLabel}</legend>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: "12.5px",
              fontFamily: sans,
              fontWeight: 500,
              color: theme.label.primary,
              marginBottom: "4px",
            }}
          >
            {application.appName}
          </div>
          <div
            style={{
              fontSize: "11px",
              fontFamily: mono,
              color: theme.label.secondary,
              lineHeight: "1.4",
              wordBreak: "break-all",
            }}
          >
            {application.appPath}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {actions}
        </div>
      </fieldset>
    </div>
  );
}

function formatZoomPercent(value: number): string {
  return `${value}%`;
}

function parseZoomPercent(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(/%/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  return clampZoomPercent(Number(normalized));
}

function ZoomLevelInput({
  value,
  theme,
  onChange,
}: {
  value: number;
  theme: ResolvedSettingsTheme;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatZoomPercent(value));

  useEffect(() => {
    setDraft(formatZoomPercent(value));
  }, [value]);

  const commit = () => {
    const parsed = parseZoomPercent(draft);
    if (parsed === null) {
      const fallback = DEFAULT_APP_PREFERENCES.zoomPercent;
      setDraft(formatZoomPercent(fallback));
      if (fallback !== value) {
        onChange(fallback);
      }
      return;
    }
    setDraft(formatZoomPercent(parsed));
    if (parsed !== value) {
      onChange(parsed);
    }
  };

  return (
    <input
      type="text"
      value={draft}
      aria-label="Zoom level"
      inputMode="decimal"
      spellCheck={false}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      onFocus={(event) => {
        event.currentTarget.style.borderColor = theme.input.borderFocus;
      }}
      onBlur={(event) => {
        event.currentTarget.style.borderColor = theme.input.border;
        commit();
      }}
      style={{
        width: "92px",
        height: SETTINGS_CONTROL_HEIGHT,
        padding: "0 10px",
        borderRadius: "6px",
        background: theme.input.bg,
        border: settingsControlBorder(theme.input.border),
        color: theme.input.text,
        fontSize: "13px",
        fontFamily: sans,
        fontWeight: 400,
        outline: "none",
        caretColor: theme.input.caret,
      }}
    />
  );
}

function OpenItemLimitInput({
  value,
  theme,
  onChange,
}: {
  value: number;
  theme: ResolvedSettingsTheme;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const normalized = draft.trim();
    if (!/^\d+$/.test(normalized)) {
      const fallback = DEFAULT_APP_PREFERENCES.openItemLimit;
      setDraft(String(fallback));
      if (fallback !== value) {
        onChange(fallback);
      }
      return;
    }
    const nextValue = clampOpenItemLimit(Number(normalized));
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  return (
    <input
      type="number"
      min={1}
      max={50}
      value={draft}
      aria-label="Open and Edit item limit"
      inputMode="numeric"
      spellCheck={false}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      onFocus={(event) => {
        event.currentTarget.style.borderColor = theme.input.borderFocus;
      }}
      onBlur={(event) => {
        event.currentTarget.style.borderColor = theme.input.border;
        commit();
      }}
      style={{
        width: "92px",
        height: SETTINGS_CONTROL_HEIGHT,
        padding: "0 10px",
        borderRadius: "6px",
        background: theme.input.bg,
        border: settingsControlBorder(theme.input.border),
        color: theme.input.text,
        fontSize: "13px",
        fontFamily: sans,
        fontWeight: 400,
        outline: "none",
        caretColor: theme.input.caret,
      }}
    />
  );
}

function SettingRow({
  title,
  desc,
  right,
  theme,
}: {
  title: string;
  desc?: string | undefined;
  right: ReactNode;
  theme: ResolvedSettingsTheme;
}) {
  // The line under the row is `.settings-row`'s: every row has one but the last of its
  // group, whichever that turns out to be.
  return (
    <div
      className="settings-row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 0",
        gap: "16px",
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

export function SettingsView({
  activeTab,
  searchDefaults,
  onSearchDefaultsChange = () => undefined,
  theme,
  effectiveTheme,
  autoLightTheme = DEFAULT_APP_PREFERENCES.autoLightTheme,
  autoDarkTheme = DEFAULT_APP_PREFERENCES.autoDarkTheme,
  onAutoLightThemeChange = () => undefined,
  onAutoDarkThemeChange = () => undefined,
  accent,
  zoomPercent,
  uiFontFamily,
  compactListView,
  compactDetailsView,
  compactIconView,
  compactTreeView,
  singleClickExpandTreeItems,
  highlightHoveredItems = true,
  detailColumns,
  layoutMode = "wide",
  notificationsEnabled,
  notificationDurationSeconds,
  highlightClipboardItemsInTree = true,
  highlightClipboardItemsInContent = true,
  notifyClipboardItems = true,
  topToolbarItems,
  restoreLastVisitedFolderOnStartup,
  restoreOpenTabsOnStartup,
  homePath,
  terminalApp,
  defaultTextEditor,
  favorites,
  favoritesPlacement,
  openWithApplications,
  fileActivationAction,
  returnKeyAction = "rename",
  onReturnKeyActionChange = () => undefined,
  tabStyle = DEFAULT_APP_PREFERENCES.tabStyle,
  onTabStyleChange = () => undefined,
  shortcutOverrides = DEFAULT_APP_PREFERENCES.shortcutOverrides,
  onShortcutOverridesChange = () => undefined,
  openItemLimit,
  accentOptions,
  uiFontOptions,
  notificationDurationSecondsOptions,
  onThemeChange,
  onAccentChange,
  onZoomPercentChange,
  onUiFontFamilyChange,
  onResetAppearance,
  onCompactListViewChange,
  onCompactDetailsViewChange,
  onCompactIconViewChange,
  onCompactTreeViewChange,
  onSingleClickExpandTreeItemsChange,
  onHighlightHoveredItemsChange = () => undefined,
  onDetailColumnsChange,
  onNotificationsEnabledChange,
  onHighlightClipboardItemsInTreeChange = () => undefined,
  onHighlightClipboardItemsInContentChange = () => undefined,
  onNotifyClipboardItemsChange = () => undefined,
  onNotificationDurationSecondsChange,
  onTopToolbarItemsChange,
  onResetTopToolbar,
  onRestoreLastVisitedFolderOnStartupChange,
  onRestoreOpenTabsOnStartupChange,
  onBrowseTerminalApp,
  onClearTerminalApp,
  onBrowseDefaultTextEditor,
  onClearDefaultTextEditor,
  onAddFavorite,
  onBrowseFavorite,
  onMoveFavorite,
  onRemoveFavorite,
  onRestoreDefaultFavorites,
  onFavoriteIconChange,
  onFavoritesPlacementChange,
  onAddOpenWithApplication,
  onBrowseOpenWithApplication,
  onMoveOpenWithApplication,
  onRemoveOpenWithApplication,
  onFileActivationActionChange,
  onOpenItemLimitChange,
}: {
  // In the Settings window each toolbar tab shows one group of sections; without a tab
  // (tests, embedded use) every section renders.
  activeTab?: SettingsTab;
  // Defaults for new searches; the Search tab only renders when these are provided.
  searchDefaults?: SearchDefaults | undefined;
  onSearchDefaultsChange?: (patch: Partial<SearchDefaults>) => void;
  theme: ThemePreference;
  effectiveTheme?: ThemeMode;
  autoLightTheme?: ThemeMode;
  autoDarkTheme?: ThemeMode;
  onAutoLightThemeChange?: (value: ThemeMode) => void;
  onAutoDarkThemeChange?: (value: ThemeMode) => void;
  accent: AccentMode;
  zoomPercent: number;
  uiFontFamily: UiFontFamily;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactIconView: boolean;
  compactTreeView: boolean;
  singleClickExpandTreeItems: boolean;
  highlightHoveredItems?: boolean;
  detailColumns: DetailColumnVisibility;
  layoutMode?: "wide" | "narrow" | "compact";
  notificationsEnabled: boolean;
  notificationDurationSeconds: number;
  highlightClipboardItemsInTree?: boolean;
  highlightClipboardItemsInContent?: boolean;
  notifyClipboardItems?: boolean;
  topToolbarItems: ToolbarItemId[];
  restoreLastVisitedFolderOnStartup: boolean;
  restoreOpenTabsOnStartup: boolean;
  homePath: string;
  terminalApp: ApplicationSelection | null;
  defaultTextEditor: ApplicationSelection;
  favorites: ReadonlyArray<FavoritePreference>;
  favoritesPlacement: FavoritesPlacement;
  openWithApplications: ReadonlyArray<OpenWithApplication>;
  fileActivationAction: FileActivationAction;
  returnKeyAction?: ReturnKeyAction;
  onReturnKeyActionChange?: (value: ReturnKeyAction) => void;
  tabStyle?: TabStyle;
  onTabStyleChange?: (value: TabStyle) => void;
  // The keyboard shortcuts that differ from their defaults (the Shortcuts tab).
  shortcutOverrides?: ShortcutOverrides;
  onShortcutOverridesChange?: (value: ShortcutOverrides) => void;
  openItemLimit: number;
  accentOptions: ReadonlyArray<{ value: AccentMode; label: string }>;
  uiFontOptions: ReadonlyArray<{ value: UiFontFamily; label: string }>;
  notificationDurationSecondsOptions: ReadonlyArray<number>;
  onThemeChange: (value: ThemePreference) => void;
  onAccentChange: (value: AccentMode) => void;
  onZoomPercentChange: (value: number) => void;
  onUiFontFamilyChange: (value: UiFontFamily) => void;
  onResetAppearance: () => void;
  onCompactListViewChange: (value: boolean) => void;
  onCompactDetailsViewChange: (value: boolean) => void;
  onCompactIconViewChange: (value: boolean) => void;
  onCompactTreeViewChange: (value: boolean) => void;
  onSingleClickExpandTreeItemsChange: (value: boolean) => void;
  onHighlightHoveredItemsChange?: (value: boolean) => void;
  onDetailColumnsChange: (value: DetailColumnVisibility) => void;
  onNotificationsEnabledChange: (value: boolean) => void;
  onHighlightClipboardItemsInTreeChange?: (value: boolean) => void;
  onHighlightClipboardItemsInContentChange?: (value: boolean) => void;
  onNotifyClipboardItemsChange?: (value: boolean) => void;
  onNotificationDurationSecondsChange: (value: number) => void;
  onTopToolbarItemsChange: (value: ToolbarItemId[]) => void;
  onResetTopToolbar: () => void;
  onRestoreLastVisitedFolderOnStartupChange: (value: boolean) => void;
  onRestoreOpenTabsOnStartupChange: (value: boolean) => void;
  onBrowseTerminalApp: () => void;
  onClearTerminalApp: () => void;
  onBrowseDefaultTextEditor: () => void;
  onClearDefaultTextEditor: () => void;
  onAddFavorite: () => void;
  onBrowseFavorite: (index: number) => void;
  onMoveFavorite: (index: number, direction: "up" | "down") => void;
  onRemoveFavorite: (index: number) => void;
  onRestoreDefaultFavorites: () => void;
  onFavoriteIconChange: (index: number, icon: FavoriteIconId) => void;
  onFavoritesPlacementChange: (value: FavoritesPlacement) => void;
  onAddOpenWithApplication: () => void;
  onBrowseOpenWithApplication: (entryId: string) => void;
  onMoveOpenWithApplication: (entryId: string, direction: "up" | "down") => void;
  onRemoveOpenWithApplication: (entryId: string) => void;
  onFileActivationActionChange: (value: FileActivationAction) => void;
  onOpenItemLimitChange: (value: number) => void;
}) {
  const showSection = (tab: SettingsTab) => activeTab === undefined || activeTab === tab;
  const paintedTheme: ThemeMode = effectiveTheme ?? (theme === "auto" ? autoLightTheme : theme);
  const palette = resolveSettingsTheme(paintedTheme, accent);
  // Settings names a few keys in its own text; they follow the Shortcuts tab.
  const shortcutDisplay = useMemo(
    () => createShortcutDisplay(resolveShortcuts(shortcutOverrides), { returnKeyAction }),
    [shortcutOverrides, returnKeyAction],
  );
  const isDefaultTextEditorSelection =
    defaultTextEditor.appPath === DEFAULT_TEXT_EDITOR.appPath &&
    defaultTextEditor.appName === DEFAULT_TEXT_EDITOR.appName;
  // The whole toolbar in order, the items that always stay included.
  const orderedTopToolbarItems = useMemo(
    () => sanitizeTopToolbarItems(topToolbarItems),
    [topToolbarItems],
  );
  const isDefaultTopToolbar =
    orderedTopToolbarItems.length === DEFAULT_TOP_TOOLBAR_ITEMS.length &&
    orderedTopToolbarItems.every((itemId, index) => itemId === DEFAULT_TOP_TOOLBAR_ITEMS[index]);
  const sortedTopToolbarAvailableItems = sortToolbarAvailableItems(
    TOOLBAR_ITEM_IDS.filter(
      (itemId) =>
        !isRequiredTopToolbarItem(itemId) &&
        (getToolbarItemDefinition(itemId).allowDuplicates ||
          !orderedTopToolbarItems.includes(itemId)),
    ),
    TOP_TOOLBAR_AVAILABLE_ITEM_ORDER,
  );

  const reorderToolbarItems = useCallback(
    (items: ToolbarItemId[], sourceIndex: number, targetIndex: number) => {
      if (
        sourceIndex < 0 ||
        sourceIndex >= items.length ||
        targetIndex < 0 ||
        targetIndex >= items.length ||
        sourceIndex === targetIndex
      ) {
        return items;
      }
      const nextItems = [...items];
      const [movedItem] = nextItems.splice(sourceIndex, 1);
      if (!movedItem) {
        return items;
      }
      nextItems.splice(targetIndex, 0, movedItem);
      return nextItems;
    },
    [],
  );
  const handleTopToolbarMove = useCallback(
    (sourceIndex: number, targetIndex: number) => {
      onTopToolbarItemsChange(
        reorderToolbarItems(orderedTopToolbarItems, sourceIndex, targetIndex),
      );
    },
    [orderedTopToolbarItems, onTopToolbarItemsChange, reorderToolbarItems],
  );
  const handleTopToolbarRemove = useCallback(
    (index: number) => {
      const itemId = orderedTopToolbarItems[index];
      if (itemId === undefined || isRequiredTopToolbarItem(itemId)) {
        return;
      }
      onTopToolbarItemsChange(
        orderedTopToolbarItems.filter((_, candidateIndex) => candidateIndex !== index),
      );
    },
    [orderedTopToolbarItems, onTopToolbarItemsChange],
  );
  const handleTopToolbarAdd = useCallback(
    (itemId: ToolbarItemId) => {
      const definition = getToolbarItemDefinition(itemId);
      if (!definition.allowDuplicates && orderedTopToolbarItems.includes(itemId)) {
        return;
      }
      onTopToolbarItemsChange(addTopToolbarItem(orderedTopToolbarItems, itemId));
    },
    [orderedTopToolbarItems, onTopToolbarItemsChange],
  );
  return (
    <div
      className="settings-view"
      data-layout={layoutMode}
      style={{
        background: palette.page.bg,
        padding:
          layoutMode === "compact"
            ? "26px 16px 16px"
            : layoutMode === "narrow"
              ? "30px 18px 18px"
              : "34px 24px 20px",
        minHeight: "100%",
        overflowY: "auto",
      }}
    >
      <div
        className="settings-page"
        style={{
          maxWidth: "704px",
          margin: "0 auto",
        }}
      >
        {activeTab ? null : (
          <header className="settings-page-header" style={{ marginBottom: "20px" }}>
            <div className="settings-page-header-left">
              <span
                className="settings-page-eyebrow"
                style={{
                  fontSize: "10px",
                  fontFamily: sans,
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
            </div>
          </header>
        )}

        {showSection("appearance") ? (
          <SectionCard
            icon="Aa"
            title="Appearance"
            theme={palette}
            resetButton={
              <ActionButton
                label="Reset"
                ariaLabel="Reset Appearance"
                theme={palette}
                onClick={onResetAppearance}
              />
            }
          >
            <SettingRow
              title="Appearance"
              desc={theme === "auto" ? "Follows the macOS Light / Dark setting." : undefined}
              theme={palette}
              right={
                <AppearanceModePicker
                  theme={theme}
                  autoLightTheme={autoLightTheme}
                  autoDarkTheme={autoDarkTheme}
                  palette={palette}
                  onChange={onThemeChange}
                />
              }
            />
            {/* One palette per side. Auto uses both; Light or Dark uses its own. */}
            <SettingRow
              title="Light palette"
              desc="Colors used while the app is light."
              theme={palette}
              right={
                <SelectControl
                  value={autoLightTheme}
                  options={LIGHT_THEME_OPTIONS.map((option) => option.value)}
                  theme={palette}
                  width="176px"
                  ariaLabel="Light palette"
                  onChange={(value) => {
                    onAutoLightThemeChange(value as ThemeMode);
                    // In Light mode the palette on screen is this one.
                    if (theme !== "auto" && isThemeInGroup(theme, "light")) {
                      onThemeChange(value as ThemeMode);
                    }
                  }}
                  formatOption={(value) => getThemeLabel(value as ThemeMode)}
                />
              }
            />
            <SettingRow
              title="Dark palette"
              desc="Colors used while the app is dark."
              theme={palette}
              right={
                <SelectControl
                  value={autoDarkTheme}
                  options={DARK_THEME_OPTIONS.map((option) => option.value)}
                  theme={palette}
                  width="176px"
                  ariaLabel="Dark palette"
                  onChange={(value) => {
                    onAutoDarkThemeChange(value as ThemeMode);
                    if (theme !== "auto" && isThemeInGroup(theme, "dark")) {
                      onThemeChange(value as ThemeMode);
                    }
                  }}
                  formatOption={(value) => getThemeLabel(value as ThemeMode)}
                />
              }
            />

            <SettingRow
              title="Accent color"
              theme={palette}
              right={
                <div style={{ maxWidth: "100%" }}>
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
              title="Zoom level"
              desc={`Makes everything larger or smaller, text included${describeKeys(
                [
                  shortcutDisplay.label("zoomIn"),
                  shortcutDisplay.label("zoomOut"),
                  shortcutDisplay.label("resetZoom"),
                ],
                " (",
                ")",
              )}. ${ZOOM_PERCENT_MIN}% to ${ZOOM_PERCENT_MAX}%.`}
              theme={palette}
              right={
                <ZoomLevelInput
                  value={zoomPercent}
                  theme={palette}
                  onChange={onZoomPercentChange}
                />
              }
            />

            <SettingRow
              title="Font"
              theme={palette}
              right={
                <SelectControl
                  value={uiFontFamily}
                  options={uiFontOptions.map((option) => option.value)}
                  theme={palette}
                  width="190px"
                  ariaLabel="Font"
                  onChange={(value) => onUiFontFamilyChange(value as UiFontFamily)}
                  formatOption={(value) =>
                    uiFontOptions.find((option) => option.value === value)?.label ?? String(value)
                  }
                />
              }
            />

            <SettingRow
              title="Tab style"
              desc="Flat tabs under a line in the accent color, or cards on a band."
              theme={palette}
              right={
                <SelectControl
                  value={tabStyle}
                  options={["accentLine", "cards"] satisfies TabStyle[]}
                  theme={palette}
                  width="140px"
                  ariaLabel="Tab style"
                  onChange={(value) => onTabStyleChange(value as TabStyle)}
                  formatOption={(value) => (value === "accentLine" ? "Accent line" : "Cards")}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("explorer") ? (
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
            <SettingRow
              title="Compact icon view"
              desc="Use smaller icons and tighter spacing in icon view."
              theme={palette}
              right={
                <Toggle
                  checked={compactIconView}
                  onToggle={() => onCompactIconViewChange(!compactIconView)}
                  theme={palette}
                  label="Compact icon view"
                />
              }
            />
            <SettingRow
              title="Single-click expand tree folders"
              desc="Expand or collapse filesystem tree folders when you single-click them in the folders pane."
              theme={palette}
              right={
                <Toggle
                  checked={singleClickExpandTreeItems}
                  onToggle={() => onSingleClickExpandTreeItemsChange(!singleClickExpandTreeItems)}
                  theme={palette}
                  label="Single-click expand tree folders"
                />
              }
            />
            <SettingRow
              title="Highlight hovered items"
              desc="Show hover highlighting in icon view, list view, detail view, and search results."
              theme={palette}
              right={
                <Toggle
                  checked={highlightHoveredItems}
                  onToggle={() => onHighlightHoveredItemsChange(!highlightHoveredItems)}
                  theme={palette}
                  label="Highlight hovered items"
                />
              }
            />

            <div className="settings-row" style={{ padding: "10px 0 8px" }}>
              <div
                style={{
                  fontSize: "12.5px",
                  fontFamily: sans,
                  fontWeight: 500,
                  color: palette.label.primary,
                  marginBottom: "8px",
                }}
              >
                Detail view columns
              </div>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                {OPTIONAL_DETAIL_COLUMN_KEYS.map((key) => (
                  <CheckboxChip
                    key={key}
                    checked={detailColumns[key]}
                    label={DETAIL_COLUMN_LABELS[key]}
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
            </div>
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard icon="🔔" title="Notifications" theme={palette}>
            <SettingRow
              title="Show notifications"
              desc="Show bottom-right banners for copy, cut, paste status, and warnings."
              theme={palette}
              right={
                <Toggle
                  checked={notificationsEnabled}
                  onToggle={() => onNotificationsEnabledChange(!notificationsEnabled)}
                  theme={palette}
                  label="Show notifications"
                />
              }
            />
            <SettingRow
              title="Notification duration"
              theme={palette}
              right={
                <SelectControl
                  value={notificationDurationSeconds}
                  options={notificationDurationSecondsOptions}
                  theme={palette}
                  width="110px"
                  ariaLabel="Notification duration"
                  disabled={!notificationsEnabled}
                  onChange={(value) => onNotificationDurationSecondsChange(Number(value))}
                  formatOption={(value) => `${value} s`}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard icon="⧉" title="Copy and Cut" theme={palette}>
            <SettingRow
              title="Highlight copied items in the folder tree"
              desc="Flash a folder when it is copied or cut, and mark it while it waits to be pasted."
              theme={palette}
              right={
                <Toggle
                  checked={highlightClipboardItemsInTree}
                  onToggle={() =>
                    onHighlightClipboardItemsInTreeChange(!highlightClipboardItemsInTree)
                  }
                  theme={palette}
                  label="Highlight copied items in the folder tree"
                />
              }
            />
            <SettingRow
              title="Highlight copied items in the file list"
              desc="Flash items when they are copied or cut, and mark them while they wait to be pasted."
              theme={palette}
              right={
                <Toggle
                  checked={highlightClipboardItemsInContent}
                  onToggle={() =>
                    onHighlightClipboardItemsInContentChange(!highlightClipboardItemsInContent)
                  }
                  theme={palette}
                  label="Highlight copied items in the file list"
                />
              }
            />
            <SettingRow
              title="Notify what was copied"
              desc="Show a notification with the item's name and icon, or how many items were copied or cut."
              theme={palette}
              right={
                <Toggle
                  checked={notifyClipboardItems}
                  onToggle={() => onNotifyClipboardItemsChange(!notifyClipboardItems)}
                  theme={palette}
                  label="Notify what was copied"
                  disabled={!notificationsEnabled}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("general") ? (
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
            <SettingRow
              title="Restore open tabs"
              desc="Reopen the tabs that were open. Each returns to its own folder when Restore last visited folder is on, and to home when it is off."
              theme={palette}
              right={
                <Toggle
                  checked={restoreOpenTabsOnStartup}
                  onToggle={() => onRestoreOpenTabsOnStartupChange(!restoreOpenTabsOnStartup)}
                  theme={palette}
                  label="Restore open tabs"
                />
              }
            />
          </SectionCard>
        ) : null}

        {searchDefaults && showSection("search") ? (
          <SectionCard title="Search" theme={palette}>
            <SettingRow
              title="Match as"
              desc="Plain text finds the text anywhere in a name. Glob and Regex treat it as a pattern."
              theme={palette}
              right={
                <SelectControl
                  value={searchDefaults.searchPatternMode}
                  options={SEARCH_PATTERN_MODES}
                  theme={palette}
                  width="120px"
                  ariaLabel="Default match mode"
                  onChange={(value) =>
                    onSearchDefaultsChange({
                      searchPatternMode: value as SearchPatternModePreference,
                    })
                  }
                  formatOption={(value) =>
                    SEARCH_PATTERN_MODE_LABELS[value as SearchPatternModePreference]
                  }
                />
              }
            />
            <SettingRow
              title="Match on"
              theme={palette}
              right={
                <SelectControl
                  value={searchDefaults.searchMatchScope}
                  options={["name", "path"]}
                  theme={palette}
                  width="120px"
                  ariaLabel="Default match scope"
                  onChange={(value) =>
                    onSearchDefaultsChange({ searchMatchScope: value as "name" | "path" })
                  }
                  formatOption={(value) => (value === "path" ? "Full path" : "Name")}
                />
              }
            />
            <SettingRow
              title="Search subfolders"
              theme={palette}
              right={
                <Toggle
                  checked={searchDefaults.searchRecursive}
                  onToggle={() =>
                    onSearchDefaultsChange({ searchRecursive: !searchDefaults.searchRecursive })
                  }
                  theme={palette}
                  label="Search subfolders"
                />
              }
            />
            <SettingRow
              title="Skip .git folders"
              desc="Leave Git's internal files out of the results. This matters while hidden files are shown."
              theme={palette}
              right={
                <Toggle
                  checked={searchDefaults.searchSkipGitFolders}
                  onToggle={() =>
                    onSearchDefaultsChange({
                      searchSkipGitFolders: !searchDefaults.searchSkipGitFolders,
                    })
                  }
                  theme={palette}
                  label="Skip .git folders"
                />
              }
            />
            <SettingRow
              title="Skip files ignored by Git"
              desc="Inside a Git repository, leave out whatever its .gitignore excludes, such as build output."
              theme={palette}
              right={
                <Toggle
                  checked={searchDefaults.searchSkipGitIgnored}
                  onToggle={() =>
                    onSearchDefaultsChange({
                      searchSkipGitIgnored: !searchDefaults.searchSkipGitIgnored,
                    })
                  }
                  theme={palette}
                  label="Skip files ignored by Git"
                />
              }
            />
          </SectionCard>
        ) : null}
        {showSection("files") ? (
          <SectionCard icon="✎" title="File Opening" theme={palette}>
            <SettingRow
              title="File activation"
              desc="Choose what double click (and Return, when set to Open) does for files. Folders still open normally."
              theme={palette}
              right={
                <SelectControl
                  value={fileActivationAction}
                  options={["open", "edit"] satisfies FileActivationAction[]}
                  theme={palette}
                  width="120px"
                  ariaLabel="File activation"
                  onChange={(value) => onFileActivationActionChange(value as FileActivationAction)}
                  formatOption={(value) => (value === "edit" ? "Edit" : "Open")}
                />
              }
            />
            <SettingRow
              title="Return key"
              desc={`Rename like Finder, or open the selection.${describeKeys(
                [shortcutDisplay.label("openSelection"), shortcutDisplay.label("openSelectedItem")],
                " ",
                " always open.",
                " and ",
              )}`}
              theme={palette}
              right={
                <SelectControl
                  value={returnKeyAction}
                  options={["rename", "open"] satisfies ReturnKeyAction[]}
                  theme={palette}
                  width="120px"
                  ariaLabel="Return key"
                  onChange={(value) => onReturnKeyActionChange(value as ReturnKeyAction)}
                  formatOption={(value) => (value === "open" ? "Open" : "Rename")}
                />
              }
            />
            <SettingRow
              title="Open and Edit limit"
              desc="Prevent large accidental launches. Applies to the Open and Edit actions."
              theme={palette}
              right={
                <OpenItemLimitInput
                  value={openItemLimit}
                  theme={palette}
                  onChange={onOpenItemLimitChange}
                />
              }
            />

            <ApplicationSelectionDisplay
              title="Default text editor"
              ariaLabel="Default text editor"
              application={defaultTextEditor}
              theme={palette}
              actions={
                <>
                  <ActionButton
                    label="Browse"
                    ariaLabel="Browse default text editor"
                    theme={palette}
                    onClick={onBrowseDefaultTextEditor}
                  />
                  {!isDefaultTextEditorSelection ? (
                    <ActionButton
                      label="Default"
                      ariaLabel="Use default text editor"
                      theme={palette}
                      onClick={onClearDefaultTextEditor}
                    />
                  ) : null}
                </>
              }
            />

            <ApplicationSelectionDisplay
              title="Terminal app"
              ariaLabel="Terminal app"
              application={terminalApp ?? DEFAULT_TERMINAL_APPLICATION}
              theme={palette}
              actions={
                <>
                  <ActionButton
                    label="Browse"
                    ariaLabel="Browse terminal app"
                    theme={palette}
                    onClick={onBrowseTerminalApp}
                  />
                  {terminalApp ? (
                    <ActionButton
                      label="Default"
                      ariaLabel="Use default terminal app"
                      theme={palette}
                      onClick={onClearTerminalApp}
                    />
                  ) : null}
                </>
              }
            />
          </SectionCard>
        ) : null}

        {showSection("explorer") ? (
          <SectionCard icon="★" title="Favorites" theme={palette}>
            <SettingRow
              title="Favorites placement"
              theme={palette}
              desc="Show favorites as their own sidebar section, or as a Favorites folder at the top of the folder tree that scrolls with it."
              right={
                <SelectControl
                  value={favoritesPlacement}
                  options={["separate", "integrated"]}
                  theme={palette}
                  width="220px"
                  ariaLabel="Favorites placement"
                  onChange={(value) => onFavoritesPlacementChange(value as FavoritesPlacement)}
                  formatOption={(value) =>
                    value === "integrated" ? "In the folder tree" : "Separate section"
                  }
                />
              }
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 0 12px",
                borderBottom: `1px solid ${palette.separator}`,
              }}
            >
              <div
                style={{
                  fontSize: "12.5px",
                  fontFamily: sans,
                  fontWeight: 500,
                  color: palette.label.primary,
                }}
              >
                Configured favorites
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <ActionButton
                  label="Restore Defaults"
                  theme={palette}
                  ariaLabel="Restore default favorites"
                  onClick={onRestoreDefaultFavorites}
                />
                <ActionButton
                  label="Add Favorite"
                  theme={palette}
                  ariaLabel="Add Favorite"
                  onClick={onAddFavorite}
                />
              </div>
            </div>

            {favorites.map((favorite, index) => (
              <div
                key={`${favorite.path}-${index}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 0",
                  borderBottom:
                    index === favorites.length - 1 ? "none" : `1px solid ${palette.separator}`,
                }}
              >
                <div
                  style={{
                    minWidth: 0,
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <FavoriteItemIcon icon={favorite.icon} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontSize: "12.5px",
                        fontFamily: sans,
                        fontWeight: 500,
                        color: palette.label.primary,
                        marginBottom: "4px",
                      }}
                    >
                      {getFavoriteLabel(favorite.path, homePath)}
                    </div>
                    <div
                      style={{
                        fontSize: "11px",
                        fontFamily: mono,
                        color: palette.label.secondary,
                        lineHeight: "1.4",
                        wordBreak: "break-all",
                      }}
                    >
                      {favorite.path}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <FavoriteIconPicker
                    selectedIcon={favorite.icon}
                    theme={palette}
                    ariaLabel={`Favorite icon for ${getFavoriteLabel(favorite.path, homePath)}`}
                    onChange={(icon) => onFavoriteIconChange(index, icon)}
                  />
                  <ActionButton
                    label="Browse"
                    ariaLabel={`Browse ${getFavoriteLabel(favorite.path, homePath)}`}
                    theme={palette}
                    onClick={() => onBrowseFavorite(index)}
                  />
                  <ActionButton
                    label="Up"
                    ariaLabel={`Move ${getFavoriteLabel(favorite.path, homePath)} up`}
                    theme={palette}
                    disabled={index === 0}
                    onClick={() => onMoveFavorite(index, "up")}
                  />
                  <ActionButton
                    label="Down"
                    ariaLabel={`Move ${getFavoriteLabel(favorite.path, homePath)} down`}
                    theme={palette}
                    disabled={index === favorites.length - 1}
                    onClick={() => onMoveFavorite(index, "down")}
                  />
                  <ActionButton
                    label="Remove"
                    ariaLabel={`Remove ${getFavoriteLabel(favorite.path, homePath)}`}
                    theme={palette}
                    disabled={favorite.path === getTrashPath(homePath)}
                    onClick={() => onRemoveFavorite(index)}
                  />
                </div>
              </div>
            ))}
          </SectionCard>
        ) : null}

        {showSection("files") ? (
          <SectionCard icon="↗" title="Open With" theme={palette}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 0 12px",
                borderBottom: `1px solid ${palette.separator}`,
              }}
            >
              <div
                style={{
                  fontSize: "12.5px",
                  fontFamily: sans,
                  fontWeight: 500,
                  color: palette.label.primary,
                }}
              >
                Configured applications
              </div>
              <ActionButton
                label="Add App"
                theme={palette}
                ariaLabel="Add Open With application"
                onClick={onAddOpenWithApplication}
              />
            </div>

            {openWithApplications.map((application, index) => (
              <div
                key={application.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "12px 0",
                  borderBottom:
                    index === openWithApplications.length - 1
                      ? "none"
                      : `1px solid ${palette.separator}`,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: "12.5px",
                      fontFamily: sans,
                      fontWeight: 500,
                      color: palette.label.primary,
                      marginBottom: "4px",
                    }}
                  >
                    {application.appName}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      fontFamily: mono,
                      color: palette.label.secondary,
                      lineHeight: "1.4",
                      wordBreak: "break-all",
                    }}
                  >
                    {application.appPath}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    flexWrap: "wrap",
                    justifyContent: "flex-end",
                  }}
                >
                  <ActionButton
                    label="Browse"
                    ariaLabel={`Browse ${application.appName}`}
                    theme={palette}
                    onClick={() => onBrowseOpenWithApplication(application.id)}
                  />
                  <ActionButton
                    label="Up"
                    ariaLabel={`Move ${application.appName} up`}
                    theme={palette}
                    disabled={index === 0}
                    onClick={() => onMoveOpenWithApplication(application.id, "up")}
                  />
                  <ActionButton
                    label="Down"
                    ariaLabel={`Move ${application.appName} down`}
                    theme={palette}
                    disabled={index === openWithApplications.length - 1}
                    onClick={() => onMoveOpenWithApplication(application.id, "down")}
                  />
                  <ActionButton
                    label="Remove"
                    ariaLabel={`Remove ${application.appName}`}
                    theme={palette}
                    onClick={() => onRemoveOpenWithApplication(application.id)}
                  />
                </div>
              </div>
            ))}
          </SectionCard>
        ) : null}

        {showSection("toolbars") ? (
          <ToolbarEditor
            title="Toolbar"
            items={orderedTopToolbarItems}
            availableItems={sortedTopToolbarAvailableItems}
            requiredItems={REQUIRED_TOP_TOOLBAR_ITEMS}
            itemNotes={{
              title:
                "The name of the folder on screen. It stretches to fill the room the other items leave.",
              clipboard: "Appears while files or folders are waiting to be pasted, and lists them.",
              viewOptions:
                "A menu of how the list and the panels are shown, and the way back here.",
              search: "The search field. It is wider while you type in it.",
            }}
            theme={palette}
            onReorderItem={handleTopToolbarMove}
            onRemoveItem={handleTopToolbarRemove}
            onAddItem={handleTopToolbarAdd}
            onReset={onResetTopToolbar}
            resetDisabled={isDefaultTopToolbar}
          />
        ) : null}

        {showSection("shortcuts") ? (
          <ShortcutSettings
            overrides={shortcutOverrides}
            returnKeyAction={returnKeyAction}
            theme={palette}
            onChange={onShortcutOverridesChange}
          />
        ) : null}

        <div className="settings-footer-note" style={{ textAlign: "center", padding: "8px 0 4px" }}>
          <span
            style={{
              fontSize: "10.5px",
              fontFamily: sans,
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
