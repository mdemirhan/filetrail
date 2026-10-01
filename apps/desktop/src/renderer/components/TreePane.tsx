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
  AUTO_THEME_OPTION,
  type FavoritePreference,
  type FavoritesPlacement,
  THEME_GROUPS,
  type ThemePreference,
  getThemeLabel,
} from "../../shared/appPreferences";
import type { RendererCommandType } from "../../shared/rendererCommands";
import {
  type LeftToolbarItems,
  type ToolbarItemId,
  getToolbarItemDefinition,
} from "../../shared/toolbarItems";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import {
  type TreeItemId,
  type TreePresentationItem,
  buildTreePresentation,
  createFavoriteItemId,
  getFavoriteLabel,
} from "../lib/favorites";
import { FavoriteItemIcon, TreeFolderIcon } from "../lib/fileIcons";
import type { HistoryMenuEntry } from "../lib/historyMenu";
import { HistoryButton } from "./HistoryButton";
import { ToolbarIcon } from "./ToolbarIcon";

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
  activeLeftPaneSubview,
  favoritesExpanded,
  onFocusChange,
  onLeftPaneSubviewChange,
  onGoHome,
  canGoBack,
  onGoBack,
  canGoForward,
  onGoForward,
  backHistory = [],
  forwardHistory = [],
  onGoToHistoryIndex = () => undefined,
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
  showRail = false,
  showBottomRail = true,
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
  activeLeftPaneSubview: "favorites" | "tree";
  favoritesExpanded: boolean;
  onFocusChange: (focused: boolean) => void;
  onLeftPaneSubviewChange: (value: "favorites" | "tree") => void;
  onGoHome: () => void;
  canGoBack?: boolean;
  onGoBack?: () => void;
  canGoForward?: boolean;
  onGoForward?: () => void;
  /** The folders Back and Forward lead to, nearest first, for their hold menus. */
  backHistory?: HistoryMenuEntry[];
  forwardHistory?: HistoryMenuEntry[];
  onGoToHistoryIndex?: (historyIndex: number) => void;
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
  theme: ThemePreference;
  themeMenuOpen: boolean;
  themeButtonRef: React.RefObject<HTMLButtonElement | null>;
  themeMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleThemeMenu: () => void;
  onSelectTheme: (theme: ThemePreference) => void;
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
  // Both rails are optional and independent. The left rail shows the "main" items beside
  // the sidebar; the bottom rail shows the "utility" items under it. With only the left
  // rail on, the utility items dock at its foot.
  showRail?: boolean;
  showBottomRail?: boolean;
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
  const [optimisticSelectedItemId, setOptimisticSelectedItemId] = useState<TreeItemId | null>(null);
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
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
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

  useKeepInViewport(themeMenuRef, themeMenuOpen);

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
      // The narrowest a menu gets (`.toolbar-menu`).
      const menuWidth = 220;
      const maxLeft = window.innerWidth - menuWidth - 12;
      // The menu opens above a bottom rail button, and beside a left rail button.
      setThemeMenuViewportPosition(
        button.closest(".sidebar-bottom-rail")
          ? {
              left: Math.max(12, Math.min(rect.left, maxLeft)),
              bottom: Math.max(window.innerHeight - rect.top + 6, 8),
            }
          : {
              left: Math.max(12, Math.min(rect.right + 10, maxLeft)),
              bottom: Math.max(window.innerHeight - rect.bottom, 8),
            },
      );
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
    void selectedRowRegistrationVersion;
    void treeVisibilityVersion;
    if (!selectedTreeItemId) {
      return;
    }
    const currentRow = rowRefs.current[selectedTreeItemId];
    if (!currentRow || typeof currentRow.scrollIntoView !== "function") {
      return;
    }
    const scrollContainer = currentRow.closest<HTMLElement>(".tree-scroll, .sidebar-sections");
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
      if (!(target instanceof Element) || target.closest(".tree-row")) {
        return;
      }
      const scrollContainer = target.closest<HTMLElement>(".tree-scroll, .sidebar-sections");
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
      return <div key={itemId} className="sidebar-rail-separator" aria-hidden="true" />;
    }
    if (itemId === "back") {
      return (
        <HistoryButton
          key={itemId}
          className="sidebar-rail-button"
          label="Back"
          title={getToolbarTooltip(itemId)}
          disabled={!canGoBack || !onGoBack}
          entries={backHistory}
          onStep={onGoBack}
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
          className="sidebar-rail-button"
          label="Forward"
          title={getToolbarTooltip(itemId)}
          disabled={!canGoForward || !onGoForward}
          entries={forwardHistory}
          onStep={onGoForward}
          onSelectEntry={onGoToHistoryIndex}
        >
          <ToolbarIcon name="forward" />
        </HistoryButton>
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
      const renderThemeMenuItem = (option: { value: ThemePreference; label: string }) => (
        <button
          key={option.value}
          type="button"
          className="toolbar-menu-item"
          role="menuitemradio"
          aria-checked={theme === option.value}
          onClick={() => onSelectTheme(option.value)}
        >
          <span className="toolbar-menu-check" aria-hidden="true">
            {theme === option.value ? "✓" : ""}
          </span>
          <span className="toolbar-menu-label">{option.label}</span>
        </button>
      );
      const themeMenu =
        themeMenuOpen && themeMenuViewportPosition
          ? createPortal(
              <div
                ref={themeMenuRef}
                className="toolbar-menu theme-menu"
                role="menu"
                aria-label="Theme"
                style={{
                  position: "fixed",
                  left: `${themeMenuViewportPosition.left}px`,
                  bottom: `${themeMenuViewportPosition.bottom}px`,
                }}
              >
                {renderThemeMenuItem(AUTO_THEME_OPTION)}
                {THEME_GROUPS.map((group) => (
                  <Fragment key={group.value}>
                    <hr className="toolbar-menu-separator" />
                    {group.options.map(renderThemeMenuItem)}
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
            aria-haspopup="menu"
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
          aria-label="Go To"
        >
          <ToolbarIcon name="location" />
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
        className="sidebar-rail-button"
        onClick={() => onRendererCommand(commandType)}
        disabled={!canRunRendererCommand(commandType)}
        title={formatToolbarTooltip(definition.label, definition.shortcutLabel)}
        aria-label={definition.label}
      >
        <ToolbarIcon name={definition.icon} />
      </button>
    );
  }

  // Finder-style collapsible section header: the title toggles the section, with a
  // disclosure chevron that appears on hover (and stays visible while collapsed).
  function renderSectionHeader(
    title: string,
    expanded: boolean,
    onToggle: () => void,
    controlsId: string,
  ) {
    return (
      <button
        type="button"
        className={`sidebar-section-header${expanded ? "" : " collapsed"}`}
        aria-expanded={expanded}
        aria-controls={controlsId}
        title={expanded ? `Hide ${title}` : `Show ${title}`}
        onClick={onToggle}
      >
        <span className="sidebar-section-title">{title}</span>
        <span className="sidebar-section-chevron" aria-hidden="true">
          <ToolbarIcon name="chevron" />
        </span>
      </button>
    );
  }

  // Favorites as a collapsible root row in the folder tree, scrolling with it.
  function renderIntegratedTree() {
    return (
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
          getItemDropIndicator={getItemDropIndicator}
          subview="tree"
          onSubviewFocus={() => onLeftPaneSubviewChange("tree")}
          registerRowRef={registerTreeRowRef}
        />
      </div>
    );
  }

  function renderToolbarItems(items: readonly ToolbarItemId[]) {
    const keyCounts = new Map<string, number>();
    return items
      .filter((itemId) => itemId !== "settings")
      .map((itemId) => {
        const keyCount = (keyCounts.get(itemId) ?? 0) + 1;
        keyCounts.set(itemId, keyCount);
        return <Fragment key={`${itemId}:${keyCount}`}>{renderLeftToolbarItem(itemId)}</Fragment>;
      });
  }

  // Settings always closes the utility items, whichever rail shows them. Docked at the foot
  // of the left rail, they skip buttons that rail already shows.
  function renderUtilityItems(dockedInLeftRail: boolean) {
    const items = dockedInLeftRail
      ? leftToolbarItems.utility.filter(
          (itemId) =>
            getToolbarItemDefinition(itemId).allowDuplicates ||
            !leftToolbarItems.main.includes(itemId),
        )
      : leftToolbarItems.utility;
    return (
      <>
        {renderToolbarItems(items)}
        {renderLeftToolbarItem("settings")}
      </>
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
          !target.closest(".tree-scroll, .tree-row, .sidebar-sections, .sidebar-tree")
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
      {/* Space for the window's traffic lights; the sidebar runs the full window height. */}
      <div className="sidebar-titlebar" aria-hidden="true" />
      <div className={`sidebar-shell${showRail ? "" : " sidebar-shell-no-rail"}`}>
        {showRail ? (
          <aside className="sidebar-rail" aria-label="Left rail">
            <div className="sidebar-rail-group sidebar-rail-group-main">
              {renderToolbarItems(leftToolbarItems.main)}
            </div>
            {showBottomRail ? null : (
              <div className="sidebar-rail-group sidebar-rail-group-utility">
                {renderUtilityItems(true)}
              </div>
            )}
          </aside>
        ) : null}
        <div className="sidebar-main sidebar-main-native">
          {/* Finder layout: a labeled Favorites list above the folder tree, or Favorites as
              a root row inside the tree. */}
          {favoritesPlacement === "separate" && favoriteItems.length > 0 ? (
            <div className="sidebar-sections">
              <section
                className={`sidebar-favorites favorites-pane-section${
                  activeLeftPaneSubview === "favorites" ? " active" : ""
                }`}
                aria-label="Favorites"
                data-drag-active={dragActive ? "true" : "false"}
                data-left-subview="favorites"
                onMouseDownCapture={handlePaneMouseDownCapture("favorites")}
                onDragEnterCapture={handlePaneDragEnterCapture(favoriteItemsById, "favorites")}
                onDragOverCapture={handlePaneDragOverCapture(favoriteItemsById, "favorites")}
                onDropCapture={handlePaneDropCapture(favoriteItemsById, "favorites")}
              >
                {renderSectionHeader(
                  "Favorites",
                  favoritesExpanded,
                  () => {
                    // Keyboard navigation cannot stay in a hidden list.
                    if (favoritesExpanded && activeLeftPaneSubview === "favorites") {
                      onLeftPaneSubviewChange("tree");
                    }
                    onToggleFavoritesExpanded();
                  },
                  "sidebar-favorites-list",
                )}
                {favoritesExpanded ? (
                  <div
                    id="sidebar-favorites-list"
                    className="tree-list favorites-list"
                    role="tree"
                    aria-label="Favorites"
                  >
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
                ) : null}
              </section>
            </div>
          ) : null}
          {favoritesPlacement === "separate" ? (
            <div className={`sidebar-header${isFocused ? " sidebar-header-focused" : ""}`}>
              <span className="sidebar-title">Folders</span>
            </div>
          ) : null}
          {typeaheadQuery ? (
            <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
              <span className="pane-typeahead-label">Jump to</span>
              <span className="pane-typeahead-value">{typeaheadQuery}</span>
            </div>
          ) : null}
          {favoritesPlacement === "separate" ? (
            <div
              className={`sidebar-tree filesystem-tree-section${
                activeLeftPaneSubview === "tree" ? " active" : ""
              }`}
              data-drag-active={dragActive ? "true" : "false"}
              data-left-subview="tree"
              onMouseDownCapture={handlePaneMouseDownCapture("tree")}
              onDragEnterCapture={handlePaneDragEnterCapture(filesystemPresentation.items, "tree")}
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
          ) : (
            renderIntegratedTree()
          )}
          {showBottomRail ? (
            <footer className="sidebar-bottom-rail" aria-label="Bottom rail">
              {renderUtilityItems(false)}
            </footer>
          ) : null}
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
      <div className="tree-list" role="tree" aria-label="Folders">
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
    // The branch wrapper is purely structural; rows are flattened in the DOM, so the
    // tree pattern is expressed with aria-level on each treeitem instead of nested
    // role="group" containers.
    <div className="tree-branch" role="presentation">
      <div
        ref={(element) => registerRowRef(item.id, element)}
        className={`tree-row${isCurrent ? " active" : ""}${isCurrent && !isPaneFocused ? " inactive" : ""}`}
        role="treeitem"
        aria-selected={isCurrent}
        aria-expanded={canExpand ? item.expanded : undefined}
        aria-level={item.depth + 1}
        data-tree-item-id={item.id}
        data-drop-target-state={dropIndicator ?? "none"}
        data-tree-path={itemPath ?? item.id}
        data-tree-kind={item.kind}
        style={{ paddingLeft: `calc(8px + ${item.depth} * var(--tree-indent))` }}
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
            <TreeFolderIcon open={item.expanded} alias={item.isSymlink} path={itemPath} />
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
        <div
          className="tree-loading"
          style={{ paddingLeft: `calc(38px + ${item.depth} * var(--tree-indent))` }}
        >
          Loading folder…
        </div>
      ) : null}
      {item.error ? (
        <div
          className="tree-error"
          style={{ paddingLeft: `calc(38px + ${item.depth} * var(--tree-indent))` }}
        >
          {item.error}
        </div>
      ) : null}
    </div>
  );
}
