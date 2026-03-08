import { useEffect, useRef } from "react";

import { THEME_OPTIONS, type ThemeMode, getThemeLabel } from "../../shared/appPreferences";
import { TreeFolderIcon } from "../lib/fileIcons";
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

export function TreePane({
  paneRef,
  isFocused,
  rootPath,
  homePath,
  compactTreeView = false,
  nodes,
  currentPath,
  onFocusChange,
  onGoHome,
  onRerootHome,
  onQuickAccess,
  foldersFirst,
  onToggleFoldersFirst,
  onToggleDetailRow,
  detailRowOpen,
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
  typeaheadQuery,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  homePath: string;
  compactTreeView?: boolean;
  nodes: Record<string, TreeNodeState>;
  currentPath: string;
  onFocusChange: (focused: boolean) => void;
  onGoHome: () => void;
  onRerootHome: () => void;
  onQuickAccess: (location: "desktop" | "downloads" | "documents" | "source") => void;
  foldersFirst: boolean;
  onToggleFoldersFirst: () => void;
  onToggleDetailRow: () => void;
  detailRowOpen: boolean;
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
  typeaheadQuery?: string;
}) {
  const root = nodes[rootPath];
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const clickTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clickTimeoutRef.current !== null) {
        window.clearTimeout(clickTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const currentRow = rowRefs.current[currentPath];
    if (!currentRow || typeof currentRow.scrollIntoView !== "function") {
      return;
    }
    currentRow.scrollIntoView({
      block: "nearest",
    });
  }, [currentPath]);

  if (!root) {
    return (
      <aside
        ref={paneRef}
        className={`tree-pane sidebar pane pane-focus-target${compactTreeView ? " compact-tree-view" : ""}`}
        tabIndex={-1}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onFocusChange(false);
          }
        }}
      >
        <div className="sidebar-shell">
          <aside className="sidebar-rail" />
          <div className="sidebar-main">
            <div className="sidebar-header">
              <span className="sidebar-title">Folders</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={paneRef}
      className={`tree-pane sidebar pane pane-focus-target${compactTreeView ? " compact-tree-view" : ""}`}
      tabIndex={-1}
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
            onClick={() => onQuickAccess("desktop")}
            title="Desktop"
            aria-label="Quick access Desktop"
          >
            <ToolbarIcon name="desktop" />
          </button>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => onQuickAccess("downloads")}
            title="Downloads"
            aria-label="Quick access Downloads"
          >
            <ToolbarIcon name="downloads" />
          </button>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => onQuickAccess("documents")}
            title="Documents"
            aria-label="Quick access Documents"
          >
            <ToolbarIcon name="documents" />
          </button>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={() => onQuickAccess("source")}
            title="Source"
            aria-label="Quick access Source"
          >
            <ToolbarIcon name="source" />
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
            className={`sidebar-rail-button${detailRowOpen ? " active" : ""}`}
            onClick={onToggleDetailRow}
            title="Toggle detail row"
            aria-label="Toggle detail row"
          >
            <ToolbarIcon name="detailRow" />
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
                {THEME_OPTIONS.map((option) => (
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
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="sidebar-rail-button"
            onClick={onOpenSettings}
            title="Settings"
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
                <TreeNodeRow
                  currentPath={currentPath}
                  depth={0}
                  isPaneFocused={isFocused}
                  node={root}
                  nodes={nodes}
                  clickTimeoutRef={clickTimeoutRef}
                  onToggleExpand={onToggleExpand}
                  onNavigate={onNavigate}
                  registerRowRef={(path, element) => {
                    rowRefs.current[path] = element;
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function TreeNodeRow({
  node,
  nodes,
  currentPath,
  depth,
  isPaneFocused,
  clickTimeoutRef,
  onToggleExpand,
  onNavigate,
  registerRowRef,
}: {
  node: TreeNodeState;
  nodes: Record<string, TreeNodeState>;
  currentPath: string;
  depth: number;
  isPaneFocused: boolean;
  clickTimeoutRef: React.RefObject<number | null>;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => void;
  registerRowRef: (path: string, element: HTMLDivElement | null) => void;
}) {
  const isCurrent = currentPath === node.path;
  const canExpand = !node.isSymlink;

  return (
    <div className="tree-branch">
      <div
        ref={(element) => registerRowRef(node.path, element)}
        className={`tree-row${isCurrent ? " active" : ""}${isCurrent && !isPaneFocused ? " inactive" : ""}`}
        data-tree-path={node.path}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <button
          type="button"
          className={`tree-expand${node.expanded ? " expanded" : ""}${
            !canExpand && !node.loading ? " empty" : ""
          }`}
          onClick={() => onToggleExpand(node.path)}
          disabled={!canExpand || node.loading}
          aria-label={node.expanded ? "Collapse folder" : "Expand folder"}
          title={!canExpand ? "No subfolders" : node.expanded ? "Collapse folder" : "Expand folder"}
        >
          <ToolbarIcon name="chevron" />
        </button>
        <button
          type="button"
          className="tree-label"
          onClick={() => {
            if (clickTimeoutRef.current !== null) {
              window.clearTimeout(clickTimeoutRef.current);
            }
            clickTimeoutRef.current = window.setTimeout(() => {
              clickTimeoutRef.current = null;
              onNavigate(node.path);
            }, 180);
          }}
          onDoubleClick={() => {
            if (clickTimeoutRef.current !== null) {
              window.clearTimeout(clickTimeoutRef.current);
              clickTimeoutRef.current = null;
            }
            onToggleExpand(node.path);
          }}
          title={node.path}
        >
          <TreeFolderIcon open={node.expanded} alias={node.isSymlink} />
          <span className="tree-label-text">{node.name}</span>
          {node.isSymlink ? <span className="tree-label-badge">Alias</span> : null}
        </button>
      </div>
      {node.loading ? (
        <div className="tree-loading" style={{ paddingLeft: `${44 + depth * 16}px` }}>
          Loading folder…
        </div>
      ) : null}
      {node.error ? (
        <div className="tree-error" style={{ paddingLeft: `${44 + depth * 16}px` }}>
          {node.error}
        </div>
      ) : null}
      {node.expanded
        ? node.childPaths.map((childPath) => {
            const child = nodes[childPath];
            if (!child) {
              return null;
            }
            return (
              <TreeNodeRow
                key={child.path}
                currentPath={currentPath}
                depth={depth + 1}
                isPaneFocused={isPaneFocused}
                node={child}
                nodes={nodes}
                clickTimeoutRef={clickTimeoutRef}
                onToggleExpand={onToggleExpand}
                onNavigate={onNavigate}
                registerRowRef={registerRowRef}
              />
            );
          })
        : null}
    </div>
  );
}
