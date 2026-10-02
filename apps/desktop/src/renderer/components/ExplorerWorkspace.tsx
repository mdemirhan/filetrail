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
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { formatTooltip, getToolbarItemTooltip } from "../lib/tooltips";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { InfoPanel } from "./GetInfoPanel";
import { HistoryButton } from "./HistoryButton";
import { SearchOptionsMenu } from "./SearchOptionsMenu";
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
  // Nothing has been laid out yet (or there is no layout at all): keep the whole strip.
  if (itemWidths.some((itemWidth) => itemWidth <= 0)) {
    return itemWidths.length;
  }
  if (availableWidth <= 0) {
    return 0;
  }
  let usedWidth = 0;
  for (const [index, itemWidth] of itemWidths.entries()) {
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
  onSearchInputArrowDown,
  onClearSearchDraft,
  searchPatternMode,
  onSearchPatternModeChange,
  searchMatchScope,
  onSearchMatchScopeChange,
  searchRecursive,
  onSearchRecursiveChange,
  searchSkipGitFolders,
  onSearchSkipGitFoldersChange,
  searchSkipGitIgnored,
  onSearchSkipGitIgnoredChange,
  canRunRendererCommand,
  onRendererCommand,
  onPaneResizeKey,
  showSidebarRail = false,
  showSidebarBottomRail = true,
  toolbarTitle = "",
  toolbarSubtitle = "",
  tabStrip = null,
  clipboardButton = null,
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
  /** The row of tabs, while there is more than one. */
  tabStrip?: React.ReactNode;
  /** The clipboard button, while files or folders are waiting to be pasted. */
  clipboardButton?: React.ReactNode;
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
  onSearchInputArrowDown: () => void;
  onClearSearchDraft: () => void;
  searchPatternMode: SearchPatternMode;
  onSearchPatternModeChange: (value: SearchPatternMode) => void;
  searchMatchScope: SearchMatchScope;
  onSearchMatchScopeChange: (value: SearchMatchScope) => void;
  searchRecursive: boolean;
  onSearchRecursiveChange: (value: boolean) => void;
  searchSkipGitFolders: boolean;
  onSearchSkipGitFoldersChange: (value: boolean) => void;
  searchSkipGitIgnored: boolean;
  onSearchSkipGitIgnoredChange: (value: boolean) => void;
  canRunRendererCommand: (command: RendererCommandType) => boolean;
  onRendererCommand: (command: RendererCommandType) => void;
  onPaneResizeKey: (pane: "tree" | "inspector", event: ReactKeyboardEvent<HTMLDivElement>) => void;
  showSidebarRail?: boolean;
  showSidebarBottomRail?: boolean;
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
  useKeepInViewport(sortMenuRef, sortMenuOpen);
  useKeepInViewport(viewOptionsMenuRef, viewOptionsPosition !== null);
  const [sortMenuViewportPosition, setSortMenuViewportPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const toolbarMeasurementKey = trailingTopToolbarItems.join(":");
  // The toolbar is not on screen until preferences and pane widths are restored.
  const workspaceReady =
    preferencesReady &&
    (restoredPaneWidths === null ||
      (treeWidth === restoredPaneWidths.treeWidth &&
        inspectorWidth === restoredPaneWidths.inspectorWidth));
  const sortMenuResetKey = `${explorerToolbarLayout}:${visibleTopToolbarCount}`;

  // Measured again once the toolbar appears: a saved toolbar arrives before it does, and
  // would otherwise stay cut to the number of buttons in the default one.
  useLayoutEffect(() => {
    void toolbarMeasurementKey;
    void workspaceReady;
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
  }, [toolbarMeasurementKey, workspaceReady]);

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

  const shortcutDisplay = useShortcutDisplay();
  const goToShortcut = shortcutDisplay.label("openLocationSheet");
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
            label: "Go To…",
            ...(goToShortcut ? { shortcut: goToShortcut } : {}),
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
  const getToolbarTooltip = (itemId: ToolbarItemId) =>
    getToolbarItemTooltip(
      itemId,
      {
        foldersFirst: treePaneProps.foldersFirst,
        hiddenFilesShown: treePaneProps.includeHidden,
        infoPanelOpen,
        infoRowOpen: treePaneProps.infoRowOpen,
      },
      shortcutDisplay,
    );

  function renderTopToolbarItem(
    itemId: ToolbarItemId,
    mode: "interactive" | "measure" = "interactive",
  ) {
    if (itemId === "topSeparator") {
      return <div key={itemId} className="titlebar-divider" aria-hidden="true" />;
    }
    if (itemId === "back") {
      return (
        <HistoryButton
          key={itemId}
          className="tb-btn tb-btn-icon toolbar-btn-muted"
          label="Back"
          title={getToolbarTooltip(itemId)}
          disabled={!canGoBack}
          entries={treePaneProps.backHistory ?? []}
          interactive={mode === "interactive"}
          onStep={goBack}
          onSelectEntry={treePaneProps.onGoToHistoryIndex ?? (() => undefined)}
        >
          <ToolbarIcon name="back" />
        </HistoryButton>
      );
    }
    if (itemId === "forward") {
      return (
        <HistoryButton
          key={itemId}
          className="tb-btn tb-btn-icon toolbar-btn-muted"
          label="Forward"
          title={getToolbarTooltip(itemId)}
          disabled={!canGoForward}
          entries={treePaneProps.forwardHistory ?? []}
          interactive={mode === "interactive"}
          onStep={goForward}
          onSelectEntry={treePaneProps.onGoToHistoryIndex ?? (() => undefined)}
        >
          <ToolbarIcon name="forward" />
        </HistoryButton>
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
          aria-label="Enclosing Folder"
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
          aria-label="Open Selected Item"
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
              className={viewMode === "icons" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
              onClick={() => onViewModeChange("icons")}
              title={formatTooltip("View as Icons", shortcutDisplay.written("viewAsIcons"))}
              aria-label="Icon view"
            >
              <ToolbarIcon name="icons" />
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
              onClick={() => onViewModeChange("list")}
              title={formatTooltip("View as List", shortcutDisplay.written("viewAsList"))}
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
              title={formatTooltip("View as Details", shortcutDisplay.written("viewAsDetails"))}
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
            title={`Sort By: ${getSortByLabel(sortBy)}, ${
              sortDirection === "asc" ? "Ascending" : "Descending"
            }`}
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
                <SearchOptionsMenu
                  anchorRef={searchShellRef}
                  inputRef={searchInputRef}
                  interactive={mode === "interactive"}
                  patternMode={searchPatternMode}
                  onPatternModeChange={onSearchPatternModeChange}
                  matchScope={searchMatchScope}
                  onMatchScopeChange={onSearchMatchScopeChange}
                  recursive={searchRecursive}
                  onRecursiveChange={onSearchRecursiveChange}
                  skipGitFolders={searchSkipGitFolders}
                  onSkipGitFoldersChange={onSearchSkipGitFoldersChange}
                  skipGitIgnored={searchSkipGitIgnored}
                  onSkipGitIgnoredChange={onSearchSkipGitIgnoredChange}
                />
                <input
                  ref={searchInputRef}
                  className="toolbar-search-input"
                  type="text"
                  value={searchDraftQuery}
                  onFocus={onSearchInputFocus}
                  onChange={(event) => onSearchDraftQueryChange(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      onSearchInputArrowDown();
                      return;
                    }
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
                    title="Clear Search"
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
          title={getToolbarTooltip(itemId)}
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
          title={getToolbarTooltip(itemId)}
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
        title={getToolbarTooltip(itemId)}
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
    <header
      ref={toolbarRef}
      className="window-toolbar"
      style={{ gridColumn: "3 / -1", gridRow: "1" }}
    >
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
        {clipboardButton ? <div className="toolbar-clipboard">{clipboardButton}</div> : null}
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
      {!workspaceReady ? (
        <section className="workspace-body workspace-loading" />
      ) : (
        <section
          className="workspace-body tomorrow-night-layout"
          style={{
            gridTemplateColumns: `${treeWidth}px ${EXPLORER_LAYOUT.resizerWidth}px minmax(0, 1fr)${
              infoPanelOpen ? ` ${EXPLORER_LAYOUT.resizerWidth}px ${inspectorWidth}px` : ""
            }`,
            // Toolbar, tab strip (no height while there is a single view), panes.
            gridTemplateRows: "auto auto minmax(0, 1fr)",
          }}
        >
          <div className="workspace-sidebar-cell" style={{ gridColumn: "1", gridRow: "1 / -1" }}>
            <TreePane
              {...treePaneProps}
              showRail={showSidebarRail}
              showBottomRail={showSidebarBottomRail}
            />
          </div>
          <div
            className="pane-resizer pane-resizer-tree"
            style={{ gridColumn: "2", gridRow: "1 / -1" }}
            onPointerDown={beginResize("tree")}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize folders pane"
            onKeyDown={(event) => onPaneResizeKey("tree", event)}
          />
          {toolbar}
          {tabStrip}
          <div className="workspace-main-cell" style={{ gridColumn: "3", gridRow: "3" }}>
            <SearchWorkspace {...searchWorkspaceProps} />
          </div>
          {infoPanelOpen ? (
            <>
              <div
                className="pane-resizer"
                style={{ gridColumn: "4", gridRow: "3" }}
                onPointerDown={beginResize("inspector")}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize Info Panel pane"
                onKeyDown={(event) => onPaneResizeKey("inspector", event)}
              />
              <div className="workspace-inspector-cell" style={{ gridColumn: "5", gridRow: "3" }}>
                <InfoPanel {...infoPanelProps} />
              </div>
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}
