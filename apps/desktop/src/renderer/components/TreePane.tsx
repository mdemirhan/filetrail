import {
  type Dispatch,
  type SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { FavoritePreference, FavoritesPlacement } from "../../shared/appPreferences";
import { useDelayedFlag } from "../hooks/useDelayedFlag";
import {
  ClipboardMarkIcon,
  clipboardMarkClassName,
  useClipboardMarks,
} from "../lib/clipboardMarks";
import {
  type SidebarLocation,
  type TreeItemId,
  type TreePresentationItem,
  buildLocationItems,
  buildTreePresentation,
  createFavoriteItemId,
  getFavoriteLabel,
} from "../lib/favorites";
import { FavoriteItemIcon, TreeFolderIcon } from "../lib/fileIcons";
import { ToolbarIcon } from "./ToolbarIcon";

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
  forcedVisiblePackageChildPath?: string | null;
  error: string | null;
  childPaths: string[];
};

// The row a context menu is open for: it gets a ring, and the selection stays on the folder
// being shown.
export type TreeContextMenuTarget = {
  path: string;
  subview: "favorites" | "tree";
  kind: "favorite" | "treeFolder";
};

// A favorite dragged to a new place in its list. The drag carries this type alone, no files,
// so the file drops of the sidebar and the window take no notice of it.
const FAVORITE_DRAG_TYPE = "application/x-filetrail-favorite";

type FavoriteDropTarget = { path: string; position: "before" | "after" };

type FavoriteReorder = {
  draggedPath: string | null;
  dropTarget: FavoriteDropTarget | null;
  start: (path: string) => void;
  over: (target: FavoriteDropTarget | null) => void;
  drop: () => void;
  end: () => void;
};

const FavoriteReorderContext = createContext<FavoriteReorder | null>(null);

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
  onClearSelection,
  includeHidden,
  onToggleExpand,
  onNavigate,
  onNavigateFavorite,
  onOpenInNewTab,
  onSelectFavoritesRoot,
  onItemContextMenu,
  contextMenuTarget = null,
  onItemDragEnter,
  onItemDragOver,
  onItemDrop,
  getItemDropIndicator,
  onToggleFavoritesExpanded,
  locations = [],
  locationsExpanded = true,
  onToggleLocationsExpanded = () => undefined,
  onSelectItem,
  onReorderFavorites,
  typeaheadQuery,
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
  onClearSelection: () => void;
  includeHidden: boolean;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => Promise<boolean | undefined> | undefined;
  onNavigateFavorite: (path: string) => Promise<boolean | undefined> | undefined;
  /** ⌘-click on a folder or a favorite. */
  onOpenInNewTab?: ((path: string) => void) | undefined;
  onSelectFavoritesRoot?: (() => Promise<boolean | undefined> | undefined) | undefined;
  onItemContextMenu?:
    | ((
        item: TreePresentationItem,
        subview: "favorites" | "tree",
        position: { x: number; y: number },
      ) => void)
    | undefined;
  contextMenuTarget?: TreeContextMenuTarget | null;
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
  /** The disks: Macintosh HD and those mounted, under Locations after the favorites. */
  locations?: SidebarLocation[];
  locationsExpanded?: boolean;
  onToggleLocationsExpanded?: () => void;
  /** Selects a row that is neither a folder nor a favorite: a disk, or the Locations row. */
  onSelectItem?: ((itemId: TreeItemId) => Promise<unknown> | undefined) | undefined;
  /** A favorite dragged just before or after another. Unset, favorites can't be dragged. */
  onReorderFavorites?:
    | ((movedPath: string, targetPath: string, position: "before" | "after") => void)
    | undefined;
  typeaheadQuery?: string;
}) {
  const [favoriteDrag, setFavoriteDrag] = useState<{
    draggedPath: string;
    dropTarget: FavoriteDropTarget | null;
  } | null>(null);
  const favoriteReorder = useMemo<FavoriteReorder | null>(
    () =>
      onReorderFavorites
        ? {
            draggedPath: favoriteDrag?.draggedPath ?? null,
            dropTarget: favoriteDrag?.dropTarget ?? null,
            start: (path) => setFavoriteDrag({ draggedPath: path, dropTarget: null }),
            over: (target) =>
              setFavoriteDrag((current) =>
                current &&
                (current.dropTarget?.path !== target?.path ||
                  current.dropTarget?.position !== target?.position)
                  ? { ...current, dropTarget: target }
                  : current,
              ),
            drop: () => {
              if (favoriteDrag?.dropTarget) {
                onReorderFavorites(
                  favoriteDrag.draggedPath,
                  favoriteDrag.dropTarget.path,
                  favoriteDrag.dropTarget.position,
                );
              }
              setFavoriteDrag(null);
            },
            end: () => setFavoriteDrag(null),
          }
        : null,
    [favoriteDrag, onReorderFavorites],
  );
  const integratedPresentation = useMemo(
    () =>
      buildTreePresentation({
        favorites,
        favoritesExpanded,
        homePath,
        rootPath,
        nodes,
        includeFavorites: favoritesPlacement === "integrated",
        locations,
        locationsExpanded,
      }),
    [
      favorites,
      favoritesExpanded,
      homePath,
      rootPath,
      nodes,
      favoritesPlacement,
      locations,
      locationsExpanded,
    ],
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
  // The separate layout's Locations section, below the Favorites list.
  const locationItems = useMemo(() => buildLocationItems(locations, null, 0), [locations]);
  const locationItemsById = useMemo(
    () => new Map(locationItems.map((item) => [item.id, item])),
    [locationItems],
  );
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const clickTimeoutRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const lastRegisteredSelectedRowRef = useRef<HTMLDivElement | null>(null);
  const lastRegisteredSelectedItemIdRef = useRef(selectedTreeItemId);
  const lastCommittedSelectedItemIdRef = useRef(selectedTreeItemId);
  const [optimisticSelectedItemId, setOptimisticSelectedItemId] = useState<TreeItemId | null>(null);
  const [selectedRowRegistrationVersion, setSelectedRowRegistrationVersion] = useState(0);
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
      if (!item || item.kind === "favorites-root" || item.kind === "locations-root") {
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
      // A favorite being put in order shows where it lands only over another favorite.
      if (favoriteReorder?.draggedPath && item?.kind !== "favorite") {
        favoriteReorder.over(null);
      }
      if (!item || item.kind === "favorites-root" || item.kind === "locations-root") {
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
      if (!item || item.kind === "favorites-root" || item.kind === "locations-root") {
        return;
      }
      onItemDrop?.(item, event, subview);
    };
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

  // A row of the separate layout's Favorites or Locations list.
  function renderSidebarListRow(item: TreePresentationItem) {
    return (
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
        onToggleLocationsExpanded={onToggleLocationsExpanded}
        onSelectItem={onSelectItem}
        singleClickExpandTreeItems={singleClickExpandTreeItems}
        onClearSelection={onClearSelection}
        onNavigate={onNavigate}
        onNavigateFavorite={onNavigateFavorite}
        onOpenInNewTab={onOpenInNewTab}
        onSelectFavoritesRoot={onSelectFavoritesRoot}
        onItemContextMenu={onItemContextMenu}
        contextMenuTarget={contextMenuTarget}
        onItemDragEnter={onItemDragEnter}
        onItemDragOver={onItemDragOver}
        onItemDrop={onItemDrop}
        getItemDropIndicator={getItemDropIndicator}
        subview="favorites"
        onSubviewFocus={() => onLeftPaneSubviewChange("favorites")}
        registerRowRef={registerTreeRowRef}
      />
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
          onToggleLocationsExpanded={onToggleLocationsExpanded}
          onSelectItem={onSelectItem}
          singleClickExpandTreeItems={singleClickExpandTreeItems}
          onClearSelection={onClearSelection}
          onNavigate={onNavigate}
          onNavigateFavorite={onNavigateFavorite}
          onOpenInNewTab={onOpenInNewTab}
          onSelectFavoritesRoot={onSelectFavoritesRoot}
          onItemContextMenu={onItemContextMenu}
          contextMenuTarget={contextMenuTarget}
          getItemDropIndicator={getItemDropIndicator}
          subview="tree"
          onSubviewFocus={() => onLeftPaneSubviewChange("tree")}
          registerRowRef={registerTreeRowRef}
        />
      </div>
    );
  }

  return (
    <FavoriteReorderContext.Provider value={favoriteReorder}>
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
        <div className="sidebar-shell">
          <div className="sidebar-main sidebar-main-native">
            {/* Finder layout: a labeled Favorites list above the folder tree, or Favorites as
              a root row inside the tree. */}
            {favoritesPlacement === "separate" &&
            (favoriteItems.length > 0 || locationItems.length > 0) ? (
              <div className="sidebar-sections overlay-scroll">
                {favoriteItems.length > 0 ? (
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
                        {favoriteItems.map(renderSidebarListRow)}
                      </div>
                    ) : null}
                  </section>
                ) : null}
                {locationItems.length > 0 ? (
                  <section
                    className="sidebar-locations favorites-pane-section"
                    aria-label="Locations"
                    data-drag-active={dragActive ? "true" : "false"}
                    data-left-subview="favorites"
                    onMouseDownCapture={handlePaneMouseDownCapture("favorites")}
                    onDragEnterCapture={handlePaneDragEnterCapture(locationItemsById, "favorites")}
                    onDragOverCapture={handlePaneDragOverCapture(locationItemsById, "favorites")}
                    onDropCapture={handlePaneDropCapture(locationItemsById, "favorites")}
                  >
                    {renderSectionHeader(
                      "Locations",
                      locationsExpanded,
                      onToggleLocationsExpanded,
                      "sidebar-locations-list",
                    )}
                    {locationsExpanded ? (
                      <div
                        id="sidebar-locations-list"
                        className="tree-list favorites-list"
                        role="tree"
                        aria-label="Locations"
                      >
                        {locationItems.map(renderSidebarListRow)}
                      </div>
                    ) : null}
                  </section>
                ) : null}
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
                  onToggleLocationsExpanded={onToggleLocationsExpanded}
                  onSelectItem={onSelectItem}
                  singleClickExpandTreeItems={singleClickExpandTreeItems}
                  onClearSelection={onClearSelection}
                  onNavigate={onNavigate}
                  onNavigateFavorite={onNavigateFavorite}
                  onOpenInNewTab={onOpenInNewTab}
                  onSelectFavoritesRoot={onSelectFavoritesRoot}
                  onItemContextMenu={onItemContextMenu}
                  contextMenuTarget={contextMenuTarget}
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
          </div>
        </div>
      </aside>
    </FavoriteReorderContext.Provider>
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
  onToggleLocationsExpanded,
  onSelectItem,
  singleClickExpandTreeItems,
  onClearSelection,
  onNavigate,
  onNavigateFavorite,
  onOpenInNewTab,
  onSelectFavoritesRoot,
  onItemContextMenu,
  contextMenuTarget = null,
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
  onToggleLocationsExpanded: () => void;
  onSelectItem: ((itemId: TreeItemId) => Promise<unknown> | undefined) | undefined;
  singleClickExpandTreeItems: boolean;
  onClearSelection: () => void;
  onNavigate: (path: string) => Promise<boolean | undefined> | undefined;
  onNavigateFavorite: (path: string) => Promise<boolean | undefined> | undefined;
  /** ⌘-click on a folder or a favorite. */
  onOpenInNewTab?: ((path: string) => void) | undefined;
  onSelectFavoritesRoot?: (() => Promise<boolean | undefined> | undefined) | undefined;
  onItemContextMenu?:
    | ((
        item: TreePresentationItem,
        subview: "favorites" | "tree",
        position: { x: number; y: number },
      ) => void)
    | undefined;
  contextMenuTarget?: TreeContextMenuTarget | null;
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
              onToggleLocationsExpanded={onToggleLocationsExpanded}
              onSelectItem={onSelectItem}
              singleClickExpandTreeItems={singleClickExpandTreeItems}
              onClearSelection={onClearSelection}
              onNavigate={onNavigate}
              onNavigateFavorite={onNavigateFavorite}
              onOpenInNewTab={onOpenInNewTab}
              onSelectFavoritesRoot={onSelectFavoritesRoot}
              onItemContextMenu={onItemContextMenu}
              contextMenuTarget={contextMenuTarget}
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

// How long a folder in the tree loads before it says so.
const TREE_LOADING_DELAY_MS = 400;

function TreeItemRow({
  item,
  isPaneFocused,
  selectedTreeItemId,
  clickTimeoutRef,
  optimisticSelectedItemId,
  setOptimisticSelectedItemId,
  onToggleExpand,
  onToggleFavoritesExpanded,
  onToggleLocationsExpanded,
  onSelectItem,
  singleClickExpandTreeItems,
  onClearSelection,
  onNavigate,
  onNavigateFavorite,
  onOpenInNewTab,
  onSelectFavoritesRoot,
  onItemContextMenu,
  contextMenuTarget = null,
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
  onToggleLocationsExpanded: () => void;
  onSelectItem: ((itemId: TreeItemId) => Promise<unknown> | undefined) | undefined;
  singleClickExpandTreeItems: boolean;
  onClearSelection: () => void;
  onNavigate: (path: string) => Promise<boolean | undefined> | undefined;
  onNavigateFavorite: (path: string) => Promise<boolean | undefined> | undefined;
  /** ⌘-click on a folder or a favorite. */
  onOpenInNewTab?: ((path: string) => void) | undefined;
  onSelectFavoritesRoot?: (() => Promise<boolean | undefined> | undefined) | undefined;
  onItemContextMenu?:
    | ((
        item: TreePresentationItem,
        subview: "favorites" | "tree",
        position: { x: number; y: number },
      ) => void)
    | undefined;
  contextMenuTarget?: TreeContextMenuTarget | null;
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
  // Most folders list in a few milliseconds: their "Loading folder…" line would only flash
  // under the row (and vanish again for a folder without subfolders), so it waits.
  const showLoading = useDelayedFlag(item.loading === true, TREE_LOADING_DELAY_MS);
  const isCurrent = (optimisticSelectedItemId ?? selectedTreeItemId) === item.id;
  const isMenuTarget =
    contextMenuTarget !== null &&
    contextMenuTarget.path === item.path &&
    contextMenuTarget.subview === subview &&
    contextMenuTarget.kind ===
      (item.kind === "favorite" || item.kind === "location" ? "favorite" : "treeFolder");
  const canExpand =
    item.kind === "favorites-root" || item.kind === "locations-root"
      ? item.canExpand
      : item.kind === "filesystem"
        ? !item.isSymlink
        : false;
  const isFavorite = item.kind === "favorite";
  const isLocation = item.kind === "location";
  const isLocationsRoot = item.kind === "locations-root";
  // The Favorites and Locations rows: section heads, not places.
  const isFavoritesRoot = item.kind === "favorites-root" || isLocationsRoot;
  const toggleSection = isLocationsRoot ? onToggleLocationsExpanded : onToggleFavoritesExpanded;
  const isFileSystem = item.kind === "filesystem";
  const itemPath = item.path;
  const dropIndicator = getItemDropIndicator?.(item, subview) ?? null;
  // A favorite points at a folder; only the folder's own row in the tree is marked.
  const clipboardMarks = useClipboardMarks("tree");
  const clipboardPath = isFileSystem ? itemPath : null;
  // A favorite can be dragged before or after another to put the favorites in order.
  const favoriteReorder = useContext(FavoriteReorderContext);
  const reorderPath = favoriteReorder !== null && isFavorite ? itemPath : null;
  const favoriteDropPosition =
    reorderPath !== null && favoriteReorder?.dropTarget?.path === reorderPath
      ? favoriteReorder.dropTarget.position
      : null;

  // ⌘-click on a folder that is not on screen opens it in a new tab; the tab on screen and
  // its selection in the tree stay as they are.
  const opensInNewTab = Boolean(onOpenInNewTab) && !isCurrent && !isFavoritesRoot && itemPath;

  function handleActivatePointerDown(metaKey: boolean, button: number, ctrlKey: boolean) {
    // Control-click opens the context menu, which leaves the selection alone.
    if (button !== 0 || ctrlKey) {
      return;
    }
    onSubviewFocus();
    if (metaKey && isCurrent) {
      setOptimisticSelectedItemId(null);
      return;
    }
    if (metaKey && opensInNewTab) {
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
    if (metaKey && opensInNewTab && itemPath) {
      onOpenInNewTab?.(itemPath);
      return;
    }
    if (isLocationsRoot) {
      onSelectItem?.(item.id);
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
      toggleSection();
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
    const navigationResult = isLocation
      ? (onSelectItem?.(item.id) as Promise<boolean | undefined> | undefined)
      : isFavorite
        ? onNavigateFavorite(itemPath)
        : onNavigate(itemPath);
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
    // The menu acts on this row, but the selection stays on the folder being shown: the row
    // gets a ring while the menu is open instead.
    onSubviewFocus();
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
        className={`tree-row${isCurrent ? " active" : ""}${
          isCurrent && !isPaneFocused ? " inactive" : ""
        }${isMenuTarget ? " menu-target" : ""}${clipboardMarkClassName(clipboardMarks, clipboardPath)}`}
        role="treeitem"
        aria-selected={isCurrent}
        aria-expanded={canExpand ? item.expanded : undefined}
        aria-level={item.depth + 1}
        data-tree-item-id={item.id}
        data-drop-target-state={dropIndicator ?? "none"}
        data-tree-path={itemPath ?? item.id}
        data-tree-kind={item.kind}
        data-favorite-dragging={
          reorderPath !== null && favoriteReorder?.draggedPath === reorderPath ? "true" : undefined
        }
        draggable={reorderPath !== null}
        onDragStart={
          reorderPath === null
            ? undefined
            : (event) => {
                event.dataTransfer.setData(FAVORITE_DRAG_TYPE, reorderPath);
                event.dataTransfer.effectAllowed = "move";
                favoriteReorder?.start(reorderPath);
              }
        }
        onDragOver={
          reorderPath === null
            ? undefined
            : (event) => {
                if (!favoriteReorder?.draggedPath) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (favoriteReorder.draggedPath === reorderPath) {
                  favoriteReorder.over(null);
                  return;
                }
                // The upper half of a row puts the favorite before it, the lower half after.
                const rect = event.currentTarget.getBoundingClientRect();
                favoriteReorder.over({
                  path: reorderPath,
                  position: event.clientY < rect.top + rect.height / 2 ? "before" : "after",
                });
              }
        }
        onDrop={
          reorderPath === null
            ? undefined
            : (event) => {
                if (!favoriteReorder?.draggedPath) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                favoriteReorder.drop();
              }
        }
        onDragEnd={reorderPath === null ? undefined : () => favoriteReorder?.end()}
        style={{ paddingLeft: `calc(8px + ${item.depth} * var(--tree-indent))` }}
        tabIndex={-1}
        onPointerDown={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest(".tree-label, .tree-expand")) {
            return;
          }
          handleActivatePointerDown(event.metaKey, event.button, event.ctrlKey);
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
              toggleSection();
              return;
            }
            if (isFileSystem && itemPath) {
              onToggleExpand(itemPath);
            }
          }}
          disabled={!canExpand || item.loading}
          aria-label={
            isFavoritesRoot
              ? `${item.expanded ? "Collapse" : "Expand"} ${item.label}`
              : item.expanded
                ? "Collapse Folder"
                : "Expand Folder"
          }
          title={
            !canExpand
              ? isFavoritesRoot
                ? "No favorites"
                : "No subfolders"
              : isFavoritesRoot
                ? `${item.expanded ? "Collapse" : "Expand"} ${item.label}`
                : item.expanded
                  ? "Collapse Folder"
                  : "Expand Folder"
          }
        >
          <ToolbarIcon name="chevron" />
        </button>
        <button
          type="button"
          className="tree-label"
          data-tree-item-id={item.id}
          onFocus={onSubviewFocus}
          onPointerDown={(event) =>
            handleActivatePointerDown(event.metaKey, event.button, event.ctrlKey)
          }
          onClick={(event) => handleActivateClick(event.metaKey)}
          onDoubleClick={() => {
            handleActivateDoubleClick();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            handleActivateContextMenu(event.clientX, event.clientY);
          }}
          title={isLocation ? item.label : (itemPath ?? item.label)}
        >
          {isFavorite || isFavoritesRoot || isLocation ? (
            <FavoriteItemIcon icon={item.icon ?? "folder"} />
          ) : (
            <TreeFolderIcon alias={item.isSymlink} path={itemPath} />
          )}
          <span className="tree-label-text">{item.label}</span>
          <ClipboardMarkIcon marks={clipboardMarks} path={clipboardPath} />
          {item.isSymlink ? <span className="tree-label-badge">Alias</span> : null}
        </button>
        {favoriteDropPosition ? (
          <span
            className="favorite-drop-line"
            data-position={favoriteDropPosition}
            aria-hidden="true"
          />
        ) : null}
        {dropIndicator === "valid" ? (
          <span className="tree-drop-target-badge" aria-hidden="true">
            Drop here
          </span>
        ) : null}
      </div>
      {item.loading && showLoading ? (
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
