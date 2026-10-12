import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useKeepInViewport } from "../hooks/useKeepInViewport";
import type { ContextMenuSubmenuAction, ContextMenuSubmenuItem } from "../lib/contextMenu";
import { useOptionKeyHeld } from "../lib/optionKey";
import { SubmenuItemList, getSubmenuActions } from "./SubmenuItemList";
import { WindowDragRelease } from "./WindowDragRelease";

// A menu that drops from a button, with the same rows as the right-click menu's submenus
// (SubmenuItemList) and worked the same way: ↑ ↓ Home End move, Return or Space chooses, a
// letter moves to the next item starting with it, Escape closes. It closes as a native menu
// does: on a click anywhere else, on a click in the toolbar (WindowDragRelease) and when the
// window loses focus. While Option is held it lists its alternate items, when it has some,
// under their heading (Always Open With).
export function PullDownMenu({
  items,
  alternate,
  onChoose,
  className,
  menuClassName,
  renderTrigger,
}: {
  items: readonly ContextMenuSubmenuItem[];
  alternate?: { label: string; items: readonly ContextMenuSubmenuItem[] } | null | undefined;
  onChoose: (action: ContextMenuSubmenuAction) => void;
  className?: string | undefined;
  menuClassName?: string | undefined;
  /** The button that opens the menu. */
  renderTrigger: (trigger: { open: boolean; toggle: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Under the button, its right edge on the button's, placed against the window so no
  // cut-off row clips it; then moved back inside the window if it doesn't fit.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const menu = menuRef.current;
    if (!open || !root || !menu) {
      return;
    }
    const button = root.getBoundingClientRect();
    menu.style.top = `${button.bottom + 4}px`;
    menu.style.left = `${button.right - menu.offsetWidth}px`;
  });
  useKeepInViewport(menuRef, open);
  const optionHeld = useOptionKeyHeld() && open;
  const shownAlternate = optionHeld && alternate ? alternate : null;
  const shownItems = shownAlternate ? shownAlternate.items : items;
  const actions = useMemo(() => getSubmenuActions(shownItems), [shownItems]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(null);
      return;
    }
    // Focus does not move when empty panel space is clicked, so a click is watched for.
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const close = () => setOpen(false);
    // The menu stays where it opened, so it closes when what holds its button scrolls.
    const closeOnScroll = (event: Event) => {
      if (!(event.target instanceof Node && menuRef.current?.contains(event.target))) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", closeOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const choose = (action: ContextMenuSubmenuAction) => {
      setOpen(false);
      onChoose(action);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      const optionChoice = event.altKey && (key === "Enter" || key === " ");
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) {
        return;
      }
      if (event.altKey && !optionChoice) {
        return;
      }
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      const count = actions.length;
      if (key === "Escape") {
        take();
        setOpen(false);
      } else if (key === "ArrowDown" || key === "ArrowUp") {
        take();
        if (count > 0) {
          const step = key === "ArrowDown" ? 1 : -1;
          setActiveIndex((current) =>
            current === null ? (step > 0 ? 0 : count - 1) : (current + step + count) % count,
          );
        }
      } else if (key === "Home" || key === "End") {
        take();
        if (count > 0) {
          setActiveIndex(key === "Home" ? 0 : count - 1);
        }
      } else if (key === "Enter" || key === " ") {
        take();
        const action = activeIndex === null ? undefined : actions[activeIndex];
        if (action) {
          choose(action);
        }
      } else if (key.length === 1 && key.trim().length === 1) {
        take();
        const letter = key.toLocaleLowerCase();
        for (let offset = 1; offset <= count; offset += 1) {
          const index = ((activeIndex ?? -1) + offset) % count;
          if (actions[index]?.label.toLocaleLowerCase().startsWith(letter)) {
            setActiveIndex(index);
            break;
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actions, activeIndex, onChoose, open]);

  return (
    <div ref={rootRef} className={`pull-down${className ? ` ${className}` : ""}`}>
      {renderTrigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div
          ref={menuRef}
          className={`context-submenu pull-down-menu${menuClassName ? ` ${menuClassName}` : ""}`}
          role="menu"
          onMouseLeave={() => setActiveIndex(null)}
        >
          <WindowDragRelease />
          {shownAlternate ? (
            <div className="pull-down-menu-heading">{shownAlternate.label}</div>
          ) : null}
          <SubmenuItemList
            items={shownItems}
            activeIndex={activeIndex}
            onActiveIndexChange={setActiveIndex}
            itemRole="menuitem"
            onChoose={(action) => {
              setOpen(false);
              onChoose(action);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
