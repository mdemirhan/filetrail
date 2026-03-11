import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import type { CopyPasteReviewDialogSize } from "../../shared/appPreferences";
import { formatSize } from "../lib/formatting";

type Policy = Extract<IpcRequest<"copyPaste:start">, { analysisId: string }>["policy"];
type AnalysisNode = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>["nodes"][number];
type AnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;

const REVIEW_DIALOG_MIN_WIDTH = 760;
const REVIEW_DIALOG_MIN_HEIGHT = 520;
const REVIEW_DIALOG_DEFAULT_WIDTH = 980;
const REVIEW_DIALOG_DEFAULT_HEIGHT = 700;
const REVIEW_DIALOG_EDGE_MARGIN = 24;
type DialogFrame = CopyPasteReviewDialogSize & { x: number; y: number };

export function CopyPasteReviewDialog({
  title,
  report,
  policy,
  persistedSize,
  onPolicyChange,
  onSizeChange,
  onClose,
  onStart,
}: {
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
  const [activeTab, setActiveTab] = useState<ConflictTab>("files");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogFrame, setDialogFrame] = useState<DialogFrame>(() =>
    resolveInitialDialogFrame(persistedSize),
  );
  const dialogFrameRef = useRef(dialogFrame);
  const interactionRef = useRef<
    | {
        mode: "move" | "resize";
        startX: number;
        startY: number;
        startFrame: DialogFrame;
      }
    | null
  >(null);
  const sharedAncestorPath = useMemo(
    () => findCommonAncestorPath([...report.sourcePaths, report.destinationDirectoryPath]),
    [report.destinationDirectoryPath, report.sourcePaths],
  );

  const conflicts = useMemo(
    () => flattenConflictNodes(report.nodes, sharedAncestorPath),
    [report.nodes, sharedAncestorPath],
  );
  const counts = useMemo(() => summarizeConflicts(conflicts), [conflicts]);
  const filteredConflicts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return conflicts.filter((conflict) => {
      if (conflict.tab !== activeTab) {
        return false;
      }
      if (normalizedQuery.length === 0) {
        return true;
      }
      return [
        conflict.displayPath,
        conflict.name,
        conflict.displayPrefix,
        conflict.displayName,
        conflict.sourcePath,
        conflict.destinationPath,
        conflict.detail,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [activeTab, conflicts, searchQuery]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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

  function beginPointerInteraction(
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>,
  ) {
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
                  Conflicts detected pasting into{" "}
                  <span className="copy-paste-review-path-pill">{report.destinationDirectoryPath}</span>
                </p>
              </div>
            </div>
            <div className="copy-paste-review-summary">
              <span>{report.summary.totalNodeCount} items</span>
              <span className="is-accent">{report.summary.fileConflictCount} file conflicts</span>
              <span className="is-accent">{report.summary.directoryConflictCount} folder conflicts</span>
              <span>{report.summary.mismatchConflictCount} mismatches</span>
              {report.summary.totalBytes !== null ? (
                <span>{formatSize(report.summary.totalBytes, "ready")}</span>
              ) : null}
            </div>
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
          </div>
          <div className="copy-paste-review-body">
            <div className="copy-paste-review-toolbar">
              <div className="copy-paste-review-tabs" role="tablist" aria-label="Conflict categories">
                <TabButton
                  active={activeTab === "files"}
                  label={`Files (${counts.files})`}
                  onClick={() => setActiveTab("files")}
                />
                <TabButton
                  active={activeTab === "folders"}
                  label={`Folders (${counts.folders})`}
                  onClick={() => setActiveTab("folders")}
                />
                <TabButton
                  active={activeTab === "mismatches"}
                  label={`Mismatches (${counts.mismatches})`}
                  onClick={() => setActiveTab("mismatches")}
                />
              </div>
              <label className="copy-paste-review-search">
                <span className="copy-paste-review-search-icon" aria-hidden="true">
                  <SearchGlyph />
                </span>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Filter..."
                  aria-label="Filter conflicts"
                />
              </label>
            </div>
            <section className="copy-paste-review-list-panel">
              <div className="copy-paste-review-list-header">
                <span>{filteredConflicts.length} shown</span>
                <span>{describeTab(activeTab)}</span>
              </div>
              <div className="copy-paste-review-list" role="list">
                {filteredConflicts.length > 0 ? (
                  filteredConflicts.map((conflict) => (
                    <ConflictRow key={conflict.id} conflict={conflict} />
                  ))
                ) : (
                  <div className="copy-paste-review-empty">
                    {searchQuery.trim().length > 0
                      ? "No conflicts match this filter."
                      : `No ${describeTab(activeTab).toLowerCase()} detected.`}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
        <div className="action-notice-actions copy-paste-review-actions">
          <span className="copy-paste-review-selection-summary">
            Files: {formatPolicyLabel(policy.file).toLowerCase()} · Folders:{" "}
            {formatPolicyLabel(policy.directory).toLowerCase()} · Mismatches:{" "}
            {formatPolicyLabel(policy.mismatch).toLowerCase()}
          </span>
          <div className="copy-paste-review-action-buttons">
            <button type="button" className="tb-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="tb-btn primary" onClick={onStart}>
              {report.mode === "cut" ? "Continue Move" : "Continue Paste"}
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

type ConflictTab = "files" | "folders" | "mismatches";

type FlatConflict = {
  id: string;
  tab: ConflictTab;
  displayPath: string;
  name: string;
  displayPrefix: string;
  displayName: string;
  sourcePath: string;
  destinationPath: string;
  detail: string;
  nestedConflictCount: number;
  sourceSize: string | null;
  destinationSize: string | null;
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
    <div className="copy-paste-review-policy-group">
      <div className="copy-paste-review-policy-label">{label}</div>
      <div className="copy-paste-review-segmented" role="group" aria-label={label}>
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
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "copy-paste-review-tab is-active" : "copy-paste-review-tab"}
      role="tab"
      aria-selected={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ConflictRow({ conflict }: { conflict: FlatConflict }) {
  return (
    <article className="copy-paste-review-row" role="listitem">
      <div className="copy-paste-review-row-icon" aria-hidden="true">
        {conflict.tab === "files" ? (
          <FileGlyph accent={iconAccentForName(conflict.name)} />
        ) : conflict.tab === "folders" ? (
          <FolderGlyph />
        ) : (
          <MismatchGlyph />
        )}
      </div>
      <div className="copy-paste-review-row-nameplate">
        <span className="copy-paste-review-row-path" title={conflict.displayPath}>
          {conflict.displayPrefix.length > 0 ? (
            <span className="copy-paste-review-row-prefix">{conflict.displayPrefix}</span>
          ) : null}
          <span className="copy-paste-review-row-basename">{conflict.displayName}</span>
        </span>
      </div>
      {conflict.tab === "files" && conflict.sourceSize && conflict.destinationSize ? (
        <div className="copy-paste-review-row-size">
          <span>{conflict.sourceSize}</span>
          <span className="copy-paste-review-row-size-arrow">→</span>
          <span
            className={
              conflict.sourceSize === conflict.destinationSize ? undefined : "is-accent"
            }
          >
            {conflict.destinationSize}
          </span>
        </div>
      ) : (
        <div className="copy-paste-review-row-detail">{formatRowDetail(conflict)}</div>
      )}
    </article>
  );
}

function flattenConflictNodes(nodes: AnalysisNode[], sharedAncestorPath: string): FlatConflict[] {
  const conflicts: FlatConflict[] = [];

  const visit = (node: AnalysisNode) => {
    if (node.conflictClass !== null) {
      const displayPath = trimSharedAncestor(node.sourcePath, sharedAncestorPath);
      const { prefix, name } = splitDisplayPath(displayPath);
      conflicts.push({
        id: node.id,
        tab: conflictTabForNode(node),
        displayPath,
        name,
        displayPrefix: prefix,
        displayName: name,
        sourcePath: node.sourcePath,
        destinationPath: node.destinationPath,
        detail: formatConflict(node),
        nestedConflictCount: Math.max(0, node.conflictNodeCount - 1),
        sourceSize: formatNodeSize(node.sourceFingerprint.size),
        destinationSize: formatNodeSize(node.destinationFingerprint.size),
      });
    }
    node.children.forEach(visit);
  };

  nodes.forEach(visit);
  return conflicts;
}

function splitDisplayPath(displayPath: string): { prefix: string; name: string } {
  const normalizedPath = normalizePath(displayPath);
  const separatorIndex = normalizedPath.lastIndexOf("/");
  if (separatorIndex < 0) {
    return { prefix: "", name: normalizedPath };
  }
  return {
    prefix: normalizedPath.slice(0, separatorIndex + 1),
    name: normalizedPath.slice(separatorIndex + 1),
  };
}

function summarizeConflicts(conflicts: FlatConflict[]) {
  return conflicts.reduce(
    (summary, conflict) => {
      summary[conflict.tab] += 1;
      return summary;
    },
    { files: 0, folders: 0, mismatches: 0 } satisfies Record<ConflictTab, number>,
  );
}

function conflictTabForNode(node: AnalysisNode): ConflictTab {
  if (node.conflictClass === "directory_conflict") {
    return "folders";
  }
  if (node.conflictClass === "type_mismatch") {
    return "mismatches";
  }
  return "files";
}

function describeTab(tab: ConflictTab): string {
  if (tab === "folders") {
    return "Folder conflicts";
  }
  if (tab === "mismatches") {
    return "Type mismatches";
  }
  return "File conflicts";
}

function formatPolicyLabel(
  value: Policy["file"] | Policy["directory"] | Policy["mismatch"],
): string {
  if (value === "keep_both") {
    return "Keep Both";
  }
  if (value === "overwrite") {
    return "Overwrite";
  }
  if (value === "merge") {
    return "Merge";
  }
  return "Skip";
}

function formatConflict(node: AnalysisNode): string {
  if (node.conflictClass === "directory_conflict") {
    return "Folder exists";
  }
  if (node.conflictClass === "type_mismatch") {
    return `${capitalize(node.sourceKind)} → ${capitalize(node.destinationKind)}`;
  }
  return "File exists";
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
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
  const splitPaths = normalizedPaths.map((value) => value.split("/").filter((segment, index) => segment.length > 0 || index === 0));
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

function formatNodeSize(size: number | null): string | null {
  if (size === null) {
    return null;
  }
  return formatSize(size, "ready");
}

function formatRowDetail(conflict: FlatConflict): string {
  if (conflict.tab === "folders") {
    return `${conflict.nestedConflictCount} nested`;
  }
  return conflict.detail;
}

function iconAccentForName(fileName: string): string {
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() ?? "" : "";
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
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="copy-paste-review-warning-glyph">
      <path d="M8 1.75 14 13H2L8 1.75Z" />
      <path d="M8 5.25V8.75" />
      <circle cx="8" cy="11.35" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" />
      <path d="M10.6 10.6L14 14" />
    </svg>
  );
}

function resolveInitialDialogFrame(
  persistedSize: CopyPasteReviewDialogSize | null,
): DialogFrame {
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

function areFramesEqual(
  left: DialogFrame,
  right: DialogFrame,
): boolean {
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
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
