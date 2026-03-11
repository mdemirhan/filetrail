import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import type { CopyPasteReviewDialogSize } from "../../shared/appPreferences";

type Policy = Extract<IpcRequest<"copyPaste:start">, { analysisId: string }>["policy"];
type CopyLikeAction = IpcRequest<"copyPaste:analyzeStart">["action"];
type AnalysisNode = NonNullable<
  IpcResponse<"copyPaste:analyzeGetUpdate">["report"]
>["nodes"][number];
type AnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;

const REVIEW_DIALOG_MIN_WIDTH = 760;
const REVIEW_DIALOG_MIN_HEIGHT = 520;
const REVIEW_DIALOG_DEFAULT_WIDTH = 980;
const REVIEW_DIALOG_DEFAULT_HEIGHT = 700;
const REVIEW_DIALOG_EDGE_MARGIN = 24;
type DialogFrame = CopyPasteReviewDialogSize & { x: number; y: number };

export function CopyPasteReviewDialog({
  action = "paste",
  title,
  report,
  policy,
  persistedSize,
  onPolicyChange,
  onSizeChange,
  onClose,
  onStart,
}: {
  action?: CopyLikeAction;
  title: string;
  report: AnalysisReport;
  policy: Policy;
  persistedSize: CopyPasteReviewDialogSize | null;
  onPolicyChange: (policy: Policy) => void;
  onSizeChange: (size: CopyPasteReviewDialogSize) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [dialogFrame, setDialogFrame] = useState<DialogFrame>(() =>
    resolveInitialDialogFrame(persistedSize),
  );
  const dialogFrameRef = useRef(dialogFrame);
  const interactionRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    startFrame: DialogFrame;
  } | null>(null);
  const sharedAncestorPath = useMemo(
    () => findCommonAncestorPath([...report.sourcePaths, report.destinationDirectoryPath]),
    [report.destinationDirectoryPath, report.sourcePaths],
  );
  const hasConflicts = useMemo(
    () =>
      report.summary.fileConflictCount > 0 ||
      report.summary.directoryConflictCount > 0 ||
      report.summary.mismatchConflictCount > 0,
    [
      report.summary.directoryConflictCount,
      report.summary.fileConflictCount,
      report.summary.mismatchConflictCount,
    ],
  );
  const hasLargeBatchWarning = useMemo(
    () => report.warnings.some((warning) => warning.code === "large_batch"),
    [report.warnings],
  );
  const reviewMessage = hasConflicts
    ? "Conflicts detected pasting into"
    : hasLargeBatchWarning
      ? "This operation is large and needs confirmation before writing into"
      : "Review the plan before writing into";

  const previewNodes = useMemo(
    () => buildPlanPreviewNodes(report.nodes, sharedAncestorPath, policy),
    [policy, report.nodes, sharedAncestorPath],
  );
  const planTreeKey = useMemo(
    () =>
      [
        report.analysisId,
        policy.file,
        policy.directory,
        policy.mismatch,
        report.summary.totalNodeCount,
      ].join(":"),
    [
      policy.directory,
      policy.file,
      policy.mismatch,
      report.analysisId,
      report.summary.totalNodeCount,
    ],
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(collectExpandableNodeIds(previewNodes)),
  );

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    if (planTreeKey.length === 0) {
      return;
    }
    setExpandedNodeIds(new Set(collectExpandableNodeIds(previewNodes)));
  }, [planTreeKey, previewNodes]);

  useEffect(() => {
    dialogFrameRef.current = dialogFrame;
  }, [dialogFrame]);

  useEffect(() => {
    if (interactionRef.current !== null) {
      return;
    }
    setDialogFrame((current) => syncFrameSize(current, persistedSize));
  }, [persistedSize]);

  useEffect(() => {
    const handleWindowResize = () => {
      setDialogFrame((current) => constrainDialogFrame(current));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  function commitFrame(nextFrame: DialogFrame) {
    const normalizedFrame = constrainDialogFrame(nextFrame);
    setDialogFrame(normalizedFrame);
    onSizeChange({
      width: normalizedFrame.width,
      height: normalizedFrame.height,
    });
  }

  function beginPointerInteraction(mode: "move" | "resize", event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    interactionRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startFrame: dialogFrameRef.current,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const active = interactionRef.current;
      if (!active) {
        return;
      }
      const deltaX = moveEvent.clientX - active.startX;
      const deltaY = moveEvent.clientY - active.startY;
      const nextFrame =
        active.mode === "move"
          ? {
              ...active.startFrame,
              x: active.startFrame.x + deltaX,
              y: active.startFrame.y + deltaY,
            }
          : {
              ...active.startFrame,
              width: active.startFrame.width + deltaX,
              height: active.startFrame.height + deltaY,
            };
      setDialogFrame(constrainDialogFrame(nextFrame));
    };

    const finishInteraction = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishInteraction);
      window.removeEventListener("pointercancel", finishInteraction);
      if (interactionRef.current) {
        commitFrame(dialogFrameRef.current);
      }
      interactionRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishInteraction);
    window.addEventListener("pointercancel", finishInteraction);
  }

  function toggleNodeExpansion(nodeId: string) {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  return (
    <div className="action-notice-backdrop" role="presentation">
      <dialog
        ref={dialogRef}
        className="action-notice-dialog copy-paste-dialog copy-paste-review-dialog"
        aria-label={title}
        aria-modal="true"
        open
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: `${dialogFrame.width}px`,
          height: `${dialogFrame.height}px`,
          left: `${dialogFrame.x}px`,
          top: `${dialogFrame.y}px`,
        }}
      >
        <div className="copy-paste-review-shell">
          <div className="copy-paste-review-header">
            <div
              className="copy-paste-review-title-row"
              data-testid="copy-paste-review-drag-handle"
              onPointerDown={(event) => beginPointerInteraction("move", event)}
            >
              <WarningGlyph />
              <div className="copy-paste-review-title-block">
                <div className="action-notice-title">{title}</div>
                <p className="action-notice-message copy-paste-review-message">
                  {reviewMessage}{" "}
                  <span className="copy-paste-review-path-pill">
                    {report.destinationDirectoryPath}
                  </span>
                </p>
              </div>
            </div>
            {hasConflicts ? (
              <section className="copy-paste-review-policy-bar" aria-label="Conflict policies">
                <PolicyGroup
                  label="File Conflicts"
                  value={policy.file}
                  onChange={(value) => onPolicyChange({ ...policy, file: value })}
                  options={[
                    ["skip", "Skip"],
                    ["overwrite", "Overwrite"],
                    ["keep_both", "Keep Both"],
                  ]}
                />
                <PolicyGroup
                  label="Folder Conflicts"
                  value={policy.directory}
                  onChange={(value) => onPolicyChange({ ...policy, directory: value })}
                  options={[
                    ["skip", "Skip"],
                    ["overwrite", "Replace Folder"],
                    ["merge", "Merge"],
                    ["keep_both", "Keep Both"],
                  ]}
                />
                <PolicyGroup
                  label="Mismatches"
                  value={policy.mismatch}
                  onChange={(value) => onPolicyChange({ ...policy, mismatch: value })}
                  options={[
                    ["skip", "Skip"],
                    ["overwrite", "Overwrite"],
                    ["keep_both", "Keep Both"],
                  ]}
                />
              </section>
            ) : null}
          </div>
          <div className="copy-paste-review-body">
            <section className="copy-paste-review-list-panel">
              <ul className="copy-paste-review-tree" role="tree" aria-label="Destination plan">
                {previewNodes.length > 0 ? (
                  previewNodes.map((row) => (
                    <PlanTreeNode
                      key={row.id}
                      node={row}
                      expandedNodeIds={expandedNodeIds}
                      onToggle={toggleNodeExpansion}
                      searchActive={false}
                    />
                  ))
                ) : (
                  <li className="copy-paste-review-empty">No planned changes.</li>
                )}
              </ul>
            </section>
          </div>
        </div>
        <div className="action-notice-actions copy-paste-review-actions">
          <span className="copy-paste-review-selection-summary">
            Files: {formatPolicyLabel("file", policy.file).toLowerCase()} · Folders:{" "}
            {formatPolicyLabel("directory", policy.directory).toLowerCase()} · Mismatches:{" "}
            {formatPolicyLabel("mismatch", policy.mismatch).toLowerCase()}
          </span>
          <div className="copy-paste-review-action-buttons">
            <button type="button" className="tb-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="tb-btn primary" onClick={onStart}>
              {report.mode === "cut"
                ? "Continue Move"
                : action === "duplicate"
                  ? "Continue Duplicate"
                  : "Continue Paste"}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="copy-paste-review-resize-handle"
          aria-label="Resize paste review dialog"
          data-testid="copy-paste-review-resize-handle"
          onPointerDown={(event) => beginPointerInteraction("resize", event)}
        />
      </dialog>
    </div>
  );
}

type SummaryBucket = "added" | "replaced" | "skipped" | "keepBoth" | "merged";
type Tone = "accent" | "success" | "warning" | "muted" | "neutral" | "danger";
type PreviewKind = "file" | "folder" | "mismatch";

type PlanPreviewNode = {
  id: string;
  kind: PreviewKind;
  depth: number;
  displayPath: string;
  name: string;
  displayName: string;
  sourcePath: string;
  destinationPath: string;
  actionLabel: string;
  summaryBucket: SummaryBucket;
  badgeTone: Tone;
  children: PlanPreviewNode[];
};

function PolicyGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly [T, string][];
}) {
  return (
    <fieldset className="copy-paste-review-policy-group">
      <legend className="copy-paste-review-policy-label">{label}</legend>
      <div className="copy-paste-review-segmented" aria-label={label}>
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            className={optionValue === value ? "is-active" : undefined}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PlanTreeNode({
  node,
  expandedNodeIds,
  onToggle,
  searchActive,
}: {
  node: PlanPreviewNode;
  expandedNodeIds: Set<string>;
  onToggle: (nodeId: string) => void;
  searchActive: boolean;
}) {
  const isExpandable = node.children.length > 0;
  const isExpanded = searchActive || expandedNodeIds.has(node.id);

  return (
    <li
      className="copy-paste-review-tree-item"
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={isExpandable ? isExpanded : undefined}
    >
      <div className="copy-paste-review-row" style={{ paddingLeft: `${node.depth * 18}px` }}>
        <div className="copy-paste-review-row-leading">
          {isExpandable ? (
            <button
              type="button"
              className="copy-paste-review-row-toggle"
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.displayName}`}
              aria-expanded={isExpanded}
              onClick={() => onToggle(node.id)}
            >
              <TreeChevron expanded={isExpanded} />
            </button>
          ) : (
            <span className="copy-paste-review-row-toggle-spacer" aria-hidden="true" />
          )}
        </div>
        <div className="copy-paste-review-row-icon" aria-hidden="true">
          {node.kind === "file" ? (
            <FileGlyph accent={iconAccentForName(node.name)} />
          ) : node.kind === "folder" ? (
            <FolderGlyph />
          ) : (
            <MismatchGlyph />
          )}
        </div>
        <div className="copy-paste-review-row-nameplate">
          <span className="copy-paste-review-row-path" title={node.displayPath}>
            {node.displayName}
          </span>
        </div>
        <div className="copy-paste-review-row-meta">
          <span className={`copy-paste-review-row-badge is-${node.badgeTone}`}>
            {node.actionLabel}
          </span>
        </div>
      </div>
      {isExpandable && isExpanded ? (
        <ul className="copy-paste-review-tree-group">
          {node.children.map((child) => (
            <PlanTreeNode
              key={child.id}
              node={child}
              expandedNodeIds={expandedNodeIds}
              onToggle={onToggle}
              searchActive={searchActive}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function buildPlanPreviewNodes(
  nodes: AnalysisNode[],
  sharedAncestorPath: string,
  policy: Policy,
  depth = 0,
): PlanPreviewNode[] {
  return nodes.map((node) => buildPlanPreviewNode(node, sharedAncestorPath, policy, depth));
}

function buildPlanPreviewNode(
  node: AnalysisNode,
  sharedAncestorPath: string,
  policy: Policy,
  depth: number,
): PlanPreviewNode {
  const displayPath = trimSharedAncestor(node.sourcePath, sharedAncestorPath);
  const name = splitDisplayPath(displayPath);
  const action = resolvePreviewAction(node, policy);
  const children =
    node.sourceKind === "directory" && action.expandChildren
      ? node.children.map((child) =>
          buildPlanPreviewNode(child, sharedAncestorPath, policy, depth + 1),
        )
      : [];

  return {
    id: node.id,
    kind: previewKindForNode(node),
    depth,
    displayPath,
    name,
    displayName: name,
    sourcePath: node.sourcePath,
    destinationPath: node.destinationPath,
    actionLabel: action.label,
    summaryBucket: action.summaryBucket,
    badgeTone: action.badgeTone,
    children,
  };
}

function collectExpandableNodeIds(nodes: PlanPreviewNode[]): string[] {
  const nodeIds: string[] = [];
  for (const node of nodes) {
    if (node.children.length > 0) {
      nodeIds.push(node.id);
      nodeIds.push(...collectExpandableNodeIds(node.children));
    }
  }
  return nodeIds;
}

function previewKindForNode(node: AnalysisNode): PreviewKind {
  if (node.conflictClass === "type_mismatch") {
    return "mismatch";
  }
  return node.sourceKind === "directory" ? "folder" : "file";
}

function resolvePreviewAction(node: AnalysisNode, policy: Policy) {
  if (node.conflictClass === null) {
    if (node.sourceKind === "directory") {
      return {
        label: "Add",
        summaryBucket: "added" as const,
        badgeTone: "success" as const,
        expandChildren: false,
      };
    }
    return {
      label: "Add",
      summaryBucket: "added" as const,
      badgeTone: "success" as const,
      expandChildren: false,
    };
  }

  if (node.conflictClass === "directory_conflict") {
    if (policy.directory === "merge") {
      return {
        label: "Merge",
        summaryBucket: "merged" as const,
        badgeTone: "neutral" as const,
        expandChildren: true,
      };
    }
    if (policy.directory === "overwrite") {
      return {
        label: "Replace Folder",
        summaryBucket: "replaced" as const,
        badgeTone: "danger" as const,
        expandChildren: false,
      };
    }
    if (policy.directory === "keep_both") {
      return {
        label: "Keep Both",
        summaryBucket: "keepBoth" as const,
        badgeTone: "warning" as const,
        expandChildren: false,
      };
    }
    return {
      label: "Skip Folder",
      summaryBucket: "skipped" as const,
      badgeTone: "muted" as const,
      expandChildren: false,
    };
  }

  if (node.conflictClass === "type_mismatch") {
    if (policy.mismatch === "overwrite") {
      return {
        label: "Replace",
        summaryBucket: "replaced" as const,
        badgeTone: "accent" as const,
        expandChildren: false,
      };
    }
    if (policy.mismatch === "keep_both") {
      return {
        label: "Keep Both",
        summaryBucket: "keepBoth" as const,
        badgeTone: "warning" as const,
        expandChildren: false,
      };
    }
    return {
      label: "Skip",
      summaryBucket: "skipped" as const,
      badgeTone: "muted" as const,
      expandChildren: false,
    };
  }

  if (policy.file === "overwrite") {
    return {
      label: "Replace File",
      summaryBucket: "replaced" as const,
      badgeTone: "danger" as const,
      expandChildren: false,
    };
  }
  if (policy.file === "keep_both") {
    return {
      label: "Keep Both",
      summaryBucket: "keepBoth" as const,
      badgeTone: "warning" as const,
      expandChildren: false,
    };
  }
  return {
    label: "Skip",
    summaryBucket: "skipped" as const,
    badgeTone: "muted" as const,
    expandChildren: false,
  };
}

function splitDisplayPath(displayPath: string): string {
  const normalizedPath = normalizePath(displayPath);
  const separatorIndex = normalizedPath.lastIndexOf("/");
  if (separatorIndex < 0) {
    return normalizedPath;
  }
  return normalizedPath.slice(separatorIndex + 1);
}

function formatPolicyLabel(
  kind: "file" | "directory" | "mismatch",
  value: Policy["file"] | Policy["directory"] | Policy["mismatch"],
): string {
  if (value === "keep_both") {
    return "Keep Both";
  }
  if (value === "overwrite") {
    return kind === "directory" ? "Replace Folder" : "Overwrite";
  }
  if (value === "merge") {
    return "Merge";
  }
  return "Skip";
}

function basename(filePath: string): string {
  const normalizedPath = normalizePath(filePath);
  const lastSeparatorIndex = normalizedPath.lastIndexOf("/");
  return lastSeparatorIndex < 0 ? normalizedPath : normalizedPath.slice(lastSeparatorIndex + 1);
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function trimSharedAncestor(filePath: string, sharedAncestorPath: string): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedRoot = normalizePath(sharedAncestorPath);
  if (normalizedRoot.length === 0) {
    return normalizedPath;
  }
  if (normalizedPath === normalizedRoot) {
    return basename(normalizedPath);
  }
  const prefix = normalizedRoot.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

function findCommonAncestorPath(paths: string[]): string {
  const normalizedPaths = paths.map(normalizePath).filter((value) => value.length > 0);
  if (normalizedPaths.length === 0) {
    return "";
  }
  const splitPaths = normalizedPaths.map((value) =>
    value.split("/").filter((segment, index) => segment.length > 0 || index === 0),
  );
  const shortestLength = Math.min(...splitPaths.map((segments) => segments.length));
  const commonSegments: string[] = [];
  for (let index = 0; index < shortestLength; index += 1) {
    const candidate = splitPaths[0]?.[index];
    if (candidate === undefined || splitPaths.some((segments) => segments[index] !== candidate)) {
      break;
    }
    commonSegments.push(candidate);
  }
  if (commonSegments.length === 0) {
    return "";
  }
  if (commonSegments.length === 1 && commonSegments[0] === "") {
    return "/";
  }
  return commonSegments.join("/");
}

function iconAccentForName(fileName: string): string {
  const extension = fileName.includes(".") ? (fileName.split(".").pop()?.toLowerCase() ?? "") : "";
  if (["kt", "kts"].includes(extension)) {
    return "var(--ft-conflict-icon-violet)";
  }
  if (["json", "toml"].includes(extension)) {
    return "var(--ft-conflict-icon-gold)";
  }
  if (["xml"].includes(extension)) {
    return "var(--ft-conflict-icon-coral)";
  }
  if (["md", "lock", "properties", "bin"].includes(extension)) {
    return "var(--ft-conflict-icon-slate)";
  }
  return "var(--ft-conflict-icon-slate)";
}

function WarningGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="copy-paste-review-warning-glyph"
    >
      <path d="M8 1.75 14 13H2L8 1.75Z" />
      <path d="M8 5.25V8.75" />
      <circle cx="8" cy="11.35" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TreeChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={expanded ? "M4.25 6.25L8 10L11.75 6.25" : "M6.25 4.25L10 8L6.25 11.75"} />
    </svg>
  );
}

function resolveInitialDialogFrame(persistedSize: CopyPasteReviewDialogSize | null): DialogFrame {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxWidth = Math.max(520, viewportWidth - REVIEW_DIALOG_EDGE_MARGIN * 2);
  const maxHeight = Math.max(420, viewportHeight - REVIEW_DIALOG_EDGE_MARGIN * 2);
  const width = Math.min(persistedSize?.width ?? REVIEW_DIALOG_DEFAULT_WIDTH, maxWidth);
  const height = Math.min(persistedSize?.height ?? REVIEW_DIALOG_DEFAULT_HEIGHT, maxHeight);
  return constrainDialogFrame(
    {
      width,
      height,
      x: Math.round((viewportWidth - width) / 2),
      y: Math.round((viewportHeight - height) / 2),
    },
    viewportWidth,
    viewportHeight,
  );
}

function constrainDialogFrame(
  frame: DialogFrame,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): DialogFrame {
  const width = Math.round(
    clamp(frame.width, Math.min(REVIEW_DIALOG_MIN_WIDTH, viewportWidth - 16), viewportWidth - 16),
  );
  const height = Math.round(
    clamp(
      frame.height,
      Math.min(REVIEW_DIALOG_MIN_HEIGHT, viewportHeight - 16),
      viewportHeight - 16,
    ),
  );
  const centeredX = Math.round((viewportWidth - width) / 2);
  const centeredY = Math.round((viewportHeight - height) / 2);
  const minX = Math.min(REVIEW_DIALOG_EDGE_MARGIN, centeredX);
  const minY = Math.min(REVIEW_DIALOG_EDGE_MARGIN, centeredY);
  const maxX = Math.max(minX, viewportWidth - width - REVIEW_DIALOG_EDGE_MARGIN);
  const maxY = Math.max(minY, viewportHeight - height - REVIEW_DIALOG_EDGE_MARGIN);
  return {
    width,
    height,
    x: Math.round(clamp(frame.x, minX, maxX)),
    y: Math.round(clamp(frame.y, minY, maxY)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function areFramesEqual(left: DialogFrame, right: DialogFrame): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.x === right.x &&
    left.y === right.y
  );
}

function syncFrameSize(
  current: DialogFrame,
  persistedSize: CopyPasteReviewDialogSize | null,
): DialogFrame {
  const targetWidth = persistedSize?.width ?? REVIEW_DIALOG_DEFAULT_WIDTH;
  const targetHeight = persistedSize?.height ?? REVIEW_DIALOG_DEFAULT_HEIGHT;
  if (current.width === targetWidth && current.height === targetHeight) {
    return current;
  }
  const nextFrame = constrainDialogFrame({
    ...current,
    width: targetWidth,
    height: targetHeight,
  });
  return areFramesEqual(nextFrame, current) ? current : nextFrame;
}

function FileGlyph({ accent }: { accent: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: accent }}>
      <path d="M3.25 1.75H9.5L12.75 5V13.25C12.75 13.6642 12.4142 14 12 14H4C3.58579 14 3.25 13.6642 3.25 13.25V1.75Z" />
      <path d="M9.25 1.75V5.25H12.75" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ color: "var(--ft-conflict-icon-gold)" }}
    >
      <path d="M1.75 4.25C1.75 3.69772 2.19772 3.25 2.75 3.25H5.75L7.1 4.85H13.25C13.8023 4.85 14.25 5.29772 14.25 5.85V12.25C14.25 12.8023 13.8023 13.25 13.25 13.25H2.75C2.19772 13.25 1.75 12.8023 1.75 12.25V4.25Z" />
    </svg>
  );
}

function MismatchGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.25H9.75L12.25 6.75V11.75C12.25 12.1642 11.9142 12.5 11.5 12.5H3.75C3.33579 12.5 3 12.1642 3 11.75V4.25Z" />
      <path d="M6 8H13" />
      <path d="M10.75 5.75L13 8L10.75 10.25" />
    </svg>
  );
}
