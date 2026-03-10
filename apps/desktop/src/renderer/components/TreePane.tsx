import { Fragment, type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import {
  THEME_GROUPS,
  type FavoritePreference,
  type ThemeMode,
  getThemeLabel,
} from "../../shared/appPreferences";
import {
  buildTreePresentation,
  type TreeItemId,
  type TreePresentationItem,
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
  error: string | null;
  childPaths: string[];
};

// TreePane is largely controlled by App. It renders the current tree model and emits user
// intents, while App owns async loading, expansion state, and path synchronization.
export function TreePane({
  paneRef,
  isFocused,
  rootPath,
  homePath,
  compactTreeView = false,
  nodes,
  selectedTreeItemId,
  favorites,
  favoritesExpanded,
  onFocusChange,
  onGoHome,
  onRerootHome,
  onOpenLocation,
  onQuickAccess,
  foldersFirst,
  onToggleFoldersFirst,
  onToggleInfoPanel,
  infoPanelOpen,
  onToggleInfoRow,
  infoRowOpen,
  theme,
  themeMenuOpen,
  themeButtonRef,
  themeMenuRef,
  onToggleThemeMenu,
  onSelectTheme,
  onOpenHelp,
  onOpenSettings,
  includeHidden,
  onToggleHidden,
  onToggleExpand,
  onNavigate,
  onNavigateFavorite,
  onToggleFavoritesExpanded,
  typeaheadQuery,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  homePath: string;
  compactTreeView?: boolean;
  nodes: Record<string, TreeNodeState>;
  selectedTreeItemId: TreeItemId;
  favorites: FavoritePreference[];
  favoritesExpanded: boolean;
  onFocusChange: (focused: boolean) => void;
  onGoHome: () => void;
  onRerootHome: () => void;
  onOpenLocation?: () => void;
  onQuickAccess: (location: "root" | "applications" | "trash") => void;
  foldersFirst: boolean;
  onToggleFoldersFirst: () => void;
  onToggleInfoPanel: () => void;
  infoPanelOpen: boolean;
  onToggleInfoRow: () => void;
  infoRowOpen: boolean;
  theme: ThemeMode;
  themeMenuOpen: boolean;
  themeButtonRef: React.RefObject<HTMLButtonElement | null>;
  themeMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleThemeMenu: () => void;
  onSelectTheme: (theme: ThemeMode) => void;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
  includeHidden: boolean;
  onToggleHidden: () => void;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => void;
  onNavigateFavorite: (path: string) => Promise<boolean> | void;
  onToggleFavoritesExpanded: () => void;
  typeaheadQuery?: string;
}) {
  const presentation = buildTreePresentation({
    favorites,
    favoritesExpanded,
    homePath,
    rootPath,
    nodes,
  });
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const clickTimeoutRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const lastScrolledPathRef = useRef<string | null>(null);
  const lastScrolledRowRef = useRef<HTMLDivElement | null>(null);
  const [optimisticSelectedItemId, setOptimisticSelectedItemId] = useState<TreeItemId | null>(null);

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
    const currentRow = rowRefs.current[selectedTreeItemId];
    if (!currentRow || typeof currentRow.scrollIntoView !== "function") {
      return;
    }
    // Selection can move because of keyboard navigation, typeahead, or external path sync.
    // Keep the active row visible without repeatedly re-scrolling the same element.
    if (
      lastScrolledPathRef.current === selectedTreeItemId &&
      lastScrolledRowRef.current === currentRow
    ) {
      return;
    }
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      currentRow.scrollIntoView({
        block: "nearest",
      });
      lastScrolledPathRef.current = selectedTreeItemId;
      lastScrolledRowRef.current = currentRow;
      scrollFrameRef.current = null;
    });
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [selectedTreeItemId]);

  useEffect(() => {
    setOptimisticSelectedItemId(null);
  }, [selectedTreeItemId]);

  return (
    <aside
      ref={paneRef}
      className={`tree-pane sidebar pane pane-focus-target${compactTreeView ? " compact-tree-view" : ""}`}
      tabIndex={-1}
      onMouseDownCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(".tree-scroll, .tree-row")) {
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
          {/* The rail keeps navigation, visibility toggles, and global app controls in a
              stable order so icon muscle memory holds across themes and layouts. */}
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={onGoHome}
            title="Home"
            aria-label="Quick access Home"
          >
            <ToolbarIcon name="home" />
          </button>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => onQuickAccess("root")}
            title="Macintosh HD"
            aria-label="Quick access Macintosh HD"
          >
            <ToolbarIcon name="drive" />
          </button>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => onQuickAccess("applications")}
            title="Applications"
            aria-label="Quick access Applications"
          >
            <ToolbarIcon name="applications" />
          </button>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => onQuickAccess("trash")}
            title="Trash"
            aria-label="Quick access Trash"
          >
            <ToolbarIcon name="trash" />
          </button>
          <span className="sidebar-rail-separator" />
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={onRerootHome}
            title="Root tree at Home"
            aria-label="Root tree at Home"
          >
            <ToolbarIcon name="rerootHome" />
          </button>
          <span className="sidebar-rail-separator" />
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={onOpenLocation}
            title="Go to Folder (Cmd+Shift+G)"
            aria-label="Go to Folder"
          >
            <ToolbarIcon name="location" />
          </button>
          <span className="sidebar-rail-separator" />
          <button
            type="button"
            className={`sidebar-rail-button${foldersFirst ? " active" : ""}`}
            onClick={onToggleFoldersFirst}
            title={foldersFirst ? "Folders first" : "Mixed file and folder order"}
            aria-label="Toggle folders first"
            aria-pressed={foldersFirst}
          >
            <ToolbarIcon name="foldersFirst" />
          </button>
          <button
            type="button"
            className={`sidebar-rail-button${includeHidden ? " active" : ""}`}
            onClick={onToggleHidden}
            title="Toggle hidden files"
            aria-label="Toggle hidden files"
          >
            <ToolbarIcon name="hidden" />
          </button>
          <button
            type="button"
            className={`sidebar-rail-button${infoPanelOpen ? " active" : ""}`}
            onClick={onToggleInfoPanel}
            title="Toggle Info Panel (Cmd+I)"
            aria-label="Toggle Info Panel"
          >
            <ToolbarIcon name="drawer" />
          </button>
          <button
            type="button"
            className={`sidebar-rail-button${infoRowOpen ? " active" : ""}`}
            onClick={onToggleInfoRow}
            title="Toggle Info Row (Cmd+Shift+I)"
            aria-label="Toggle Info Row"
          >
            <ToolbarIcon name="infoRow" />
          </button>
          <div className="sidebar-rail-spacer" />
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={onOpenHelp}
            title="Help"
            aria-label="Open help"
          >
            <ToolbarIcon name="help" />
          </button>
          <div className="sidebar-rail-menu-anchor">
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
            {themeMenuOpen ? (
              <div ref={themeMenuRef} className="sidebar-rail-menu" tabIndex={-1}>
                {THEME_GROUPS.map((group, groupIndex) => (
                  <Fragment key={group.value}>
                    {groupIndex > 0 ? (
                      <div className="sidebar-rail-menu-separator" role="separator" />
                    ) : null}
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
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={onOpenSettings}
            title="Settings (Cmd+,)"
            aria-label="Open settings"
          >
            <ToolbarIcon name="settings" />
          </button>
        </aside>
        <div className="sidebar-main">
          <div className="sidebar-header">
            <span className="sidebar-title">Folders</span>
          </div>
          {typeaheadQuery ? (
            <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
              <span className="pane-typeahead-label">Jump to</span>
              <span className="pane-typeahead-value">{typeaheadQuery}</span>
            </div>
          ) : null}
          <div className="sidebar-tree">
            <div className="tree-scroll">
              <div className="tree-list">
                {presentation.visibleItemIds.map((itemId) => {
                  const item = presentation.items[itemId];
                  if (!item) {
                    return null;
                  }
                  const path = item.path;
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
                      onNavigate={onNavigate}
                      onNavigateFavorite={onNavigateFavorite}
                      registerRowRef={(id, element) => {
                        rowRefs.current[id] = element;
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
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
  onNavigate,
  onNavigateFavorite,
  registerRowRef,
}: {
  item: TreePresentationItem;
  isPaneFocused: boolean;
  selectedTreeItemId: TreeItemId;
  clickTimeoutRef: React.RefObject<number | null>;
  optimisticSelectedItemId: TreeItemId | null;
  setOptimisticSelectedItemId: Dispatch<SetStateAction<TreeItemId | null>>;
  onToggleExpand: (path: string) => void;
  onToggleFavoritesExpanded: () => void;
  onNavigate: (path: string) => Promise<boolean> | void;
  onNavigateFavorite: (path: string) => Promise<boolean> | void;
  registerRowRef: (id: string, element: HTMLDivElement | null) => void;
}) {
  const isCurrent = (optimisticSelectedItemId ?? selectedTreeItemId) === item.id;
  const canExpand =
    item.kind === "favorites-root" ? item.canExpand : item.kind === "filesystem" ? !item.isSymlink : false;
  const isFavorite = item.kind === "favorite";
  const isFavoritesRoot = item.kind === "favorites-root";
  const isFileSystem = item.kind === "filesystem";
  const itemPath = item.path;

  return (
    <div className="tree-branch">
      <div
        ref={(element) => registerRowRef(item.id, element)}
        className={`tree-row${isCurrent ? " active" : ""}${isCurrent && !isPaneFocused ? " inactive" : ""}`}
        data-tree-path={itemPath ?? item.id}
        data-tree-kind={item.kind}
        style={{ paddingLeft: `${12 + item.depth * 16}px` }}
      >
        <button
          type="button"
          className={`tree-expand${item.expanded ? " expanded" : ""}${
            !canExpand && !item.loading ? " empty" : ""
          }`}
          onClick={() => {
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
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            setOptimisticSelectedItemId(item.id);
          }}
          onClick={() => {
            if (isFavoritesRoot) {
              return;
            }
            if (clickTimeoutRef.current !== null) {
              window.clearTimeout(clickTimeoutRef.current);
            }
            clickTimeoutRef.current = window.setTimeout(() => {
              clickTimeoutRef.current = null;
              const navigationResult = itemPath
                ? isFavorite
                  ? onNavigateFavorite(itemPath)
                  : onNavigate(itemPath)
                : undefined;
              if (!navigationResult || typeof navigationResult.then !== "function") {
                return;
              }
              void navigationResult.then((didNavigate) => {
                if (!didNavigate) {
                  setOptimisticSelectedItemId(null);
                }
              });
            }, 180);
          }}
          onDoubleClick={() => {
            if (isFavoritesRoot) {
              onToggleFavoritesExpanded();
              return;
            }
            if (clickTimeoutRef.current !== null) {
              window.clearTimeout(clickTimeoutRef.current);
              clickTimeoutRef.current = null;
            }
            setOptimisticSelectedItemId(item.id);
            if (isFileSystem && itemPath) {
              onToggleExpand(itemPath);
            }
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
