import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TabStyle } from "../../shared/appPreferences";
import type { ExplorerTabItem } from "../hooks/useExplorerTabs";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { formatTooltip } from "../lib/tooltips";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { ToolbarIcon } from "./ToolbarIcon";

// How far a tab is dragged before it starts moving along the row; less than that is a click.
const TAB_DRAG_THRESHOLD_PX = 6;

type TabMenuAction = "close" | "closeOthers" | "duplicate";

// The row of tabs under the toolbar. It is only shown while there is more than one tab.
export function TabStrip({
  tabs,
  tabStyle = "cards",
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onDuplicateTab,
  onMoveTab,
  onNewTab,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
  getDropIndicator,
}: {
  tabs: readonly ExplorerTabItem[];
  /** How the tabs are drawn (Settings → Appearance). */
  tabStyle?: TabStyle;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOtherTabs: (tabId: string) => void;
  onDuplicateTab: (tabId: string) => void;
  /** A tab was dragged over the place of another one. */
  onMoveTab: (tabId: string, toIndex: number) => void;
  onNewTab: () => void;
  /** Files dragged from the list or the search results, over a tab. */
  onItemDragOver?: (tab: ExplorerTabItem, event: React.DragEvent<HTMLElement>) => void;
  onItemDragLeave?: (tab: ExplorerTabItem) => void;
  onItemDrop?: (tab: ExplorerTabItem, event: React.DragEvent<HTMLElement>) => void;
  getDropIndicator?: (tabId: string) => "valid" | "invalid" | null;
}) {
  const shortcutDisplay = useShortcutDisplay();
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ tabId: string; startX: number; moving: boolean } | null>(null);
  // The click that ends a drag along the row must not also select the tab.
  const draggedRef = useRef(false);
  const [menu, setMenu] = useState<{ tabId: string; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useKeepInViewport(menuRef, menu !== null);

  // With more tabs than fit, the row scrolls: the tab on screen is kept in sight.
  const activeTabId = tabs.find((tab) => tab.active)?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: also when a tab is added or removed, which can move the active tab out of sight.
  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    if (activeTab && typeof activeTab.scrollIntoView === "function") {
      activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeTabId, tabs.length]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
      close();
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
  }, [menu]);

  // The place in the row the pointer is over, or -1 when it is outside the tabs.
  function resolveTabIndexAt(clientX: number): number {
    const elements = tabsRef.current?.querySelectorAll<HTMLElement>("[role='tab']") ?? [];
    for (const [index, element] of Array.from(elements).entries()) {
      const rect = element.getBoundingClientRect();
      if (clientX >= rect.left && clientX < rect.right) {
        return index;
      }
    }
    return -1;
  }

  function runMenuAction(action: TabMenuAction) {
    const tabId = menu?.tabId;
    setMenu(null);
    if (!tabId) {
      return;
    }
    if (action === "close") {
      onCloseTab(tabId);
    } else if (action === "closeOthers") {
      onCloseOtherTabs(tabId);
    } else {
      onDuplicateTab(tabId);
    }
  }

  return (
    <div
      className="tab-strip"
      data-tab-style={tabStyle}
      style={{ gridColumn: "3 / -1", gridRow: "2" }}
    >
      <div ref={tabsRef} className="tab-strip-tabs" role="tablist" aria-label="Tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-strip-tab${tab.active ? " active" : ""}`}
            role="tab"
            aria-selected={tab.active}
            tabIndex={-1}
            title={tab.tooltip}
            data-drop-target-state={getDropIndicator?.(tab.id) ?? "none"}
            // The click must not take the keyboard away from the file list.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (draggedRef.current) {
                draggedRef.current = false;
                return;
              }
              onSelectTab(tab.id);
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                onCloseTab(tab.id);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ tabId: tab.id, left: event.clientX, top: event.clientY });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              }
            }}
            // Dragging a tab along the row moves it to the place the pointer is over.
            onPointerDown={(event) => {
              if (event.button !== 0 || tabs.length < 2) {
                return;
              }
              if (event.target instanceof Element && event.target.closest(".tab-strip-close")) {
                return;
              }
              draggedRef.current = false;
              dragRef.current = { tabId: tab.id, startX: event.clientX, moving: false };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag) {
                return;
              }
              if (!drag.moving) {
                if (Math.abs(event.clientX - drag.startX) < TAB_DRAG_THRESHOLD_PX) {
                  return;
                }
                drag.moving = true;
                draggedRef.current = true;
              }
              const index = resolveTabIndexAt(event.clientX);
              if (index >= 0) {
                onMoveTab(drag.tabId, index);
              }
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              draggedRef.current = false;
            }}
            onDragEnter={(event) => onItemDragOver?.(tab, event)}
            onDragOver={(event) => onItemDragOver?.(tab, event)}
            onDragLeave={(event) => {
              // Moving between the tab and what is inside it is not leaving the tab.
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              ) {
                return;
              }
              onItemDragLeave?.(tab);
            }}
            onDrop={(event) => onItemDrop?.(tab, event)}
          >
            <button
              type="button"
              className="tab-strip-close"
              aria-label={`Close ${tab.label}`}
              title={formatTooltip("Close Tab", shortcutDisplay.written("closeTab"))}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <ToolbarIcon name="close" />
            </button>
            {tab.kind === "search" ? (
              <span
                className={`tab-strip-search${tab.searching ? " searching" : ""}`}
                aria-hidden="true"
              >
                <ToolbarIcon name="search" />
              </span>
            ) : null}
            <span className="tab-strip-label">{tab.label}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="tab-strip-new"
        aria-label="New Tab"
        title={formatTooltip("New Tab", shortcutDisplay.written("newTab"))}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onNewTab}
      >
        <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu tab-strip-menu"
              role="menu"
              aria-label="Tab"
              style={{ position: "fixed", left: `${menu.left}px`, top: `${menu.top}px` }}
            >
              {(
                [
                  ["close", "Close Tab"],
                  ["closeOthers", "Close Other Tabs"],
                  ["duplicate", "Duplicate Tab"],
                ] as const
              ).map(([action, label]) => (
                <button
                  key={action}
                  type="button"
                  className="toolbar-menu-item"
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runMenuAction(action)}
                >
                  <span className="toolbar-menu-label">{label}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
