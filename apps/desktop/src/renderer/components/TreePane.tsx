import {
  type Dispatch,
  Fragment,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  type FavoritePreference,
  type FavoritesPlacement,
  THEME_GROUPS,
  type ThemeMode,
  getThemeLabel,
} from "../../shared/appPreferences";
import type { RendererCommandType } from "../../shared/rendererCommands";
import {
  getToolbarItemDefinition,
  type LeftToolbarItems,
  type ToolbarItemId,
} from "../../shared/toolbarItems";
import {
  type TreeItemId,
  type TreePresentationItem,
  buildTreePresentation,
  createFavoriteItemId,
  getFavoriteLabel,
} from "../lib/favorites";
import { FavoriteItemIcon, TreeFolderIcon } from "../lib/fileIcons";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { ToolbarIcon } from "./ToolbarIcon";

const FAVORITES_PANE_DEFAULT_HEIGHT = 220;
const FAVORITES_PANE_MIN_HEIGHT = 116;
const FILESYSTEM_PANE_MIN_HEIGHT = 140;

function formatToolbarTooltip(label: string, shortcutLabel?: string) {
  return shortcutLabel ? `${label} (${shortcutLabel})` : label;
}

export type TreeNodeState = {
  path: string;
  name: string;
  kind: "directory" | "symlink_directory";
  isHidden: boolean;
  isSymlink: boolean;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  loadedIncludeHidden?: boolean;
  forcedVisibleHiddenChildPath?: string | null;
  error: string | null;
  childPaths: string[];
};

export function TreePane({
  paneRef,
  isFocused,
  dragActive = false,
  rootPath,
  homePath,
  compactTreeView = false,
  singleClickExpandTreeItems = false,
  nodes,
  selectedTreeItemId,
  favorites,
  favoritesPlacement,
  favoritesPaneHeight,
  activeLeftPaneSubview,
  favoritesExpanded,
  onFocusChange,
  onLeftPaneSubviewChange,
  onFavoritesPaneHeightChange,
  onGoHome,
  canGoBack,
  onGoBack,
  canGoForward,
  onGoForward,
  canNavigateToParent,
  onNavigateToParent,
  canNavigateDown,
  onNavigateDown,
  onRerootHome,
  onOpenLocation,
  onQuickAccess,
  foldersFirst,
  onToggleFoldersFirst,
  onToggleInfoPanel,
  infoPanelOpen,
  onToggleInfoRow,
  infoRowOpen,
  leftToolbarItems,
  theme,
  themeMenuOpen,
  themeButtonRef,
  themeMenuRef,
  onToggleThemeMenu,
  onSelectTheme,
  actionLogEnabled,
  onOpenActionLog,
  onClearSelection,
  onOpenHelp,
  onOpenSettings,
  includeHidden,
  onToggleHidden,
  onToggleExpand,
  onNavigate,
  onNavigateFavorite,
  onSelectFavoritesRoot,
  onItemContextMenu,
  onItemDragEnter,
  onItemDragOver,
  onItemDrop,
  getItemDropIndicator,
  onToggleFavoritesExpanded,
  typeaheadQuery,
  canRunRendererCommand,
  onRendererCommand,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  dragActive?: boolean;
  rootPath: string;
  homePath: string;
  compactTreeView?: boolean;
  singleClickExpandTreeItems?: boolean;
  nodes: Record<string, TreeNodeState>;
  selectedTreeItemId: TreeItemId | null;
  favorites: FavoritePreference[];
  favoritesPlacement: FavoritesPlacement;
  favoritesPaneHeight: number | null;
  activeLeftPaneSubview: "favorites" | "tree";
  favoritesExpanded: boolean;
  onFocusChange: (focused: boolean) => void;
  onLeftPaneSubviewChange: (value: "favorites" | "tree") => void;
  onFavoritesPaneHeightChange: (value: number) => void;
  onGoHome: () => void;
  canGoBack?: boolean;
  onGoBack?: () => void;
  canGoForward?: boolean;
  onGoForward?: () => void;
  canNavigateToParent?: boolean;
  onNavigateToParent?: () => void;
  canNavigateDown?: boolean;
  onNavigateDown?: () => void;
  onRerootHome: () => void;
  onOpenLocation?: () => void;
  onQuickAccess: (location: "root" | "applications" | "trash") => void;
  foldersFirst: boolean;
  onToggleFoldersFirst: () => void;
  onToggleInfoPanel: () => void;
  infoPanelOpen: boolean;
  onToggleInfoRow: () => void;
  infoRowOpen: boolean;
  leftToolbarItems: LeftToolbarItems;
  theme: ThemeMode;
  themeMenuOpen: boolean;
  themeButtonRef: React.RefObject<HTMLButtonElement | null>;
  themeMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleThemeMenu: () => void;
  onSelectTheme: (theme: ThemeMode) => void;
  actionLogEnabled: boolean;
  onOpenActionLog: () => void;
  onClearSelection: () => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  includeHidden: boolean;
  onToggleHidden: () => void;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => Promise<boolean | undefined> | undefined;
  onNavigateFavorite: (path: string) => Promise<boolean | undefined> | undefined;
  onSelectFavoritesRoot?: (() => Promise<boolean | undefined> | undefined) | undefined;
  onItemContextMenu?:
    | ((
        item: TreePresentationItem,
        subview: "favorites" | "tree",
        position: { x: number; y: number },
      ) => void)
    | undefined;
  onItemDragEnter?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  onItemDragOver?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  onItemDrop?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  getItemDropIndicator?:
    | ((item: TreePresentationItem, subview: "favorites" | "tree") => "valid" | "invalid" | null)
    | undefined;
  onToggleFavoritesExpanded: () => void;
  typeaheadQuery?: string;
  canRunRendererCommand: (command: RendererCommandType) => boolean;
  onRendererCommand: (command: RendererCommandType) => void;
}) {
  const integratedPresentation = useMemo(
    () =>
      buildTreePresentation({
        favorites,
        favoritesExpanded,
        homePath,
        rootPath,
        nodes,
        includeFavorites: favoritesPlacement === "integrated",
      }),
    [favorites, favoritesExpanded, homePath, rootPath, nodes, favoritesPlacement],
  );
  const filesystemPresentation = useMemo(
    () =>
      buildTreePresentation({
        favorites,
        favoritesExpanded,
        homePath,
        rootPath,
        nodes,
        includeFavorites: false,
      }),
    [favorites, favoritesExpanded, homePath, rootPath, nodes],
  );
  const favoriteItems = useMemo<TreePresentationItem[]>(
    () =>
      favorites.map((favorite) => ({
        id: createFavoriteItemId(favorite.path),
        kind: "favorite",
        label: getFavoriteLabel(favorite.path, homePath),
        depth: 0,
        path: favorite.path,
        parentId: null,
        expanded: false,
        canExpand: false,
        loading: false,
        error: null,
        isSymlink: false,
        childIds: [],
        icon: favorite.icon,
      })),
    [favorites, homePath],
  );
  const favoriteItemsById = useMemo(
    () => new Map(favoriteItems.map((item) => [item.id, item])),
    [favoriteItems],
  );
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const clickTimeoutRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const lastRegisteredSelectedRowRef = useRef<HTMLDivElement | null>(null);
  const lastRegisteredSelectedItemIdRef = useRef(selectedTreeItemId);
  const lastCommittedSelectedItemIdRef = useRef(selectedTreeItemId);
  const splitPaneRef = useRef<HTMLDivElement | null>(null);
  const splitResizeRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);
  const splitResizeCleanupRef = useRef<(() => void) | null>(null);
  const [optimisticSelectedItemId, setOptimisticSelectedItemId] = useState<TreeItemId | null>(null);
  const [splitPaneHeight, setSplitPaneHeight] = useState(0);
  const [selectedRowRegistrationVersion, setSelectedRowRegistrationVersion] = useState(0);
  const [themeMenuViewportPosition, setThemeMenuViewportPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const treeVisibilityVersion = useMemo(
    () =>
      [
        includeHidden ? "hidden:on" : "hidden:off",
        favoritesPlacement,
        favoritesExpanded ? "favorites:expanded" : "favorites:collapsed",
        favoriteItems.map((item) => item.id).join("\0"),
        filesystemPresentation.visibleItemIds.join("\0"),
        integratedPresentation.visibleItemIds.join("\0"),
      ].join("|"),
    [
      favoriteItems,
      favoritesExpanded,
      favoritesPlacement,
      filesystemPresentation.visibleItemIds,
      includeHidden,
      integratedPresentation.visibleItemIds,
    ],
  );
  const getToolbarTooltip = (itemId: ToolbarItemId, labelOverride?: string) => {
    const definition = getToolbarItemDefinition(itemId);
    return formatToolbarTooltip(labelOverride ?? definition.label, definition.shortcutLabel);
  };

  useEffect(
    () => () => {
      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = null;
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      document.body.classList.remove("resizing-panels-vertical");
    },
    [],
  );

  useEffect(() => {
    if (lastRegisteredSelectedItemIdRef.current === selectedTreeItemId) {
      return;
    }
    lastRegisteredSelectedItemIdRef.current = selectedTreeItemId;
    lastRegisteredSelectedRowRef.current = null;
  }, [selectedTreeItemId]);

  useEffect(() => {
    const measureSplitPane = () => {
      setSplitPaneHeight(splitPaneRef.current?.clientHeight ?? 0);
    };
    measureSplitPane();
    const frame = window.requestAnimationFrame(measureSplitPane);
    window.addEventListener("resize", measureSplitPane);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measureSplitPane);
    };
  }, []);

  useLayoutEffect(() => {
    if (!themeMenuOpen) {
      setThemeMenuViewportPosition(null);
      return;
    }
    const updateThemeMenuPosition = () => {
      const button = themeButtonRef.current;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const menuWidth = 176;
      setThemeMenuViewportPosition({
        left: Math.max(12, Math.min(rect.right + 10, window.innerWidth - menuWidth - 12)),
        bottom: Math.max(window.innerHeight - rect.bottom, 8),
      });
    };
    updateThemeMenuPosition();
    window.addEventListener("resize", updateThemeMenuPosition);
    window.addEventListener("scroll", updateThemeMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateThemeMenuPosition);
      window.removeEventListener("scroll", updateThemeMenuPosition, true);
    };
  }, [themeButtonRef, themeMenuOpen]);

  useEffect(() => {
    if (!selectedTreeItemId) {
      return;
    }
    const currentRow = rowRefs.current[selectedTreeItemId];
    if (!currentRow || typeof currentRow.scrollIntoView !== "function") {
      return;
    }
    const scrollContainer = currentRow.closest<HTMLElement>(".tree-scroll, .favorites-scroll");
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      if (!scrollContainer || !isElementFullyVisibleWithinContainer(currentRow, scrollContainer)) {
        currentRow.scrollIntoView({ block: "nearest" });
      }
      scrollFrameRef.current = null;
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [selectedRowRegistrationVersion, selectedTreeItemId, treeVisibilityVersion]);

  useEffect(() => {
    if (lastCommittedSelectedItemIdRef.current === selectedTreeItemId) {
      return;
    }
    lastCommittedSelectedItemIdRef.current = selectedTreeItemId;
    setOptimisticSelectedItemId(null);
  }, [selectedTreeItemId]);

  const resolvedFavoritesPaneHeight = clampFavoritesPaneHeight(
    favoritesPaneHeight ?? FAVORITES_PANE_DEFAULT_HEIGHT,
    splitPaneHeight,
  );

  const registerTreeRowRef = useCallback(
    (id: string, element: HTMLDivElement | null) => {
      rowRefs.current[id] = element;
      if (
        id === selectedTreeItemId &&
        element &&
        lastRegisteredSelectedRowRef.current !== element
      ) {
        lastRegisteredSelectedRowRef.current = element;
        setSelectedRowRegistrationVersion((current) => current + 1);
      }
    },
    [selectedTreeItemId],
  );

  function handlePaneMouseDownCapture(subview: "favorites" | "tree") {
    return (event: React.MouseEvent<HTMLDivElement>) => {
      onLeftPaneSubviewChange(subview);
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".tree-row, .favorites-pane-resizer")) {
        return;
      }
      const scrollContainer = target.closest<HTMLElement>(".tree-scroll, .favorites-scroll");
      if (scrollContainer && isScrollbarGutterHit(scrollContainer, event.clientX, event.clientY)) {
        return;
      }
      setOptimisticSelectedItemId(null);
      onClearSelection();
    };
  }

  function resolveDragTargetItem(
    event: React.DragEvent<HTMLElement>,
    items: Map<string, TreePresentationItem> | Record<string, TreePresentationItem>,
  ): TreePresentationItem | null {
    const target = event.target;
    if (!(target instanceof Element)) {
      return null;
    }
    const row = target.closest<HTMLElement>(".tree-row[data-tree-item-id]");
    const itemId = row?.dataset.treeItemId;
    if (!itemId) {
      return null;
    }
    if (items instanceof Map) {
      return items.get(itemId) ?? null;
    }
    return items[itemId] ?? null;
  }

  function handlePaneDragEnterCapture(
    items: Map<string, TreePresentationItem> | Record<string, TreePresentationItem>,
    subview: "favorites" | "tree",
  ) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      const item = resolveDragTargetItem(event, items);
      if (!item || item.kind === "favorites-root") {
        return;
      }
      onItemDragEnter?.(item, event, subview);
    };
  }

  function handlePaneDragOverCapture(
    items: Map<string, TreePresentationItem> | Record<string, TreePresentationItem>,
    subview: "favorites" | "tree",
  ) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      const item = resolveDragTargetItem(event, items);
      if (!item || item.kind === "favorites-root") {
        return;
      }
      onItemDragOver?.(item, event, subview);
    };
  }

  function handlePaneDropCapture(
    items: Map<string, TreePresentationItem> | Record<string, TreePresentationItem>,
    subview: "favorites" | "tree",
  ) {
    return (event: React.DragEvent<HTMLDivElement>) => {
      const item = resolveDragTargetItem(event, items);
      if (!item || item.kind === "favorites-root") {
        return;
      }
      onItemDrop?.(item, event, subview);
    };
  }

  function renderLeftToolbarItem(itemId: ToolbarItemId) {
    if (itemId === "leftSeparator") {
      return <div key={itemId} className="sidebar-rail-separator" role="separator" aria-orientation="horizontal" />;
    }
    if (itemId === "back") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onGoBack}
          disabled={!canGoBack || !onGoBack}
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
          className="sidebar-rail-button"
          onClick={onGoForward}
          disabled={!canGoForward || !onGoForward}
          title={getToolbarTooltip(itemId)}
          aria-label="Forward"
        >
          <ToolbarIcon name="forward" />
        </button>
      );
    }
    if (itemId === "home") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onGoHome}
          title={getToolbarTooltip(itemId)}
          aria-label="Quick access Home"
        >
          <ToolbarIcon name="home" />
        </button>
      );
    }
    if (itemId === "up") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onNavigateToParent}
          disabled={!canNavigateToParent || !onNavigateToParent}
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
          className="sidebar-rail-button"
          onClick={onNavigateDown}
          disabled={!canNavigateDown || !onNavigateDown}
          title={getToolbarTooltip(itemId)}
          aria-label="Navigate Down"
        >
          <ToolbarIcon name="down" />
        </button>
      );
    }
    if (itemId === "root") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={() => onQuickAccess("root")}
          title={getToolbarTooltip(itemId)}
          aria-label="Quick access Macintosh HD"
        >
          <ToolbarIcon name="drive" />
        </button>
      );
    }
    if (itemId === "applications") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={() => onQuickAccess("applications")}
          title={getToolbarTooltip(itemId)}
          aria-label="Quick access Applications"
        >
          <ToolbarIcon name="applications" />
        </button>
      );
    }
    if (itemId === "trash") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={() => onQuickAccess("trash")}
          title={getToolbarTooltip(itemId)}
          aria-label="Quick access Trash"
        >
          <ToolbarIcon name="trash" />
        </button>
      );
    }
    if (itemId === "rerootHome") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onRerootHome}
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
          className={`sidebar-rail-button${foldersFirst ? " active" : ""}`}
          onClick={onToggleFoldersFirst}
          title={foldersFirst ? "Folders first" : "Mixed file and folder order"}
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
          className={`sidebar-rail-button${includeHidden ? " active" : ""}`}
          onClick={onToggleHidden}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle hidden files"
          aria-pressed={includeHidden}
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
          className={`sidebar-rail-button${infoPanelOpen ? " active" : ""}`}
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
          className={`sidebar-rail-button${infoRowOpen ? " active" : ""}`}
          onClick={onToggleInfoRow}
          title={getToolbarTooltip(itemId)}
          aria-label="Toggle Info Row"
          aria-pressed={infoRowOpen}
        >
          <ToolbarIcon name="infoRow" />
        </button>
      );
    }
    if (itemId === "actionLog") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onOpenActionLog}
          disabled={!actionLogEnabled}
          title={getToolbarTooltip(itemId)}
          aria-label="Open action log"
        >
          <ToolbarIcon name="actionLog" />
        </button>
      );
    }
    if (itemId === "help") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onOpenHelp}
          title={getToolbarTooltip(itemId)}
          aria-label="Open help"
        >
          <ToolbarIcon name="help" />
        </button>
      );
    }
    if (itemId === "theme") {
      const themeMenu =
        themeMenuOpen && themeMenuViewportPosition
          ? createPortal(
              <div
                ref={themeMenuRef}
                className="sidebar-rail-menu sidebar-rail-menu-portal"
                tabIndex={-1}
                style={{
                  position: "fixed",
                  left: `${themeMenuViewportPosition.left}px`,
                  bottom: `${themeMenuViewportPosition.bottom}px`,
                }}
              >
                {THEME_GROUPS.map((group, groupIndex) => (
                  <Fragment key={group.value}>
                    {groupIndex > 0 ? <hr className="sidebar-rail-menu-separator" /> : null}
                    {group.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`sidebar-rail-menu-item${theme === option.value ? " active" : ""}`}
                        onClick={() => onSelectTheme(option.value)}
                        aria-pressed={theme === option.value}
                      >
                        <span>{option.label}</span>
                        {theme === option.value ? (
                          <span className="sidebar-rail-menu-check">✓</span>
                        ) : null}
                      </button>
                    ))}
                  </Fragment>
                ))}
              </div>,
              document.body,
            )
          : null;
      return (
        <div key={itemId} className="sidebar-rail-menu-anchor">
          <button
            ref={themeButtonRef}
            type="button"
            className={`sidebar-rail-button${themeMenuOpen ? " active" : ""}`}
            onClick={onToggleThemeMenu}
            title={`Theme: ${getThemeLabel(theme)}`}
            aria-label="Choose theme"
            aria-haspopup="listbox"
            aria-expanded={themeMenuOpen}
          >
            <ToolbarIcon name="theme" />
          </button>
          {themeMenu}
        </div>
      );
    }
    if (itemId === "settings") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onOpenSettings}
          title={getToolbarTooltip(itemId)}
          aria-label="Open settings"
        >
          <ToolbarIcon name="settings" />
        </button>
      );
    }
    if (itemId === "goToFolder") {
      return (
        <button
          key={itemId}
          type="button"
          className="sidebar-rail-button"
          onClick={onOpenLocation}
          disabled={!onOpenLocation}
          title={getToolbarTooltip(itemId)}
          aria-label="Go to Folder"
        >
          <ToolbarIcon name="location" />
        </button>
      );
    }

    const definition = getToolbarItemDefinition(itemId);
    if (!definition.commandType) {
      return null;
    }
    return (
      <button
        key={itemId}
        type="button"
        className="sidebar-rail-button"
        onClick={() => onRendererCommand(definition.commandType!)}
        disabled={!canRunRendererCommand(definition.commandType)}
        title={formatToolbarTooltip(definition.label, definition.shortcutLabel)}
        aria-label={definition.label}
      >
        <ToolbarIcon name={definition.icon} />
      </button>
    );
  }

  return (
    <aside
      ref={paneRef}
      className={`tree-pane sidebar pane pane-focus-target${compactTreeView ? " compact-tree-view" : ""}`}
      tabIndex={-1}
      onMouseDownCapture={(event) => {
        const target = event.target;
        if (
          !(target instanceof Element) ||
          !target.closest(
            ".tree-scroll, .tree-row, .favorites-scroll, .favorites-pane-resizer, .sidebar-tree",
          )
        ) {
          return;
        }
        paneRef?.current?.focus({ preventScroll: true });
      }}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
    >
      <div className="sidebar-shell">
        <aside className="sidebar-rail">
          <div className="sidebar-rail-group sidebar-rail-group-main">
            {leftToolbarItems.main
              .filter((itemId) => itemId !== "settings")
              .map((itemId, index) => (
                <Fragment key={`${itemId}-${index}`}>{renderLeftToolbarItem(itemId)}</Fragment>
              ))}
          </div>
          <div className="sidebar-rail-group sidebar-rail-group-utility">
            {leftToolbarItems.utility
              .filter((itemId) => itemId !== "settings")
              .map((itemId, index) => (
                <Fragment key={`${itemId}-${index}`}>{renderLeftToolbarItem(itemId)}</Fragment>
              ))}
            {renderLeftToolbarItem("settings")}
          </div>
        </aside>
        <div className="sidebar-main">
          <div className={`sidebar-header${isFocused ? " sidebar-header-focused" : ""}`}>
            <span className="sidebar-title">Folders</span>
          </div>
          {typeaheadQuery ? (
            <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
              <span className="pane-typeahead-label">Jump to</span>
              <span className="pane-typeahead-value">{typeaheadQuery}</span>
            </div>
          ) : null}
          {favoritesPlacement === "separate" ? (
            <div ref={splitPaneRef} className="sidebar-split-pane">
              <div
                className={`favorites-pane-section${activeLeftPaneSubview === "favorites" ? " active" : ""}`}
                data-drag-active={dragActive ? "true" : "false"}
                data-left-subview="favorites"
                style={{ height: `${resolvedFavoritesPaneHeight}px` }}
                onMouseDownCapture={handlePaneMouseDownCapture("favorites")}
                onDragEnterCapture={handlePaneDragEnterCapture(favoriteItemsById, "favorites")}
                onDragOverCapture={handlePaneDragOverCapture(favoriteItemsById, "favorites")}
                onDropCapture={handlePaneDropCapture(favoriteItemsById, "favorites")}
              >
                <div className="favorites-scroll">
                  <div className="tree-list favorites-list">
                    {favoriteItems.map((item) => (
                      <TreeItemRow
                        key={item.id}
                        item={item}
                        isPaneFocused={isFocused}
                        selectedTreeItemId={selectedTreeItemId}
                        clickTimeoutRef={clickTimeoutRef}
                        optimisticSelectedItemId={optimisticSelectedItemId}
                        setOptimisticSelectedItemId={setOptimisticSelectedItemId}
                        onToggleExpand={onToggleExpand}
                        onToggleFavoritesExpanded={onToggleFavoritesExpanded}
                        singleClickExpandTreeItems={singleClickExpandTreeItems}
                        onClearSelection={onClearSelection}
                        onNavigate={onNavigate}
                        onNavigateFavorite={onNavigateFavorite}
                        onSelectFavoritesRoot={onSelectFavoritesRoot}
                        onItemContextMenu={onItemContextMenu}
                        onItemDragEnter={onItemDragEnter}
                        onItemDragOver={onItemDragOver}
                        onItemDrop={onItemDrop}
                        getItemDropIndicator={getItemDropIndicator}
                        subview="favorites"
                        onSubviewFocus={() => onLeftPaneSubviewChange("favorites")}
                        registerRowRef={registerTreeRowRef}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div
                className="favorites-pane-resizer"
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label="Resize favorites pane"
                onMouseDownCapture={() => onLeftPaneSubviewChange("favorites")}
                onPointerDown={(event) => {
                  event.preventDefault();
                  splitResizeCleanupRef.current?.();
                  splitResizeRef.current = {
                    startY: event.clientY,
                    startHeight: resolvedFavoritesPaneHeight,
                  };
                  const handlePointerMove = (moveEvent: PointerEvent) => {
                    const activeResize = splitResizeRef.current;
                    if (!activeResize) {
                      return;
                    }
                    const containerHeight = splitPaneRef.current?.clientHeight ?? splitPaneHeight;
                    const nextHeight = clampFavoritesPaneHeight(
                      activeResize.startHeight + (moveEvent.clientY - activeResize.startY),
                      containerHeight,
                    );
                    onFavoritesPaneHeightChange(nextHeight);
                  };
                  const handlePointerUp = () => {
                    splitResizeCleanupRef.current?.();
                    splitResizeCleanupRef.current = null;
                  };
                  splitResizeCleanupRef.current = () => {
                    window.removeEventListener("pointermove", handlePointerMove);
                    window.removeEventListener("pointerup", handlePointerUp);
                    splitResizeRef.current = null;
                    document.body.classList.remove("resizing-panels-vertical");
                  };
                  window.addEventListener("pointermove", handlePointerMove);
                  window.addEventListener("pointerup", handlePointerUp);
                  document.body.classList.add("resizing-panels-vertical");
                }}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                    return;
                  }
                  event.preventDefault();
                  const step = event.shiftKey
                    ? EXPLORER_LAYOUT.paneResizeStepLarge
                    : EXPLORER_LAYOUT.paneResizeStep;
                  const direction = event.key === "ArrowDown" ? 1 : -1;
                  const nextHeight = clampFavoritesPaneHeight(
                    resolvedFavoritesPaneHeight + direction * step,
                    splitPaneHeight,
                  );
                  onFavoritesPaneHeightChange(nextHeight);
                }}
              />
              <div
                className={`sidebar-tree filesystem-tree-section${
                  activeLeftPaneSubview === "tree" ? " active" : ""
                }`}
                data-drag-active={dragActive ? "true" : "false"}
                data-left-subview="tree"
                onMouseDownCapture={handlePaneMouseDownCapture("tree")}
                onDragEnterCapture={handlePaneDragEnterCapture(
                  filesystemPresentation.items,
                  "tree",
                )}
                onDragOverCapture={handlePaneDragOverCapture(filesystemPresentation.items, "tree")}
                onDropCapture={handlePaneDropCapture(filesystemPresentation.items, "tree")}
              >
                <TreeList
                  items={filesystemPresentation.items}
                  visibleItemIds={filesystemPresentation.visibleItemIds}
                  isPaneFocused={isFocused}
                  selectedTreeItemId={selectedTreeItemId}
                  clickTimeoutRef={clickTimeoutRef}
                  optimisticSelectedItemId={optimisticSelectedItemId}
                  setOptimisticSelectedItemId={setOptimisticSelectedItemId}
                  onToggleExpand={onToggleExpand}
                  onToggleFavoritesExpanded={onToggleFavoritesExpanded}
                  singleClickExpandTreeItems={singleClickExpandTreeItems}
                  onClearSelection={onClearSelection}
                  onNavigate={onNavigate}
                  onNavigateFavorite={onNavigateFavorite}
                  onSelectFavoritesRoot={onSelectFavoritesRoot}
                  onItemContextMenu={onItemContextMenu}
                  onItemDragEnter={onItemDragEnter}
                  onItemDragOver={onItemDragOver}
                  onItemDrop={onItemDrop}
                  getItemDropIndicator={getItemDropIndicator}
                  subview="tree"
                  onSubviewFocus={() => onLeftPaneSubviewChange("tree")}
                  registerRowRef={registerTreeRowRef}
                />
              </div>
            </div>
          ) : (
            <div
              className="sidebar-tree"
              data-drag-active={dragActive ? "true" : "false"}
              data-left-subview="tree"
              onMouseDownCapture={handlePaneMouseDownCapture("tree")}
              onDragEnterCapture={handlePaneDragEnterCapture(integratedPresentation.items, "tree")}
              onDragOverCapture={handlePaneDragOverCapture(integratedPresentation.items, "tree")}
              onDropCapture={handlePaneDropCapture(integratedPresentation.items, "tree")}
            >
              <TreeList
                items={integratedPresentation.items}
                visibleItemIds={integratedPresentation.visibleItemIds}
                isPaneFocused={isFocused}
                selectedTreeItemId={selectedTreeItemId}
                clickTimeoutRef={clickTimeoutRef}
                optimisticSelectedItemId={optimisticSelectedItemId}
                setOptimisticSelectedItemId={setOptimisticSelectedItemId}
                onToggleExpand={onToggleExpand}
                onToggleFavoritesExpanded={onToggleFavoritesExpanded}
                singleClickExpandTreeItems={singleClickExpandTreeItems}
                onClearSelection={onClearSelection}
                onNavigate={onNavigate}
                onNavigateFavorite={onNavigateFavorite}
                onSelectFavoritesRoot={onSelectFavoritesRoot}
                onItemContextMenu={onItemContextMenu}
                subview="tree"
                onSubviewFocus={() => onLeftPaneSubviewChange("tree")}
                registerRowRef={registerTreeRowRef}
              />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function isScrollbarGutterHit(container: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = container.getBoundingClientRect();
  const verticalScrollbarWidth = Math.max(0, container.offsetWidth - container.clientWidth);
  const horizontalScrollbarHeight = Math.max(0, container.offsetHeight - container.clientHeight);
  const hitVerticalScrollbar =
    verticalScrollbarWidth > 0 && clientX >= rect.right - verticalScrollbarWidth;
  const hitHorizontalScrollbar =
    horizontalScrollbarHeight > 0 && clientY >= rect.bottom - horizontalScrollbarHeight;
  return hitVerticalScrollbar || hitHorizontalScrollbar;
}

function isElementFullyVisibleWithinContainer(
  element: HTMLElement,
  container: HTMLElement,
): boolean {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom;
}

function TreeList({
  items,
  visibleItemIds,
  isPaneFocused,
  selectedTreeItemId,
  clickTimeoutRef,
  optimisticSelectedItemId,
  setOptimisticSelectedItemId,
  onToggleExpand,
  onToggleFavoritesExpanded,
  singleClickExpandTreeItems,
  onClearSelection,
  onNavigate,
  onNavigateFavorite,
  onSelectFavoritesRoot,
  onItemContextMenu,
  onItemDragEnter,
  onItemDragOver,
  onItemDrop,
  getItemDropIndicator,
  subview,
  onSubviewFocus,
  registerRowRef,
}: {
  items: Record<TreeItemId, TreePresentationItem>;
  visibleItemIds: TreeItemId[];
  isPaneFocused: boolean;
  selectedTreeItemId: TreeItemId | null;
  clickTimeoutRef: React.RefObject<number | null>;
  optimisticSelectedItemId: TreeItemId | null;
  setOptimisticSelectedItemId: Dispatch<SetStateAction<TreeItemId | null>>;
  onToggleExpand: (path: string) => void;
  onToggleFavoritesExpanded: () => void;
  singleClickExpandTreeItems: boolean;
  onClearSelection: () => void;
  onNavigate: (path: string) => Promise<boolean | undefined> | undefined;
  onNavigateFavorite: (path: string) => Promise<boolean | undefined> | undefined;
  onSelectFavoritesRoot?: (() => Promise<boolean | undefined> | undefined) | undefined;
  onItemContextMenu?:
    | ((
        item: TreePresentationItem,
        subview: "favorites" | "tree",
        position: { x: number; y: number },
      ) => void)
    | undefined;
  onItemDragEnter?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  onItemDragOver?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  onItemDrop?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  getItemDropIndicator?:
    | ((item: TreePresentationItem, subview: "favorites" | "tree") => "valid" | "invalid" | null)
    | undefined;
  subview: "favorites" | "tree";
  onSubviewFocus: () => void;
  registerRowRef: (id: string, element: HTMLDivElement | null) => void;
}) {
  return (
    <div className="tree-scroll">
      <div className="tree-list">
        {visibleItemIds.map((itemId) => {
          const item = items[itemId];
          if (!item) {
            return null;
          }
          return (
            <TreeItemRow
              key={item.id}
              item={item}
              isPaneFocused={isPaneFocused}
              selectedTreeItemId={selectedTreeItemId}
              clickTimeoutRef={clickTimeoutRef}
              optimisticSelectedItemId={optimisticSelectedItemId}
              setOptimisticSelectedItemId={setOptimisticSelectedItemId}
              onToggleExpand={onToggleExpand}
              onToggleFavoritesExpanded={onToggleFavoritesExpanded}
              singleClickExpandTreeItems={singleClickExpandTreeItems}
              onClearSelection={onClearSelection}
              onNavigate={onNavigate}
              onNavigateFavorite={onNavigateFavorite}
              onSelectFavoritesRoot={onSelectFavoritesRoot}
              onItemContextMenu={onItemContextMenu}
              onItemDragEnter={onItemDragEnter}
              onItemDragOver={onItemDragOver}
              onItemDrop={onItemDrop}
              getItemDropIndicator={getItemDropIndicator}
              subview={subview}
              onSubviewFocus={onSubviewFocus}
              registerRowRef={registerRowRef}
            />
          );
        })}
      </div>
    </div>
  );
}

function TreeItemRow({
  item,
  isPaneFocused,
  selectedTreeItemId,
  clickTimeoutRef,
  optimisticSelectedItemId,
  setOptimisticSelectedItemId,
  onToggleExpand,
  onToggleFavoritesExpanded,
  singleClickExpandTreeItems,
  onClearSelection,
  onNavigate,
  onNavigateFavorite,
  onSelectFavoritesRoot,
  onItemContextMenu,
  onItemDragEnter,
  onItemDragOver,
  onItemDrop,
  getItemDropIndicator,
  subview,
  onSubviewFocus,
  registerRowRef,
}: {
  item: TreePresentationItem;
  isPaneFocused: boolean;
  selectedTreeItemId: TreeItemId | null;
  clickTimeoutRef: React.RefObject<number | null>;
  optimisticSelectedItemId: TreeItemId | null;
  setOptimisticSelectedItemId: Dispatch<SetStateAction<TreeItemId | null>>;
  onToggleExpand: (path: string) => void;
  onToggleFavoritesExpanded: () => void;
  singleClickExpandTreeItems: boolean;
  onClearSelection: () => void;
  onNavigate: (path: string) => Promise<boolean | undefined> | undefined;
  onNavigateFavorite: (path: string) => Promise<boolean | undefined> | undefined;
  onSelectFavoritesRoot?: (() => Promise<boolean | undefined> | undefined) | undefined;
  onItemContextMenu?:
    | ((
        item: TreePresentationItem,
        subview: "favorites" | "tree",
        position: { x: number; y: number },
      ) => void)
    | undefined;
  onItemDragEnter?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  onItemDragOver?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  onItemDrop?:
    | ((
        item: TreePresentationItem,
        event: React.DragEvent<HTMLElement>,
        subview: "favorites" | "tree",
      ) => void)
    | undefined;
  getItemDropIndicator?:
    | ((item: TreePresentationItem, subview: "favorites" | "tree") => "valid" | "invalid" | null)
    | undefined;
  subview: "favorites" | "tree";
  onSubviewFocus: () => void;
  registerRowRef: (id: string, element: HTMLDivElement | null) => void;
}) {
  const isCurrent = (optimisticSelectedItemId ?? selectedTreeItemId) === item.id;
  const canExpand =
    item.kind === "favorites-root"
      ? item.canExpand
      : item.kind === "filesystem"
        ? !item.isSymlink
        : false;
  const isFavorite = item.kind === "favorite";
  const isFavoritesRoot = item.kind === "favorites-root";
  const isFileSystem = item.kind === "filesystem";
  const itemPath = item.path;
  const dropIndicator = getItemDropIndicator?.(item, subview) ?? null;

  function handleActivatePointerDown(metaKey: boolean, button: number) {
    if (button !== 0) {
      return;
    }
    onSubviewFocus();
    if (metaKey && isCurrent) {
      setOptimisticSelectedItemId(null);
      return;
    }
    setOptimisticSelectedItemId(item.id);
  }

  function handleActivateClick(metaKey: boolean) {
    onSubviewFocus();
    if (metaKey && isCurrent) {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      setOptimisticSelectedItemId(null);
      onClearSelection();
      return;
    }
    if (isFavoritesRoot) {
      onSelectFavoritesRoot?.();
      return;
    }
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
    }
    clickTimeoutRef.current = window.setTimeout(() => {
      clickTimeoutRef.current = null;
      activateTreeItem(singleClickExpandTreeItems);
    }, 180);
  }

  function handleActivateDoubleClick() {
    onSubviewFocus();
    if (isFavoritesRoot) {
      onToggleFavoritesExpanded();
      return;
    }
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
    setOptimisticSelectedItemId(item.id);
    activateTreeItem(true);
  }

  function activateTreeItem(expandBeforeNavigate: boolean) {
    if (!itemPath) {
      return;
    }
    if (expandBeforeNavigate && isFileSystem && canExpand) {
      onToggleExpand(itemPath);
    }
    const navigationResult = isFavorite ? onNavigateFavorite(itemPath) : onNavigate(itemPath);
    if (!navigationResult || typeof navigationResult.then !== "function") {
      return;
    }
    void navigationResult.then((didNavigate) => {
      if (!didNavigate) {
        setOptimisticSelectedItemId(null);
      }
    });
  }

  function handleActivateContextMenu(clientX: number, clientY: number) {
    if (!itemPath || isFavoritesRoot) {
      return;
    }
    onSubviewFocus();
    setOptimisticSelectedItemId(item.id);
    onItemContextMenu?.(item, subview, {
      x: clientX,
      y: clientY,
    });
  }

  return (
    <div className="tree-branch">
      <div
        ref={(element) => registerRowRef(item.id, element)}
        className={`tree-row${isCurrent ? " active" : ""}${isCurrent && !isPaneFocused ? " inactive" : ""}`}
        data-tree-item-id={item.id}
        data-drop-target-state={dropIndicator ?? "none"}
        data-tree-path={itemPath ?? item.id}
        data-tree-kind={item.kind}
        style={{ paddingLeft: `${12 + item.depth * 16}px` }}
        tabIndex={-1}
        onPointerDown={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest(".tree-label, .tree-expand")) {
            return;
          }
          handleActivatePointerDown(event.metaKey, event.button);
        }}
        onKeyDown={(event) => {
          const target = event.target;
          if (
            event.defaultPrevented ||
            !(target instanceof Element) ||
            target.closest(".tree-label, .tree-expand") ||
            (event.key !== "Enter" && event.key !== " ")
          ) {
            return;
          }
          event.preventDefault();
          handleActivateClick(event.metaKey);
        }}
        onClick={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest(".tree-label, .tree-expand")) {
            return;
          }
          handleActivateClick(event.metaKey);
        }}
        onDoubleClick={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest(".tree-label, .tree-expand")) {
            return;
          }
          handleActivateDoubleClick();
        }}
        onContextMenu={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest(".tree-label, .tree-expand")) {
            return;
          }
          event.preventDefault();
          handleActivateContextMenu(event.clientX, event.clientY);
        }}
      >
        <button
          type="button"
          className={`tree-expand${item.expanded ? " expanded" : ""}${
            !canExpand && !item.loading ? " empty" : ""
          }`}
          onFocus={onSubviewFocus}
          onClick={() => {
            onSubviewFocus();
            if (isFavoritesRoot) {
              onToggleFavoritesExpanded();
              return;
            }
            if (isFileSystem && itemPath) {
              onToggleExpand(itemPath);
            }
          }}
          disabled={!canExpand || item.loading}
          aria-label={
            isFavoritesRoot
              ? item.expanded
                ? "Collapse favorites"
                : "Expand favorites"
              : item.expanded
                ? "Collapse folder"
                : "Expand folder"
          }
          title={
            !canExpand
              ? isFavoritesRoot
                ? "No favorites"
                : "No subfolders"
              : isFavoritesRoot
                ? item.expanded
                  ? "Collapse favorites"
                  : "Expand favorites"
                : item.expanded
                  ? "Collapse folder"
                  : "Expand folder"
          }
        >
          <ToolbarIcon name="chevron" />
        </button>
        <button
          type="button"
          className="tree-label"
          data-tree-item-id={item.id}
          onFocus={onSubviewFocus}
          onPointerDown={(event) => handleActivatePointerDown(event.metaKey, event.button)}
          onClick={(event) => handleActivateClick(event.metaKey)}
          onDoubleClick={() => {
            handleActivateDoubleClick();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            handleActivateContextMenu(event.clientX, event.clientY);
          }}
          title={itemPath ?? item.label}
        >
          {isFavorite || isFavoritesRoot ? (
            <FavoriteItemIcon icon={item.icon ?? "folder"} />
          ) : (
            <TreeFolderIcon open={item.expanded} alias={item.isSymlink} />
          )}
          <span className="tree-label-text">{item.label}</span>
          {item.isSymlink ? <span className="tree-label-badge">Alias</span> : null}
        </button>
        {dropIndicator === "valid" ? (
          <span className="tree-drop-target-badge" aria-hidden="true">
            Drop Here
          </span>
        ) : null}
      </div>
      {item.loading ? (
        <div className="tree-loading" style={{ paddingLeft: `${44 + item.depth * 16}px` }}>
          Loading folder…
        </div>
      ) : null}
      {item.error ? (
        <div className="tree-error" style={{ paddingLeft: `${44 + item.depth * 16}px` }}>
          {item.error}
        </div>
      ) : null}
    </div>
  );
}

function clampFavoritesPaneHeight(height: number, containerHeight: number): number {
  const safeContainerHeight =
    containerHeight > 0
      ? containerHeight
      : FAVORITES_PANE_DEFAULT_HEIGHT + FILESYSTEM_PANE_MIN_HEIGHT + EXPLORER_LAYOUT.resizerWidth;
  const maxFavoritesHeight = Math.max(
    FAVORITES_PANE_MIN_HEIGHT,
    safeContainerHeight - FILESYSTEM_PANE_MIN_HEIGHT - EXPLORER_LAYOUT.resizerWidth,
  );
  return Math.round(Math.max(FAVORITES_PANE_MIN_HEIGHT, Math.min(maxFavoritesHeight, height)));
}
