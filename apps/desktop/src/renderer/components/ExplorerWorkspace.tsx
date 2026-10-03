import {
  type ComponentProps,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { IpcRequest } from "@filetrail/contracts";

import type { ExplorerViewMode, ThemePreference } from "../../shared/appPreferences";
import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ShortcutCommandId } from "../../shared/shortcuts";
import {
  type ToolbarItemId,
  getToolbarItemDefinition,
  isRequiredTopToolbarItem,
  sanitizeTopToolbarItems,
} from "../../shared/toolbarItems";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import type { HistoryMenuEntry } from "../lib/historyMenu";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { placeDropdownMenu } from "../lib/menuPlacement";
import { PANE_LAYOUT_CHANGE_MS, PaneLayoutChangeContext } from "../lib/paneLayoutChange";
import { formatTooltip, getToolbarItemTooltip } from "../lib/tooltips";
import {
  type TopToolbarSlot,
  resolveToolbarCapsules,
  resolveTopToolbarSlots,
  resolveVisibleOptionalCount,
  selectTopToolbarSlots,
} from "../lib/topToolbarLayout";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { InfoPanel } from "./GetInfoPanel";
import { HistoryButton } from "./HistoryButton";
import { MenuCheck } from "./MenuCheck";
import { SearchOptionsMenu } from "./SearchOptionsMenu";
import { SearchWorkspace } from "./SearchWorkspace";
import { ThemeMenuButton } from "./ThemeMenuButton";
import { ToolbarIcon } from "./ToolbarIcon";
import { TreePane } from "./TreePane";

type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type TreePaneProps = ComponentProps<typeof TreePane>;
type SearchWorkspaceProps = ComponentProps<typeof SearchWorkspace>;
type InfoPanelProps = ComponentProps<typeof InfoPanel>;

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

// `command` is the shortcut command the item stands for; its key is shown beside the label.
type ViewOptionsMenuItem =
  | {
      kind: "toggle";
      id: string;
      label: string;
      command: ShortcutCommandId;
      checked: boolean;
      onSelect: () => void;
    }
  | { kind: "action"; id: string; label: string; command?: ShortcutCommandId; onSelect: () => void }
  | { kind: "separator"; id: string };

export function ExplorerWorkspace({
  preferencesReady,
  restoredPaneWidths,
  treeWidth,
  inspectorWidth,
  beginResize,
  infoPanelOpen,
  treePaneProps,
  searchWorkspaceProps,
  infoPanelProps,
  currentPath,
  topToolbarItems,
  canGoBack,
  canGoForward,
  backHistory = [],
  forwardHistory = [],
  onGoToHistoryIndex = () => undefined,
  focusedPane,
  selectedEntryExists,
  goBack,
  goForward,
  navigateToParentFolder,
  refreshDirectory,
  viewMode,
  onViewModeChange,
  sortBy,
  sortDirection,
  onSortChange,
  foldersFirst = false,
  onToggleFoldersFirst = () => undefined,
  includeHidden = false,
  onToggleHidden = () => undefined,
  onToggleInfoPanel = () => undefined,
  infoRowOpen = false,
  onToggleInfoRow = () => undefined,
  theme = "auto",
  onSelectTheme = () => undefined,
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
  onCustomizeToolbar,
  onPaneResizeKey,
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
  treePaneProps: TreePaneProps;
  searchWorkspaceProps: SearchWorkspaceProps;
  infoPanelProps: InfoPanelProps;
  currentPath: string;
  topToolbarItems: ToolbarItemId[];
  canGoBack: boolean;
  canGoForward: boolean;
  /** The folders Back and Forward lead to, nearest first, for their hold menus. */
  backHistory?: HistoryMenuEntry[];
  forwardHistory?: HistoryMenuEntry[];
  onGoToHistoryIndex?: (historyIndex: number) => void;
  focusedPane: "tree" | "content" | null;
  selectedEntryExists: boolean;
  goBack: () => void;
  goForward: () => void;
  navigateToParentFolder: () => void;
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
  foldersFirst?: boolean;
  onToggleFoldersFirst?: () => void;
  includeHidden?: boolean;
  onToggleHidden?: () => void;
  onToggleInfoPanel?: () => void;
  infoRowOpen?: boolean;
  onToggleInfoRow?: () => void;
  theme?: ThemePreference;
  onSelectTheme?: (theme: ThemePreference) => void;
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
  /** Opens Settings where the toolbar is arranged. */
  onCustomizeToolbar: () => void;
  onPaneResizeKey: (pane: "tree" | "inspector", event: ReactKeyboardEvent<HTMLDivElement>) => void;
  toolbarTitle?: string;
  toolbarSubtitle?: string;
}) {
  const toolbarRef = useRef<HTMLElement | null>(null);
  const toolbarRowRef = useRef<HTMLDivElement | null>(null);
  const sortMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const clipboardShown = clipboardButton !== null && clipboardButton !== undefined;
  // The toolbar's items in their saved order. One of the required ones is not always there:
  // the clipboard button, which shows only while something waits to be pasted.
  const topToolbarSlots = useMemo(
    () =>
      resolveTopToolbarSlots(sanitizeTopToolbarItems(topToolbarItems)).filter(
        (slot) => slot.id !== "clipboard" || clipboardShown,
      ),
    [clipboardShown, topToolbarItems],
  );
  const optionalTopToolbarSlots = useMemo(
    () => topToolbarSlots.filter((slot) => !isRequiredTopToolbarItem(slot.id)),
    [topToolbarSlots],
  );
  const [visibleOptionalCount, setVisibleOptionalCount] = useState(optionalTopToolbarSlots.length);
  const viewOptionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewOptionsMenuStyle, setViewOptionsMenuStyle] = useState<ReturnType<
    typeof placeDropdownMenu
  > | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  useKeepInViewport(sortMenuRef, sortMenuOpen);
  useKeepInViewport(viewOptionsMenuRef, viewOptionsMenuStyle !== null);
  const [sortMenuViewportPosition, setSortMenuViewportPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // The toolbar is not on screen until preferences and pane widths are restored.
  const workspaceReady =
    preferencesReady &&
    (restoredPaneWidths === null ||
      (treeWidth === restoredPaneWidths.treeWidth &&
        inspectorWidth === restoredPaneWidths.inspectorWidth));

  // Opening or closing the Info panel changes the content pane's width in one step; the panel
  // slides in over the space it takes, or out over the content, and icon view moves its
  // items to their new places (see PaneLayoutChangeContext). A closing panel stays on screen,
  // out of reach, until it has slid away.
  const [infoPanelChange, setInfoPanelChange] = useState({
    open: infoPanelOpen,
    count: 0,
    slide: null as "in" | "out" | null,
  });
  if (infoPanelChange.open !== infoPanelOpen) {
    setInfoPanelChange({
      open: infoPanelOpen,
      count: infoPanelChange.count + 1,
      slide: workspaceReady ? (infoPanelOpen ? "in" : "out") : null,
    });
  }
  useEffect(() => {
    if (infoPanelChange.slide === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setInfoPanelChange((current) => ({ ...current, slide: null })),
      PANE_LAYOUT_CHANGE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [infoPanelChange]);
  const infoPanelClosing = !infoPanelOpen && infoPanelChange.slide === "out";

  // Works out how many of the removable items fit, from the width of the row and the
  // widths of the items: the removable ones are measured in a hidden copy (those that do
  // not fit are not in the row), the clipboard button and View Options where they are.
  // Measured again once the toolbar appears: a saved toolbar arrives before it does, and
  // would otherwise stay cut to the number of buttons in the default one.
  useLayoutEffect(() => {
    void workspaceReady;
    const toolbar = toolbarRef.current;
    const row = toolbarRowRef.current;
    if (!toolbar || !row) {
      return;
    }
    const measuredItems = Array.from(
      toolbar.querySelectorAll<HTMLElement>("[data-top-toolbar-measure]"),
    );

    const updateVisibleCount = () => {
      const widths = new Map(
        measuredItems.map((item) => [
          item.dataset.topToolbarMeasure ?? "",
          Math.ceil(item.getBoundingClientRect().width),
        ]),
      );
      const nextVisibleCount = resolveVisibleOptionalCount({
        slots: topToolbarSlots,
        widths,
        availableWidth: Math.floor(row.clientWidth),
      });
      setVisibleOptionalCount((currentCount) =>
        currentCount === nextVisibleCount ? currentCount : nextVisibleCount,
      );
    };

    updateVisibleCount();
    const observer = new ResizeObserver(() => {
      updateVisibleCount();
    });
    observer.observe(row);
    for (const item of measuredItems) {
      observer.observe(item);
    }
    return () => {
      observer.disconnect();
    };
  }, [topToolbarSlots, workspaceReady]);

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

  const visibleTopToolbarSlots = useMemo(
    () => selectTopToolbarSlots(topToolbarSlots, visibleOptionalCount),
    [topToolbarSlots, visibleOptionalCount],
  );

  // When the row changes the sort button may have moved or gone; its menu does not stay behind.
  const sortMenuResetKey = visibleTopToolbarSlots.map((slot) => slot.key).join(" ");
  useEffect(() => {
    void sortMenuResetKey;
    setSortMenuOpen(false);
  }, [sortMenuResetKey]);

  useEffect(() => {
    if (!viewOptionsMenuStyle) {
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
      setViewOptionsMenuStyle(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewOptionsMenuStyle(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewOptionsMenuStyle]);

  const shortcutDisplay = useShortcutDisplay();
  // How the list and the panels are shown, worded and ordered as in the View menu, and the
  // way from the toolbar to the place where it is arranged.
  const viewOptionsItems: ViewOptionsMenuItem[] = [
    {
      kind: "toggle",
      id: "foldersFirst",
      label: "Folders First",
      command: "toggleFoldersFirst",
      checked: foldersFirst,
      onSelect: onToggleFoldersFirst,
    },
    {
      kind: "toggle",
      id: "hidden",
      label: "Hidden Files",
      command: "toggleHiddenFiles",
      checked: includeHidden,
      onSelect: onToggleHidden,
    },
    { kind: "separator", id: "separator-1" },
    {
      kind: "toggle",
      id: "infoPanel",
      label: "Info Panel",
      command: "toggleInfoPanel",
      checked: infoPanelOpen,
      onSelect: onToggleInfoPanel,
    },
    {
      kind: "toggle",
      id: "infoRow",
      label: "Info Row",
      command: "toggleInfoRow",
      checked: infoRowOpen,
      onSelect: onToggleInfoRow,
    },
    { kind: "separator", id: "separator-2" },
    {
      kind: "action",
      id: "customizeToolbar",
      label: "Customize Toolbar…",
      onSelect: onCustomizeToolbar,
    },
  ];

  function renderViewOptions(slot: TopToolbarSlot) {
    return (
      <div
        key={slot.key}
        className="toolbar-view-options"
        data-top-toolbar-item={slot.id}
        data-top-toolbar-measure={slot.key}
      >
        <button
          ref={viewOptionsButtonRef}
          type="button"
          className={`tb-btn tb-btn-icon${viewOptionsMenuStyle ? " active" : ""}`}
          title="View Options"
          aria-label="View options"
          aria-haspopup="menu"
          aria-expanded={viewOptionsMenuStyle !== null}
          onClick={() => {
            if (viewOptionsMenuStyle) {
              setViewOptionsMenuStyle(null);
              return;
            }
            const rect = viewOptionsButtonRef.current?.getBoundingClientRect();
            if (!rect) {
              return;
            }
            setViewOptionsMenuStyle(
              placeDropdownMenu({ anchor: rect, viewportWidth: window.innerWidth }),
            );
          }}
        >
          <ToolbarIcon name="more" />
        </button>
        {viewOptionsMenuStyle
          ? createPortal(
              <div
                ref={viewOptionsMenuRef}
                className="toolbar-menu"
                role="menu"
                aria-label="View options"
                style={viewOptionsMenuStyle}
              >
                {viewOptionsItems.map((item) => {
                  if (item.kind === "separator") {
                    return <hr key={item.id} className="toolbar-menu-separator" />;
                  }
                  // The key the command has now; nothing for a command without one.
                  const shortcut = item.command ? shortcutDisplay.label(item.command) : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="toolbar-menu-item"
                      role={item.kind === "toggle" ? "menuitemcheckbox" : "menuitem"}
                      aria-checked={item.kind === "toggle" ? item.checked : undefined}
                      onClick={() => {
                        setViewOptionsMenuStyle(null);
                        item.onSelect();
                      }}
                    >
                      <MenuCheck checked={item.kind === "toggle" && item.checked} />
                      <span className="toolbar-menu-label">{item.label}</span>
                      {shortcut ? <span className="toolbar-menu-shortcut">{shortcut}</span> : null}
                    </button>
                  );
                })}
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
        foldersFirst,
        hiddenFilesShown: includeHidden,
        infoPanelOpen,
        infoRowOpen,
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
          entries={backHistory}
          interactive={mode === "interactive"}
          onStep={goBack}
          onSelectEntry={onGoToHistoryIndex}
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
          entries={forwardHistory}
          interactive={mode === "interactive"}
          onStep={goForward}
          onSelectEntry={onGoToHistoryIndex}
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
                    <MenuCheck checked={sortBy === value} />
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
                    <MenuCheck checked={sortDirection === direction} />
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
        <div key={itemId} className="toolbar-search-slot" data-top-toolbar-item={itemId}>
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

    if (itemId === "foldersFirst") {
      return (
        <button
          key={itemId}
          type="button"
          className={foldersFirst ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleFoldersFirst}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle folders first"
          aria-pressed={foldersFirst}
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
          className={includeHidden ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleHidden}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle hidden files"
          aria-pressed={includeHidden}
        >
          <ToolbarIcon name={includeHidden ? "hiddenShown" : "hidden"} />
        </button>
      );
    }
    if (itemId === "infoPanel") {
      return (
        <button
          key={itemId}
          type="button"
          className={infoPanelOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleInfoPanel}
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
          className={infoRowOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleInfoRow}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle Info Row"
          aria-pressed={infoRowOpen}
        >
          <ToolbarIcon name="infoRow" />
        </button>
      );
    }
    if (itemId === "theme") {
      return (
        <ThemeMenuButton
          key={itemId}
          theme={theme}
          onSelectTheme={onSelectTheme}
          interactive={mode === "interactive"}
        />
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

  // Buttons side by side share a capsule; each knows whether it starts or ends one.
  const toolbarCapsules = resolveToolbarCapsules(
    visibleTopToolbarSlots,
    (slot) => slot.id !== "clipboard" || clipboardShown,
  );

  function renderTopToolbarSlot(slot: TopToolbarSlot) {
    const element = renderTopToolbarSlotContent(slot);
    const edges = toolbarCapsules.get(slot.key);
    if (!edges || !isValidElement<Record<string, unknown>>(element)) {
      return element;
    }
    return cloneElement(element, {
      "data-capsule":
        edges.start && edges.end ? "single" : edges.start ? "start" : edges.end ? "end" : "middle",
    });
  }

  function renderTopToolbarSlotContent(slot: TopToolbarSlot) {
    if (slot.id === "title") {
      return (
        <div key={slot.key} className="toolbar-title-block" data-top-toolbar-item={slot.id}>
          <span className="toolbar-title" title={currentPath}>
            {toolbarTitle}
          </span>
          {toolbarSubtitle ? <span className="toolbar-subtitle">{toolbarSubtitle}</span> : null}
        </div>
      );
    }
    if (slot.id === "search") {
      return renderTopToolbarItem(slot.id);
    }
    if (slot.id === "clipboard") {
      return (
        <div
          key={slot.key}
          className="toolbar-clipboard"
          data-top-toolbar-item={slot.id}
          data-top-toolbar-measure={slot.key}
        >
          {clipboardButton}
        </div>
      );
    }
    if (slot.id === "viewOptions") {
      return renderViewOptions(slot);
    }
    return (
      <div key={slot.key} className="toolbar-item" data-top-toolbar-item={slot.id}>
        {renderTopToolbarItem(slot.id)}
      </div>
    );
  }

  const toolbar = (
    <header
      ref={toolbarRef}
      className="window-toolbar"
      style={{ gridColumn: "3 / -1", gridRow: "1" }}
    >
      <div ref={toolbarRowRef} className="toolbar-row">
        {visibleTopToolbarSlots.map(renderTopToolbarSlot)}
      </div>
      <div className="toolbar-row-measure" aria-hidden="true">
        {optionalTopToolbarSlots.map((slot) => (
          <div key={slot.key} className="toolbar-item" data-top-toolbar-measure={slot.key}>
            {renderTopToolbarItem(slot.id, "measure")}
          </div>
        ))}
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
            <TreePane {...treePaneProps} />
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
            <PaneLayoutChangeContext.Provider value={infoPanelChange.count}>
              <SearchWorkspace {...searchWorkspaceProps} />
            </PaneLayoutChangeContext.Provider>
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
              <div
                className={`workspace-inspector-cell${
                  infoPanelChange.slide === "in" ? " is-sliding-in" : ""
                }`}
                style={{ gridColumn: "5", gridRow: "3" }}
              >
                <InfoPanel {...infoPanelProps} />
              </div>
            </>
          ) : infoPanelClosing ? (
            // Over the right edge of the content, which already has the whole width.
            <div
              className="workspace-inspector-cell is-sliding-out"
              style={{ gridColumn: "3", gridRow: "3", justifySelf: "end", width: inspectorWidth }}
              inert
            >
              <InfoPanel {...infoPanelProps} />
            </div>
          ) : null}
        </section>
      )}
    </section>
  );
}
