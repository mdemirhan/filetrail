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
  onConfirmDotNameDialog,
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
    action: "paste" | "copy_to" | "move_to" | "duplicate",
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
  onConfirmDotNameDialog: () => void;
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
        browseLabel="Choose…"
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
        title={renameDialogState ? `Rename “${renameDialogState.currentName}”` : "Rename"}
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
          ? { message: `In “${leafName(newFolderDialogState.parentDirectoryPath)}”` }
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
              ? "Preparing to Move…"
              : copyPasteDialogState.action === "copy_to"
                ? "Preparing to Copy…"
                : copyPasteDialogState.action === "duplicate"
                  ? "Preparing to Duplicate…"
                  : "Preparing to Paste…"
          }
          message="Checking the destination for items with the same names."
          secondaryAction={{
            label: "Cancel",
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
          title={`Move ${quoteItems(copyPasteDialogState.itemLabel, copyPasteDialogState.paths.length)} to the Trash?`}
          message={
            copyPasteDialogState.paths.length === 1
              ? "You can put it back from the Trash."
              : "You can put them back from the Trash."
          }
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
          // Finder's question, word for word.
          title={
            copyPasteDialogState.paths.length === 1
              ? `Are you sure you want to delete ${quoteItems(copyPasteDialogState.itemLabel, 1)}?`
              : `Are you sure you want to delete these ${copyPasteDialogState.paths.length.toLocaleString()} items?`
          }
          message={
            copyPasteDialogState.paths.length === 1
              ? "This item will be deleted immediately. You can’t undo this action."
              : "These items will be deleted immediately. You can’t undo this action."
          }
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
      {copyPasteDialogState?.type === "confirmDotName" ? (
        // Finder's question, word for word. Cancel is the default: Return keeps the name
        // from hiding the item.
        <CopyPasteDialog
          title="Are you sure you want to use a name that begins with a dot (“.”)?"
          message="These names are reserved for the system. If you continue, the item will be hidden."
          primaryAction={{
            label: "Use “.”",
            onClick: onConfirmDotNameDialog,
            isDefault: false,
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
              label: "OK",
              onClick: onCloseCopyPasteDialog,
            }}
          />
        )
      ) : null}
      <ToastViewport
        toasts={toasts}
        onDismiss={onDismissToast}
        progressCardShown={showCopyPasteProgressCard && writeOperationCardState !== null}
      />
    </>
  );
}

function buildCopyPasteResultMessage(event: WriteOperationProgressEvent): string {
  const result = event.result;
  if (!result) {
    return "Finished.";
  }
  if (result.error) {
    return result.error;
  }
  const { completedItemCount, failedItemCount, skippedItemCount } = result.summary;
  if (skippedItemCount > 0 && completedItemCount === 0 && failedItemCount === 0) {
    return "Nothing was changed: every item was skipped.";
  }
  if (failedItemCount > 0) {
    return "Some items couldn’t be changed.";
  }
  return "Done.";
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
  return state.stage === "starting" || state.stage === "analyzing"
    ? "Preparing…"
    : state.stage === "queued"
      ? "Waiting to start"
      : state.stage === "awaiting_resolution"
        ? "Waiting for your answer"
        : "Working…";
}

// While it runs, an operation is named by what it does ("Moving to Trash…"); afterwards by
// what it was ("Move to Trash").
function getWriteOperationTitle(
  action: WriteOperationAction,
  phase: "progress" | "result",
): string {
  const [progress, result] =
    action === "move_to"
      ? ["Moving…", "Move"]
      : action === "copy_to"
        ? ["Copying…", "Copy"]
        : action === "duplicate"
          ? ["Duplicating…", "Duplicate"]
          : action === "trash"
            ? ["Moving to Trash…", "Move to Trash"]
            : action === "delete_immediately"
              ? ["Deleting…", "Delete Immediately"]
              : action === "rename"
                ? ["Renaming…", "Rename"]
                : action === "new_folder"
                  ? ["Creating Folder…", "New Folder"]
                  : ["Pasting…", "Paste"];
  return phase === "progress" ? progress : result;
}

// “name” for one item, or the summary as it is ("a.txt and 2 more") for several.
function quoteItems(itemLabel: string, count: number): string {
  return count === 1 ? `“${itemLabel}”` : itemLabel;
}

function isCopyLikeAction(action: WriteOperationAction): boolean {
  return (
    action === "paste" || action === "copy_to" || action === "move_to" || action === "duplicate"
  );
}

function getCopyLikeVerb(action: WriteOperationAction): "Paste" | "Copy" | "Move" | "Duplicate" {
  return action === "move_to"
    ? "Move"
    : action === "copy_to"
      ? "Copy"
      : action === "duplicate"
        ? "Duplicate"
        : "Paste";
}
