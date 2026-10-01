import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { IpcRequest } from "@filetrail/contracts";

import { ToolbarIcon } from "./ToolbarIcon";

type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];

const MENU_ITEM_SELECTOR = '[role="menuitemradio"], [role="menuitemcheckbox"]';

// The magnifier inside the toolbar search field doubles as a menu button (as in Mail or
// Xcode): it opens the search options as an ordinary menu with checkmarks, so the field
// itself stays a plain field. The same options are in the bar above the search results.
// Hidden files are not an option here: search includes them when the file list shows them.
export function SearchOptionsMenu({
  anchorRef,
  inputRef,
  interactive,
  patternMode,
  onPatternModeChange,
  matchScope,
  onMatchScopeChange,
  recursive,
  onRecursiveChange,
}: {
  /** The search field; the menu hangs below it. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Keeps (or gets back) the keyboard focus so Return still runs the search. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** False for the off-screen copy the toolbar measures; it never opens a menu. */
  interactive: boolean;
  patternMode: SearchPatternMode;
  onPatternModeChange: (value: SearchPatternMode) => void;
  matchScope: SearchMatchScope;
  onMatchScopeChange: (value: SearchMatchScope) => void;
  recursive: boolean;
  onRecursiveChange: (value: boolean) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  // The field sits at the right end of the toolbar, so the menu lines up with its right edge.
  const [position, setPosition] = useState<{ right: number; top: number } | null>(null);
  // Opened from the keyboard: the first item takes focus, as in a native menu.
  const focusFirstItemRef = useRef(false);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      setPosition({
        right: Math.max(12, window.innerWidth - rect.right),
        top: rect.bottom + 6,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open || !position || !focusFirstItemRef.current) {
      return;
    }
    focusFirstItemRef.current = false;
    menuRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR)?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) {
        inputRef.current?.focus();
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || buttonRef.current?.contains(target))
      ) {
        return;
      }
      close(false);
    };
    // Capture phase, so the menu's keys never reach the search field's own Escape handling
    // or the explorer shortcuts while it is open.
    const handleKeyDown = (event: KeyboardEvent) => {
      const menu = menuRef.current;
      if (!menu) {
        return;
      }
      const items = Array.from(menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
      const focusedIndex = items.findIndex((item) => item === document.activeElement);
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        consume();
        close(true);
        return;
      }
      if (event.key === "Tab") {
        consume();
        close(true);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        consume();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          focusedIndex === -1
            ? step === 1
              ? 0
              : items.length - 1
            : (focusedIndex + step + items.length) % items.length;
        items[nextIndex]?.focus();
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        if (focusedIndex !== -1) {
          consume();
          items[event.key === "Home" ? 0 : items.length - 1]?.focus();
        }
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && focusedIndex !== -1) {
        consume();
        items[focusedIndex]?.click();
        return;
      }
      if (event.key === "Enter" && document.activeElement !== buttonRef.current) {
        // Return in the field runs the search; the menu just gets out of the way.
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [inputRef, open]);

  // Like a native menu, choosing an item applies it and closes the menu; the field keeps
  // the focus so Return runs the search with the new option.
  const choose = (apply: () => void) => {
    apply();
    setOpen(false);
    inputRef.current?.focus();
  };

  const radioItem = (label: string, checked: boolean, apply: () => void) => (
    <button
      type="button"
      className="toolbar-menu-item"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => choose(apply)}
    >
      <span className="toolbar-menu-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="toolbar-menu-label">{label}</span>
    </button>
  );
  const checkboxItem = (label: string, checked: boolean, apply: () => void) => (
    <button
      type="button"
      className="toolbar-menu-item"
      role="menuitemcheckbox"
      aria-checked={checked}
      tabIndex={-1}
      onClick={() => choose(apply)}
    >
      <span className="toolbar-menu-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="toolbar-menu-label">{label}</span>
    </button>
  );

  const menu =
    interactive && open && position
      ? createPortal(
          // Clicks must not take the focus away from the search field.
          <div
            ref={menuRef}
            className="toolbar-menu toolbar-search-menu"
            role="menu"
            aria-label="Search options"
            style={{ position: "fixed", right: `${position.right}px`, top: `${position.top}px` }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="toolbar-menu-heading">Match</div>
            {radioItem("Name", matchScope === "name", () => onMatchScopeChange("name"))}
            {radioItem("Full path", matchScope === "path", () => onMatchScopeChange("path"))}
            <hr className="toolbar-menu-separator" />
            <div className="toolbar-menu-heading">Pattern</div>
            {radioItem("Glob", patternMode === "glob", () => onPatternModeChange("glob"))}
            {radioItem("Regex", patternMode === "regex", () => onPatternModeChange("regex"))}
            <hr className="toolbar-menu-separator" />
            {checkboxItem("Search subfolders", recursive, () => onRecursiveChange(!recursive))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={interactive ? buttonRef : undefined}
        type="button"
        className="toolbar-search-icon toolbar-search-options-button"
        aria-label="Search options"
        title="Search options"
        aria-haspopup="menu"
        aria-expanded={open}
        tabIndex={interactive ? undefined : -1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={
          interactive
            ? (event) => {
                // A keyboard "click" (Return or Space on the button) has no pointer detail.
                focusFirstItemRef.current = event.detail === 0;
                if (event.detail !== 0) {
                  // Opened with the mouse: typing still goes to the search field.
                  inputRef.current?.focus();
                }
                setOpen((value) => !value);
              }
            : undefined
        }
      >
        <ToolbarIcon name="search" />
        <svg className="toolbar-search-options-chevron" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.5 3 4 5.5 6.5 3" />
        </svg>
      </button>
      {menu}
    </>
  );
}
