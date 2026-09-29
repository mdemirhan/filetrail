import {
  type ComponentProps,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { IpcRequest } from "@filetrail/contracts";

import type { ExplorerViewMode } from "../../shared/appPreferences";
import type { RendererCommandType } from "../../shared/rendererCommands";
import { type ToolbarItemId, getToolbarItemDefinition } from "../../shared/toolbarItems";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { InfoPanel } from "./GetInfoPanel";
import { SearchWorkspace } from "./SearchWorkspace";
import { ToolbarIcon } from "./ToolbarIcon";
import { TreePane } from "./TreePane";

type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type TreePaneProps = ComponentProps<typeof TreePane>;
type SearchWorkspaceProps = ComponentProps<typeof SearchWorkspace>;
type InfoPanelProps = ComponentProps<typeof InfoPanel>;
const TOP_TOOLBAR_ITEM_GAP_PX = 4;

function formatToolbarTooltip(label: string, shortcutLabel?: string) {
  return shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

function getSortByLabel(sortBy: SortBy) {
  if (sortBy === "size") {
    return "Size";
  }
  if (sortBy === "modified") {
    return "Date Modified";
  }
  if (sortBy === "kind") {
    return "Kind";
  }
  return "Name";
}

export function resolveVisibleTopToolbarCount(
  itemWidths: readonly number[],
  availableWidth: number,
  gapPx = TOP_TOOLBAR_ITEM_GAP_PX,
) {
  if (availableWidth <= 0) {
    return 0;
  }
  let usedWidth = 0;
  for (const [index, itemWidth] of itemWidths.entries()) {
    if (itemWidth <= 0) {
      return itemWidths.length;
    }
    const nextWidth = usedWidth === 0 ? itemWidth : usedWidth + gapPx + itemWidth;
    if (nextWidth > availableWidth) {
      return index;
    }
    usedWidth = nextWidth;
  }
  return itemWidths.length;
}

export function normalizeTopToolbarItems(items: readonly ToolbarItemId[]) {
  const normalized: ToolbarItemId[] = [];
  for (const itemId of items) {
    if (itemId !== "topSeparator") {
      normalized.push(itemId);
      continue;
    }
    if (normalized.length === 0 || normalized.at(-1) === "topSeparator") {
      continue;
    }
    normalized.push(itemId);
  }
  if (normalized.at(-1) === "topSeparator") {
    normalized.pop();
  }
  return normalized;
}

const LEADING_TOOLBAR_ITEM_IDS = new Set<ToolbarItemId>(["back", "forward"]);

// Back/forward sit before the folder title like Finder; everything else is right-aligned.
export function splitLeadingToolbarItems(items: readonly ToolbarItemId[]) {
  let leadingCount = 0;
  while (leadingCount < items.length) {
    const itemId = items[leadingCount];
    if (itemId === undefined || !LEADING_TOOLBAR_ITEM_IDS.has(itemId)) {
      break;
    }
    leadingCount += 1;
  }
  return {
    leading: items.slice(0, leadingCount),
    trailing: normalizeTopToolbarItems(items.slice(leadingCount)),
  };
}

type ViewOptionsMenuItem =
  | { kind: "toggle"; id: string; label: string; checked: boolean; onSelect: () => void }
  | { kind: "action"; id: string; label: string; shortcut?: string; onSelect: () => void }
  | { kind: "separator"; id: string };

export function ExplorerWorkspace({
  preferencesReady,
  restoredPaneWidths,
  treeWidth,
  inspectorWidth,
  beginResize,
  infoPanelOpen,
  toolbarRef,
  treePaneProps,
  searchWorkspaceProps,
  infoPanelProps,
  currentPath,
  topToolbarItems,
  explorerToolbarLayout,
  canGoBack,
  canGoForward,
  focusedPane,
  selectedEntryExists,
  goBack,
  goForward,
  navigateToParentFolder,
  navigateDownAction,
  refreshDirectory,
  viewMode,
  onViewModeChange,
  sortBy,
  sortDirection,
  onSortChange,
  searchShellRef,
  searchPopoverOpen,
  onSearchShellBlur,
  searchPointerIntentRef,
  onSearchShellPointerIntent,
  onSearchSubmit,
  searchInputRef,
  searchDraftQuery,
  onSearchInputFocus,
  onSearchDraftQueryChange,
  onSearchInputEscape,
  onClearSearchDraft,
  searchPatternMode,
  onSearchPatternModeChange,
  searchMatchScope,
  onSearchMatchScopeChange,
  searchRecursive,
  onSearchRecursiveChange,
  searchIncludeHidden,
  onSearchIncludeHiddenChange,
  canRunRendererCommand,
  onRendererCommand,
  onPaneResizeKey,
  showSidebarRail = true,
  toolbarTitle = "",
  toolbarSubtitle = "",
}: {
  preferencesReady: boolean;
  restoredPaneWidths: { treeWidth: number; inspectorWidth: number } | null;
  treeWidth: number;
  inspectorWidth: number;
  beginResize: (pane: "tree" | "inspector") => (event: React.PointerEvent<HTMLDivElement>) => void;
  infoPanelOpen: boolean;
  toolbarRef: React.RefObject<HTMLElement | null>;
  treePaneProps: TreePaneProps;
  searchWorkspaceProps: SearchWorkspaceProps;
  infoPanelProps: InfoPanelProps;
  currentPath: string;
  topToolbarItems: ToolbarItemId[];
  explorerToolbarLayout: string;
  canGoBack: boolean;
  canGoForward: boolean;
  focusedPane: "tree" | "content" | null;
  selectedEntryExists: boolean;
  goBack: () => void;
  goForward: () => void;
  navigateToParentFolder: () => void;
  navigateDownAction: () => void;
  refreshDirectory: () => Promise<void>;
  viewMode: ExplorerViewMode;
  onViewModeChange: (value: ExplorerViewMode) => void;
  sortBy: SortBy;
  sortDirection: "asc" | "desc";
  onSortChange: (value: SortBy) => void;
  searchShellRef: React.RefObject<HTMLDivElement | null>;
  searchPopoverOpen: boolean;
  onSearchShellBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  searchPointerIntentRef: MutableRefObject<boolean>;
  onSearchShellPointerIntent: () => void;
  onSearchSubmit: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchDraftQuery: string;
  onSearchInputFocus: () => void;
  onSearchDraftQueryChange: (value: string) => void;
  onSearchInputEscape: () => void;
  onClearSearchDraft: () => void;
  searchPatternMode: SearchPatternMode;
  onSearchPatternModeChange: (value: SearchPatternMode) => void;
  searchMatchScope: SearchMatchScope;
  onSearchMatchScopeChange: (value: SearchMatchScope) => void;
  searchRecursive: boolean;
  onSearchRecursiveChange: (value: boolean) => void;
  searchIncludeHidden: boolean;
  onSearchIncludeHiddenChange: (value: boolean) => void;
  canRunRendererCommand: (command: RendererCommandType) => boolean;
  onRendererCommand: (command: RendererCommandType) => void;
  onPaneResizeKey: (pane: "tree" | "inspector", event: ReactKeyboardEvent<HTMLDivElement>) => void;
  showSidebarRail?: boolean;
  toolbarTitle?: string;
  toolbarSubtitle?: string;
}) {
  const titlebarActionsMainRef = useRef<HTMLDivElement | null>(null);
  const titlebarActionsMeasureRef = useRef<HTMLDivElement | null>(null);
  const sortMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const baseTopToolbarItems = useMemo(
    () =>
      topToolbarItems.filter(
        (itemId) =>
          itemId !== "search" &&
          (explorerToolbarLayout !== "minimal" ||
            getToolbarItemDefinition(itemId).topVisibleInMinimal !== false),
      ),
    [explorerToolbarLayout, topToolbarItems],
  );
  const { leading: leadingTopToolbarItems, trailing: trailingTopToolbarItems } = useMemo(
    () => splitLeadingToolbarItems(baseTopToolbarItems),
    [baseTopToolbarItems],
  );
  const [visibleTopToolbarCount, setVisibleTopToolbarCount] = useState(
    trailingTopToolbarItems.length,
  );
  const viewOptionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewOptionsPosition, setViewOptionsPosition] = useState<{
    right: number;
    top: number;
  } | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuViewportPosition, setSortMenuViewportPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const toolbarMeasurementKey = trailingTopToolbarItems.join(":");
  const sortMenuResetKey = `${explorerToolbarLayout}:${visibleTopToolbarCount}`;

  useLayoutEffect(() => {
    void toolbarMeasurementKey;
    const mainContainer = titlebarActionsMainRef.current;
    const measureContainer = titlebarActionsMeasureRef.current;
    if (
      !(mainContainer instanceof HTMLDivElement) ||
      !(measureContainer instanceof HTMLDivElement)
    ) {
      return;
    }

    const updateVisibleCount = () => {
      const itemWidths = Array.from(
        measureContainer.querySelectorAll<HTMLElement>("[data-top-toolbar-item]"),
      ).map((item) => Math.ceil(item.getBoundingClientRect().width));
      const nextVisibleCount = resolveVisibleTopToolbarCount(
        itemWidths,
        Math.floor(mainContainer.clientWidth),
      );
      setVisibleTopToolbarCount((currentCount) =>
        currentCount === nextVisibleCount ? currentCount : nextVisibleCount,
      );
    };

    updateVisibleCount();
    const observer = new ResizeObserver(() => {
      updateVisibleCount();
    });
    observer.observe(mainContainer);
    observer.observe(measureContainer);
    return () => {
      observer.disconnect();
    };
  }, [toolbarMeasurementKey]);

  useLayoutEffect(() => {
    if (!sortMenuOpen) {
      setSortMenuViewportPosition(null);
      return;
    }
    const updateSortMenuPosition = () => {
      const button = sortMenuButtonRef.current;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const menuWidth = 200;
      setSortMenuViewportPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12)),
        top: rect.bottom + 8,
      });
    };
    updateSortMenuPosition();
    window.addEventListener("resize", updateSortMenuPosition);
    window.addEventListener("scroll", updateSortMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateSortMenuPosition);
      window.removeEventListener("scroll", updateSortMenuPosition, true);
    };
  }, [sortMenuOpen]);

  useEffect(() => {
    if (!sortMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (sortMenuRef.current?.contains(target) || sortMenuButtonRef.current?.contains(target)) {
        return;
      }
      setSortMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [sortMenuOpen]);

  useEffect(() => {
    void sortMenuResetKey;
    setSortMenuOpen(false);
  }, [sortMenuResetKey]);

  const visibleTopToolbarItems = useMemo(
    () => normalizeTopToolbarItems(trailingTopToolbarItems.slice(0, visibleTopToolbarCount)),
    [trailingTopToolbarItems, visibleTopToolbarCount],
  );

  useEffect(() => {
    if (!viewOptionsPosition) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (viewOptionsMenuRef.current?.contains(target) ||
          viewOptionsButtonRef.current?.contains(target))
      ) {
        return;
      }
      setViewOptionsPosition(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewOptionsPosition(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewOptionsPosition]);

  const viewOptionsItems: ViewOptionsMenuItem[] = [
    {
      kind: "toggle",
      id: "infoPanel",
      label: "Show Info Panel",
      checked: infoPanelOpen,
      onSelect: treePaneProps.onToggleInfoPanel,
    },
    {
      kind: "toggle",
      id: "infoRow",
      label: "Show Info Row",
      checked: treePaneProps.infoRowOpen,
      onSelect: treePaneProps.onToggleInfoRow,
    },
    { kind: "separator", id: "separator-1" },
    {
      kind: "toggle",
      id: "foldersFirst",
      label: "Keep Folders on Top",
      checked: treePaneProps.foldersFirst,
      onSelect: treePaneProps.onToggleFoldersFirst,
    },
    {
      kind: "toggle",
      id: "hidden",
      label: "Show Hidden Files",
      checked: treePaneProps.includeHidden,
      onSelect: treePaneProps.onToggleHidden,
    },
    { kind: "separator", id: "separator-2" },
    ...(treePaneProps.onOpenLocation
      ? [
          {
            kind: "action" as const,
            id: "goToFolder",
            label: "Go to Folder…",
            shortcut: "⇧⌘G",
            onSelect: treePaneProps.onOpenLocation,
          },
        ]
      : []),
    {
      kind: "action",
      id: "rerootHome",
      label: "Show Home in Folder Tree",
      onSelect: treePaneProps.onRerootHome,
    },
  ];

  function renderViewOptions() {
    return (
      <div className="toolbar-view-options">
        <button
          ref={viewOptionsButtonRef}
          type="button"
          className={`tb-btn tb-btn-icon${viewOptionsPosition ? " active" : ""}`}
          title="View Options"
          aria-label="View options"
          aria-haspopup="menu"
          aria-expanded={viewOptionsPosition !== null}
          onClick={() => {
            if (viewOptionsPosition) {
              setViewOptionsPosition(null);
              return;
            }
            const rect = viewOptionsButtonRef.current?.getBoundingClientRect();
            if (!rect) {
              return;
            }
            setViewOptionsPosition({
              right: Math.max(8, window.innerWidth - rect.right),
              top: rect.bottom + 6,
            });
          }}
        >
          <ToolbarIcon name="more" />
        </button>
        {viewOptionsPosition
          ? createPortal(
              <div
                ref={viewOptionsMenuRef}
                className="toolbar-menu"
                role="menu"
                aria-label="View options"
                style={{
                  position: "fixed",
                  right: `${viewOptionsPosition.right}px`,
                  top: `${viewOptionsPosition.top}px`,
                }}
              >
                {viewOptionsItems.map((item) =>
                  item.kind === "separator" ? (
                    <hr key={item.id} className="toolbar-menu-separator" />
                  ) : (
                    <button
                      key={item.id}
                      type="button"
                      className="toolbar-menu-item"
                      role={item.kind === "toggle" ? "menuitemcheckbox" : "menuitem"}
                      aria-checked={item.kind === "toggle" ? item.checked : undefined}
                      onClick={() => {
                        setViewOptionsPosition(null);
                        item.onSelect();
                      }}
                    >
                      <span className="toolbar-menu-check" aria-hidden="true">
                        {item.kind === "toggle" && item.checked ? "✓" : ""}
                      </span>
                      <span className="toolbar-menu-label">{item.label}</span>
                      {item.kind === "action" && item.shortcut ? (
                        <span className="toolbar-menu-shortcut">{item.shortcut}</span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }
  const getToolbarTooltip = (itemId: ToolbarItemId, labelOverride?: string) => {
    const definition = getToolbarItemDefinition(itemId);
    return formatToolbarTooltip(labelOverride ?? definition.label, definition.shortcutLabel);
  };

  function renderTopToolbarItem(
    itemId: ToolbarItemId,
    mode: "interactive" | "measure" = "interactive",
  ) {
    if (itemId === "topSeparator") {
      return <div key={itemId} className="titlebar-divider" aria-hidden="true" />;
    }
    if (itemId === "back") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon toolbar-btn-muted"
          disabled={!canGoBack}
          onClick={goBack}
          title={getToolbarTooltip(itemId)}
          aria-label="Back"
        >
          <ToolbarIcon name="back" />
        </button>
      );
    }
    if (itemId === "forward") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon toolbar-btn-muted"
          disabled={!canGoForward}
          onClick={goForward}
          title={getToolbarTooltip(itemId)}
          aria-label="Forward"
        >
          <ToolbarIcon name="forward" />
        </button>
      );
    }
    if (itemId === "up") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          disabled={!parentDirectoryPath(currentPath)}
          onClick={navigateToParentFolder}
          title={getToolbarTooltip(itemId)}
          aria-label="Navigate Up"
        >
          <ToolbarIcon name="up" />
        </button>
      );
    }
    if (itemId === "down") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          disabled={focusedPane !== "tree" && !selectedEntryExists}
          onClick={navigateDownAction}
          title={getToolbarTooltip(itemId)}
          aria-label="Navigate Down"
        >
          <ToolbarIcon name="down" />
        </button>
      );
    }
    if (itemId === "view") {
      return (
        <div key={itemId} className="toolbar-group toolbar-group-view">
          <fieldset className="toolbar-segmented toolbar-segmented-native">
            <legend className="sr-only">View mode</legend>
            <button
              type="button"
              className={viewMode === "list" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
              onClick={() => onViewModeChange("list")}
              title="List view"
              aria-label="List view"
            >
              <ToolbarIcon name="list" />
            </button>
            <button
              type="button"
              className={
                viewMode === "details" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
              }
              onClick={() => onViewModeChange("details")}
              title="Details view"
              aria-label="Details view"
            >
              <ToolbarIcon name="details" />
            </button>
          </fieldset>
        </div>
      );
    }
    if (itemId === "sort") {
      // One icon button opening a menu of sort fields and direction, like Finder's
      // "Sort By" toolbar item. Choosing the active field again reverses the direction.
      const sortMenu =
        mode === "interactive" && sortMenuOpen && sortMenuViewportPosition
          ? createPortal(
              <div
                ref={sortMenuRef}
                className="toolbar-menu toolbar-sort-menu"
                role="menu"
                style={{
                  position: "fixed",
                  left: `${sortMenuViewportPosition.left}px`,
                  top: `${sortMenuViewportPosition.top}px`,
                }}
              >
                {(["name", "kind", "modified", "size"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="toolbar-menu-item"
                    onClick={() => {
                      if (value !== sortBy) {
                        onSortChange(value);
                      }
                      setSortMenuOpen(false);
                    }}
                    role="menuitemradio"
                    aria-checked={sortBy === value}
                  >
                    <span className="toolbar-menu-check" aria-hidden="true">
                      {sortBy === value ? "✓" : ""}
                    </span>
                    <span className="toolbar-menu-label">{getSortByLabel(value)}</span>
                  </button>
                ))}
                <hr className="toolbar-menu-separator" />
                {(["asc", "desc"] as const).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    className="toolbar-menu-item"
                    onClick={() => {
                      if (direction !== sortDirection) {
                        onSortChange(sortBy);
                      }
                      setSortMenuOpen(false);
                    }}
                    role="menuitemradio"
                    aria-checked={sortDirection === direction}
                  >
                    <span className="toolbar-menu-check" aria-hidden="true">
                      {sortDirection === direction ? "✓" : ""}
                    </span>
                    <span className="toolbar-menu-label">
                      {direction === "asc" ? "Ascending" : "Descending"}
                    </span>
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null;
      return (
        <div key={itemId} className="toolbar-group">
          <button
            ref={mode === "interactive" ? sortMenuButtonRef : undefined}
            type="button"
            className={`tb-btn tb-btn-icon${sortMenuOpen ? " active" : ""}`}
            onClick={mode === "interactive" ? () => setSortMenuOpen((value) => !value) : undefined}
            tabIndex={mode === "interactive" ? undefined : -1}
            title={`Sort by ${getSortByLabel(sortBy)} (${
              sortDirection === "asc" ? "ascending" : "descending"
            })`}
            aria-label="Sort by"
            aria-haspopup="menu"
            aria-expanded={sortMenuOpen}
          >
            <ToolbarIcon name="sort" />
          </button>
          {sortMenu}
        </div>
      );
    }
    if (itemId === "search") {
      return (
        <div key={itemId} className="toolbar-search-slot">
          <div
            ref={searchShellRef}
            className={`toolbar-search-shell${searchPopoverOpen ? " active" : ""}`}
            onBlurCapture={onSearchShellBlur}
          >
            <form
              className="toolbar-search"
              aria-label="Find files in current folder"
              onMouseDownCapture={(event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                  return;
                }
                if (target.closest(".toolbar-search-clear") !== null) {
                  return;
                }
                searchPointerIntentRef.current = true;
                onSearchShellPointerIntent();
              }}
              onSubmit={(event) => {
                event.preventDefault();
                onSearchSubmit();
              }}
            >
              <div className="toolbar-search-row">
                <span className="toolbar-search-icon">
                  <ToolbarIcon name="search" />
                </span>
                <input
                  ref={searchInputRef}
                  className="toolbar-search-input"
                  type="text"
                  value={searchDraftQuery}
                  onFocus={onSearchInputFocus}
                  onChange={(event) => onSearchDraftQueryChange(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    onSearchInputEscape();
                  }}
                  placeholder="Search"
                  spellCheck={false}
                />
                {searchDraftQuery.trim().length > 0 ? (
                  <button
                    type="button"
                    className="toolbar-search-clear"
                    aria-label="Clear file search"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={onClearSearchDraft}
                  >
                    <ToolbarIcon name="close" />
                  </button>
                ) : null}
              </div>
            </form>
            {searchPopoverOpen ? (
              <div className="toolbar-search-popover">
                <div className="toolbar-search-options">
                  <div className="toolbar-search-option-row toolbar-search-option-row-primary">
                    <label className="toolbar-search-listbox">
                      <span className="toolbar-search-listbox-label">Pattern</span>
                      <select
                        className="toolbar-search-select"
                        value={searchPatternMode}
                        onChange={(event) =>
                          onSearchPatternModeChange(event.currentTarget.value as SearchPatternMode)
                        }
                        aria-label="Search pattern mode"
                      >
                        <option value="regex">Regex</option>
                        <option value="glob">Glob</option>
                      </select>
                    </label>
                    <label className="toolbar-search-listbox">
                      <span className="toolbar-search-listbox-label">Match</span>
                      <select
                        className="toolbar-search-select"
                        value={searchMatchScope}
                        onChange={(event) =>
                          onSearchMatchScopeChange(event.currentTarget.value as SearchMatchScope)
                        }
                        aria-label="Search match scope"
                      >
                        <option value="name">Name</option>
                        <option value="path">Path</option>
                      </select>
                    </label>
                  </div>
                  <div className="toolbar-search-option-row toolbar-search-option-row-secondary">
                    <button
                      type="button"
                      className={
                        searchRecursive ? "toolbar-search-pill active" : "toolbar-search-pill"
                      }
                      onClick={() => onSearchRecursiveChange(!searchRecursive)}
                      aria-pressed={searchRecursive}
                    >
                      Recursive
                    </button>
                    <button
                      type="button"
                      className={
                        searchIncludeHidden ? "toolbar-search-pill active" : "toolbar-search-pill"
                      }
                      onClick={() => onSearchIncludeHiddenChange(!searchIncludeHidden)}
                      aria-pressed={searchIncludeHidden}
                    >
                      Hidden
                    </button>
                  </div>
                  <div className="toolbar-search-meta">
                    <span className="toolbar-search-status">Press Enter to search</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (itemId === "home") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          onClick={treePaneProps.onGoHome}
          title={getToolbarTooltip(itemId)}
          aria-label="Home"
        >
          <ToolbarIcon name="home" />
        </button>
      );
    }
    if (itemId === "root" || itemId === "applications" || itemId === "trash") {
      const location =
        itemId === "root" ? "root" : itemId === "applications" ? "applications" : "trash";
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          onClick={() => treePaneProps.onQuickAccess(location)}
          title={getToolbarTooltip(itemId)}
          aria-label={getToolbarItemDefinition(itemId).label}
        >
          <ToolbarIcon name={getToolbarItemDefinition(itemId).icon} />
        </button>
      );
    }
    if (itemId === "rerootHome") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          onClick={treePaneProps.onRerootHome}
          title={getToolbarTooltip(itemId)}
          aria-label="Root tree at Home"
        >
          <ToolbarIcon name="rerootHome" />
        </button>
      );
    }
    if (itemId === "foldersFirst") {
      return (
        <button
          key={itemId}
          type="button"
          className={
            treePaneProps.foldersFirst ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
          }
          onClick={treePaneProps.onToggleFoldersFirst}
          title={treePaneProps.foldersFirst ? "Folders first" : "Mixed file and folder order"}
          aria-label="Toggle folders first"
          aria-pressed={treePaneProps.foldersFirst}
        >
          <ToolbarIcon name="foldersFirst" />
        </button>
      );
    }
    if (itemId === "hidden") {
      return (
        <button
          key={itemId}
          type="button"
          className={
            treePaneProps.includeHidden ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
          }
          onClick={treePaneProps.onToggleHidden}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle hidden files"
          aria-pressed={treePaneProps.includeHidden}
        >
          <ToolbarIcon name="hidden" />
        </button>
      );
    }
    if (itemId === "infoPanel") {
      return (
        <button
          key={itemId}
          type="button"
          className={infoPanelOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={treePaneProps.onToggleInfoPanel}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle Info Panel"
          aria-pressed={infoPanelOpen}
        >
          <ToolbarIcon name="drawer" />
        </button>
      );
    }
    if (itemId === "infoRow") {
      return (
        <button
          key={itemId}
          type="button"
          className={treePaneProps.infoRowOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={treePaneProps.onToggleInfoRow}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle Info Row"
          aria-pressed={treePaneProps.infoRowOpen}
        >
          <ToolbarIcon name="infoRow" />
        </button>
      );
    }
    if (itemId === "help") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          onClick={treePaneProps.onOpenHelp}
          title="Help"
          aria-label="Help"
        >
          <ToolbarIcon name="help" />
        </button>
      );
    }

    const definition = getToolbarItemDefinition(itemId);
    const commandType = definition.commandType;
    if (!commandType) {
      return null;
    }
    return (
      <button
        key={itemId}
        type="button"
        className="tb-btn tb-btn-icon"
        disabled={!canRunRendererCommand(commandType)}
        onClick={() => onRendererCommand(commandType)}
        title={formatToolbarTooltip(definition.label, definition.shortcutLabel)}
        aria-label={definition.label}
      >
        <ToolbarIcon name={definition.icon} />
      </button>
    );
  }

  function renderTopToolbarActionItem(itemId: ToolbarItemId, key: string) {
    return (
      <div key={key} className="titlebar-action-item" data-top-toolbar-item={itemId}>
        {renderTopToolbarItem(itemId)}
      </div>
    );
  }

  function renderMeasuredTopToolbarActionItem(itemId: ToolbarItemId, key: string) {
    return (
      <div key={key} className="titlebar-action-item" data-top-toolbar-item={itemId}>
        {renderTopToolbarItem(itemId, "measure")}
      </div>
    );
  }

  const toolbar = (
    <header ref={toolbarRef} className="window-toolbar" style={{ gridColumn: "3 / -1" }}>
      {leadingTopToolbarItems.length > 0 ? (
        <div className="toolbar-leading">
          {leadingTopToolbarItems.map((itemId, index) =>
            renderTopToolbarActionItem(itemId, `${itemId}-leading-${index}`),
          )}
        </div>
      ) : null}
      <div className="toolbar-title-block">
        <span className="toolbar-title" title={currentPath}>
          {toolbarTitle}
        </span>
        {toolbarSubtitle ? <span className="toolbar-subtitle">{toolbarSubtitle}</span> : null}
      </div>
      <div className="titlebar-actions" data-layout={explorerToolbarLayout}>
        <div ref={titlebarActionsMainRef} className="titlebar-actions-main">
          {visibleTopToolbarItems.map((itemId, index) =>
            renderTopToolbarActionItem(itemId, `${itemId}-${index}`),
          )}
        </div>
        {showSidebarRail ? null : renderViewOptions()}
        {renderTopToolbarItem("search")}
        <div
          ref={titlebarActionsMeasureRef}
          className="titlebar-actions-measure"
          aria-hidden="true"
        >
          {trailingTopToolbarItems.map((itemId, index) =>
            renderMeasuredTopToolbarActionItem(itemId, `${itemId}-measure-${index}`),
          )}
        </div>
      </div>
    </header>
  );

  return (
    <section className="workspace explorer-workspace">
      {!preferencesReady ||
      (restoredPaneWidths !== null &&
        (treeWidth !== restoredPaneWidths.treeWidth ||
          inspectorWidth !== restoredPaneWidths.inspectorWidth)) ? (
        <section className="workspace-body workspace-loading" />
      ) : (
        <section
          className="workspace-body tomorrow-night-layout"
          style={{
            gridTemplateColumns: `${treeWidth}px ${EXPLORER_LAYOUT.resizerWidth}px minmax(0, 1fr)${
              infoPanelOpen ? ` ${EXPLORER_LAYOUT.resizerWidth}px ${inspectorWidth}px` : ""
            }`,
            gridTemplateRows: "auto minmax(0, 1fr)",
          }}
        >
          <div className="workspace-sidebar-cell" style={{ gridColumn: "1", gridRow: "1 / -1" }}>
            <TreePane {...treePaneProps} showRail={showSidebarRail} />
          </div>
          <div
            className="pane-resizer"
            style={{ gridColumn: "2", gridRow: "1 / -1" }}
            onPointerDown={beginResize("tree")}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize folders pane"
            onKeyDown={(event) => onPaneResizeKey("tree", event)}
          />
          {toolbar}
          <div className="workspace-main-cell" style={{ gridColumn: "3", gridRow: "2" }}>
            <SearchWorkspace {...searchWorkspaceProps} />
          </div>
          {infoPanelOpen ? (
            <>
              <div
                className="pane-resizer"
                style={{ gridColumn: "4", gridRow: "2" }}
                onPointerDown={beginResize("inspector")}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize Info Panel pane"
                onKeyDown={(event) => onPaneResizeKey("inspector", event)}
              />
              <div className="workspace-inspector-cell" style={{ gridColumn: "5", gridRow: "2" }}>
                <InfoPanel {...infoPanelProps} />
              </div>
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}
