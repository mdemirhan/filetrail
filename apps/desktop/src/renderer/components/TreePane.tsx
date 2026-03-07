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
  nodes,
  currentPath,
  onFocusChange,
  onOpenNode,
  onToggleExpand,
  onNavigate,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
  currentPath: string;
  onFocusChange: (focused: boolean) => void;
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
        className="tree-pane pane pane-focus-target"
        tabIndex={-1}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            onFocusChange(false);
          }
        }}
      >
        <div className={`pane-header${isFocused ? " pane-header-focused" : ""}`}>
          <span>Folders</span>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={paneRef}
      className="tree-pane pane pane-focus-target"
      tabIndex={-1}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
    >
      <div className={`pane-header${isFocused ? " pane-header-focused" : ""}`}>
        <span>Folders</span>
      </div>
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
