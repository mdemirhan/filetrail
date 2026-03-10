import { type CSSProperties, useEffect, useMemo, useState } from "react";

import {
  type ContextMenuActionId,
  type ContextMenuIconName,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuItem,
  type ContextMenuSurface,
  getContextMenuItems,
} from "../lib/contextMenu";
import {
  getContextMenuShortcutLabel,
  type ShortcutContext,
} from "../lib/shortcutPolicy";

export type { ContextMenuActionId, ContextMenuSubmenuAction, ContextMenuSubmenuItem };

export function ItemContextMenu({
  anchorX,
  anchorY,
  surface = "content",
  disabledActionIds = [],
  favoriteToggleLabel = null,
  folderExpansionLabel = null,
  hiddenActionIds = [],
  submenuItems,
  shortcutContext,
  open,
  onAction,
  onSubmenuAction,
}: {
  anchorX: number;
  anchorY: number;
  surface?: ContextMenuSurface;
  disabledActionIds?: ContextMenuActionId[];
  favoriteToggleLabel?: string | null;
  folderExpansionLabel?: "Expand" | "Collapse" | null;
  hiddenActionIds?: ContextMenuActionId[];
  submenuItems: readonly ContextMenuSubmenuItem[];
  shortcutContext: ShortcutContext;
  open: boolean;
  onAction: (actionId: ContextMenuActionId) => void;
  onSubmenuAction: (action: ContextMenuSubmenuAction) => void;
}) {
  const [activeItemId, setActiveItemId] = useState<ContextMenuActionId | null>(null);
  const disabledActionIdSet = useMemo(() => new Set(disabledActionIds), [disabledActionIds]);
  const hiddenActionIdSet = useMemo(() => new Set(hiddenActionIds), [hiddenActionIds]);
  const items = useMemo(() => {
    const rawItems = getContextMenuItems({
      surface,
      favoriteToggleLabel,
      folderExpansionLabel,
    });
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
  }, [favoriteToggleLabel, folderExpansionLabel, hiddenActionIdSet, surface]);

  useEffect(() => {
    if (open) {
      return;
    }
    setActiveItemId(null);
  }, [open]);

  const submenuOpen = activeItemId === "openWith";
  const menuStyle = useMemo(
    () =>
      ({
        left: `${anchorX}px`,
        top: `${anchorY}px`,
      }) satisfies CSSProperties,
    [anchorX, anchorY],
  );
  if (!open) {
    return null;
  }

  return (
    <div className="context-menu-layer" style={menuStyle}>
      <div className="context-menu">
        {items.map((item) => {
          if (item.type === "separator") {
            return <div key={item.key} className="context-menu-separator" />;
          }
          const isActive = activeItemId === item.id;
          const isDisabled = disabledActionIdSet.has(item.id);
          const shortcut = isDisabled ? null : getContextMenuShortcutLabel(item.id, shortcutContext);
          return (
            <button
              key={item.id}
              type="button"
              aria-disabled={isDisabled}
              className={`context-menu-item${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}${
                item.destructive ? " destructive" : ""
              }`}
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
              {item.hasSubmenu && submenuOpen && !isDisabled ? (
                <div className="context-submenu">
                  {submenuItems.map((submenuItem) => {
                    if (submenuItem.type === "separator") {
                      return <div key={submenuItem.key} className="context-menu-separator" />;
                    }
                    return (
                      <button
                        key={submenuItem.action.id}
                        type="button"
                        className="context-submenu-item"
                        onClick={() => onSubmenuAction(submenuItem.action)}
                      >
                        {submenuItem.action.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContextMenuIcon({ name }: { name: ContextMenuIconName }) {
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
  if (name === "open") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
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
  if (name === "edit") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
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
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2" />
        <path d="M9 4h5l1 2H8l1-2z" />
        <rect x="4" y="8" width="10" height="12" rx="2" ry="2" />
      </svg>
    );
  }
  if (name === "move") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
    );
  }
  if (name === "rename") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
      </svg>
    );
  }
  if (name === "duplicate") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
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
  if (name === "toggleExpand") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="9 6 15 12 9 18" />
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
  if (name === "terminal") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
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
  return (
    <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
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
