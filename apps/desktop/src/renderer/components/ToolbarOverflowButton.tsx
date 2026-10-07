import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { placeDropdownMenu } from "../lib/menuPlacement";
import { MenuCheck } from "./MenuCheck";
import { ToolbarIcon } from "./ToolbarIcon";
import { WindowDragRelease } from "./WindowDragRelease";

export type ToolbarOverflowEntry = {
  key: string;
  label: string;
  // Given for an item that is on or off (a view, a toggle): its check mark.
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

// The toolbar items there is no room for, as Finder lists them: the » at the end of the row
// opens a menu of them, one group per item.
export function ToolbarOverflowButton({
  groups,
}: {
  groups: ReadonlyArray<{ key: string; entries: readonly ToolbarOverflowEntry[] }>;
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
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`tb-btn tb-btn-icon${open ? " active" : ""}`}
        title="More Toolbar Items"
        aria-label="More Toolbar Items"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          setMenuStyle(
            open || !rect
              ? null
              : placeDropdownMenu({ anchor: rect, viewportWidth: window.innerWidth }),
          );
        }}
      >
        <ToolbarIcon name="overflow" />
      </button>
      {menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu toolbar-overflow-menu"
              role="menu"
              aria-label="More Toolbar Items"
              style={menuStyle}
            >
              <WindowDragRelease />
              {groups.map((group, index) => (
                <Fragment key={group.key}>
                  {index > 0 ? <hr className="toolbar-menu-separator" /> : null}
                  {group.entries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className="toolbar-menu-item"
                      role={entry.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                      aria-checked={entry.checked}
                      disabled={entry.disabled}
                      onClick={() => {
                        setMenuStyle(null);
                        entry.onSelect();
                      }}
                    >
                      <MenuCheck checked={entry.checked === true} />
                      <span className="toolbar-menu-label">{entry.label}</span>
                    </button>
                  ))}
                </Fragment>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
