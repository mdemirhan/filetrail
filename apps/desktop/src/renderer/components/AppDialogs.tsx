import type {
  IpcRequest,
  IpcResponse,
  WriteOperationAction,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";

import type { CopyPasteReviewDialogSize } from "../../shared/appPreferences";
import type {
  ContextMenuState,
  CopyPasteDialogState,
  WriteOperationCardState,
} from "../hooks/useWriteOperations";
import { formatSize } from "../lib/formatting";
import type { InternalMoveSourceSurface } from "../lib/internalDragAndDrop";
import type { ShortcutContext } from "../lib/shortcutPolicy";
import type { ToastEntry } from "../lib/toasts";
import { ActionNoticeDialog } from "./ActionNoticeDialog";
import { CopyPasteDialog } from "./CopyPasteDialog";
import { CopyPasteProgressCard } from "./CopyPasteProgressCard";
import { CopyPasteReviewDialog } from "./CopyPasteReviewDialog";
import { CopyPasteRuntimeConflictDialog } from "./CopyPasteRuntimeConflictDialog";
import { GoToFolderDialog } from "./GoToFolderDialog";
import {
  type ContextMenuActionId,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuItem,
  ItemContextMenu,
} from "./ItemContextMenu";
import { TextPromptDialog } from "./TextPromptDialog";
import { ToastViewport } from "./ToastViewport";

type CopyPasteAnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
type CopyPastePolicy = Extract<IpcRequest<"copyPaste:start">, { analysisId: string }>["policy"];

function resolveContextMenuShortcutContext(
  shortcutContext: ShortcutContext,
  contextMenuState: ContextMenuState | null,
): ShortcutContext {
  if (!contextMenuState) {
    return shortcutContext;
  }
  if (contextMenuState.targetKind === "treeFolder") {
    return {
      ...shortcutContext,
      focusedPane: "tree",
      selectedTreeTargetKind: "filesystemFolder",
    };
  }
  if (contextMenuState.targetKind === "favorite") {
    return {
      ...shortcutContext,
      focusedPane: "tree",
      selectedTreeTargetKind: "favorite",
    };
  }
  return shortcutContext;
}

export function AppDialogs({
  locationSheetOpen,
  currentPath,
  locationSubmitting,
  locationError,
  tabSwitchesExplorerPanes,
  onRequestPathSuggestions,
  onCloseLocationSheet,
  onSubmitLocationPath,
  moveDialogState,
  onBrowseForDirectoryPath,
  onCloseMoveDialog,
  onSubmitMoveDialog,
  contextMenuState,
  contextMenuDisabledActionIds,
  contextMenuFavoriteToggleLabel,
  contextMenuHiddenActionIds,
  contextMenuSubmenuItems,
  shortcutContext,
  onRunContextMenuAction,
  onRunContextSubmenuAction,
  actionNotice,
  onDismissActionNotice,
  renameDialogState,
  onCloseRenameDialog,
  onSubmitRenameDialog,
  newFolderDialogState,
  onCloseNewFolderDialog,
  onSubmitNewFolderDialog,
  copyPasteDialogState,
  onRequestCopyLikePlanStart,
  onUpdateCopyPastePolicy,
  onCloseCopyPasteDialog,
  onConfirmTrashDialog,
  showCopyPasteProgressCard,
  writeOperationCardState,
  onCancelWriteOperation,
  showCopyPasteResultDialog,
  writeOperationProgressEvent,
  onResolveRuntimeConflict,
  onRetryFailedCopyPasteItems,
  toasts,
  onDismissToast,
  copyPasteReviewDialogSize,
  onCopyPasteReviewDialogSizeChange,
}: {
  locationSheetOpen: boolean;
  currentPath: string;
  locationSubmitting: boolean;
  locationError: string | null;
  tabSwitchesExplorerPanes: boolean;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
  onCloseLocationSheet: () => void;
  onSubmitLocationPath: (path: string) => void;
  moveDialogState: {
    sourcePaths: string[];
    currentPath: string;
    submitting: boolean;
    error: string | null;
  } | null;
  onBrowseForDirectoryPath: (path: string) => Promise<string | null>;
  onCloseMoveDialog: () => void;
  onSubmitMoveDialog: (path: string) => void;
  contextMenuState: ContextMenuState | null;
  contextMenuDisabledActionIds: ContextMenuActionId[];
  contextMenuFavoriteToggleLabel: string | null;
  contextMenuHiddenActionIds: ContextMenuActionId[];
  contextMenuSubmenuItems: ContextMenuSubmenuItem[];
  shortcutContext: ShortcutContext;
  onRunContextMenuAction: (actionId: ContextMenuActionId, paths: string[]) => void;
  onRunContextSubmenuAction: (action: ContextMenuSubmenuAction, paths: string[]) => void;
  actionNotice: { title: string; message: string } | null;
  onDismissActionNotice: () => void;
  renameDialogState: {
    sourcePath: string;
    currentName: string;
    error: string | null;
  } | null;
  onCloseRenameDialog: () => void;
  onSubmitRenameDialog: (value: string) => void;
  newFolderDialogState: {
    parentDirectoryPath: string;
    initialName: string;
    error: string | null;
  } | null;
  onCloseNewFolderDialog: () => void;
  onSubmitNewFolderDialog: (value: string) => void;
  copyPasteDialogState: CopyPasteDialogState;
  onRequestCopyLikePlanStart: (
    report: CopyPasteAnalysisReport,
    policy: CopyPastePolicy,
    action: "paste" | "move_to" | "duplicate",
    options: {
      clearClipboardOnStart: boolean;
      initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
    },
  ) => void;
  onUpdateCopyPastePolicy: (policy: CopyPastePolicy) => void;
  onCloseCopyPasteDialog: () => void;
  onConfirmTrashDialog: (paths: string[]) => void;
  showCopyPasteProgressCard: boolean;
  writeOperationCardState: WriteOperationCardState | null;
  onCancelWriteOperation: () => void;
  showCopyPasteResultDialog: boolean;
  writeOperationProgressEvent: WriteOperationProgressEvent | null;
  onResolveRuntimeConflict: (
    conflictId: string,
    resolution: "overwrite" | "skip" | "keep_both" | "merge",
  ) => void;
  onRetryFailedCopyPasteItems: (event: WriteOperationProgressEvent) => void;
  toasts: ToastEntry[];
  onDismissToast: (id: string) => void;
  copyPasteReviewDialogSize: CopyPasteReviewDialogSize | null;
  onCopyPasteReviewDialogSizeChange: (size: CopyPasteReviewDialogSize | null) => void;
}) {
  const contextMenuShortcutContext = resolveContextMenuShortcutContext(
    shortcutContext,
    contextMenuState,
  );

  return (
    <>
      <GoToFolderDialog
        open={locationSheetOpen}
        currentPath={currentPath}
        submitting={locationSubmitting}
        error={locationError}
        tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
        onRequestPathSuggestions={onRequestPathSuggestions}
        onClose={onCloseLocationSheet}
        onSubmit={(path) => onSubmitLocationPath(path)}
      />
      <GoToFolderDialog
        open={moveDialogState !== null}
        currentPath={moveDialogState?.currentPath ?? currentPath}
        submitting={moveDialogState?.submitting ?? false}
        error={moveDialogState?.error ?? null}
        title="Move To"
        inputAriaLabel="Destination folder"
        submitLabel="Move"
        browseLabel="Browse"
        onBrowse={onBrowseForDirectoryPath}
        tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
        onRequestPathSuggestions={onRequestPathSuggestions}
        onClose={onCloseMoveDialog}
        onSubmit={(path) => onSubmitMoveDialog(path)}
      />
      {contextMenuState ? (
        <ItemContextMenu
          anchorX={contextMenuState.x}
          anchorY={contextMenuState.y}
          surface={contextMenuState.surface}
          disabledActionIds={contextMenuDisabledActionIds}
          favoriteToggleLabel={contextMenuFavoriteToggleLabel}
          hiddenActionIds={contextMenuHiddenActionIds}
          submenuItems={contextMenuSubmenuItems}
          shortcutContext={contextMenuShortcutContext}
          open
          onAction={(actionId) => {
            onRunContextMenuAction(actionId, contextMenuState.paths);
          }}
          onSubmenuAction={(action) => {
            onRunContextSubmenuAction(action, contextMenuState.paths);
          }}
        />
      ) : null}
      {actionNotice ? (
        <ActionNoticeDialog
          title={actionNotice.title}
          message={actionNotice.message}
          onClose={onDismissActionNotice}
        />
      ) : null}
      <TextPromptDialog
        open={renameDialogState !== null}
        title="Rename"
        {...(renameDialogState ? { message: `Rename ${renameDialogState.currentName}` } : {})}
        label="New name"
        value={renameDialogState?.currentName ?? ""}
        submitLabel="Rename"
        error={renameDialogState?.error ?? null}
        onClose={onCloseRenameDialog}
        onSubmit={(value) => onSubmitRenameDialog(value)}
      />
      <TextPromptDialog
        open={newFolderDialogState !== null}
        title="New Folder"
        {...(newFolderDialogState
          ? { message: `Create in ${newFolderDialogState.parentDirectoryPath}` }
          : {})}
        label="Folder name"
        value={newFolderDialogState?.initialName ?? "New Folder"}
        submitLabel="Create Folder"
        selectAllOnOpen
        error={newFolderDialogState?.error ?? null}
        onClose={onCloseNewFolderDialog}
        onSubmit={(value) => onSubmitNewFolderDialog(value)}
      />
      {copyPasteDialogState?.type === "analysis" ? (
        <CopyPasteDialog
          title={
            copyPasteDialogState.action === "move_to"
              ? "Analyzing Move"
              : copyPasteDialogState.action === "duplicate"
                ? "Analyzing Duplicate"
                : "Analyzing Paste"
          }
          message="Scanning the destination and building a recursive conflict report."
          secondaryAction={{
            label: "Cancel Analysis",
            onClick: onCloseCopyPasteDialog,
          }}
        />
      ) : null}
      {copyPasteDialogState?.type === "review" ? (
        <CopyPasteReviewDialog
          action={copyPasteDialogState.action}
          title={
            copyPasteDialogState.action === "move_to"
              ? "Move Requires Review"
              : copyPasteDialogState.action === "duplicate"
                ? "Duplicate Requires Review"
                : "Paste Requires Review"
          }
          report={copyPasteDialogState.report}
          policy={copyPasteDialogState.policy}
          onPolicyChange={onUpdateCopyPastePolicy}
          onClose={onCloseCopyPasteDialog}
          persistedSize={copyPasteReviewDialogSize}
          onSizeChange={onCopyPasteReviewDialogSizeChange}
          onStart={() =>
            onRequestCopyLikePlanStart(
              copyPasteDialogState.report,
              copyPasteDialogState.policy,
              copyPasteDialogState.action,
              {
                clearClipboardOnStart: copyPasteDialogState.clearClipboardOnStart,
                initiator: copyPasteDialogState.initiator ?? null,
                sourceSurface: copyPasteDialogState.sourceSurface ?? null,
                pendingTreeSelectionPath: copyPasteDialogState.pendingTreeSelectionPath ?? null,
              },
            )
          }
        />
      ) : null}
      {copyPasteDialogState?.type === "confirmTrash" ? (
        <CopyPasteDialog
          title="Move to Trash?"
          message={`Move ${copyPasteDialogState.itemLabel} to Trash?`}
          primaryAction={{
            label: "Move to Trash",
            onClick: () => onConfirmTrashDialog(copyPasteDialogState.paths),
            destructive: true,
          }}
          secondaryAction={{
            label: "Cancel",
            onClick: onCloseCopyPasteDialog,
          }}
        />
      ) : null}
      {showCopyPasteProgressCard && writeOperationCardState ? (
        <CopyPasteProgressCard
          title={getWriteOperationTitle(writeOperationCardState.action, "progress")}
          progressPercent={getWriteOperationProgressPercent(writeOperationCardState)}
          progressMetaStart={`${writeOperationCardState.completedItemCount.toLocaleString()} of ${Math.max(writeOperationCardState.totalItemCount, 0).toLocaleString()} items`}
          progressMetaEnd={formatWriteOperationByteLabel(writeOperationCardState)}
          detailLabel={
            writeOperationCardState.action === "new_folder" ? "Destination" : "Current item"
          }
          detailValue={getPathLeafName(
            writeOperationCardState.currentSourcePath ??
              writeOperationCardState.targetPath ??
              currentPath,
          )}
          onCancel={onCancelWriteOperation}
        />
      ) : null}
      {writeOperationProgressEvent?.status === "awaiting_resolution" &&
      writeOperationProgressEvent.runtimeConflict ? (
        <CopyPasteRuntimeConflictDialog
          title={buildRuntimeConflictTitle(writeOperationProgressEvent)}
          summary={buildRuntimeConflictSummary(writeOperationProgressEvent)}
          sourcePath={writeOperationProgressEvent.runtimeConflict.sourcePath}
          sourceDetail={buildRuntimeConflictSourceDetail(writeOperationProgressEvent)}
          destinationPath={writeOperationProgressEvent.runtimeConflict.destinationPath}
          destinationDetail={buildRuntimeConflictDestinationDetail(writeOperationProgressEvent)}
          changeExplanation={buildRuntimeConflictChangeExplanation(writeOperationProgressEvent)}
          actions={buildRuntimeConflictActions(
            writeOperationProgressEvent,
            onResolveRuntimeConflict,
          )}
          cancelLabel={getCancelWriteOperationLabel(writeOperationProgressEvent.action)}
          onCancel={onCancelWriteOperation}
        />
      ) : null}
      {showCopyPasteResultDialog && writeOperationProgressEvent ? (
        <CopyPasteDialog
          title={getWriteOperationTitle(writeOperationProgressEvent.action, "result")}
          message={buildCopyPasteResultMessage(writeOperationProgressEvent)}
          detailLines={buildCopyPasteResultDetailLines(writeOperationProgressEvent)}
          primaryAction={
            isRetryableCopyAction(writeOperationProgressEvent) &&
            writeOperationProgressEvent.result?.items.some((item) => item.status === "failed")
              ? {
                  label: "Retry Failed Items",
                  onClick: () => {
                    onRetryFailedCopyPasteItems(writeOperationProgressEvent);
                  },
                }
              : {
                  label: "Close",
                  onClick: onCloseCopyPasteDialog,
                }
          }
          secondaryAction={
            isRetryableCopyAction(writeOperationProgressEvent) &&
            writeOperationProgressEvent.result?.items.some((item) => item.status === "failed")
              ? {
                  label: "Close",
                  onClick: onCloseCopyPasteDialog,
                }
              : undefined
          }
        />
      ) : null}
      <ToastViewport
        toasts={toasts}
        onDismiss={onDismissToast}
        offsetBottom={showCopyPasteProgressCard ? 272 : 16}
      />
    </>
  );
}

function buildCopyPasteResultMessage(event: WriteOperationProgressEvent): string {
  const result = event.result;
  if (!result) {
    return "The write operation has finished.";
  }
  if (result.error) {
    return result.error;
  }
  const { completedItemCount, failedItemCount, skippedItemCount } = result.summary;
  if (skippedItemCount > 0 && completedItemCount === 0 && failedItemCount === 0) {
    return "All items were skipped by conflict policy.";
  }
  if (failedItemCount > 0) {
    return "The operation completed with some failures.";
  }
  return "The operation completed successfully.";
}

function buildCopyPasteResultDetailLines(event: WriteOperationProgressEvent): string[] {
  const result = event.result;
  if (!result) {
    return [];
  }
  const lines = [
    `${result.summary.completedItemCount} of ${result.summary.totalItemCount} items completed`,
  ];
  if (result.summary.failedItemCount > 0) {
    lines.push(
      `${result.summary.failedItemCount} item${result.summary.failedItemCount === 1 ? "" : "s"} failed`,
    );
  }
  if (result.summary.skippedItemCount > 0) {
    lines.push(
      `${result.summary.skippedItemCount} item${result.summary.skippedItemCount === 1 ? "" : "s"} skipped`,
    );
  }
  if (result.summary.cancelledItemCount > 0) {
    lines.push(
      `${result.summary.cancelledItemCount} item${result.summary.cancelledItemCount === 1 ? "" : "s"} cancelled`,
    );
  }
  for (const item of result.items.filter((entry) => entry.error).slice(0, 3)) {
    lines.push(item.error ?? "");
  }
  return lines;
}

function getWriteOperationProgressPercent(state: WriteOperationCardState): number {
  if (state.totalBytes !== null && state.totalBytes > 0) {
    return (state.completedByteCount / state.totalBytes) * 100;
  }
  if (state.totalItemCount <= 0) {
    return state.stage === "starting" || state.stage === "analyzing" ? 4 : 0;
  }
  return (state.completedItemCount / state.totalItemCount) * 100;
}

function formatWriteOperationByteLabel(state: WriteOperationCardState): string {
  if (state.totalBytes !== null) {
    return `${formatSize(state.completedByteCount, "ready")} of ${formatSize(state.totalBytes, "ready")}`;
  }
  return state.stage === "starting"
    ? "Preparing write plan"
    : state.stage === "analyzing"
      ? "Preparing write plan"
      : state.stage === "queued"
        ? "Waiting to begin"
        : state.stage === "awaiting_resolution"
          ? "Waiting for conflict resolution"
          : "Tracking progress";
}

function getWriteOperationTitle(
  action: WriteOperationAction,
  phase: "progress" | "result",
): string {
  if (action === "move_to") {
    return phase === "progress" ? "Move In Progress" : "Move Result";
  }
  if (action === "duplicate") {
    return phase === "progress" ? "Duplicate In Progress" : "Duplicate Result";
  }
  if (action === "trash") {
    return phase === "progress" ? "Move to Trash In Progress" : "Trash Result";
  }
  if (action === "rename") {
    return phase === "progress" ? "Rename In Progress" : "Rename Result";
  }
  if (action === "new_folder") {
    return phase === "progress" ? "Create Folder In Progress" : "Create Folder Result";
  }
  return phase === "progress" ? "Paste In Progress" : "Paste Result";
}

function isRetryableCopyAction(event: WriteOperationProgressEvent): boolean {
  return event.action === "paste" || event.action === "move_to" || event.action === "duplicate";
}

function buildRuntimeConflictActions(
  event: WriteOperationProgressEvent,
  onResolveRuntimeConflict: (
    conflictId: string,
    resolution: "overwrite" | "skip" | "keep_both" | "merge",
  ) => void,
) {
  const conflict = event.runtimeConflict;
  if (!conflict) {
    return [];
  }
  if (conflict.reason === "source_deleted") {
    return [
      {
        label: conflict.sourceKind === "directory" ? "Skip Folder" : "Skip",
        description: "Leave this item unchanged and continue with the rest of the operation.",
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "skip"),
      },
    ];
  }
  if (conflict.conflictClass === "directory_conflict") {
    return [
      {
        label: "Replace Folder",
        destructive: true,
        description:
          "Replace the destination folder with the source folder and continue. Destination-only contents will be removed.",
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "overwrite"),
      },
      {
        label: "Merge Folders",
        description:
          "Keep the destination folder and continue moving the source contents into it.",
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "merge"),
      },
      {
        label: "Keep Both",
        description:
          "Keep the existing destination folder and create a second folder with a new name.",
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "keep_both"),
      },
      {
        label: "Skip Folder",
        description: "Leave this folder unchanged and continue with the rest of the operation.",
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "skip"),
      },
    ];
  }
  return [
    {
      label: conflict.conflictClass === "type_mismatch" ? "Replace" : "Overwrite",
      description:
        "Replace the destination item with the source item and continue with the operation.",
      onClick: () => onResolveRuntimeConflict(conflict.conflictId, "overwrite"),
    },
    {
      label: "Keep Both",
      description:
        "Keep the destination item and create a second copy of the source item with a new name.",
      onClick: () => onResolveRuntimeConflict(conflict.conflictId, "keep_both"),
    },
    {
      label: "Skip",
      description: "Leave this item unchanged and continue with the rest of the operation.",
      onClick: () => onResolveRuntimeConflict(conflict.conflictId, "skip"),
    },
  ];
}

function buildRuntimeConflictTitle(event: WriteOperationProgressEvent): string {
  const conflict = event.runtimeConflict;
  if (!conflict) {
    return "Operation Paused";
  }
  return `${getWriteOperationLabel(event.action)} Paused: ${formatRuntimeConflictReasonTitle(conflict.reason)}`;
}

function buildRuntimeConflictSummary(event: WriteOperationProgressEvent): string {
  const conflict = event.runtimeConflict;
  if (!conflict) {
    return "The operation paused because the filesystem changed after planning.";
  }
  const sourceName = getPathLeafName(conflict.sourcePath);
  const destinationName = getPathLeafName(conflict.destinationPath);
  if (conflict.reason === "source_deleted") {
    return `The source ${formatKindLabel(conflict.sourceKind)} "${sourceName}" is no longer available.`;
  }
  if (conflict.reason === "source_changed") {
    return `The source ${formatKindLabel(conflict.sourceKind)} "${sourceName}" changed after the operation was planned.`;
  }
  if (conflict.reason === "destination_created") {
    return `A destination ${formatKindLabel(conflict.destinationKind)} named "${destinationName}" appeared after the operation was planned.`;
  }
  if (conflict.reason === "destination_deleted") {
    return `The destination item "${destinationName}" no longer matches the state that was reviewed earlier.`;
  }
  return `The destination ${formatKindLabel(conflict.destinationKind)} "${destinationName}" changed after the operation was planned.`;
}

function buildRuntimeConflictSourceDetail(event: WriteOperationProgressEvent): string {
  const conflict = event.runtimeConflict;
  if (!conflict) {
    return "";
  }
  if (conflict.reason === "source_deleted") {
    return `${formatKindLabel(conflict.sourceKind)} · missing now`;
  }
  if (conflict.reason === "source_changed") {
    return `${formatKindLabel(conflict.sourceKind)} · changed after planning`;
  }
  return `${formatKindLabel(conflict.sourceKind)} · still present`;
}

function buildRuntimeConflictDestinationDetail(event: WriteOperationProgressEvent): string {
  const conflict = event.runtimeConflict;
  if (!conflict) {
    return "";
  }
  if (conflict.reason === "destination_deleted") {
    return "missing · deleted after planning";
  }
  if (conflict.reason === "destination_created") {
    return `${formatKindLabel(conflict.destinationKind)} · created after planning`;
  }
  if (conflict.reason === "destination_changed") {
    return `${formatKindLabel(conflict.destinationKind)} · changed after planning`;
  }
  return `${formatKindLabel(conflict.currentDestinationFingerprint.kind)} · current destination state`;
}

function buildRuntimeConflictChangeExplanation(event: WriteOperationProgressEvent): string {
  const conflict = event.runtimeConflict;
  if (!conflict) {
    return "The filesystem changed after the operation was planned, so File Trail paused before continuing with an outdated decision.";
  }
  if (conflict.reason === "source_deleted") {
    return "The source item no longer exists at its original path, so continuing without a new decision could fail or produce an incomplete move.";
  }
  if (conflict.reason === "source_changed") {
    return "The source item is different from the version that was analyzed earlier, so the original plan may no longer reflect what will be moved.";
  }
  if (conflict.reason === "destination_created") {
    return "The plan expected no item at the destination path, but something new appeared there before the write reached this step.";
  }
  if (conflict.reason === "destination_deleted") {
    return "The destination item that existed during planning is gone now, so File Trail needs a new decision before continuing.";
  }
  return "The destination item changed after planning, so the original conflict choice may no longer be safe to apply automatically.";
}

function getCancelWriteOperationLabel(action: WriteOperationAction): string {
  return `Cancel ${getWriteOperationLabel(action)}`;
}

function getWriteOperationLabel(action: WriteOperationAction): string {
  if (action === "move_to") {
    return "Move";
  }
  if (action === "duplicate") {
    return "Duplicate";
  }
  if (action === "trash") {
    return "Trash";
  }
  if (action === "rename") {
    return "Rename";
  }
  if (action === "new_folder") {
    return "Create Folder";
  }
  return "Paste";
}

function formatRuntimeConflictReasonTitle(
  reason: NonNullable<WriteOperationProgressEvent["runtimeConflict"]>["reason"],
): string {
  if (reason === "destination_created") {
    return "Destination Created";
  }
  if (reason === "destination_deleted") {
    return "Destination Deleted";
  }
  if (reason === "source_changed") {
    return "Source Changed";
  }
  if (reason === "source_deleted") {
    return "Source Missing";
  }
  return "Destination Changed";
}

function formatKindLabel(
  kind:
    | "file"
    | "directory"
    | "symlink"
    | "symlink_directory"
    | "missing",
): string {
  if (kind === "directory") {
    return "folder";
  }
  if (kind === "symlink_directory") {
    return "symlink folder";
  }
  if (kind === "symlink") {
    return "symlink";
  }
  if (kind === "missing") {
    return "item";
  }
  return "file";
}

function getPathLeafName(path: string): string {
  const trimmedPath = path.replace(/\/+$/u, "");
  return trimmedPath.split("/").filter(Boolean).at(-1) ?? path;
}
