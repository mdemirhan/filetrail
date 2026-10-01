import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useKeepInViewport } from "../hooks/useKeepInViewport";
import type { HistoryMenuEntry } from "../lib/historyMenu";

// How long Back or Forward is held before the list of folders appears, as in Safari.
export const HISTORY_MENU_HOLD_MS = 350;

// A Back or Forward button. A click steps once; holding it, or a right-click, lists the
// folders in that direction, nearest first, to jump straight to one of them.
export function HistoryButton({
  className,
  label,
  title,
  disabled,
  entries,
  interactive = true,
  onStep,
  onSelectEntry,
  children,
}: {
  className: string;
  /** "Back" or "Forward": names the button and its menu. */
  label: string;
  title: string;
  disabled: boolean;
  entries: HistoryMenuEntry[];
  /** False for the copy of the toolbar that is only measured, never used. */
  interactive?: boolean;
  onStep: (() => void) | undefined;
  onSelectEntry: (historyIndex: number) => void;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The click that ends a hold must not also step back once.
  const openedByHoldRef = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  // The row the arrow keys are on. The keyboard focus itself stays where it was (the file
  // list or the sidebar), so nothing has to be given back when the menu closes.
  const [activeIndex, setActiveIndex] = useState(0);
  const open = position !== null;
  useKeepInViewport(menuRef, open);

  function cancelHold() {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function openMenu() {
    const button = buttonRef.current;
    if (!button || entries.length === 0) {
      return;
    }
    const rect = button.getBoundingClientRect();
    setActiveIndex(0);
    setPosition({ left: rect.left, top: rect.bottom + 6 });
  }

  useEffect(
    () => () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
    },
    [],
  );

  // The folders listed belong to the place the menu was opened from.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes when the history changes under it.
  useEffect(() => {
    setPosition(null);
  }, [entries.length, entries[0]?.path]);

  useLayoutEffect(() => {
    if (!open) {
      // A hold that ended away from the button never got its click; do not let the flag
      // swallow the next one.
      openedByHoldRef.current = false;
    }
  }, [open]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const onSelectEntryRef = useRef(onSelectEntry);
  onSelectEntryRef.current = onSelectEntry;

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => setPosition(null);
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
    // While the menu is open the keyboard belongs to it: the keys are taken here, before
    // the file list's shortcuts see them.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        close();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const count = entriesRef.current.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => (current + step + count) % count);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        const entry = entriesRef.current[activeIndexRef.current];
        close();
        if (entry) {
          onSelectEntryRef.current(entry.index);
        }
        return;
      }
      if (event.key === "Escape" || event.key === "Tab") {
        close();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  if (!interactive) {
    return (
      <button type="button" className={className} disabled={disabled} aria-label={label}>
        {children}
      </button>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className}${open ? " active" : ""}`}
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onPointerDown={(event) => {
          if (event.button !== 0 || open) {
            return;
          }
          openedByHoldRef.current = false;
          cancelHold();
          holdTimerRef.current = setTimeout(() => {
            holdTimerRef.current = null;
            openedByHoldRef.current = true;
            openMenu();
          }, HISTORY_MENU_HOLD_MS);
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(event) => {
          event.preventDefault();
          cancelHold();
          openMenu();
        }}
        onClick={() => {
          if (openedByHoldRef.current) {
            openedByHoldRef.current = false;
            return;
          }
          if (open) {
            setPosition(null);
            return;
          }
          onStep?.();
        }}
      >
        {children}
      </button>
      {position
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu history-menu"
              role="menu"
              aria-label={`${label} history`}
              style={{ position: "fixed", left: `${position.left}px`, top: `${position.top}px` }}
            >
              {entries.map((entry, index) => (
                <button
                  key={entry.index}
                  type="button"
                  className={`toolbar-menu-item history-menu-item${
                    index === activeIndex ? " active" : ""
                  }`}
                  role="menuitem"
                  aria-current={index === activeIndex ? "true" : undefined}
                  tabIndex={-1}
                  title={entry.path}
                  // The menu never takes the keyboard focus (see `activeIndex`).
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={() => {
                    setPosition(null);
                    onSelectEntry(entry.index);
                  }}
                >
                  <span className="history-menu-name">{entry.label}</span>
                  <span className="history-menu-detail">{entry.detail}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
