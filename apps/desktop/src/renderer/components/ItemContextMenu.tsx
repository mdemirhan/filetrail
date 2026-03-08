import { type CSSProperties, useEffect, useMemo, useState } from "react";

export type ContextMenuActionId =
  | "revealInFolder"
  | "open"
  | "openWith"
  | "info"
  | "copy"
  | "move"
  | "rename"
  | "duplicate"
  | "compress"
  | "newFolder"
  | "terminal"
  | "copyPath"
  | "trash";

export type ContextMenuSubmenuActionId = "vscode" | "sublime" | "nvim" | "finder" | "other";

type ContextMenuItem =
  | {
      type: "separator";
      key: string;
    }
  | {
      type?: "action";
      id: ContextMenuActionId;
      label: string;
      icon: ContextMenuIconName;
      shortcut?: string;
      destructive?: boolean;
      hasSubmenu?: boolean;
    };

type ContextMenuSubmenuItem =
  | {
      type: "separator";
      key: string;
    }
  | {
      type?: "item";
      id: ContextMenuSubmenuActionId;
      label: string;
    };

type ContextMenuIconName =
  | "revealInFolder"
  | "open"
  | "openWith"
  | "info"
  | "copy"
  | "move"
  | "rename"
  | "duplicate"
  | "compress"
  | "newFolder"
  | "terminal"
  | "copyPath"
  | "trash";

export const BROWSE_CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { id: "open", label: "Open", icon: "open", shortcut: "⏎" },
  { id: "openWith", label: "Open With", icon: "openWith", hasSubmenu: true },
  { type: "separator", key: "separator-open" },
  { id: "info", label: "Get Info", icon: "info", shortcut: "⌘I" },
  { type: "separator", key: "separator-info" },
  { id: "copy", label: "Copy", icon: "copy", shortcut: "⌘C" },
  { id: "move", label: "Move To…", icon: "move", shortcut: "⌘M" },
  { id: "rename", label: "Rename", icon: "rename", shortcut: "F2" },
  { id: "duplicate", label: "Duplicate", icon: "duplicate", shortcut: "⌘D" },
  { type: "separator", key: "separator-duplicate" },
  { id: "compress", label: "Compress", icon: "compress" },
  { id: "newFolder", label: "New Folder", icon: "newFolder", shortcut: "⇧⌘N" },
  { type: "separator", key: "separator-new-folder" },
  { id: "terminal", label: "Open in Terminal", icon: "terminal", shortcut: "⌘T" },
  { id: "copyPath", label: "Copy Path", icon: "copyPath", shortcut: "⌥⌘C" },
  { type: "separator", key: "separator-copy-path" },
  { id: "trash", label: "Move to Trash", icon: "trash", shortcut: "⌘⌫", destructive: true },
] as const;

export const SEARCH_CONTEXT_MENU_ITEMS: readonly ContextMenuItem[] = [
  { id: "revealInFolder", label: "Reveal in Folder", icon: "revealInFolder" },
  { type: "separator", key: "separator-reveal" },
  ...BROWSE_CONTEXT_MENU_ITEMS,
] as const;

export const CONTEXT_MENU_SUBMENU_ITEMS: readonly ContextMenuSubmenuItem[] = [
  { id: "vscode", label: "Visual Studio Code" },
  { id: "sublime", label: "Sublime Text" },
  { id: "nvim", label: "Neovim" },
  { type: "separator", key: "separator-submenu-main" },
  { id: "finder", label: "Finder" },
  { id: "other", label: "Other…" },
] as const;

export function ItemContextMenu({
  anchorX,
  anchorY,
  variant = "browse",
  disabledActionIds = [],
  open,
  onAction,
  onSubmenuAction,
}: {
  anchorX: number;
  anchorY: number;
  variant?: "browse" | "search";
  disabledActionIds?: ContextMenuActionId[];
  open: boolean;
  onAction: (actionId: ContextMenuActionId) => void;
  onSubmenuAction: (actionId: ContextMenuSubmenuActionId) => void;
}) {
  const [activeItemId, setActiveItemId] = useState<ContextMenuActionId | null>(null);
  const disabledActionIdSet = useMemo(() => new Set(disabledActionIds), [disabledActionIds]);
  const items = variant === "search" ? SEARCH_CONTEXT_MENU_ITEMS : BROWSE_CONTEXT_MENU_ITEMS;

  useEffect(() => {
    if (!open) {
      setActiveItemId(null);
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
              ) : item.shortcut ? (
                <span className="context-menu-item-shortcut">{item.shortcut}</span>
              ) : null}
              {item.hasSubmenu && submenuOpen && !isDisabled ? (
                <div className="context-submenu">
                  {CONTEXT_MENU_SUBMENU_ITEMS.map((submenuItem) => {
                    if (submenuItem.type === "separator") {
                      return <div key={submenuItem.key} className="context-menu-separator" />;
                    }
                    return (
                      <button
                        key={submenuItem.id}
                        type="button"
                        className="context-submenu-item"
                        onClick={() => onSubmenuAction(submenuItem.id)}
                      >
                        {submenuItem.label}
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
  if (name === "info") {
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
  if (name === "compress") {
    return (
      <svg className="context-menu-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
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
