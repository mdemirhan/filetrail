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
import {
  type ContextMenuActionId,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuItem,
  ItemContextMenu,
} from "./ItemContextMenu";
import { LocationSheet } from "./LocationSheet";
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
      <LocationSheet
        open={locationSheetOpen}
        currentPath={currentPath}
        submitting={locationSubmitting}
        error={locationError}
        tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
        onRequestPathSuggestions={onRequestPathSuggestions}
        onClose={onCloseLocationSheet}
        onSubmit={(path) => onSubmitLocationPath(path)}
      />
      <LocationSheet
        open={moveDialogState !== null}
        currentPath={moveDialogState?.currentPath ?? currentPath}
        submitting={moveDialogState?.submitting ?? false}
        error={moveDialogState?.error ?? null}
        title="Move To"
        eyebrow="Destination"
        label="Destination folder"
        submitLabel="Move"
        placeholder={currentPath}
        tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
        enableSuggestions={false}
        browseLabel="Browse"
        onBrowse={onBrowseForDirectoryPath}
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
          title="Live Conflict Detected"
          message={buildRuntimeConflictMessage(writeOperationProgressEvent.runtimeConflict)}
          actions={buildRuntimeConflictActions(
            writeOperationProgressEvent,
            onResolveRuntimeConflict,
          )}
          onCancel={onCancelWriteOperation}
        />
      ) : null}
      {showCopyPasteResultDialog && writeOperationProgressEvent ? (
        <CopyPasteDialog
          title={getWriteOperationTitle(writeOperationProgressEvent.action, "result")}
          message={writeOperationProgressEvent.result?.error ?? "The write operation has finished."}
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

function buildCopyPasteResultDetailLines(event: WriteOperationProgressEvent): string[] {
  const result = event.result;
  if (!result) {
    return [];
  }
  const lines = [
    `${result.summary.completedItemCount} of ${result.summary.totalItemCount} steps completed`,
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
  if (conflict.conflictClass === "directory_conflict") {
    return [
      {
        label: "Replace Folder",
        destructive: true,
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "overwrite"),
      },
      { label: "Merge", onClick: () => onResolveRuntimeConflict(conflict.conflictId, "merge") },
      { label: "Skip", onClick: () => onResolveRuntimeConflict(conflict.conflictId, "skip") },
      {
        label: "Keep Both",
        onClick: () => onResolveRuntimeConflict(conflict.conflictId, "keep_both"),
      },
    ];
  }
  return [
    {
      label: "Overwrite",
      onClick: () => onResolveRuntimeConflict(conflict.conflictId, "overwrite"),
    },
    { label: "Skip", onClick: () => onResolveRuntimeConflict(conflict.conflictId, "skip") },
    {
      label: "Keep Both",
      onClick: () => onResolveRuntimeConflict(conflict.conflictId, "keep_both"),
    },
  ];
}

function buildRuntimeConflictMessage(
  conflict: NonNullable<WriteOperationProgressEvent["runtimeConflict"]>,
): string {
  const baseMessage = `${conflict.sourcePath} now conflicts with ${conflict.destinationPath}.`;
  if (conflict.conflictClass !== "directory_conflict") {
    return baseMessage;
  }
  return `${baseMessage} Replacing the folder will delete destination-only files and subfolders inside the conflicting destination folder before copying continues.`;
}

function getPathLeafName(path: string): string {
  const trimmedPath = path.replace(/\/+$/u, "");
  return trimmedPath.split("/").filter(Boolean).at(-1) ?? path;
}
