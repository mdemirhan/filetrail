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
      return;
    }
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      const focusedIndex = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        buttonRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
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
      if (event.key === "Tab") {
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
              {entries.map((entry) => (
                <button
                  key={entry.index}
                  type="button"
                  className="toolbar-menu-item history-menu-item"
                  role="menuitem"
                  tabIndex={-1}
                  title={entry.path}
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
