import {
  type CSSProperties,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useKeepInViewport } from "../hooks/useKeepInViewport";

import {
  type ContextMenuActionId,
  type ContextMenuIconName,
  type ContextMenuOptions,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuId,
  type ContextMenuSubmenuItem,
  type ContextMenuSubmenus,
  type ContextMenuSurface,
  getContextMenuItems,
} from "../lib/contextMenu";
import { placeSubmenu } from "../lib/menuPlacement";
import { type ShortcutContext, getContextMenuShortcutLabel } from "../lib/shortcutPolicy";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { EjectIcon } from "./EjectIcon";
import { MenuCheck } from "./MenuCheck";
import { WindowDragRelease } from "./WindowDragRelease";

export type {
  ContextMenuActionId,
  ContextMenuSubmenuAction,
  ContextMenuSubmenuItem,
  ContextMenuSubmenus,
};

const NO_OPTIONS: ContextMenuOptions = {};

export function ItemContextMenu({
  anchorX,
  anchorY,
  surface = "content",
  disabledActionIds = [],
  options = NO_OPTIONS,
  hiddenActionIds = [],
  submenus,
  shortcutContext,
  open,
  onAction,
  onSubmenuAction,
}: {
  anchorX: number;
  anchorY: number;
  surface?: ContextMenuSurface;
  disabledActionIds?: ContextMenuActionId[];
  options?: ContextMenuOptions;
  hiddenActionIds?: ContextMenuActionId[];
  /** What each item with a submenu lists: Open With's apps, View As, Sort By. */
  submenus: ContextMenuSubmenus;
  shortcutContext: ShortcutContext;
  open: boolean;
  onAction: (actionId: ContextMenuActionId) => void;
  onSubmenuAction: (action: ContextMenuSubmenuAction) => void;
}) {
  const shortcutDisplay = useShortcutDisplay();
  const [activeItemId, setActiveItemId] = useState<ContextMenuActionId | null>(null);
  const disabledActionIdSet = useMemo(() => new Set(disabledActionIds), [disabledActionIds]);
  const hiddenActionIdSet = useMemo(() => new Set(hiddenActionIds), [hiddenActionIds]);
  const items = useMemo(() => {
    const rawItems = getContextMenuItems({ surface, ...options });
    const visibleItems = rawItems.filter(
      (item) => item.type === "separator" || !hiddenActionIdSet.has(item.id),
    );
    const compactedItems = [];
    let previousWasSeparator = true;

    for (const item of visibleItems) {
      if (item.type === "separator") {
        if (previousWasSeparator) {
          continue;
        }
        compactedItems.push(item);
        previousWasSeparator = true;
        continue;
      }
      compactedItems.push(item);
      previousWasSeparator = false;
    }

    if (compactedItems.at(-1)?.type === "separator") {
      compactedItems.pop();
    }

    return compactedItems;
  }, [options, hiddenActionIdSet, surface]);

  useEffect(() => {
    if (open) {
      return;
    }
    setActiveItemId(null);
  }, [open]);

  // The submenu of the item under the pointer or the arrow keys, if it has one.
  const openSubmenuId: ContextMenuSubmenuId | null =
    activeItemId !== null &&
    !disabledActionIdSet.has(activeItemId) &&
    items.some((item) => item.type !== "separator" && item.id === activeItemId && item.hasSubmenu)
      ? (activeItemId as ContextMenuSubmenuId)
      : null;
  const submenuItems = (openSubmenuId && submenus[openSubmenuId]) || null;
  const submenuOpen = submenuItems !== null;
  // The submenu row the keyboard is on, once → has gone into the submenu.
  const [submenuActiveIndex, setSubmenuActiveIndex] = useState<number | null>(null);
  const submenuActions = useMemo(
    () => (submenuItems ?? []).flatMap((item) => (item.type === "separator" ? [] : [item.action])),
    [submenuItems],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the keyboard leaves a submenu when another one opens in its place.
  useEffect(() => {
    setSubmenuActiveIndex(null);
  }, [openSubmenuId]);

  // The keyboard works the menu as it does a macOS menu: ↑ ↓ (and Home, End) move between
  // the items that can be chosen, Return or Space chooses, → goes into Open With and ←
  // back out, and a letter moves to the next item that starts with it. Escape is left to
  // the window, which closes the menu. Keys are taken before the window's shortcuts see
  // them, so they do not also move the selection behind the menu.
  useEffect(() => {
    if (!open) {
      return;
    }
    const choosable = items.flatMap((item) =>
      item.type === "separator" || disabledActionIdSet.has(item.id) ? [] : [item],
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key;
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (submenuOpen && submenuActiveIndex !== null) {
        const count = submenuActions.length;
        if (key === "ArrowDown" || key === "ArrowUp") {
          take();
          if (count > 0) {
            const step = key === "ArrowDown" ? 1 : -1;
            setSubmenuActiveIndex((submenuActiveIndex + step + count) % count);
          }
        } else if (key === "ArrowLeft") {
          take();
          setSubmenuActiveIndex(null);
        } else if (key === "Enter" || key === " ") {
          take();
          const action = submenuActions[submenuActiveIndex];
          if (action) {
            onSubmenuAction(action);
          }
        }
        return;
      }
      const index = choosable.findIndex((item) => item.id === activeItemId);
      const moveTo = (next: number) => {
        const item = choosable[(next + choosable.length) % choosable.length];
        if (item) {
          setActiveItemId(item.id);
        }
      };
      if (key === "ArrowDown") {
        take();
        moveTo(index < 0 ? 0 : index + 1);
      } else if (key === "ArrowUp") {
        take();
        moveTo(index < 0 ? choosable.length - 1 : index - 1);
      } else if (key === "Home") {
        take();
        moveTo(0);
      } else if (key === "End") {
        take();
        moveTo(choosable.length - 1);
      } else if (key === "ArrowRight" && submenuOpen) {
        take();
        setSubmenuActiveIndex(0);
      } else if ((key === "Enter" || key === " ") && index >= 0) {
        take();
        const item = choosable[index];
        if (item?.hasSubmenu) {
          setSubmenuActiveIndex(0);
        } else if (item) {
          onAction(item.id);
        }
      } else if (key.length === 1 && key.trim().length === 1) {
        take();
        const letter = key.toLocaleLowerCase();
        for (let offset = 1; offset <= choosable.length; offset += 1) {
          const candidate = choosable[(Math.max(index, -1) + offset) % choosable.length];
          if (candidate?.label.toLocaleLowerCase().startsWith(letter)) {
            setActiveItemId(candidate.id);
            break;
          }
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    activeItemId,
    disabledActionIdSet,
    items,
    onAction,
    onSubmenuAction,
    open,
    submenuActions,
    submenuActiveIndex,
    submenuOpen,
  ]);
  const menuStyle = useMemo(
    () =>
      ({
        left: `${anchorX}px`,
        top: `${anchorY}px`,
      }) satisfies CSSProperties,
    [anchorX, anchorY],
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuParentRef = useRef<HTMLButtonElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  // The menu opens at the pointer and is then moved back inside the window; a menu taller
  // than the window scrolls.
  useKeepInViewport(menuRef, open);
  // The submenu is a sibling of the menu rather than a child, so a scrolling menu cannot
  // clip it. It is placed beside its parent item once both are measured.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    const parent = submenuParentRef.current;
    const submenu = submenuRef.current;
    if (!open || !submenuOpen || !menu || !parent || !submenu) {
      return;
    }
    const menuRect = menu.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const position = placeSubmenu({
      // Beside the menu's own edge, level with the parent item.
      item: {
        left: menuRect.left,
        right: menuRect.right,
        top: parentRect.top,
        bottom: parentRect.bottom,
      },
      submenu: { width: submenuRect.width, height: submenuRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    submenu.style.left = `${position.left}px`;
    submenu.style.top = `${position.top}px`;
  });
  if (!open) {
    return null;
  }

  return (
    <div className="context-menu-layer" style={menuStyle}>
      <WindowDragRelease />
      <div
        ref={menuRef}
        className="context-menu"
        // The submenu is placed against its parent item, which moves when the menu scrolls.
        onScroll={() => setActiveItemId(null)}
      >
        {items.map((item) => {
          if (item.type === "separator") {
            return <div key={item.key} className="context-menu-separator" />;
          }
          const isActive = activeItemId === item.id;
          const isDisabled = disabledActionIdSet.has(item.id);
          const shortcut = isDisabled
            ? null
            : getContextMenuShortcutLabel(item.id, shortcutContext, shortcutDisplay);
          const itemClassName = `context-menu-item${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}${
            item.destructive ? " destructive" : ""
          }`;
          const itemButton = (
            <button
              ref={item.hasSubmenu ? submenuParentRef : undefined}
              type="button"
              aria-disabled={isDisabled}
              className={itemClassName}
              onMouseEnter={() => {
                setActiveItemId(item.id);
              }}
              onClick={() => {
                if (item.hasSubmenu || isDisabled) {
                  return;
                }
                onAction(item.id);
              }}
            >
              <span className="context-menu-item-icon" aria-hidden="true">
                <ContextMenuIcon name={item.icon} />
              </span>
              <span className="context-menu-item-label">{item.label}</span>
              {item.hasSubmenu ? (
                <span className="context-menu-submenu-arrow" aria-hidden="true">
                  <SubmenuChevron />
                </span>
              ) : shortcut ? (
                <span className="context-menu-item-shortcut">{shortcut}</span>
              ) : null}
            </button>
          );

          return <Fragment key={item.id}>{itemButton}</Fragment>;
        })}
      </div>
      {submenuItems ? (
        <div ref={submenuRef} className="context-submenu">
          {submenuItems.map((submenuItem) => {
            if (submenuItem.type === "separator") {
              return <div key={submenuItem.key} className="context-menu-separator" />;
            }
            const action = submenuItem.action;
            const submenuIndex = submenuActions.indexOf(action);
            // View As and Sort By tick the current choice, as a macOS menu does.
            const checked = "checked" in action ? action.checked : null;
            return (
              <button
                key={action.id}
                type="button"
                role={checked === null ? undefined : "menuitemradio"}
                aria-checked={checked ?? undefined}
                className={`context-submenu-item${
                  submenuIndex === submenuActiveIndex ? " active" : ""
                }`}
                onMouseEnter={() => setSubmenuActiveIndex(submenuIndex)}
                onClick={() => onSubmenuAction(action)}
              >
                {checked === null ? null : <MenuCheck checked={checked} />}
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ContextMenuIcon({ name }: { name: ContextMenuIconName }) {
  if (name === "eject") {
    return <EjectIcon className="context-menu-icon-svg" />;
  }
  if (name === "revealInFolder") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <path d="M12 10h6" />
        <path d="M15 7l3 3-3 3" />
      </svg>
    );
  }
  if (name === "revealInTree") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16" />
        <path d="M4 12h10" />
        <path d="M4 18h10" />
        <path d="M16 9l4 3-4 3" />
      </svg>
    );
  }
  if (name === "rootTreeHere") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h8" />
        <path d="M8 5v12h6" />
        <path d="M8 11h6" />
        <path d="M17 9l3 2-3 2" />
        <path d="M17 15l3 2-3 2" />
      </svg>
    );
  }
  if (name === "openFile") {
    // A page with an arrow out of it: a file opens in its app, not here.
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9.5 15.5l5-5M11 10.5h3.5V14" />
      </svg>
    );
  }
  if (name === "quickLook") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M14 7h3v3M10 17H7v-3M17 7l-4 4M7 17l4-4" />
      </svg>
    );
  }
  if (name === "viewAs") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
        <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
      </svg>
    );
  }
  if (name === "sortBy") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4" />
      </svg>
    );
  }
  if (name === "open") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (name === "openInNewTab") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 19V7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9z" />
        <path d="M12 12v5M9.5 14.5h5" />
      </svg>
    );
  }
  if (name === "openInNewWindow") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 8h18M12 11v6M9 14h6" />
      </svg>
    );
  }
  if (name === "openWith") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    );
  }
  if (name === "showInfo") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  }
  // A pie chart: how much the folder takes up.
  if (name === "calculateSize") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
        <path d="M22 12A10 10 0 0 0 12 2v10z" />
      </svg>
    );
  }
  if (name === "favorite") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 17.27-5.18 3.05 1.39-5.88L3 9.97l6.01-.5L12 4l2.99 5.47 6.01.5-5.21 4.47 1.39 5.88Z" />
      </svg>
    );
  }
  /* Icons below are converged with toolbar (same SVG in both surfaces) */
  if (name === "edit") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === "copy") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  if (name === "cut") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.5 15.5" />
        <path d="M20 20 10.5 10.5" />
      </svg>
    );
  }
  if (name === "paste") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 4h6M10 2h4a1 1 0 0 1 1 1v2H9V3a1 1 0 0 1 1-1m-3 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2m3 5h6m-6 4h6" />
      </svg>
    );
  }
  if (name === "move") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 12h8M8 9l3 3-3 3M14 8h6l2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-2" />
      </svg>
    );
  }
  if (name === "rename") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM8.5 9v6M7 9h3M7 15h3" />
      </svg>
    );
  }
  if (name === "duplicate") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        <path d="M14.5 11.5v6M11.5 14.5h6" />
      </svg>
    );
  }
  if (name === "newFolder") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    );
  }
  if (name === "terminal") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2m3 4l3 3-3 3m5 2h4" />
      </svg>
    );
  }
  if (name === "showInFinder") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <circle cx="11.5" cy="13" r="2.5" />
        <path d="M13.5 15l2.5 2.5" />
      </svg>
    );
  }
  if (name === "copyPath") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  if (name === "showPackageContents") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18M3 9h6" />
      </svg>
    );
  }
  if (name === "deleteImmediately") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6h8M10 6V4h4v2M6 6h12l-1 13a2 2 0 0 1-2 1.85H9A2 2 0 0 1 7 19L6 6M10 10v6M14 10v6" />
      </svg>
    );
  }
  if (name === "emptyTrash") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6h8M10 6V4h4v2M6 6h12l-1 13a2 2 0 0 1-2 1.85H9A2 2 0 0 1 7 19L6 6M10 10v6M14 10v6" />
      </svg>
    );
  }
  // trash (default fallback) — converged with toolbar
  return (
    <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h8M10 6V4h4v2M6 6h12l-1 13a2 2 0 0 1-2 1.85H9A2 2 0 0 1 7 19L6 6M10 10v6M14 10v6" />
    </svg>
  );
}

function SubmenuChevron() {
  return (
    <svg className="context-menu-chevron-svg" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
