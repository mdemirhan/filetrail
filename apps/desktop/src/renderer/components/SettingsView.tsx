import {
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
  DetailColumnOrder,
  DetailColumnVisibility,
  FavoriteIconId,
  FavoritePreference,
  FavoritesPlacement,
  FileActivationAction,
  OpenWithApplication,
  OptionalDetailColumnKey,
  ReturnKeyAction,
  SearchPatternModePreference,
  ThemePreference,
} from "../../shared/appPreferences";
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TERMINAL_APPLICATION,
  DEFAULT_TEXT_EDITOR,
  DETAIL_COLUMN_LABELS,
  FAVORITE_ICON_OPTIONS,
  SEARCH_PATTERN_MODES,
  SEARCH_PATTERN_MODE_LABELS,
  THEME_OPTIONS,
  ZOOM_PERCENT_MAX,
  ZOOM_PERCENT_MIN,
  clampOpenItemLimit,
  clampZoomPercent,
  normalizeAccentColor,
} from "../../shared/appPreferences";
import { type ShortcutOverrides, resolveShortcuts } from "../../shared/shortcuts";
import { getFavoriteLabel, getTrashPath } from "../lib/favorites";
import { AppIcon, FavoriteItemIcon } from "../lib/fileIcons";
import { createShortcutDisplay } from "../lib/shortcutDisplay";
import { MenuCheck } from "./MenuCheck";
import { ActionButton, SectionCard } from "./SettingsControls";
import { ShortcutSettings } from "./ShortcutSettings";

export type SettingsTab = IpcSettingsTab;

export type SearchDefaults = {
  searchPatternMode: SearchPatternModePreference;
  searchMatchScope: "name" | "path";
  searchRecursive: boolean;
  searchSkipGitFolders: boolean;
  searchSkipGitIgnored: boolean;
};

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

// A pop-up button: the system's own menu, so it reads and works like every other pop-up on
// the Mac. It is as wide as its longest choice, as a Mac pop-up is, and never narrower than
// the others' least width, so a column of short ones still lines up.
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

// Auto / Light / Dark, like System Settings.
function AppearanceModePicker({
  theme,
  onChange,
}: {
  theme: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  return (
    <div className="settings-appearance-picker">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="settings-appearance-option"
          aria-pressed={theme === option.value}
          onClick={() => onChange(option.value)}
        >
          <span className="settings-appearance-ring">
            <AppearanceThumbnail mode={option.value} />
          </span>
          {option.label}
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

// The List view's columns, to check and to drag into order, as a list in Settings is. Name is
// always shown and always first: its row is there, but it cannot be unchecked or moved. The
// arrow keys select, Space checks, and ⌥ or ⌘ with an arrow moves the selected column.
function DetailColumnList({
  visibility,
  order,
  onVisibilityChange,
  onOrderChange,
}: {
  visibility: DetailColumnVisibility;
  order: DetailColumnOrder;
  onVisibilityChange: (value: DetailColumnVisibility) => void;
  onOrderChange: (value: DetailColumnOrder) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<OptionalDetailColumnKey | null>(null);
  const [draggedKey, setDraggedKey] = useState<OptionalDetailColumnKey | null>(null);
  const [dropKey, setDropKey] = useState<OptionalDetailColumnKey | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = selectedKey === null ? -1 : order.indexOf(selectedKey);

  const focusRow = (key: OptionalDetailColumnKey) => {
    setSelectedKey(key);
    listRef.current?.querySelector<HTMLElement>(`[data-column="${key}"]`)?.focus();
  };

  const move = (key: OptionalDetailColumnKey, toIndex: number) => {
    const fromIndex = order.indexOf(key);
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= order.length) {
      return;
    }
    const next = order.filter((other) => other !== key);
    next.splice(toIndex, 0, key);
    onOrderChange(next);
    setSelectedKey(key);
  };

  const toggle = (key: OptionalDetailColumnKey) =>
    onVisibilityChange({ ...visibility, [key]: !visibility[key] });

  const endDrag = () => {
    setDraggedKey(null);
    setDropKey(null);
  };

  return (
    <div className="settings-list">
      {/* biome-ignore lint/a11y/useFocusableInteractive: the rows take the focus, one at a time. */}
      <div
        ref={listRef}
        className="settings-list-rows"
        // biome-ignore lint/a11y/useSemanticElements: a native select cannot hold rows that are dragged, or a checkbox.
        role="listbox"
        aria-label="Columns in List view"
        onDragOver={(event) => {
          if (draggedKey !== null) {
            event.preventDefault();
          }
        }}
      >
        <div
          className="settings-list-row settings-column-row"
          // biome-ignore lint/a11y/useSemanticElements: see the listbox note above.
          role="option"
          aria-label={DETAIL_COLUMN_LABELS.name}
          aria-selected={false}
          aria-disabled="true"
          tabIndex={-1}
        >
          <span className="settings-checkbox">
            <input type="checkbox" checked disabled tabIndex={-1} aria-hidden="true" />
          </span>
          <span className="settings-list-name">{DETAIL_COLUMN_LABELS.name}</span>
        </div>
        {order.map((key, index) => {
          const label = DETAIL_COLUMN_LABELS[key];
          const draggedIndex = draggedKey === null ? -1 : order.indexOf(draggedKey);
          const dropSide =
            draggedKey !== null && dropKey === key && draggedKey !== key
              ? draggedIndex < index
                ? "after"
                : "before"
              : undefined;
          return (
            <div
              key={key}
              className="settings-list-row settings-column-row"
              // biome-ignore lint/a11y/useSemanticElements: see the listbox note above.
              role="option"
              aria-label={label}
              aria-selected={selectedKey === key}
              aria-checked={visibility[key]}
              tabIndex={selectedKey === key || (selectedKey === null && index === 0) ? 0 : -1}
              data-column={key}
              data-drop={dropSide}
              data-dragging={draggedKey === key || undefined}
              draggable
              onMouseDown={() => setSelectedKey(key)}
              onFocus={() => setSelectedKey(key)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const target = index + (event.key === "ArrowUp" ? -1 : 1);
                  if (event.altKey || event.metaKey) {
                    move(key, target);
                    window.requestAnimationFrame(() => focusRow(key));
                  } else {
                    const targetKey = order[target];
                    if (targetKey !== undefined) {
                      focusRow(targetKey);
                    }
                  }
                } else if (event.key === " ") {
                  event.preventDefault();
                  toggle(key);
                }
              }}
              onDragStart={(event) => {
                setDraggedKey(key);
                setSelectedKey(key);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", label);
              }}
              onDragEnter={() => setDropKey(key)}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropKey(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedKey !== null) {
                  move(draggedKey, index);
                }
                endDrag();
              }}
              onDragEnd={endDrag}
            >
              <span className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={visibility[key]}
                  tabIndex={-1}
                  aria-label={`Show ${label}`}
                  onChange={() => toggle(key)}
                />
              </span>
              <span className="settings-list-name">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="settings-list-bar">
        <button
          type="button"
          className="settings-list-bar-button"
          aria-label={selectedKey ? `Move ${DETAIL_COLUMN_LABELS[selectedKey]} Up` : "Move Up"}
          title="Move Up"
          disabled={selectedIndex <= 0}
          onClick={() => {
            if (selectedKey !== null) {
              move(selectedKey, selectedIndex - 1);
            }
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>
        <button
          type="button"
          className="settings-list-bar-button"
          aria-label={selectedKey ? `Move ${DETAIL_COLUMN_LABELS[selectedKey]} Down` : "Move Down"}
          title="Move Down"
          disabled={selectedIndex < 0 || selectedIndex >= order.length - 1}
          onClick={() => {
            if (selectedKey !== null) {
              move(selectedKey, selectedIndex + 1);
            }
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </div>
    </div>
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

export function SettingsView({
  activeTab,
  searchDefaults,
  onSearchDefaultsChange = () => undefined,
  theme,
  accent,
  zoomPercent,
  compactListView,
  compactDetailsView,
  compactIconView,
  compactTreeView,
  singleClickExpandTreeItems,
  detailColumns,
  detailColumnOrder,
  layoutMode = "wide",
  notificationsEnabled,
  markClipboardItems,
  restoreSessionOnStartup,
  homePath,
  terminalApp,
  defaultTextEditor,
  favorites,
  favoritesPlacement,
  openWithApplications,
  fileActivationAction,
  returnKeyAction = "rename",
  onReturnKeyActionChange = () => undefined,
  shortcutOverrides = DEFAULT_APP_PREFERENCES.shortcutOverrides,
  onShortcutOverridesChange = () => undefined,
  openItemLimit,
  accentOptions,
  onThemeChange,
  onAccentChange,
  onZoomPercentChange,
  onResetAppearance,
  onCompactListViewChange,
  onCompactDetailsViewChange,
  onCompactIconViewChange,
  onCompactTreeViewChange,
  onSingleClickExpandTreeItemsChange,
  onDetailColumnsChange,
  onDetailColumnOrderChange,
  onNotificationsEnabledChange,
  onMarkClipboardItemsChange,
  onRestoreSessionOnStartupChange,
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
  accent: AccentMode;
  zoomPercent: number;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactIconView: boolean;
  compactTreeView: boolean;
  singleClickExpandTreeItems: boolean;
  detailColumns: DetailColumnVisibility;
  detailColumnOrder: DetailColumnOrder;
  layoutMode?: "wide" | "narrow" | "compact";
  notificationsEnabled: boolean;
  markClipboardItems: boolean;
  restoreSessionOnStartup: boolean;
  homePath: string;
  terminalApp: ApplicationSelection | null;
  defaultTextEditor: ApplicationSelection;
  favorites: ReadonlyArray<FavoritePreference>;
  favoritesPlacement: FavoritesPlacement;
  openWithApplications: ReadonlyArray<OpenWithApplication>;
  fileActivationAction: FileActivationAction;
  returnKeyAction?: ReturnKeyAction;
  onReturnKeyActionChange?: (value: ReturnKeyAction) => void;
  // The keyboard shortcuts that differ from their defaults (the Shortcuts tab).
  shortcutOverrides?: ShortcutOverrides;
  onShortcutOverridesChange?: (value: ShortcutOverrides) => void;
  openItemLimit: number;
  accentOptions: ReadonlyArray<{ value: AccentMode; label: string }>;
  onThemeChange: (value: ThemePreference) => void;
  onAccentChange: (value: AccentMode) => void;
  onZoomPercentChange: (value: number) => void;
  onResetAppearance: () => void;
  onCompactListViewChange: (value: boolean) => void;
  onCompactDetailsViewChange: (value: boolean) => void;
  onCompactIconViewChange: (value: boolean) => void;
  onCompactTreeViewChange: (value: boolean) => void;
  onSingleClickExpandTreeItemsChange: (value: boolean) => void;
  onDetailColumnsChange: (value: DetailColumnVisibility) => void;
  onDetailColumnOrderChange: (value: DetailColumnOrder) => void;
  onNotificationsEnabledChange: (value: boolean) => void;
  onMarkClipboardItemsChange: (value: boolean) => void;
  onRestoreSessionOnStartupChange: (value: boolean) => void;
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
  const trashPath = getTrashPath(homePath);
  return (
    <div className="settings-view overlay-scroll" data-layout={layoutMode}>
      <div className="settings-page">
        {activeTab ? null : (
          <header className="settings-page-header">
            <div className="settings-page-header-left">
              <span className="settings-page-eyebrow">File Trail</span>
              <h2>Settings</h2>
            </div>
          </header>
        )}

        {showSection("general") ? (
          <SectionCard
            title="Appearance"
            resetButton={
              <ActionButton
                label="Restore Defaults"
                ariaLabel="Restore the default appearance"
                onClick={onResetAppearance}
              />
            }
          >
            <SettingRow
              title="Theme"
              right={<AppearanceModePicker theme={theme} onChange={onThemeChange} />}
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
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard title="Startup">
            <SettingRow
              title="Reopen the last folder and tabs"
              desc="Otherwise File Trail opens one tab in your home folder."
              right={
                <Toggle
                  checked={restoreSessionOnStartup}
                  onToggle={() => onRestoreSessionOnStartupChange(!restoreSessionOnStartup)}
                  label="Reopen the last folder and tabs"
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard title="Notifications">
            <SettingRow
              title="Show notifications"
              desc="A card at the bottom right when a copy, a move or the Trash is done."
              right={
                <Toggle
                  checked={notificationsEnabled}
                  onToggle={() => onNotificationsEnabledChange(!notificationsEnabled)}
                  label="Show notifications"
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("general") ? (
          <SectionCard title="Copy and Cut">
            <SettingRow
              title="Mark copied and cut items"
              desc="They flash, and keep a mark in the folder tree and the file list until they are pasted."
              right={
                <Toggle
                  checked={markClipboardItems}
                  onToggle={() => onMarkClipboardItemsChange(!markClipboardItems)}
                  label="Mark copied and cut items"
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("browsing") ? (
          <SectionCard title="Views">
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
                  label="Expand folders with a single click"
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("browsing") ? (
          <SectionCard
            title="Columns in List View"
            note="Name always comes first. Drag the other columns into the order you want."
          >
            <div className="settings-row settings-row-list">
              <DetailColumnList
                visibility={detailColumns}
                order={detailColumnOrder}
                onVisibilityChange={onDetailColumnsChange}
                onOrderChange={onDetailColumnOrderChange}
              />
            </div>
          </SectionCard>
        ) : null}

        {showSection("browsing") ? (
          <SectionCard title="Favorites">
            <SettingRow
              title="Show favorites"
              right={
                <SelectControl
                  value={favoritesPlacement}
                  options={["integrated", "separate"] satisfies FavoritesPlacement[]}
                  ariaLabel="Show favorites"
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
                    aria-label="Restore the default favorites"
                    onClick={onRestoreDefaultFavorites}
                  >
                    Restore Defaults
                  </button>
                }
              />
            </div>
          </SectionCard>
        ) : null}

        {searchDefaults && showSection("search") ? (
          <SectionCard
            title={activeTab ? "New Searches" : "Search"}
            note="Every new search starts with these. The search field's menu changes them for the search you are making."
          >
            <SettingRow
              title="Search in"
              right={
                <SelectControl
                  value={searchDefaults.searchMatchScope}
                  options={["name", "path"]}
                  ariaLabel="Search in"
                  onChange={(value) =>
                    onSearchDefaultsChange({ searchMatchScope: value as "name" | "path" })
                  }
                  formatOption={(value) => (value === "path" ? "Full Paths" : "Names")}
                />
              }
            />
            <SettingRow
              title="Match as"
              desc="Plain Text finds the words anywhere; Glob and Regex read them as a pattern."
              right={
                <SelectControl
                  value={searchDefaults.searchPatternMode}
                  options={SEARCH_PATTERN_MODES}
                  ariaLabel="Match as"
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
              title="Search subfolders"
              right={
                <Toggle
                  checked={searchDefaults.searchRecursive}
                  onToggle={() =>
                    onSearchDefaultsChange({ searchRecursive: !searchDefaults.searchRecursive })
                  }
                  label="Search subfolders"
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
                  label="Skip .git folders"
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
                  label="Skip files ignored by Git"
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("files") ? (
          <SectionCard title="Opening Files">
            <SettingRow
              title="Double-click a file to"
              desc="Folders always open."
              right={
                <SelectControl
                  value={fileActivationAction}
                  options={["open", "edit"] satisfies FileActivationAction[]}
                  ariaLabel="Double-click a file to"
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
              title="Ask before opening more than"
              desc="Opening or editing more items at once asks first."
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
                  ariaLabel="Text editor"
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
                  ariaLabel="Terminal"
                  application={terminalApp ?? DEFAULT_TERMINAL_APPLICATION}
                  defaultApplication={DEFAULT_TERMINAL_APPLICATION}
                  onChoose={onBrowseTerminalApp}
                  onUseDefault={onClearTerminalApp}
                />
              }
            />
          </SectionCard>
        ) : null}

        {showSection("files") ? (
          <SectionCard title="Open With" note="These apps come first in the Open With menu.">
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
