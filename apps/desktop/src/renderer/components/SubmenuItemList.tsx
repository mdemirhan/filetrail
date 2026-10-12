import { useEffect, useRef } from "react";

import type { ContextMenuSubmenuAction, ContextMenuSubmenuItem } from "../lib/contextMenu";
import { AppIcon } from "../lib/fileIcons";
import { MenuCheck } from "./MenuCheck";

// The actions of a list of submenu items, without the separators: what the keyboard steps
// through, and what `activeIndex` counts.
export function getSubmenuActions(
  items: readonly ContextMenuSubmenuItem[],
): ContextMenuSubmenuAction[] {
  return items.flatMap((item) => (item.type === "separator" ? [] : [item.action]));
}

// The rows of a submenu, drawn the same wherever one shows: the right-click menu's Open
// With, View As and Sort By, and Get Info's Open With menus. View As and Sort By tick the
// current choice; Open With shows each app with its own icon. The row the keyboard is on is
// kept in sight when the list scrolls.
export function SubmenuItemList({
  items,
  activeIndex,
  onActiveIndexChange,
  onChoose,
  itemRole,
}: {
  items: readonly ContextMenuSubmenuItem[];
  /** The highlighted action, counted without separators; null for none. */
  activeIndex: number | null;
  onActiveIndexChange: (index: number) => void;
  onChoose: (action: ContextMenuSubmenuAction) => void;
  /** "menuitem" inside an element with the menu role (a pull-down); buttons otherwise. */
  itemRole?: "menuitem" | undefined;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the active row is asked to show when it changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  let actionIndex = -1;
  return (
    <>
      {items.map((item) => {
        if (item.type === "separator") {
          return <div key={item.key} className="context-menu-separator" />;
        }
        actionIndex += 1;
        const index = actionIndex;
        const action = item.action;
        const checked = "checked" in action ? action.checked : null;
        const active = index === activeIndex;
        return (
          <button
            key={action.id}
            ref={active ? activeRef : undefined}
            type="button"
            role={checked === null ? itemRole : "menuitemradio"}
            aria-checked={checked ?? undefined}
            className={`context-submenu-item${active ? " active" : ""}`}
            onMouseEnter={() => onActiveIndexChange(index)}
            onClick={() => onChoose(action)}
          >
            {checked === null ? null : <MenuCheck checked={checked} />}
            {action.kind === "application" ? <AppIcon path={action.appPath} /> : null}
            <span className="context-submenu-item-label">{action.label}</span>
          </button>
        );
      })}
    </>
  );
}
