import type {
  CopyPasteChoice,
  IpcResponse,
  WriteOperationAction,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";

import { useDelayedFlag } from "../hooks/useDelayedFlag";
import type { ContextMenuState, WriteOperationCardState } from "../hooks/useWriteOperations";
import type { ContextMenuOptions } from "../lib/contextMenu";
import {
  type CopyPasteReport as CopyPasteAnalysisReport,
  type CopyPasteOverrides,
  type CopyPastePolicy,
  leafName,
} from "../lib/copyPasteReview";
import { pluralize } from "../lib/copyPasteReview";
import { NEW_FOLDER_NAME } from "../lib/explorerAppUtils";
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
  type ContextMenuSubmenus,
  ItemContextMenu,
} from "./ItemContextMenu";
import { TextPromptDialog } from "./TextPromptDialog";
import { ToastViewport } from "./ToastViewport";

const PROGRESS_CARD_DELAY_MS = 500;

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
  contextMenuOptions,
  contextMenuHiddenActionIds,
  contextMenuSubmenus,
  shortcutContext,
  onRunContextMenuAction,
  onRunContextSubmenuAction,
  onDismissActionNotice,
  onSubmitRenameDialog,
  onSubmitNewFolderDialog,
  onRequestCopyLikePlanStart,
  onUpdateCopyPasteChoices,
  onCloseCopyPasteDialog,
  onCloseConfirmationDialog,
  onConfirmTrashDialog,
  onConfirmDeleteImmediatelyDialog,
  onConfirmEmptyTrashDialog,
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
  contextMenuOptions: ContextMenuOptions;
  contextMenuHiddenActionIds: ContextMenuActionId[];
  contextMenuSubmenus: ContextMenuSubmenus;
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
  // Cancel on a question asked before an operation starts; one running behind it goes on.
  onCloseConfirmationDialog: () => void;
  onConfirmTrashDialog: (paths: string[]) => void;
  onConfirmDeleteImmediatelyDialog: (paths: string[]) => void;
  onConfirmEmptyTrashDialog: () => void;
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
  // As in Finder, an operation over in a moment (a rename, one item to the Trash) shows no
  // progress; the card comes once it has run long enough to be worth watching.
  const progressCardVisible = useDelayedFlag(
    showCopyPasteProgressCard && writeOperationCardState !== null,
    PROGRESS_CARD_DELAY_MS,
  );
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
          options={contextMenuOptions}
          hiddenActionIds={contextMenuHiddenActionIds}
          submenus={contextMenuSubmenus}
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
        // The tree's folders: the whole name is selected, as in Finder, so typing replaces it.
        selectAllOnOpen
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
        value={newFolderDialogState?.initialName ?? NEW_FOLDER_NAME}
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
          onStart={(choices) =>
            onRequestCopyLikePlanStart(
              copyPasteDialogState.report,
              choices?.policy ?? copyPasteDialogState.policy,
              copyPasteDialogState.action,
              {
                clearClipboardOnStart: copyPasteDialogState.clearClipboardOnStart,
                sourceSurface: copyPasteDialogState.sourceSurface ?? null,
                pendingTreeSelectionPath: copyPasteDialogState.pendingTreeSelectionPath ?? null,
                overrides: choices?.overrides ?? copyPasteDialogState.overrides,
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
              ? "It stays in the Trash until the Trash is emptied."
              : "They stay in the Trash until the Trash is emptied."
          }
          primaryAction={{
            label: "Move to Trash",
            onClick: () => onConfirmTrashDialog(copyPasteDialogState.paths),
            destructive: true,
          }}
          secondaryAction={{
            label: "Cancel",
            onClick: onCloseConfirmationDialog,
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
            onClick: onCloseConfirmationDialog,
          }}
        />
      ) : null}
      {copyPasteDialogState?.type === "confirmDeleteWithoutTrash" ? (
        <CopyPasteDialog
          // Finder's question for an item on a disk without a Trash.
          title={
            copyPasteDialogState.paths.length === 1
              ? `Are you sure you want to delete ${quoteItems(copyPasteDialogState.itemLabel, 1)}?`
              : `Are you sure you want to delete these ${copyPasteDialogState.paths.length.toLocaleString()} items?`
          }
          message={
            copyPasteDialogState.paths.length === 1
              ? "Its disk has no Trash, so it will be deleted immediately. You can’t undo this action."
              : "Their disk has no Trash, so they will be deleted immediately. You can’t undo this action."
          }
          primaryAction={{
            label: "Delete",
            onClick: () => onConfirmDeleteImmediatelyDialog(copyPasteDialogState.paths),
            destructive: true,
            irreversible: true,
          }}
          secondaryAction={{
            label: "Cancel",
            onClick: onCloseConfirmationDialog,
          }}
        />
      ) : null}
      {copyPasteDialogState?.type === "confirmEmptyTrash" ? (
        <CopyPasteDialog
          // Finder's question, word for word; Cancel is the default.
          title="Are you sure you want to permanently erase the items in the Trash?"
          message="You can’t undo this action."
          primaryAction={{
            label: "Empty Trash",
            onClick: onConfirmEmptyTrashDialog,
            destructive: true,
            irreversible: true,
          }}
          secondaryAction={{
            label: "Cancel",
            onClick: onCloseConfirmationDialog,
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
            onClick: onCloseConfirmationDialog,
          }}
        />
      ) : null}
      {progressCardVisible && writeOperationCardState ? (
        <CopyPasteProgressCard
          title={getWriteOperationTitle(writeOperationCardState.action, "progress")}
          progressPercent={getWriteOperationProgressPercent(writeOperationCardState)}
          progressMetaStart={`${writeOperationCardState.completedItemCount.toLocaleString()} of ${pluralize(Math.max(writeOperationCardState.totalItemCount, 0), "item")}`}
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
        isCopyLikeAction(writeOperationProgressEvent.action) ||
        writeOperationProgressEvent.action === "batch_rename" ? (
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
        progressCardShown={progressCardVisible && writeOperationCardState !== null}
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
  const { cancelledItemCount, completedItemCount, failedItemCount, skippedItemCount } =
    result.summary;
  // Stopped part way is never told as done.
  if (cancelledItemCount > 0) {
    return "Stopped before every item was done.";
  }
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
  const { cancelledItemCount, completedItemCount, failedItemCount, skippedItemCount } =
    result.summary;
  const lines: string[] = [];
  // Counts only say something for several items: "0 of 1 item done" under the reason it
  // failed is noise.
  if (result.summary.totalItemCount > 1) {
    lines.push(
      `${completedItemCount.toLocaleString()} of ${pluralize(result.summary.totalItemCount, "item")} done`,
    );
    if (failedItemCount > 0) {
      lines.push(`${pluralize(failedItemCount, "item")} failed`);
    }
    if (skippedItemCount > 0) {
      lines.push(`${pluralize(skippedItemCount, "item")} skipped`);
    }
    if (cancelledItemCount > 0) {
      lines.push(`${pluralize(cancelledItemCount, "item")} not done`);
    }
  }
  // The reasons, each once, and not again when the message above already gives it.
  const message = buildCopyPasteResultMessage(event);
  const reasons = new Set<string>();
  for (const item of result.items) {
    if (item.error && item.error !== message) {
      reasons.add(item.error);
    }
  }
  lines.push(...[...reasons].slice(0, 3));
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
              : action === "rename" || action === "batch_rename"
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
