import type {
  CopyPasteChoice,
  IpcResponse,
  WriteOperationAction,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";

import type { ContextMenuState, WriteOperationCardState } from "../hooks/useWriteOperations";
import {
  type CopyPasteReport as CopyPasteAnalysisReport,
  type CopyPasteOverrides,
  type CopyPastePolicy,
  leafName,
} from "../lib/copyPasteReview";
import { formatSize } from "../lib/formatting";
import type { InternalMoveSourceSurface } from "../lib/internalDragAndDrop";
import type { Place } from "../lib/places";
import type { ShortcutContext } from "../lib/shortcutPolicy";
import type { ToastEntry } from "../lib/toasts";
import { useDialogStore, useNavigationStore } from "../state/explorerStoreContext";
import { ActionNoticeDialog } from "./ActionNoticeDialog";
import { CopyPasteDialog } from "./CopyPasteDialog";
import { CopyPasteProgressCard } from "./CopyPasteProgressCard";
import { CopyPasteResultDialog } from "./CopyPasteResultDialog";
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
  currentPath,
  places,
  onForgetPlace,
  onRequestPathSuggestions,
  onSubmitLocationPath,
  onBrowseForDirectoryPath,
  onSubmitMoveDialog,
  contextMenuDisabledActionIds,
  contextMenuFavoriteToggleLabel,
  contextMenuHiddenActionIds,
  contextMenuSubmenuItems,
  shortcutContext,
  onRunContextMenuAction,
  onRunContextSubmenuAction,
  onDismissActionNotice,
  onSubmitRenameDialog,
  onSubmitNewFolderDialog,
  onRequestCopyLikePlanStart,
  onUpdateCopyPasteChoices,
  onCloseCopyPasteDialog,
  onConfirmTrashDialog,
  onConfirmDeleteImmediatelyDialog,
  showCopyPasteProgressCard,
  onCancelWriteOperation,
  showCopyPasteResultDialog,
  onResolveRuntimeConflict,
  onRetryFailedCopyPasteItems,
  onDismissToast,
}: {
  currentPath: string;
  /** Opened folders and favorites, for the Go To and Move To boxes. */
  places: readonly Place[];
  onForgetPlace: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
  onSubmitLocationPath: (path: string) => void;
  onBrowseForDirectoryPath: (path: string) => Promise<string | null>;
  onSubmitMoveDialog: (path: string) => void;
  contextMenuDisabledActionIds: ContextMenuActionId[];
  contextMenuFavoriteToggleLabel: string | null;
  contextMenuHiddenActionIds: ContextMenuActionId[];
  contextMenuSubmenuItems: ContextMenuSubmenuItem[];
  shortcutContext: ShortcutContext;
  onRunContextMenuAction: (actionId: ContextMenuActionId, paths: string[]) => void;
  onRunContextSubmenuAction: (action: ContextMenuSubmenuAction, paths: string[]) => void;
  onDismissActionNotice: () => void;
  onSubmitRenameDialog: (value: string) => void;
  onSubmitNewFolderDialog: (value: string) => void;
  onRequestCopyLikePlanStart: (
    report: CopyPasteAnalysisReport,
    policy: CopyPastePolicy,
    action: "paste" | "move_to" | "duplicate",
    options: {
      clearClipboardOnStart: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
      overrides?: CopyPasteOverrides;
    },
  ) => Promise<boolean>;
  onUpdateCopyPasteChoices: (choices: {
    policy: CopyPastePolicy;
    overrides: CopyPasteOverrides;
  }) => void;
  onCloseCopyPasteDialog: () => void;
  onConfirmTrashDialog: (paths: string[]) => void;
  onConfirmDeleteImmediatelyDialog: (paths: string[]) => void;
  showCopyPasteProgressCard: boolean;
  onCancelWriteOperation: () => void;
  showCopyPasteResultDialog: boolean;
  onResolveRuntimeConflict: (
    conflictId: string,
    resolution: CopyPasteChoice,
    applyToRemaining: boolean,
  ) => void;
  onRetryFailedCopyPasteItems: (event: WriteOperationProgressEvent) => void;
  onDismissToast: (id: string) => void;
}) {
  // Dialog state and trivial close/persist transitions come straight from the
  // store contexts; only behavior-carrying callbacks remain props.
  const { locationSheetOpen, locationSubmitting, locationError, setLocationSheetOpen } =
    useNavigationStore();
  const {
    contextMenuState,
    actionNotice,
    moveDialogState,
    setMoveDialogState,
    renameDialogState,
    setRenameDialogState,
    newFolderDialogState,
    setNewFolderDialogState,
    copyPasteDialogState,
    writeOperationCardState,
    writeOperationProgressEvent,
    toasts,
  } = useDialogStore();
  const contextMenuShortcutContext = resolveContextMenuShortcutContext(
    shortcutContext,
    contextMenuState,
  );

  return (
    <>
      <GoToFolderDialog
        open={locationSheetOpen}
        currentPath={currentPath}
        places={places}
        onForgetPlace={onForgetPlace}
        submitting={locationSubmitting}
        error={locationError}
        onRequestPathSuggestions={onRequestPathSuggestions}
        onClose={() => setLocationSheetOpen(false)}
        onSubmit={(path) => onSubmitLocationPath(path)}
      />
      <GoToFolderDialog
        open={moveDialogState !== null}
        currentPath={moveDialogState?.currentPath ?? currentPath}
        places={places}
        // Return must not move anything into a folder nobody chose.
        selectFirstPlace={false}
        onForgetPlace={onForgetPlace}
        submitting={moveDialogState?.submitting ?? false}
        error={moveDialogState?.error ?? null}
        title="Move To"
        inputAriaLabel="Destination folder"
        submitLabel="Move"
        browseLabel="Browse"
        onBrowse={onBrowseForDirectoryPath}
        onRequestPathSuggestions={onRequestPathSuggestions}
        onClose={() => setMoveDialogState(null)}
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
        // List items are renamed in their row (see ContentPane); the dialog is for the rest.
        open={renameDialogState !== null && !renameDialogState.inline}
        title="Rename"
        {...(renameDialogState ? { message: `Rename ${renameDialogState.currentName}` } : {})}
        label="New name"
        value={renameDialogState?.currentName ?? ""}
        submitLabel="Rename"
        error={renameDialogState?.error ?? null}
        onClose={() => setRenameDialogState(null)}
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
        onClose={() => setNewFolderDialogState(null)}
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
            // Stops the analysis itself; only hiding the dialog would let the paste start.
            onClick: onCancelWriteOperation,
          }}
        />
      ) : null}
      {copyPasteDialogState?.type === "review" ? (
        <CopyPasteReviewDialog
          key={copyPasteDialogState.report.analysisId}
          action={copyPasteDialogState.action}
          report={copyPasteDialogState.report}
          policy={copyPasteDialogState.policy}
          overrides={copyPasteDialogState.overrides}
          onChoicesChange={onUpdateCopyPasteChoices}
          onClose={onCloseCopyPasteDialog}
          onStart={() =>
            onRequestCopyLikePlanStart(
              copyPasteDialogState.report,
              copyPasteDialogState.policy,
              copyPasteDialogState.action,
              {
                clearClipboardOnStart: copyPasteDialogState.clearClipboardOnStart,
                sourceSurface: copyPasteDialogState.sourceSurface ?? null,
                pendingTreeSelectionPath: copyPasteDialogState.pendingTreeSelectionPath ?? null,
                overrides: copyPasteDialogState.overrides,
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
      {copyPasteDialogState?.type === "confirmDeleteImmediately" ? (
        <CopyPasteDialog
          title="Delete Immediately?"
          message={`Permanently delete ${copyPasteDialogState.itemLabel}? This action cannot be undone.`}
          primaryAction={{
            label: "Delete",
            onClick: () => onConfirmDeleteImmediatelyDialog(copyPasteDialogState.paths),
            destructive: true,
            irreversible: true,
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
          detailValue={leafName(
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
          key={writeOperationProgressEvent.runtimeConflict.conflictId}
          verb={getCopyLikeVerb(writeOperationProgressEvent.action)}
          conflict={writeOperationProgressEvent.runtimeConflict}
          onResolve={(choice, applyToRemaining) => {
            const conflictId = writeOperationProgressEvent.runtimeConflict?.conflictId;
            if (conflictId) {
              onResolveRuntimeConflict(conflictId, choice, applyToRemaining);
            }
          }}
          onStop={onCancelWriteOperation}
        />
      ) : null}
      {showCopyPasteResultDialog && writeOperationProgressEvent ? (
        isCopyLikeAction(writeOperationProgressEvent.action) ? (
          <CopyPasteResultDialog
            event={writeOperationProgressEvent}
            canRetry
            onRetry={() => onRetryFailedCopyPasteItems(writeOperationProgressEvent)}
            onClose={onCloseCopyPasteDialog}
          />
        ) : (
          <CopyPasteDialog
            title={getWriteOperationTitle(writeOperationProgressEvent.action, "result")}
            message={buildCopyPasteResultMessage(writeOperationProgressEvent)}
            detailLines={buildCopyPasteResultDetailLines(writeOperationProgressEvent)}
            primaryAction={{
              label: "Close",
              onClick: onCloseCopyPasteDialog,
            }}
          />
        )
      ) : null}
      <ToastViewport
        toasts={toasts}
        onDismiss={onDismissToast}
        offsetBottom={showCopyPasteProgressCard ? 272 : undefined}
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
  if (action === "delete_immediately") {
    return phase === "progress" ? "Delete In Progress" : "Delete Result";
  }
  if (action === "rename") {
    return phase === "progress" ? "Rename In Progress" : "Rename Result";
  }
  if (action === "new_folder") {
    return phase === "progress" ? "Create Folder In Progress" : "Create Folder Result";
  }
  return phase === "progress" ? "Paste In Progress" : "Paste Result";
}

function isCopyLikeAction(action: WriteOperationAction): boolean {
  return action === "paste" || action === "move_to" || action === "duplicate";
}

function getCopyLikeVerb(action: WriteOperationAction): "Paste" | "Move" | "Duplicate" {
  return action === "move_to" ? "Move" : action === "duplicate" ? "Duplicate" : "Paste";
}
