import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  AUTO_THEME_OPTION,
  THEME_GROUPS,
  type ThemePreference,
  getThemeLabel,
} from "../../shared/appPreferences";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { placeDropdownMenu } from "../lib/menuPlacement";
import { MenuCheck } from "./MenuCheck";
import { ToolbarIcon } from "./ToolbarIcon";

// The toolbar's Theme button: a menu of the palettes, Auto first, with the one in use
// checked. It is the one-click way to change the palette; Settings → Appearance has the rest.
export function ThemeMenuButton({
  theme,
  onSelectTheme,
  interactive = true,
}: {
  theme: ThemePreference;
  onSelectTheme: (theme: ThemePreference) => void;
  /** False for the off-screen copy the toolbar measures; it never opens a menu. */
  interactive?: boolean;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<ReturnType<typeof placeDropdownMenu> | null>(null);
  const open = menuStyle !== null;
  useKeepInViewport(menuRef, open);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setMenuStyle(null);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || buttonRef.current?.contains(target))
      ) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    // The button may move when the window is resized, or the window may lose the keyboard
    // to Settings: the menu does not stay behind.
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  const renderOption = (option: { value: ThemePreference; label: string }) => (
    <button
      key={option.value}
      type="button"
      className="toolbar-menu-item"
      role="menuitemradio"
      aria-checked={theme === option.value}
      onClick={() => {
        setMenuStyle(null);
        onSelectTheme(option.value);
      }}
    >
      <MenuCheck checked={theme === option.value} />
      <span className="toolbar-menu-label">{option.label}</span>
    </button>
  );

  return (
    <>
      <button
        ref={interactive ? buttonRef : undefined}
        type="button"
        className={`tb-btn tb-btn-icon${open ? " active" : ""}`}
        tabIndex={interactive ? undefined : -1}
        title={`Theme: ${getThemeLabel(theme)}`}
        aria-label="Choose theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={
          interactive
            ? () => {
                const rect = buttonRef.current?.getBoundingClientRect();
                setMenuStyle(
                  open || !rect
                    ? null
                    : placeDropdownMenu({ anchor: rect, viewportWidth: window.innerWidth }),
                );
              }
            : undefined
        }
      >
        <ToolbarIcon name="theme" />
      </button>
      {interactive && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu theme-menu"
              role="menu"
              aria-label="Theme"
              style={menuStyle}
            >
              {renderOption(AUTO_THEME_OPTION)}
              {THEME_GROUPS.map((group) => (
                <Fragment key={group.value}>
                  <hr className="toolbar-menu-separator" />
                  {group.options.map(renderOption)}
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
