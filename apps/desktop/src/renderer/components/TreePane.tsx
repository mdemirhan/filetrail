import { useEffect, useRef } from "react";

import { FolderIcon } from "../lib/fileIcons";
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
  error: string | null;
  childPaths: string[];
};

export function TreePane({
  paneRef,
  isFocused,
  rootPath,
  homePath,
  nodes,
  currentPath,
  onFocusChange,
  onGoHome,
  onOpenNode,
  onToggleExpand,
  onNavigate,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  homePath: string;
  nodes: Record<string, TreeNodeState>;
  currentPath: string;
  onFocusChange: (focused: boolean) => void;
  onGoHome: () => void;
  onOpenNode: (path: string) => void;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => void;
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
        className="tree-pane sidebar pane pane-focus-target"
        tabIndex={-1}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onFocusChange(false);
          }
        }}
      >
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <SidebarLogoMark />
          </div>
          <div>
            <div className="sidebar-title">File Trail</div>
            <div className="sidebar-subtitle">Explorer</div>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={paneRef}
      className="tree-pane sidebar pane pane-focus-target"
      tabIndex={-1}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
    >
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <SidebarLogoMark />
        </div>
        <div>
          <div className="sidebar-title">File Trail</div>
          <div className="sidebar-subtitle">Explorer</div>
        </div>
      </div>
      <button
        type="button"
        className={`sidebar-home${currentPath === homePath ? " active" : ""}`}
        onClick={onGoHome}
        title="Go to home folder"
      >
        <ToolbarIcon name="home" />
        <span>Home</span>
      </button>
      <div className="sidebar-label">Folders</div>
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
              onOpenNode={onOpenNode}
              onToggleExpand={onToggleExpand}
              onNavigate={onNavigate}
              registerRowRef={(path, element) => {
                rowRefs.current[path] = element;
              }}
            />
          </div>
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-avatar">M</div>
        <div>
          <div className="sidebar-footer-name">tcmudemirhan</div>
          <div className="sidebar-footer-volume">Macintosh HD</div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLogoMark() {
  return (
    <svg className="sidebar-logo-mark" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
      <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.93a2 2 0 0 1-1.66-.88l-.82-1.24A2 2 0 0 0 7.93 4H5a2 2 0 0 0-2 2v1z" />
    </svg>
  );
}

function TreeNodeRow({
  node,
  nodes,
  currentPath,
  depth,
  isPaneFocused,
  clickTimeoutRef,
  onOpenNode,
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
  onOpenNode: (path: string) => void;
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
            onOpenNode(node.path);
          }}
          title={node.path}
        >
          <FolderIcon alias={node.isSymlink} />
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
                onOpenNode={onOpenNode}
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
