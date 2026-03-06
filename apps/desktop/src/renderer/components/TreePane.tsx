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
  rootPath,
  nodes,
  currentPath,
  onFocusChange,
  onToggleExpand,
  onNavigate,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
  currentPath: string;
  onFocusChange: (focused: boolean) => void;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const root = nodes[rootPath];
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
        <div className="pane-header">
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
      <div className="pane-header">
        <span>Folders</span>
        <span className="pane-header-count">{nodesCount(nodes)}</span>
      </div>
      <div className="tree-scroll">
        <div className="tree-list">
          <TreeNodeRow
            currentPath={currentPath}
            depth={0}
            node={root}
            nodes={nodes}
            onToggleExpand={onToggleExpand}
            onNavigate={onNavigate}
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
  onToggleExpand,
  onNavigate,
}: {
  node: TreeNodeState;
  nodes: Record<string, TreeNodeState>;
  currentPath: string;
  depth: number;
  onToggleExpand: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  const isCurrent = currentPath === node.path;
  const canExpand = !node.isSymlink;

  return (
    <div className="tree-branch">
      <div
        className={`tree-row${isCurrent ? " active" : ""}`}
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
          onClick={() => onNavigate(node.path)}
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
                node={child}
                nodes={nodes}
                onToggleExpand={onToggleExpand}
                onNavigate={onNavigate}
              />
            );
          })
        : null}
    </div>
  );
}

function nodesCount(nodes: Record<string, TreeNodeState>): number {
  return Object.keys(nodes).length;
}
