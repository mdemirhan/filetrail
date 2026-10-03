import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type RefObject,
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
import { AppIcon, FavoriteItemIcon } from "../lib/fileIcons";
import { createShortcutDisplay } from "../lib/shortcutDisplay";
import { type ThemeCssBase, getThemeVariant, resolveThemeCssBase } from "../lib/themeVariants";
import { VIEW_TEXT } from "../lib/viewColors";
import { MenuCheck } from "./MenuCheck";
import { ActionButton, SectionCard } from "./SettingsControls";
import { ShortcutSettings } from "./ShortcutSettings";
import { ToolbarIcon } from "./ToolbarIcon";

// Settings follows the Font preference.

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

// The Settings palette, handed down to every control as custom properties: the controls are
// drawn by `.settings-*` rules in styles.css, so none of them carries colours of its own.
function settingsPaletteStyle(palette: ResolvedSettingsTheme): CSSProperties {
  return {
    "--settings-page-bg": palette.page.bg,
    "--settings-card-bg": palette.card.bg,
    "--settings-card-border": palette.card.border,
    "--settings-card-shadow": palette.card.shadow,
    "--settings-separator": palette.separator,
    "--settings-control-bg": palette.input.bg,
    "--settings-control-border": palette.input.border,
    "--settings-label-secondary": palette.label.secondary,
    "--settings-switch-off": palette.toggle.trackOff,
    "--settings-check-border": palette.checkbox.border,
    "--settings-check-off": palette.checkbox.uncheckedBg,
    background: palette.page.bg,
  } as CSSProperties;
}

function Toggle({
  checked,
  onToggle,
  label,
  disabled = false,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="settings-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    />
  );
}

function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <label className="settings-checkbox">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {label}
    </label>
  );
}

// A pop-up button: the system's own menu, so it reads and works like every other pop-up on
// the Mac. Every pop-up in Settings is one width, so the column of them lines up.
function SelectControl({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  formatOption,
  disabledOptions,
}: {
  value: string | number;
  options: ReadonlyArray<string | number>;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  formatOption?: (value: string | number) => string;
  /** Shown in the list but not choosable, such as a "Custom" state the pop-up only reports. */
  disabledOptions?: ReadonlyArray<string | number>;
}) {
  return (
    <span className="settings-popup">
      <select
        value={String(value)}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option
            key={String(option)}
            value={String(option)}
            disabled={disabledOptions?.includes(option)}
          >
            {formatOption ? formatOption(option) : String(option)}
          </option>
        ))}
      </select>
      <PopupChevron />
    </span>
  );
}

function PopupChevron() {
  return (
    <svg className="settings-popup-chevron" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" />
    </svg>
  );
}

function AppearanceThumbnail({ mode }: { mode: "auto" | "light" | "dark" }) {
  const half = (tone: "light" | "dark", clipped = false) => (
    <span className="settings-appearance-half" data-tone={tone} data-clipped={clipped || undefined}>
      <span className="settings-appearance-thumb-side" />
      <span className="settings-appearance-thumb-main">
        <span />
        <span className="is-accent" />
        <span />
      </span>
    </span>
  );
  // Auto is the light window with the dark one over its right half.
  return (
    <span className="settings-appearance-thumb" aria-hidden="true">
      {half(mode === "dark" ? "dark" : "light")}
      {mode === "auto" ? half("dark", true) : null}
    </span>
  );
}

// Auto / Light / Dark, like System Settings. Light and Dark use the palette chosen for that
// appearance, so switching back to Auto restores the same colors.
function AppearanceModePicker({
  theme,
  autoLightTheme,
  autoDarkTheme,
  onChange,
}: {
  theme: ThemePreference;
  autoLightTheme: ThemeMode;
  autoDarkTheme: ThemeMode;
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
    <div className="settings-appearance-picker">
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className="settings-appearance-option"
          aria-pressed={current === mode.id}
          onClick={() => onChange(mode.value)}
        >
          <span className="settings-appearance-ring">
            <AppearanceThumbnail mode={mode.id} />
          </span>
          {mode.label}
        </button>
      ))}
    </div>
  );
}

// The accent color as a row of swatches, with a custom color at the end.
function AccentSelector({
  accent,
  accentOptions,
  onChange,
}: {
  accent: AccentMode;
  accentOptions: ReadonlyArray<{ value: AccentMode; label: string }>;
  onChange: (value: AccentMode) => void;
}) {
  const selected = accentOptions.find((option) => option.value === accent);
  const isCustom = !selected;
  const customInputRef = useRef<HTMLInputElement | null>(null);
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
    <div className="settings-accent">
      <div className="settings-accent-swatches">
        {accentOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className="settings-accent-swatch"
            title={option.label}
            aria-label={`Accent color ${option.label}`}
            aria-pressed={option.value === accent}
            onClick={() => onChange(option.value)}
            style={{ background: option.value }}
          />
        ))}
        <button
          type="button"
          className="settings-accent-swatch is-custom"
          title="Custom Color"
          aria-label="Accent color Custom"
          aria-pressed={isCustom}
          onClick={() => openColorPicker(customInputRef.current)}
        >
          {isCustom ? (
            <span
              className="settings-accent-custom-fill"
              aria-hidden="true"
              style={{ background: customPickerValue }}
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
          />
        </button>
      </div>
      <span className="settings-accent-name">{selected?.label ?? "Custom"}</span>
    </div>
  );
}

const FAVORITE_ICON_COLUMNS = 6;
// One cell of the icon grid, and the room around and between the cells.
const FAVORITE_ICON_CELL = 30;
const FAVORITE_ICON_GAP = 4;
const FAVORITE_ICON_PADDING = 6;

// A favorite's icon, which is also the button that chooses another one.
function FavoriteIconPicker({
  selectedIcon,
  ariaLabel,
  onChange,
}: {
  selectedIcon: FavoriteIconId;
  ariaLabel: string;
  onChange: (icon: FavoriteIconId) => void;
}) {
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDialogElement | null>(null);
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ left: 0, top: 0 });

  const popupRows = Math.ceil(FAVORITE_ICON_OPTIONS.length / FAVORITE_ICON_COLUMNS);
  const popupWidth =
    2 * FAVORITE_ICON_PADDING +
    FAVORITE_ICON_COLUMNS * FAVORITE_ICON_CELL +
    (FAVORITE_ICON_COLUMNS - 1) * FAVORITE_ICON_GAP;
  const popupHeight =
    2 * FAVORITE_ICON_PADDING +
    popupRows * FAVORITE_ICON_CELL +
    (popupRows - 1) * FAVORITE_ICON_GAP;

  const updatePopupPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 4;
    const maxLeft = Math.max(margin, window.innerWidth - popupWidth - margin);
    const left = Math.min(Math.max(rect.left, margin), maxLeft);
    const fitsBelow = rect.bottom + gap + popupHeight <= window.innerHeight - margin;
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
    // Capture phase and preventDefault: Escape closes this pop-up, and the window's own
    // Escape handling (which closes Settings) sees that the key is already used.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    updatePopupPosition();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);
    window.addEventListener("keydown", handleEscape, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
      window.removeEventListener("keydown", handleEscape, true);
    };
  }, [open, updatePopupPosition]);

  return (
    <span ref={containerRef} className="settings-favorite-icon">
      <button
        ref={triggerRef}
        type="button"
        className="settings-favorite-icon-button"
        title="Choose Icon"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          // The row under the icon is not selected or dragged by this click.
          event.stopPropagation();
          if (!open) {
            updatePopupPosition();
          }
          setOpen((current) => !current);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <FavoriteItemIcon icon={selectedIcon} />
      </button>
      {open
        ? createPortal(
            <dialog
              ref={popupRef}
              open
              className="settings-icon-grid"
              aria-label={`${ariaLabel} options`}
              onCancel={(event) => {
                event.preventDefault();
              }}
              style={{
                top: `${popupPosition.top}px`,
                left: `${popupPosition.left}px`,
                gridTemplateColumns: `repeat(${FAVORITE_ICON_COLUMNS}, ${FAVORITE_ICON_CELL}px)`,
              }}
            >
              {FAVORITE_ICON_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="settings-icon-grid-item"
                  title={option.label}
                  aria-label={`${ariaLabel}: ${option.label}`}
                  aria-pressed={option.value === selectedIcon}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <FavoriteItemIcon icon={option.value} />
                </button>
              ))}
            </dialog>,
            document.body,
          )
        : null}
    </span>
  );
}

// A list as macOS draws one in Settings: rows to select, drag into a new order, or remove,
// and + and − buttons under it. Return (or a double-click) changes the selected row.
function SettingsList<T>({
  label,
  items,
  getKey,
  getName,
  renderRow,
  onAdd,
  addLabel,
  onRemove,
  canRemove = () => true,
  onMove,
  onChange,
  changeLabel,
  extraButtons,
}: {
  label: string;
  items: ReadonlyArray<T>;
  getKey: (item: T, index: number) => string;
  getName: (item: T) => string;
  renderRow: (item: T, index: number) => ReactNode;
  onAdd: () => void;
  addLabel: string;
  onRemove: (index: number) => void;
  canRemove?: (item: T) => boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
  onChange: (index: number) => void;
  changeLabel: string;
  extraButtons?: ReactNode;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selected = selectedIndex === null ? undefined : items[selectedIndex];

  // The selection stays on the row that was selected when rows come and go.
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= items.length) {
      setSelectedIndex(items.length > 0 ? items.length - 1 : null);
    }
  }, [items.length, selectedIndex]);

  const focusRow = (index: number) => {
    setSelectedIndex(index);
    listRef.current?.querySelectorAll<HTMLElement>("[role=option]")[index]?.focus();
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) {
      return;
    }
    onMove(from, to);
    setSelectedIndex(to);
  };

  const remove = (index: number) => {
    const item = items[index];
    if (item === undefined || !canRemove(item)) {
      return;
    }
    onRemove(index);
  };

  return (
    <div className="settings-list">
      {/* biome-ignore lint/a11y/useFocusableInteractive: the rows take the focus, one at a time. */}
      <div
        ref={listRef}
        className="settings-list-rows"
        // biome-ignore lint/a11y/useSemanticElements: a native select cannot hold rows that are dragged, or an icon button.
        role="listbox"
        aria-label={label}
        onDragOver={(event) => {
          if (draggedIndex !== null) {
            event.preventDefault();
          }
        }}
      >
        {items.map((item, index) => {
          const name = getName(item);
          const dropSide =
            draggedIndex !== null && dropIndex === index && draggedIndex !== index
              ? draggedIndex < index
                ? "after"
                : "before"
              : undefined;
          return (
            <div
              key={getKey(item, index)}
              className="settings-list-row"
              // biome-ignore lint/a11y/useSemanticElements: a native option cannot be dragged or hold a button.
              role="option"
              aria-label={name}
              aria-selected={selectedIndex === index}
              tabIndex={selectedIndex === index || (selectedIndex === null && index === 0) ? 0 : -1}
              data-drop={dropSide}
              data-dragging={draggedIndex === index || undefined}
              draggable
              onMouseDown={() => setSelectedIndex(index)}
              onFocus={() => setSelectedIndex(index)}
              onDoubleClick={() => onChange(index)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const target = index + (event.key === "ArrowUp" ? -1 : 1);
                  if (event.altKey || event.metaKey) {
                    move(index, target);
                    window.requestAnimationFrame(() => focusRow(target));
                  } else if (target >= 0 && target < items.length) {
                    focusRow(target);
                  }
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  onChange(index);
                } else if (event.key === "Backspace" || event.key === "Delete") {
                  event.preventDefault();
                  remove(index);
                }
              }}
              onDragStart={(event) => {
                setDraggedIndex(index);
                setSelectedIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", name);
              }}
              onDragEnter={() => setDropIndex(index)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedIndex !== null) {
                  move(draggedIndex, index);
                }
                setDraggedIndex(null);
                setDropIndex(null);
              }}
              onDragEnd={() => {
                setDraggedIndex(null);
                setDropIndex(null);
              }}
            >
              {renderRow(item, index)}
            </div>
          );
        })}
      </div>
      <div className="settings-list-bar">
        <button
          type="button"
          className="settings-list-bar-button"
          aria-label={addLabel}
          title={addLabel}
          onClick={onAdd}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </button>
        <button
          type="button"
          className="settings-list-bar-button"
          aria-label={selected ? `Remove ${getName(selected)}` : "Remove"}
          title="Remove"
          disabled={selected === undefined || !canRemove(selected)}
          onClick={() => {
            if (selectedIndex !== null) {
              remove(selectedIndex);
            }
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <span className="settings-list-bar-divider" aria-hidden="true" />
        <button
          type="button"
          className="settings-list-bar-text-button"
          aria-label={selected ? `${changeLabel} ${getName(selected)}` : changeLabel}
          disabled={selectedIndex === null}
          onClick={() => {
            if (selectedIndex !== null) {
              onChange(selectedIndex);
            }
          }}
        >
          {changeLabel}…
        </button>
        <span className="settings-list-bar-spacer" />
        {extraButtons}
      </div>
    </div>
  );
}

// The name and location of an item in a Settings list.
function SettingsListText({ name, path }: { name: string; path: string }) {
  return (
    <span className="settings-list-text">
      <span className="settings-list-name">{name}</span>
      <span className="settings-list-path" title={path}>
        {path}
      </span>
    </span>
  );
}

// A menu that hangs below a control in Settings: it opens where the control is, closes on
// Escape, Tab or a click elsewhere, and moves between its items with the arrow keys, starting
// on the checked one. `focusTarget` takes the keyboard back when it closes.
function useSettingsMenu(
  anchorRef: RefObject<HTMLElement | null>,
  focusTargetRef: RefObject<HTMLElement | null>,
) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) {
        focusTargetRef.current?.focus();
      }
    },
    [focusTargetRef],
  );

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || anchorRef.current?.contains(target))
      ) {
        return;
      }
      close(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio]") ??
          [],
      );
      const focused = items.findIndex((item) => item === document.activeElement);
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = focused === -1 ? 0 : (focused + step + items.length) % items.length;
        items[next]?.focus();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [anchorRef, close, open]);

  useEffect(() => {
    if (open && position) {
      menuRef.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    }
  }, [position, open]);

  return { menuRef, open, setOpen, close, position };
}

// An app chosen in Settings, shown as a pop-up button with the app's icon: the menu offers
// the app File Trail uses unless told otherwise, the one chosen, and Choose… for another.
function ApplicationPopup({
  ariaLabel,
  application,
  defaultApplication,
  onChoose,
  onUseDefault,
}: {
  ariaLabel: string;
  application: ApplicationSelection;
  defaultApplication: ApplicationSelection;
  onChoose: () => void;
  onUseDefault: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { menuRef, open, setOpen, close, position } = useSettingsMenu(buttonRef, buttonRef);
  const isDefault = application.appPath === defaultApplication.appPath;
  const choices: ReadonlyArray<{ application: ApplicationSelection; isDefault: boolean }> =
    isDefault
      ? [{ application: defaultApplication, isDefault: true }]
      : [
          { application, isDefault: false },
          { application: defaultApplication, isDefault: true },
        ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="settings-app-popup"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <AppIcon path={application.appPath} />
        <span className="settings-app-popup-name">{application.appName}</span>
        <PopupChevron />
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu settings-menu"
              role="menu"
              aria-label={ariaLabel}
              style={{ top: position.top, left: position.left, minWidth: position.width }}
            >
              {choices.map((choice) => (
                <button
                  key={choice.application.appPath}
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitemradio"
                  aria-checked={choice.application.appPath === application.appPath}
                  tabIndex={-1}
                  title={choice.application.appPath}
                  onClick={() => {
                    if (choice.isDefault && !isDefault) {
                      onUseDefault();
                    }
                    close(true);
                  }}
                >
                  <MenuCheck checked={choice.application.appPath === application.appPath} />
                  <AppIcon path={choice.application.appPath} />
                  <span className="toolbar-menu-label">{choice.application.appName}</span>
                </button>
              ))}
              <hr className="toolbar-menu-separator" />
              <button
                type="button"
                className="toolbar-menu-item"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  onChoose();
                }}
              >
                <MenuCheck checked={false} />
                <span className="toolbar-menu-label">Choose…</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// The steps ⌘+ and ⌘− take, from the smallest size to the largest.
function zoomSteps(): number[] {
  const steps = [ZOOM_PERCENT_MIN];
  for (let value = 80; value <= ZOOM_PERCENT_MAX; value += 10) {
    steps.push(value);
  }
  return steps;
}

function parseZoomPercent(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(/%/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  return clampZoomPercent(Number(normalized));
}

// The zoom as a combo box, as macOS draws one: a field to type any size into ("105%"), and a
// menu of the usual steps beside it. A size out of range is brought into it; one that is not
// a number puts back the size there was.
function ZoomComboBox({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const comboRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { menuRef, open, setOpen, close, position } = useSettingsMenu(comboRef, inputRef);
  const [draft, setDraft] = useState(() => `${value}%`);

  useEffect(() => {
    setDraft(`${value}%`);
  }, [value]);

  const commit = () => {
    const parsed = parseZoomPercent(draft);
    const next = parsed ?? value;
    setDraft(`${next}%`);
    if (next !== value) {
      onChange(next);
    }
  };

  return (
    <span ref={comboRef} className="settings-combo">
      <input
        ref={inputRef}
        type="text"
        className="settings-field settings-combo-field"
        value={draft}
        aria-label="Zoom level"
        inputMode="decimal"
        spellCheck={false}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit();
            event.currentTarget.select();
          } else if (event.key === "ArrowDown" && event.altKey) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        onBlur={commit}
      />
      <button
        type="button"
        className="settings-combo-button"
        aria-label="Zoom levels"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open && position
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu settings-menu"
              role="menu"
              aria-label="Zoom levels"
              style={{ top: position.top, left: position.left, minWidth: position.width }}
            >
              {zoomSteps().map((step) => (
                <button
                  key={step}
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitemradio"
                  aria-checked={step === value}
                  tabIndex={-1}
                  onClick={() => {
                    close(true);
                    setDraft(`${step}%`);
                    if (step !== value) {
                      onChange(step);
                    }
                  }}
                >
                  <MenuCheck checked={step === value} />
                  <span className="toolbar-menu-label">{step}%</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

function OpenItemLimitInput({
  value,
  onChange,
}: {
  value: number;
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
      className="settings-field settings-number-field"
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
      onBlur={commit}
    />
  );
}

function SettingRow({
  title,
  desc,
  right,
}: {
  title: string;
  desc?: string | undefined;
  right: ReactNode;
}) {
  // The line under the row is `.settings-row`'s: every row has one but the last of its
  // group, whichever that turns out to be.
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        {desc ? <div className="settings-row-desc">{desc}</div> : null}
      </div>
      <div className="settings-row-control">{right}</div>
    </div>
  );
}

type Density = "comfortable" | "compact" | "custom";

function resolveDensity(flags: ReadonlyArray<boolean>): Density {
  if (flags.every(Boolean)) {
    return "compact";
  }
  return flags.some(Boolean) ? "custom" : "comfortable";
}

// A toolbar item in the Toolbar editor: an icon tile with its name under it, so the item
// can be told apart without hovering. The title and the search field are not buttons, and
// their tiles say so: each is two tiles wide and drawn as what it is. Like every tile they
// have one size wherever they are put: the strip shows the order of the items, not how wide
// the toolbar will draw them.
type ToolbarTileShape = "icon" | "title" | "search";

function getToolbarTileShape(itemId: ToolbarItemId): ToolbarTileShape {
  return itemId === "title" || itemId === "search" ? itemId : "icon";
}

function ToolbarTileLabel({ label }: { label: string }) {
  // The button carries the name; this copy is for the eye.
  return (
    <span className="settings-toolbar-tile-label" aria-hidden="true">
      {label}
    </span>
  );
}

// The mark on an item that is always in the toolbar.
function ToolbarTileRequiredBadge() {
  return (
    <span className="settings-toolbar-lock" aria-hidden="true">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="3.5" y="7.5" width="9" height="6" rx="1.4" />
        <path d="M5.6 7.5V5.4a2.4 2.4 0 0 1 4.8 0v2.1" />
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
      // Inside the editor, so the stand-in takes the Settings colours.
      const ghost = document.createElement("div");
      ghost.className = "settings-toolbar-drag-ghost";
      (rootRef.current ?? document.body).appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 20, 19);
      window.setTimeout(() => ghost.remove(), 0);
    },
    [items],
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
      className="settings-toolbar-editor"
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
    >
      <SectionCard
        title="In the Toolbar"
        note="Drag to reorder"
        resetButton={
          onReset ? (
            <ActionButton
              label="Reset"
              ariaLabel={`Reset ${title}`}
              disabled={resetDisabled}
              onClick={onReset}
            />
          ) : undefined
        }
      >
        <div ref={activeStripRef} className="settings-toolbar-area">
          <div className="settings-toolbar-tiles">
            {itemDefinitions.map(({ definition, index }) => {
              const itemId = definition.id;
              const required = requiredItems.has(itemId);
              const shape = getToolbarTileShape(itemId);
              const isHovered = hoveredActiveIndex === index && draggedIndex === null;
              const insertSide = getInsertSide(index);
              return (
                <div
                  key={`${title}-${itemId}-${index}`}
                  className="settings-toolbar-tile"
                  data-toolbar-tile={itemId}
                  data-shape={shape}
                  onMouseEnter={() => setHoveredActiveIndex(index)}
                  onMouseLeave={() =>
                    setHoveredActiveIndex((current) => (current === index ? null : current))
                  }
                >
                  {insertSide === "left" ? <span className="settings-toolbar-insert" /> : null}
                  <div className="settings-toolbar-tile-slot">
                    <button
                      type="button"
                      className="settings-toolbar-tile-button"
                      draggable
                      aria-label={definition.label}
                      title={itemNotes[itemId]}
                      data-dragged={draggedIndex === index || undefined}
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
                    >
                      <span
                        className="settings-toolbar-swatch"
                        data-shape={shape}
                        data-hovered={isHovered || undefined}
                      >
                        {shape === "title" ? (
                          // A stand-in for the folder's name and the line under it.
                          <>
                            <span className="settings-toolbar-title-name" aria-hidden="true">
                              Folder Name
                            </span>
                            <span className="settings-toolbar-title-count" aria-hidden="true">
                              12 items
                            </span>
                          </>
                        ) : (
                          <ToolbarIcon name={definition.icon} />
                        )}
                        {required ? <ToolbarTileRequiredBadge /> : null}
                      </span>
                      <ToolbarTileLabel label={definition.label} />
                    </button>
                    {isHovered && !required ? (
                      <button
                        type="button"
                        className="settings-toolbar-remove"
                        title="Remove"
                        aria-label={`Remove ${definition.label} from ${title}`}
                        onClick={() => onRemoveItem(index)}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M5 5l6 6M11 5l-6 6" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                  {insertSide === "right" ? <span className="settings-toolbar-insert" /> : null}
                </div>
              );
            })}
            {itemDefinitions.length === 0 ? (
              <div className="settings-toolbar-empty">No items configured.</div>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Available Items" note="Click to add">
        <div className="settings-toolbar-area">
          {availableDefinitions.length === 0 ? (
            <div className="settings-toolbar-empty">Every item is in the toolbar.</div>
          ) : (
            <div className="settings-toolbar-available">
              {availableDefinitions.map((definition) => {
                const isHovered = hoveredAvailableId === definition.id;
                return (
                  <button
                    key={`${title}-add-${definition.id}`}
                    type="button"
                    className="settings-toolbar-tile-button is-available"
                    aria-label={`Add ${definition.label} to ${title}`}
                    onClick={() => onAddItem(definition.id)}
                    onMouseEnter={() => setHoveredAvailableId(definition.id)}
                    onMouseLeave={() => setHoveredAvailableId(null)}
                  >
                    <span
                      className="settings-toolbar-swatch"
                      data-shape="icon"
                      data-available
                      data-hovered={isHovered || undefined}
                    >
                      <ToolbarIcon name={definition.icon} />
                    </span>
                    <ToolbarTileLabel label={definition.label} />
                    {isHovered ? (
                      <span className="settings-toolbar-add-mark" aria-hidden="true">
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M8 4.5v7M4.5 8h7" />
                        </svg>
                      </span>
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
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  onRemoveFavorite: (index: number) => void;
  onRestoreDefaultFavorites: () => void;
  onFavoriteIconChange: (index: number, icon: FavoriteIconId) => void;
  onFavoritesPlacementChange: (value: FavoritesPlacement) => void;
  onAddOpenWithApplication: () => void;
  onBrowseOpenWithApplication: (entryId: string) => void;
  onMoveOpenWithApplication: (entryId: string, toIndex: number) => void;
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
  // One Density for every view. The four switches it sets were once separate, and a profile
  // that still has them mixed shows as Custom until a density is chosen.
  const density = resolveDensity([
    compactListView,
    compactDetailsView,
    compactIconView,
    compactTreeView,
  ]);
  const setDensity = (value: Density) => {
    if (value === "custom") {
      return;
    }
    const compact = value === "compact";
    onCompactListViewChange(compact);
    onCompactDetailsViewChange(compact);
    onCompactIconViewChange(compact);
    onCompactTreeViewChange(compact);
  };
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
  const trashPath = getTrashPath(homePath);
  return (
    <div className="settings-view" data-layout={layoutMode} style={settingsPaletteStyle(palette)}>
      <div className="settings-page">
        {activeTab ? null : (
          <header className="settings-page-header">
            <div className="settings-page-header-left">
              <span className="settings-page-eyebrow">File Trail</span>
              <h2>Settings</h2>
            </div>
          </header>
        )}

        {showSection("appearance") ? (
          <SectionCard
            // The window's title already names the tab; the group needs no title of its own.
            title={activeTab ? undefined : "Appearance"}
            resetButton={
              <ActionButton
                label="Restore Defaults"
                ariaLabel="Reset Appearance"
                onClick={onResetAppearance}
              />
            }
            resetBelow
          >
            <SettingRow
              title="Appearance"
              right={
                <AppearanceModePicker
                  theme={theme}
                  autoLightTheme={autoLightTheme}
                  autoDarkTheme={autoDarkTheme}
                  onChange={onThemeChange}
                />
              }
            />
            {/* One palette per side. Auto uses both; Light or Dark uses its own. */}
            <SettingRow
              title="Light palette"
              right={
                <SelectControl
                  value={autoLightTheme}
                  options={LIGHT_THEME_OPTIONS.map((option) => option.value)}
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
              right={
                <SelectControl
                  value={autoDarkTheme}
                  options={DARK_THEME_OPTIONS.map((option) => option.value)}
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
              right={
                <AccentSelector
                  accent={accent}
                  accentOptions={accentOptions}
                  onChange={onAccentChange}
                />
              }
            />
            <SettingRow
              title="Zoom"
              desc={describeKeys(
                [
                  shortcutDisplay.label("zoomIn"),
                  shortcutDisplay.label("zoomOut"),
                  shortcutDisplay.label("resetZoom"),
                ],
                "",
                " also change it.",
              )}
              right={<ZoomComboBox value={zoomPercent} onChange={onZoomPercentChange} />}
            />
            <SettingRow
              title="Font"
              right={
                <SelectControl
                  value={uiFontFamily}
                  options={uiFontOptions.map((option) => option.value)}
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
              right={
                <SelectControl
                  value={tabStyle}
                  options={["accentLine", "cards"] satisfies TabStyle[]}
                  ariaLabel="Tab style"
                  onChange={(value) => onTabStyleChange(value as TabStyle)}
                  formatOption={(value) => (value === "accentLine" ? "Accent line" : "Cards")}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("explorer") ? (
          <SectionCard title={activeTab ? undefined : "Explorer"}>
            <SettingRow
              title="Density"
              desc="Compact fits more rows and icons in every view and in the folder tree."
              right={
                <SelectControl
                  value={density}
                  options={
                    density === "custom"
                      ? ["comfortable", "compact", "custom"]
                      : ["comfortable", "compact"]
                  }
                  disabledOptions={["custom"]}
                  ariaLabel="Density"
                  onChange={(value) => setDensity(value as Density)}
                  formatOption={(value) =>
                    value === "compact" ? "Compact" : value === "custom" ? "Custom" : "Comfortable"
                  }
                />
              }
            />
            <SettingRow
              title="Expand folders with a single click"
              desc="In the folder tree, a click opens or closes a folder as well as selecting it."
              right={
                <Toggle
                  checked={singleClickExpandTreeItems}
                  onToggle={() => onSingleClickExpandTreeItemsChange(!singleClickExpandTreeItems)}
                  label="Single-click expand tree folders"
                />
              }
            />
            <SettingRow
              title="Highlight items under the pointer"
              right={
                <Toggle
                  checked={highlightHoveredItems}
                  onToggle={() => onHighlightHoveredItemsChange(!highlightHoveredItems)}
                  label="Highlight hovered items"
                />
              }
            />
            <div className="settings-row settings-row-stacked">
              <div className="settings-row-title">Columns in Details view</div>
              <div className="settings-checkboxes">
                {OPTIONAL_DETAIL_COLUMN_KEYS.map((key) => (
                  <Checkbox
                    key={key}
                    checked={detailColumns[key]}
                    label={DETAIL_COLUMN_LABELS[key]}
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
          <SectionCard title="Notifications">
            <SettingRow
              title="Show notifications"
              desc="A card at the bottom right when items are copied, moved or put in the Trash."
              right={
                <Toggle
                  checked={notificationsEnabled}
                  onToggle={() => onNotificationsEnabledChange(!notificationsEnabled)}
                  label="Show notifications"
                />
              }
            />
            <SettingRow
              title="Show for"
              right={
                <SelectControl
                  value={notificationDurationSeconds}
                  options={notificationDurationSecondsOptions}
                  ariaLabel="Notification duration"
                  disabled={!notificationsEnabled}
                  onChange={(value) => onNotificationDurationSecondsChange(Number(value))}
                  formatOption={(value) => `${value} seconds`}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard title="Copy and Cut">
            <SettingRow
              title="Mark copied folders in the folder tree"
              right={
                <Toggle
                  checked={highlightClipboardItemsInTree}
                  onToggle={() =>
                    onHighlightClipboardItemsInTreeChange(!highlightClipboardItemsInTree)
                  }
                  label="Highlight copied items in the folder tree"
                />
              }
            />
            <SettingRow
              title="Mark copied items in the file list"
              right={
                <Toggle
                  checked={highlightClipboardItemsInContent}
                  onToggle={() =>
                    onHighlightClipboardItemsInContentChange(!highlightClipboardItemsInContent)
                  }
                  label="Highlight copied items in the file list"
                />
              }
            />
            <SettingRow
              title="Notify what was copied"
              right={
                <Toggle
                  checked={notifyClipboardItems}
                  onToggle={() => onNotifyClipboardItemsChange(!notifyClipboardItems)}
                  label="Notify what was copied"
                  disabled={!notificationsEnabled}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard title="Startup">
            <SettingRow
              title="Reopen the last folder"
              desc="Otherwise File Trail starts in your home folder."
              right={
                <Toggle
                  checked={restoreLastVisitedFolderOnStartup}
                  onToggle={() =>
                    onRestoreLastVisitedFolderOnStartupChange(!restoreLastVisitedFolderOnStartup)
                  }
                  label="Restore last visited folder"
                />
              }
            />
            <SettingRow
              title="Reopen tabs"
              desc="Each tab returns to its folder when the last folder is reopened, and to home when it is not."
              right={
                <Toggle
                  checked={restoreOpenTabsOnStartup}
                  onToggle={() => onRestoreOpenTabsOnStartupChange(!restoreOpenTabsOnStartup)}
                  label="Restore open tabs"
                />
              }
            />
          </SectionCard>
        ) : null}

        {searchDefaults && showSection("search") ? (
          <SectionCard title={activeTab ? undefined : "Search"}>
            <SettingRow
              title="Match as"
              desc="Text finds the words anywhere in a name; Glob and Regex read them as a pattern."
              right={
                <SelectControl
                  value={searchDefaults.searchPatternMode}
                  options={SEARCH_PATTERN_MODES}
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
              title="Match"
              right={
                <SelectControl
                  value={searchDefaults.searchMatchScope}
                  options={["name", "path"]}
                  ariaLabel="Default match scope"
                  onChange={(value) =>
                    onSearchDefaultsChange({ searchMatchScope: value as "name" | "path" })
                  }
                  formatOption={(value) => (value === "path" ? "Full Path" : "Name")}
                />
              }
            />
            <SettingRow
              title="Search subfolders"
              right={
                <Toggle
                  checked={searchDefaults.searchRecursive}
                  onToggle={() =>
                    onSearchDefaultsChange({ searchRecursive: !searchDefaults.searchRecursive })
                  }
                  label="Search Subfolders"
                />
              }
            />
            <SettingRow
              title="Skip .git folders"
              desc="Matters only while hidden files are shown."
              right={
                <Toggle
                  checked={searchDefaults.searchSkipGitFolders}
                  onToggle={() =>
                    onSearchDefaultsChange({
                      searchSkipGitFolders: !searchDefaults.searchSkipGitFolders,
                    })
                  }
                  label="Skip .git Folders"
                />
              }
            />
            <SettingRow
              title="Skip files ignored by Git"
              desc="Inside a repository, leave out what its .gitignore excludes."
              right={
                <Toggle
                  checked={searchDefaults.searchSkipGitIgnored}
                  onToggle={() =>
                    onSearchDefaultsChange({
                      searchSkipGitIgnored: !searchDefaults.searchSkipGitIgnored,
                    })
                  }
                  label="Skip Files Ignored by Git"
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("files") ? (
          <SectionCard title="File Opening">
            <SettingRow
              title="Double-click a file to"
              desc="Folders always open."
              right={
                <SelectControl
                  value={fileActivationAction}
                  options={["open", "edit"] satisfies FileActivationAction[]}
                  ariaLabel="File activation"
                  onChange={(value) => onFileActivationActionChange(value as FileActivationAction)}
                  formatOption={(value) => (value === "edit" ? "Edit" : "Open")}
                />
              }
            />
            <SettingRow
              title="Return key"
              desc={describeKeys(
                [shortcutDisplay.label("openSelection"), shortcutDisplay.label("openSelectedItem")],
                "",
                " always open.",
                " and ",
              )}
              right={
                <SelectControl
                  value={returnKeyAction}
                  options={["rename", "open"] satisfies ReturnKeyAction[]}
                  ariaLabel="Return key"
                  onChange={(value) => onReturnKeyActionChange(value as ReturnKeyAction)}
                  formatOption={(value) => (value === "open" ? "Opens" : "Renames")}
                />
              }
            />
            <SettingRow
              title="Open at most"
              desc="Asks first before opening or editing more items at once."
              right={
                <span className="settings-field-with-unit">
                  <OpenItemLimitInput value={openItemLimit} onChange={onOpenItemLimitChange} />
                  items
                </span>
              }
            />
            <SettingRow
              title="Text editor"
              right={
                <ApplicationPopup
                  ariaLabel="Default text editor"
                  application={defaultTextEditor}
                  defaultApplication={DEFAULT_TEXT_EDITOR}
                  onChoose={onBrowseDefaultTextEditor}
                  onUseDefault={onClearDefaultTextEditor}
                />
              }
            />
            <SettingRow
              title="Terminal"
              right={
                <ApplicationPopup
                  ariaLabel="Terminal app"
                  application={terminalApp ?? DEFAULT_TERMINAL_APPLICATION}
                  defaultApplication={DEFAULT_TERMINAL_APPLICATION}
                  onChoose={onBrowseTerminalApp}
                  onUseDefault={onClearTerminalApp}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("explorer") ? (
          <SectionCard title="Favorites">
            <SettingRow
              title="Show favorites"
              right={
                <SelectControl
                  value={favoritesPlacement}
                  options={["integrated", "separate"] satisfies FavoritesPlacement[]}
                  ariaLabel="Favorites placement"
                  onChange={(value) => onFavoritesPlacementChange(value as FavoritesPlacement)}
                  formatOption={(value) =>
                    value === "integrated" ? "In the folder tree" : "In their own section"
                  }
                />
              }
            />
            <div className="settings-row settings-row-list">
              <SettingsList
                label="Favorites"
                items={favorites}
                getKey={(favorite, index) => `${favorite.path}-${index}`}
                getName={(favorite) => getFavoriteLabel(favorite.path, homePath)}
                renderRow={(favorite, index) => (
                  <>
                    <FavoriteIconPicker
                      selectedIcon={favorite.icon}
                      ariaLabel={`Favorite icon for ${getFavoriteLabel(favorite.path, homePath)}`}
                      onChange={(icon) => onFavoriteIconChange(index, icon)}
                    />
                    <SettingsListText
                      name={getFavoriteLabel(favorite.path, homePath)}
                      path={favorite.path}
                    />
                  </>
                )}
                onAdd={onAddFavorite}
                addLabel="Add Favorite"
                onRemove={onRemoveFavorite}
                canRemove={(favorite) => favorite.path !== trashPath}
                onMove={onMoveFavorite}
                onChange={onBrowseFavorite}
                changeLabel="Change"
                extraButtons={
                  <button
                    type="button"
                    className="settings-list-bar-text-button"
                    aria-label="Restore default favorites"
                    onClick={onRestoreDefaultFavorites}
                  >
                    Restore Defaults
                  </button>
                }
              />
            </div>
          </SectionCard>
        ) : null}

        {showSection("files") ? (
          <SectionCard title="Open With" note="Listed first in the Open With menu">
            <div className="settings-row settings-row-list">
              <SettingsList
                label="Open With applications"
                items={openWithApplications}
                getKey={(application) => application.id}
                getName={(application) => application.appName}
                renderRow={(application) => (
                  <>
                    <AppIcon path={application.appPath} />
                    <SettingsListText name={application.appName} path={application.appPath} />
                  </>
                )}
                onAdd={onAddOpenWithApplication}
                addLabel="Add Open With application"
                onRemove={(index) => {
                  const application = openWithApplications[index];
                  if (application) {
                    onRemoveOpenWithApplication(application.id);
                  }
                }}
                onMove={(fromIndex, toIndex) => {
                  const application = openWithApplications[fromIndex];
                  if (application) {
                    onMoveOpenWithApplication(application.id, toIndex);
                  }
                }}
                onChange={(index) => {
                  const application = openWithApplications[index];
                  if (application) {
                    onBrowseOpenWithApplication(application.id);
                  }
                }}
                changeLabel="Change"
              />
            </div>
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
            onChange={onShortcutOverridesChange}
          />
        ) : null}
      </div>
    </div>
  );
}
