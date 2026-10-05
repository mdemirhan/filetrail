import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import type {
  CopyPasteChoice,
  IpcRequest,
  IpcResponse,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";
import { getItemNameError } from "@filetrail/contracts/itemName";

import type {
  ApplicationSelection,
  FavoritePreference,
  FileActivationAction,
  OpenWithApplication,
} from "../../shared/appPreferences";
import { FINDER_APP_PATH } from "../../shared/finder";
import {
  type ContentSelectionState,
  EMPTY_CONTENT_SELECTION,
  setSingleContentSelection as createSingleContentSelection,
  extendContentSelectionToPath as extendSelectionStateToPath,
  sanitizeContentSelection,
  selectAllContentEntries as selectAllSelectionStateEntries,
  toggleContentSelection as toggleSelectionState,
} from "../lib/contentSelection";
import {
  type ContextMenuActionId,
  type ContextMenuOptions,
  type ContextMenuSourceSubview,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuItem,
  getContextMenuItems,
} from "../lib/contextMenu";
import {
  type ClipboardIcon,
  type ClipboardSourceEntry,
  type CopyPasteClipboardState,
  buildPasteRequest,
  clearCopyPasteClipboard,
  describeClipboard,
  dropClipboardPaths,
  followClipboardThroughWrite,
  hasClipboardItems,
  removeClipboardItem,
  setCopyPasteClipboard,
} from "../lib/copyPasteClipboard";
import {
  type CopyPasteOverrides,
  SAFE_COPY_PASTE_POLICY,
  dirnameOf,
  pluralize,
} from "../lib/copyPasteReview";
import {
  collectRetrySourcePaths,
  createOpenItemLimitMessage,
  describeDragRefusedWhileBusy,
  describeEmptyTrashFailure,
  formatMissingClipboardItemsMessage,
  formatPathForShell,
  formatQuotedNames,
  getPathLeafName,
  isDirectoryLikeEntry,
  isEditableFileEntry,
  isExpectedPlannedSkipResult,
  isFolderSizeEligibleKind,
  resolveFreeNewFolderName,
  resolveNewFolderTargetPath,
  resolveWriteOperationRefreshPath,
  resolveWriteOperationSelectionDirectoryPath,
  resolveWriteOperationTreeReloadPaths,
  resolveWriteOperationTreeSelectionPath,
  shouldRenderCopyPasteResultDialog,
} from "../lib/explorerAppUtils";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import type { DirectoryEntry } from "../lib/explorerTypes";
import {
  createFavorite,
  getFileSystemItemPath,
  getTrashPath,
  isFavoritePath,
  isPathInsideTrash,
} from "../lib/favorites";
import type { useFiletrailClient } from "../lib/filetrailClient";
import type { InternalMoveSourceSurface } from "../lib/internalDragAndDrop";
import { createRendererLogger } from "../lib/logging";
import { expandHomeShortcut } from "../lib/pathUtils";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "../lib/toasts";
import type {
  ExplorerServices,
  NavigationStore,
  PreferencesStore,
  SearchStore,
  SelectionActions,
  WriteOperationsStore,
} from "../state/explorerStores";
import type { BatchRenameTarget } from "./useBatchRename";
import type {
  ContextMenuState,
  CopyPasteDialogState,
  DotNameRequest,
  WriteOperationCardState,
} from "./useWriteOperations";

const logger = createRendererLogger("filetrail.renderer");

const WRITE_OPERATION_BUSY_ERROR = "Another write operation is already running.";
const ANALYSIS_POLL_INTERVAL_MS = 120;
// Starting without changing anything in the review never loses data.
const DEFAULT_COPY_PASTE_POLICY = SAFE_COPY_PASTE_POLICY;
// A retry runs after part of the work already landed at the destination. Skipping files
// that exist keeps it from adding "copy" duplicates of what made it the first time, and
// merging folders finishes the ones that stopped halfway. The review sheet can change it.
const RETRY_COPY_PASTE_POLICY: CopyPastePolicy = {
  file: "skip",
  directory: "merge",
  mismatch: "skip",
};
// What a running file operation blocks, in every tab: anything that would start another.
// Copy, Cut and Copy Path only fill a clipboard, so they stay available.
const WRITE_LOCKED_CONTEXT_ACTION_IDS: ContextMenuActionId[] = [
  "paste",
  "move",
  "rename",
  "duplicate",
  "newFolder",
  "trash",
  "deleteImmediately",
  "emptyTrash",
];
// What the menus leave out in the Trash: nothing is pasted, made or duplicated there, and
// what is in it is in the Trash already (Delete Immediately is offered instead).
const TRASH_HIDDEN_ACTION_IDS: ContextMenuActionId[] = ["paste", "newFolder", "duplicate", "trash"];
// Background-menu actions that act on the folder on screen rather than on a selection.
const BACKGROUND_FOLDER_ACTION_IDS: ContextMenuActionId[] = [
  "showInfo",
  "calculateSize",
  "copyPath",
  "terminal",
  "showInFinder",
];

function createOpenWithApplicationId(): string {
  return `open-with-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

type CopyPasteAnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
type CopyPastePolicy = Extract<IpcRequest<"copyPaste:start">, { analysisId: string }>["policy"];
type CopyLikeAction = "paste" | "copy_to" | "move_to" | "duplicate";
// Every write the app starts; each says the same thing when another one is still running.
type WriteStartAction =
  | CopyLikeAction
  | "trash"
  | "delete_immediately"
  | "empty_trash"
  | "rename"
  | "batch_rename"
  | "new_folder"
  | "undo"
  | "redo";
type CopyLikePreStartOutcome =
  | { status: "queued" }
  | { status: "review" }
  | { status: "blocked"; message: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

// The items a Move to Trash couldn't move because their disk has no Trash, when that is the
// only thing that went wrong (anything else is reported first, as any failure is).
function itemsWithoutTrash(event: WriteOperationProgressEvent): string[] {
  if (event.action !== "trash" || !event.result) {
    return [];
  }
  const failed = event.result.items.filter((item) => item.status === "failed");
  if (failed.length === 0 || failed.some((item) => item.noTrash !== true)) {
    return [];
  }
  return failed.flatMap((item) => (item.sourcePath ? [item.sourcePath] : []));
}

// The questions asked before an operation starts, as opposed to the sheets of a paste.
function isConfirmationDialog(state: { type: string } | null): boolean {
  return (
    state?.type === "confirmTrash" ||
    state?.type === "confirmDeleteImmediately" ||
    state?.type === "confirmEmptyTrash" ||
    state?.type === "confirmDeleteWithoutTrash" ||
    state?.type === "confirmDotName" ||
    state?.type === "undoQuestion"
  );
}

let renameSessionCount = 0;
function nextRenameSessionId(): number {
  renameSessionCount += 1;
  return renameSessionCount;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function reportHasConflicts(report: CopyPasteAnalysisReport): boolean {
  return (
    report.summary.fileConflictCount > 0 ||
    report.summary.directoryConflictCount > 0 ||
    report.summary.mismatchConflictCount > 0
  );
}

function reportHasWarningCode(
  report: CopyPasteAnalysisReport,
  code: CopyPasteAnalysisReport["warnings"][number]["code"],
): boolean {
  return report.warnings.some((warning) => warning.code === code);
}

function getCopyLikeActionLabel(action: CopyLikeAction): string {
  if (action === "move_to") {
    return "move";
  }
  if (action === "duplicate") {
    return "duplicate";
  }
  return action === "copy_to" ? "copy" : "paste";
}

function getCopyLikePreStartFailureTitle(action: WriteStartAction): string {
  switch (action) {
    case "move_to":
      return "Couldn’t Move";
    case "copy_to":
      return "Couldn’t Copy";
    case "duplicate":
      return "Couldn’t Duplicate";
    case "trash":
      return "Couldn’t Move to Trash";
    case "delete_immediately":
      return "Couldn’t Delete";
    case "empty_trash":
      return "Couldn’t Empty the Trash";
    case "rename":
    case "batch_rename":
      return "Couldn’t Rename";
    case "new_folder":
      return "Couldn’t Make a New Folder";
    case "undo":
      return "Couldn’t Undo";
    case "redo":
      return "Couldn’t Redo";
    default:
      return "Couldn’t Paste";
  }
}

const WRITE_OPERATION_BUSY_MESSAGE =
  "Another file operation is running. Wait for it to finish, or stop it.";

function getCopyLikePreparationFailureMessage(action: CopyLikeAction): string {
  return `File Trail couldn’t check the items to ${getCopyLikeActionLabel(action)}. Nothing was changed.`;
}

function getCopyLikeStartFailureMessage(action: CopyLikeAction): string {
  return `File Trail couldn’t begin to ${getCopyLikeActionLabel(action)} the items. Nothing was changed.`;
}

function getCopyLikeBusyOutcome(): Extract<CopyLikePreStartOutcome, { status: "blocked" }> {
  return {
    status: "blocked",
    message: WRITE_OPERATION_BUSY_MESSAGE,
  };
}

// Why the analysis stopped, naming the items it is about. The issues of the first kind found
// are told together ("“a.txt” and “b.txt” no longer exist.").
function getCopyLikeIssueMessage(report: CopyPasteAnalysisReport): string {
  const issue = report.issues[0];
  if (!issue) {
    return "File Trail couldn’t finish checking the items. Nothing was changed.";
  }
  const sourcePaths = report.issues
    .filter((candidate) => candidate.code === issue.code)
    .flatMap((candidate) => (candidate.sourcePath ? [candidate.sourcePath] : []));
  const names = formatQuotedNames(sourcePaths);
  const several = sourcePaths.length > 1;
  const destinationName = `“${getPathLeafName(issue.destinationPath ?? report.destinationDirectoryPath)}”`;
  const destinationFolderName = `“${getPathLeafName(report.destinationDirectoryPath)}”`;
  switch (issue.code) {
    case "destination_missing":
      return `The folder ${destinationFolderName} no longer exists.`;
    case "destination_not_directory":
      return `${destinationFolderName} isn't a folder.`;
    case "source_missing":
      return names
        ? `${names} no longer ${several ? "exist" : "exists"}.`
        : "An item to copy no longer exists.";
    case "same_path":
      return names
        ? `${names} ${several ? "are" : "is"} already in ${destinationFolderName}.`
        : "Source and destination cannot be the same.";
    case "parent_into_child":
      return names
        ? `${names} can't be ${report.mode === "cut" ? "moved" : "copied"} into a folder inside ${several ? "themselves" : "itself"}.`
        : "You can't place a folder into its own descendant.";
    case "duplicate_destination_name":
      return `Two of the items are named ${destinationName}, so one would replace the other.`;
    default:
      return issue.message;
  }
}

export function useExplorerActions(args: {
  services: ExplorerServices;
  navigation: NavigationStore;
  preferences: PreferencesStore;
  search: SearchStore;
  writeOperations: WriteOperationsStore;
  selection: SelectionActions;
  derived: {
    activeContentEntries: DirectoryEntry[];
    // The list before the type-to-filter text narrows it.
    unfilteredContentEntries: DirectoryEntry[];
    selectedPathsInViewOrder: string[];
    selectedPathSet: Set<string>;
    contextMenuTargetEntries: DirectoryEntry[];
    contextMenuTargetEntry: DirectoryEntry | null;
    pasteDestinationPath: string | null;
    isSearchMode: boolean;
    // The Trash has nothing to empty (null: it can't be told).
    trashIsEmpty?: boolean | null;
  };
  navActions: {
    restoreExplorerPaneFocus: (preferredPane?: "tree" | "content" | null) => void;
    navigateTo: (path: string, historyMode: "push" | "replace" | "skip") => Promise<boolean>;
    navigateTreeFileSystemPath: (
      path: string,
      historyMode: "push" | "replace" | "skip",
    ) => Promise<void>;
    rootTreeAtPath: (path: string) => void;
    toggleTreeNode: (path: string) => void;
    refreshDirectory: (options?: {
      path?: string;
      treeSelectionPath?: string | null;
      extraTreeReloadPaths?: string[];
    }) => Promise<void>;
    /** Something was done here: opening the folder on screen counts for the Go To box. */
    noteFolderUsed: () => void;
  };
  callbacks: {
    restartActiveSearch?: (() => Promise<void>) | null;
    openPathInNewTab: (path: string) => void;
    calculateFolderSize: (path: string) => void;
    /** Several folders, one after another, leaving those whose size is known. */
    calculateFolderSizes: (paths: string[]) => void;
    /** Opens the Rename sheet for several items. */
    openBatchRename: (targets: BatchRenameTarget[]) => void;
  };
}) {
  const {
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    selection,
    derived,
    navActions,
    callbacks,
  } = args;
  const { client, contentPaneRef, searchInputRef } = services;
  const {
    mainView,
    focusedPane,
    setFocusedPane,
    setInfoPanelOpen,
    setInfoTargetPathOverride,
    setGetInfoItem,
    setGetInfoLoading,
    getInfoRequestRef,
    homePath,
    currentPath,
    currentEntries,
    contentSelection,
    setContentSelection,
    currentPathRef,
    selectedTreeItemIdRef,
    isSearchModeRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    activeTabIdRef,
  } = navigation;
  const {
    favorites,
    setFavorites,
    openItemLimit,
    notificationsEnabled,
    fileActivationAction,
    defaultTextEditor,
    setDefaultTextEditor,
    setTerminalApp,
    openWithApplications,
    setOpenWithApplications,
    includeHidden,
    viewMode,
    detailColumns,
  } = preferences;
  const { setSearchPopoverOpen, browseSelectionRef, cachedSearchSelectionRef } = search;
  const {
    contextMenuState,
    setContextMenuState,
    actionNotice,
    setActionNotice,
    toasts,
    setToasts,
    copyPasteClipboard,
    setCopyPasteClipboardState,
    copyPasteDialogState,
    setCopyPasteDialogState,
    writeOperationCardState,
    setWriteOperationCardState,
    writeOperationProgressEvent,
    setWriteOperationProgressEvent,
    renameDialogState,
    setRenameDialogState,
    newFolderDialogState,
    setNewFolderDialogState,
    moveDialogState,
    setMoveDialogState,
    actionNoticeReturnFocusPaneRef,
    activeWriteOperationIdRef,
    nextPasteAttemptIdRef,
    pendingPasteAttemptRef,
    nextToastIdRef,
    copyPasteClipboardRef,
    writeOperationLockedRef,
    pendingPasteSelectionRef,
    pendingTreeSelectionPathRef,
    writeOperationTabIdRef,
  } = writeOperations;
  const { clearTypeahead, focusContentPane } = selection;
  const {
    activeContentEntries,
    unfilteredContentEntries,
    selectedPathsInViewOrder,
    selectedPathSet,
    contextMenuTargetEntries,
    contextMenuTargetEntry,
    pasteDestinationPath,
    isSearchMode,
  } = derived;
  const {
    restoreExplorerPaneFocus,
    navigateTo,
    navigateTreeFileSystemPath,
    rootTreeAtPath,
    toggleTreeNode,
    refreshDirectory,
    noteFolderUsed,
  } = navActions;
  const { restartActiveSearch } = callbacks;
  const activeAnalysisIdRef = useRef<string | null>(null);
  // Bumped by every New Folder, so a folder listing that comes back late is not used for a
  // newer one.
  const newFolderNameRequestRef = useRef(0);
  // A folder made in the folder on screen, to be renamed in its row once it is listed.
  const pendingInlineRenamePathRef = useRef<string | null>(null);
  // A paste start request on its way, which Stop marks to stop once it has an id.
  const startRequestRef = useRef<{ cancelled: boolean } | null>(null);
  // Which items of the last rename of several were folders, by the path asked for, for
  // trying again those that weren't renamed wherever they are now.
  const batchRenameFoldersRef = useRef(new Map<string, boolean>());
  const reviewStartInFlightRef = useRef<string | null>(null);
  // A cut clipboard to clear when its move finishes having moved something.
  const clipboardClearAfterMoveRef = useRef<{ operationId: string; capturedAt: string } | null>(
    null,
  );
  const moveOperationSourceSurfaceRef = useRef(new Map<string, InternalMoveSourceSurface>());
  const restartActiveSearchRef = useRef(restartActiveSearch ?? null);
  const writeOperationCardStateRef = useRef<WriteOperationCardState | null>(
    writeOperationCardState,
  );

  const isWriteOperationLocked = writeOperationCardState !== null;
  const canPasteAtResolvedDestination =
    hasClipboardItems(copyPasteClipboard) && pasteDestinationPath !== null;
  const showCopyPasteProgressCard = writeOperationCardState !== null;
  const showCopyPasteResultDialog = shouldRenderCopyPasteResultDialog(writeOperationProgressEvent);
  const contextMenuFavoriteToggleLabel = useMemo(() => {
    if (!contextMenuState || isSearchMode) {
      return null;
    }
    if (contextMenuState.scope !== "selection" || contextMenuState.paths.length !== 1) {
      return null;
    }
    const targetPath = contextMenuState.targetPath;
    if (!targetPath) {
      return null;
    }
    // The Trash is always under Locations: a Trash favorite can be taken out, and none put in.
    if (targetPath === getTrashPath(homePath)) {
      return isFavoritePath(favorites, targetPath) ? "Remove from Favorites" : null;
    }
    // A favorite, or a place under Locations (which may be a favorite too).
    if (contextMenuState.surface === "favorite") {
      return isFavoritePath(favorites, targetPath) ? "Remove from Favorites" : "Add to Favorites";
    }
    if (contextMenuState.surface !== "content" && contextMenuState.surface !== "treeFolder") {
      return null;
    }
    if (
      contextMenuState.surface === "content" &&
      !isDirectoryLikeEntry(contextMenuTargetEntries[0] ?? null)
    ) {
      return null;
    }
    return isFavoritePath(favorites, targetPath) ? "Remove from Favorites" : "Add to Favorites";
  }, [contextMenuState, contextMenuTargetEntries, favorites, homePath, isSearchMode]);

  const contextMenuOptions = useMemo<ContextMenuOptions>(
    () => ({
      favoriteToggleLabel: contextMenuFavoriteToggleLabel,
      textEditorName: defaultTextEditor.appName,
      targetsFolder:
        contextMenuTargetEntries.length > 0 &&
        contextMenuTargetEntries.every((entry) => isDirectoryLikeEntry(entry)),
      // Several items are renamed in the Rename sheet, as Finder's Rename does.
      renameLabel:
        contextMenuTargetEntries.length > 1
          ? `Rename ${contextMenuTargetEntries.length.toLocaleString()} Items…`
          : null,
    }),
    [contextMenuFavoriteToggleLabel, contextMenuTargetEntries, defaultTextEditor.appName],
  );

  // A right-click menu lists only what can be done to its items, there and then, as Apple
  // asks of context menus and Finder does: anything else is left out rather than dimmed.
  // Paste alone may be dimmed (Apple allows it for Cut, Copy and Paste), as in the menu bar.
  const contextMenuHiddenActionIds = useMemo(() => {
    if (!contextMenuState) {
      return [] as ContextMenuActionId[];
    }
    const hidden = new Set<ContextMenuActionId>();
    const { surface } = contextMenuState;
    const isItemListSurface = surface === "content" || surface === "search" || surface === "trash";
    // Nothing in the Trash to empty.
    if (args.derived.trashIsEmpty === true) {
      hidden.add("emptyTrash");
    }
    // One file operation at a time: while one runs, the others are left out.
    if (isWriteOperationLocked) {
      for (const actionId of WRITE_LOCKED_CONTEXT_ACTION_IDS) {
        if (actionId !== "paste") {
          hidden.add(actionId);
        }
      }
    }
    if (contextMenuFavoriteToggleLabel === null) {
      hidden.add("toggleFavorite");
    }
    const isTreeSurface = surface === "treeFolder" || surface === "favorite";
    const isSingleFolder =
      contextMenuTargetEntries.length === 1 &&
      isDirectoryLikeEntry(contextMenuTargetEntries[0] ?? null);
    // In the file list and search results a new tab opens on one folder.
    if (!isTreeSurface && (surface === "trash" || !isSingleFolder)) {
      hidden.add("openInNewTab");
    }
    // An item's Paste goes into it, so it is there only for one folder; the folder on
    // screen has its own, in the menu of the background.
    if ((surface === "content" || surface === "search") && !isSingleFolder) {
      hidden.add("paste");
    }
    // Edit is for text files.
    if (
      contextMenuTargetEntries.length === 0 ||
      contextMenuTargetEntries.length !== contextMenuState.paths.length ||
      !contextMenuTargetEntries.every((entry) => isEditableFileEntry(entry))
    ) {
      hidden.add("edit");
    }
    if (isItemListSurface) {
      // "Show Package Contents" is for packages (.app, .framework and the like).
      if (!contextMenuTargetEntries.some((entry) => entry.kind === "bundle")) {
        hidden.add("showPackageContents");
      }
      // For folders and packages: one, or a selection with any among it (files have a size).
      if (!contextMenuTargetEntries.some((entry) => isFolderSizeEligibleKind(entry.kind))) {
        hidden.add("calculateSize");
      }
    }
    if (surface === "trash") {
      // In the Trash things are only taken out or deleted for good: nothing is pasted,
      // made or duplicated there, and what is there is in the Trash already.
      for (const actionId of TRASH_HIDDEN_ACTION_IDS) {
        hidden.add(actionId);
      }
      return Array.from(hidden);
    }
    if (surface === "favorite") {
      if (contextMenuState.targetPath !== getTrashPath(homePath)) {
        hidden.add("emptyTrash");
      } else {
        hidden.add("paste");
        hidden.add("newFolder");
      }
      return Array.from(hidden);
    }
    if (surface === "background") {
      // Nothing is pasted into or created in the Trash; it can be emptied from there.
      if (isPathInsideTrash(currentPath, homePath)) {
        hidden.add("paste");
        hidden.add("newFolder");
      } else {
        hidden.add("emptyTrash");
      }
      return Array.from(hidden);
    }
    if (surface === "treeFolder") {
      // Everything goes to the Trash; only what is already in it can be deleted for good.
      const targetPath = contextMenuState.targetPath;
      if (!targetPath || !isPathInsideTrash(targetPath, homePath)) {
        hidden.add("deleteImmediately");
      } else {
        for (const actionId of TRASH_HIDDEN_ACTION_IDS) {
          hidden.add(actionId);
        }
        // The Trash itself is the home folder's: it isn't deleted, only emptied, and it
        // stays where it is, under its name (the main process refuses too).
        if (targetPath === getTrashPath(homePath)) {
          hidden.add("deleteImmediately");
          hidden.add("cut");
          hidden.add("move");
          hidden.add("rename");
        }
      }
      return Array.from(hidden);
    }
    if (surface === "search") {
      hidden.add("toggleFavorite");
      // New Folder goes into the folder on screen, and search results show none.
      hidden.add("newFolder");
      // A duplicate goes next to its original: several results from different folders
      // have no one folder for theirs.
      if (resolveDuplicateFolder(contextMenuState.paths) === null) {
        hidden.add("duplicate");
      }
    }
    // An item's New Folder makes the folder inside it, as its Paste pastes there.
    if (!isSingleFolder) {
      hidden.add("newFolder");
    }
    return Array.from(hidden);
  }, [
    args.derived.trashIsEmpty,
    contextMenuFavoriteToggleLabel,
    contextMenuState,
    contextMenuTargetEntries,
    currentPath,
    homePath,
    isWriteOperationLocked,
  ]);

  // Items removed while their menu is open (by another app): nothing in it applies any more,
  // so it closes.
  useEffect(() => {
    const surface = contextMenuState?.surface;
    if (
      (surface === "content" || surface === "search" || surface === "trash") &&
      contextMenuTargetEntries.length === 0
    ) {
      setContextMenuState(null);
    }
  }, [contextMenuState?.surface, contextMenuTargetEntries.length, setContextMenuState]);

  // Only Paste is ever dimmed: with nothing to paste, or while a file operation runs.
  const contextMenuDisabledActionIds = useMemo(
    () =>
      contextMenuState && (!canPasteAtResolvedDestination || isWriteOperationLocked)
        ? (["paste"] as ContextMenuActionId[])
        : ([] as ContextMenuActionId[]),
    [canPasteAtResolvedDestination, contextMenuState, isWriteOperationLocked],
  );

  const openWithMenuItems = useMemo(() => {
    const items: ContextMenuSubmenuItem[] = openWithApplications.map((application) => ({
      action: {
        kind: "application",
        id: application.id,
        label: application.appName,
        appPath: application.appPath,
        appName: application.appName,
      },
    }));
    if (items.length > 0) {
      items.push({
        type: "separator",
        key: "separator-submenu-main",
      });
    }
    items.push({
      action: {
        kind: "other",
        id: "other",
        label: "Other…",
        appName: "Other…",
      },
    });
    return items;
  }, [openWithApplications]);

  // The list the selection was last checked against, so a selection whose items all leave
  // keeps their place for the arrow keys.
  const previousActiveContentEntriesRef = useRef(activeContentEntries);
  useEffect(() => {
    const previousEntries = previousActiveContentEntriesRef.current;
    previousActiveContentEntriesRef.current = activeContentEntries;
    setContentSelection((current) => {
      // A renamed, pasted or new item outside the filter is selected on purpose: the
      // filter is cleared to show it (useExplorerNavigationController), so it is kept here.
      const leadHiddenByFilter =
        current.leadPath !== null &&
        !activeContentEntries.some((entry) => entry.path === current.leadPath) &&
        unfilteredContentEntries.some((entry) => entry.path === current.leadPath);
      if (leadHiddenByFilter) {
        return current;
      }
      const nextSelection = sanitizeContentSelection(
        current,
        activeContentEntries,
        previousEntries,
      );
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
    });
  }, [activeContentEntries, setContentSelection, unfilteredContentEntries]);

  useEffect(() => {
    if (isSearchMode) {
      cachedSearchSelectionRef.current = contentSelection;
      return;
    }
    browseSelectionRef.current = contentSelection;
  }, [browseSelectionRef, cachedSearchSelectionRef, contentSelection, isSearchMode]);

  useLayoutEffect(() => {
    copyPasteClipboardRef.current = copyPasteClipboard;
  }, [copyPasteClipboard, copyPasteClipboardRef]);

  useLayoutEffect(() => {
    writeOperationCardStateRef.current = writeOperationCardState;
  }, [writeOperationCardState]);

  useEffect(() => {
    restartActiveSearchRef.current = restartActiveSearch ?? null;
  }, [restartActiveSearch]);

  useEffect(() => {
    if (!notificationsEnabled) {
      setToasts([]);
    }
  }, [notificationsEnabled, setToasts]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }
    if (contextMenuState.surface === "treeFolder" || contextMenuState.surface === "favorite") {
      return;
    }
    if (
      contextMenuState.paths.some(
        (path) => !activeContentEntries.some((entry) => entry.path === path),
      )
    ) {
      setContextMenuState(null);
    }
  }, [activeContentEntries, contextMenuState, setContextMenuState]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }
    if (mainView !== "explorer" || moveDialogState !== null) {
      setContextMenuState(null);
    }
  }, [contextMenuState, mainView, moveDialogState, setContextMenuState]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".context-menu-layer")) {
        return;
      }
      setContextMenuState(null);
    };
    const closeMenu = () => setContextMenuState(null);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenuState, setContextMenuState]);

  // Events for an operation this window hasn't heard the id of yet: one that finishes
  // before its start request returns. Kept until the id arrives (see adoptWriteOperation).
  const earlyWriteOperationEventsRef = useRef(new Map<string, WriteOperationProgressEvent[]>());
  // What was selected, and in which folder, when the running operation started.
  const selectionAtWriteStartRef = useRef<{ directoryPath: string; paths: string[] } | null>(null);
  const writeOperationProgressHandlerRef = useRef<
    ((event: WriteOperationProgressEvent) => void) | null
  >(null);
  // Records the operation this window started, then plays back whatever it already said.
  // The playback waits a moment so the caller's "queued" card goes up first.
  const adoptWriteOperation = (operationId: string) => {
    activeWriteOperationIdRef.current = operationId;
    const early = earlyWriteOperationEventsRef.current.get(operationId) ?? [];
    earlyWriteOperationEventsRef.current.clear();
    if (early.length > 0) {
      queueMicrotask(() => {
        for (const event of early) {
          writeOperationProgressHandlerRef.current?.(event);
        }
      });
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: write-operation progress should stay subscribed to stable refs without resubscribing on every ref.current mutation.
  useEffect(() => {
    const handleProgress = (event: WriteOperationProgressEvent) => {
      if (event.operationId !== activeWriteOperationIdRef.current) {
        if (activeWriteOperationIdRef.current === null) {
          const early = earlyWriteOperationEventsRef.current;
          early.set(event.operationId, [...(early.get(event.operationId) ?? []), event]);
          // Only the latest few operations matter; anything older was someone else's.
          while (early.size > 4) {
            early.delete(early.keys().next().value as string);
          }
        }
        return;
      }
      if (
        event.status === "queued" ||
        event.status === "running" ||
        event.status === "awaiting_resolution"
      ) {
        applyWriteOperationCardState({
          action: event.action,
          stage: event.status,
          targetPath:
            event.result?.targetPath ??
            writeOperationCardStateRef.current?.targetPath ??
            currentPathRef.current,
          completedItemCount: event.completedItemCount,
          totalItemCount: event.totalItemCount,
          completedByteCount: event.completedByteCount,
          totalBytes: event.totalBytes,
          currentSourcePath: event.currentSourcePath,
        });
        setWriteOperationProgressEvent(event);
      }
      if (
        event.status === "completed" ||
        event.status === "failed" ||
        event.status === "cancelled" ||
        event.status === "partial"
      ) {
        const sourceSurface = moveOperationSourceSurfaceRef.current.get(event.operationId);
        moveOperationSourceSurfaceRef.current.delete(event.operationId);
        // Another tab may be on screen by now. Its folder is still read again, but what
        // the operation leaves selected belongs to the tab it was started from.
        const startedInTabOnScreen =
          writeOperationTabIdRef.current === null ||
          writeOperationTabIdRef.current === activeTabIdRef.current;
        writeOperationTabIdRef.current = null;
        if (!startedInTabOnScreen) {
          pendingTreeSelectionPathRef.current = null;
        }
        const clipboardToClear = clipboardClearAfterMoveRef.current;
        if (clipboardToClear?.operationId === event.operationId) {
          clipboardClearAfterMoveRef.current = null;
          const clipboard = copyPasteClipboardRef.current;
          if (
            (event.result?.summary.completedItemCount ?? 0) > 0 &&
            clipboard.type === "ready" &&
            clipboard.capturedAt === clipboardToClear.capturedAt
          ) {
            applyCopyPasteClipboardState(clearCopyPasteClipboard());
          }
        }
        // Copied items that this write renamed or moved are followed, so a later paste still
        // finds them, and deleted ones are no longer offered. A cut any of whose items this
        // write changed is cancelled.
        if (event.result) {
          const clipboard = copyPasteClipboardRef.current;
          const followedClipboard = followClipboardThroughWrite(clipboard, event.result);
          if (followedClipboard !== clipboard) {
            applyCopyPasteClipboardState(followedClipboard);
          }
        }
        // The folder made in its row may have been given the next free name.
        if (event.action === "new_folder" && pendingInlineRenamePathRef.current !== null) {
          const madePath = event.result?.items[0]?.destinationPath ?? null;
          pendingInlineRenamePathRef.current =
            event.status === "completed" && madePath ? madePath : null;
        }
        activeWriteOperationIdRef.current = null;
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        if (event.result && startedInTabOnScreen) {
          queueWriteOperationSelection(event.result);
        } else {
          pendingPasteSelectionRef.current = null;
        }
        const withoutTrash = itemsWithoutTrash(event);
        if (withoutTrash.length > 0 && startedInTabOnScreen) {
          // Their disk has no Trash: as Finder does, offer to delete them immediately
          // instead of reporting a failure that leaves no way to delete them.
          setWriteOperationProgressEvent(null);
          setCopyPasteDialogState({
            type: "confirmDeleteWithoutTrash",
            paths: withoutTrash,
            itemLabel: formatItemSummaryFromPathCount(
              withoutTrash[0] ?? "item",
              withoutTrash.length,
            ),
          });
        } else if (shouldRenderCopyPasteResultDialog(event)) {
          setWriteOperationProgressEvent(event);
        } else {
          setWriteOperationProgressEvent(null);
          pushTerminalCopyPasteToast(event);
        }
        const nextPath = event.result
          ? resolveWriteOperationRefreshPath(event.result, currentPathRef.current)
          : currentPathRef.current;
        const nextTreeSelectionPath = event.result
          ? resolveCompletedTreeSelectionPath(event)
          : null;
        const nextTreeReloadPaths = event.result
          ? resolveWriteOperationTreeReloadPaths(event.result)
          : [];
        pendingTreeSelectionPathRef.current = null;
        void refreshDirectory({
          path: nextPath,
          treeSelectionPath: nextTreeSelectionPath,
          extraTreeReloadPaths: nextTreeReloadPaths,
        });
        // Search results on screen stay there; anything this write changed (moved,
        // trashed, renamed, duplicated) is found again, so they show what is on disk.
        if (
          startedInTabOnScreen &&
          (sourceSurface === "search" || isSearchModeRef.current) &&
          event.result &&
          event.result.summary.completedItemCount > 0
        ) {
          void restartActiveSearchRef.current?.();
        }
      }
    };
    writeOperationProgressHandlerRef.current = handleProgress;
    return client.onWriteOperationProgress(handleProgress);
  }, [client, refreshDirectory, setWriteOperationProgressEvent]);

  function closeContextMenu() {
    setContextMenuState(null);
  }

  function syncContentSelectionRefs(
    selection: ContentSelectionState,
    entries: DirectoryEntry[] = activeContentEntries,
  ) {
    // A set, not a list: a paste of a large folder selects many thousands of items, and
    // looking each entry up in a list of them froze the window.
    const picked = new Set(selection.paths);
    const selectedPaths = entries
      .filter((entry) => picked.has(entry.path))
      .map((entry) => entry.path);
    selectedPathsInViewOrderRef.current = selectedPaths;
    selectedEntryRef.current =
      entries.find((entry) => entry.path === selection.leadPath) ??
      entries.find((entry) => picked.has(entry.path)) ??
      null;
  }

  function applyContentSelection(
    selection: ContentSelectionState,
    entries: DirectoryEntry[] = activeContentEntries,
  ) {
    setInfoTargetPathOverride(null);
    syncContentSelectionRefs(selection, entries);
    setContentSelection(selection);
  }

  function clearContentSelection() {
    applyContentSelection(EMPTY_CONTENT_SELECTION);
  }

  function setSingleContentSelection(path: string) {
    applyContentSelection(createSingleContentSelection(path));
  }

  function toggleContentSelection(path: string) {
    setContentSelection((current) => {
      const nextSelection = toggleSelectionState(current, activeContentEntries, path);
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
    });
  }

  function extendContentSelectionToPath(path: string, additive = false) {
    setContentSelection((current) => {
      const nextSelection = extendSelectionStateToPath(
        current,
        activeContentEntries,
        path,
        additive,
      );
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
    });
  }

  function handleContentSelectionGesture(
    path: string,
    modifiers: { metaKey: boolean; shiftKey: boolean },
  ) {
    if (modifiers.metaKey && modifiers.shiftKey) {
      extendContentSelectionToPath(path, true);
      return;
    }
    if (modifiers.shiftKey) {
      extendContentSelectionToPath(path);
      return;
    }
    if (modifiers.metaKey) {
      toggleContentSelection(path);
      return;
    }
    setSingleContentSelection(path);
  }

  // Drag-to-select: the items under the box, kept in the order they are shown.
  function selectContentPaths(paths: string[], leadPath: string | null) {
    const picked = new Set(paths);
    const orderedPaths = activeContentEntries
      .filter((entry) => picked.has(entry.path))
      .map((entry) => entry.path);
    applyContentSelection(
      orderedPaths.length === 0
        ? EMPTY_CONTENT_SELECTION
        : { paths: orderedPaths, anchorPath: leadPath, leadPath },
    );
  }

  function selectAllContentEntries() {
    applyContentSelection(selectAllSelectionStateEntries(activeContentEntries));
  }

  function openItemContextMenu(
    path: string | null,
    position: { x: number; y: number },
    surface: "content" | "search" = "content",
  ) {
    let contextPaths: string[] = [];
    if (path) {
      if (selectedPathSet.has(path)) {
        contextPaths = selectedPathsInViewOrder;
      } else {
        contextPaths = [path];
        setSingleContentSelection(path);
      }
    } else {
      clearContentSelection();
    }
    setFocusedPane("content");
    window.requestAnimationFrame(() => {
      contentPaneRef.current?.focus({ preventScroll: true });
    });
    if (!path) {
      // Empty space: a short menu for the folder on screen. Search results have no single
      // folder behind them, so there is no menu there.
      if (surface === "search" || currentPath.length === 0) {
        setContextMenuState(null);
        return;
      }
      setContextMenuState({
        ...position,
        // Left empty on purpose: shortcuts pressed while the menu is open act on these
        // paths, and they must not reach the folder itself.
        paths: [],
        targetPath: null,
        surface: "background",
        targetKind: "contentEntry",
        sourceSubview: null,
        scope: "background",
        folderExpansionLabel: null,
      });
      return;
    }
    // Inside Trash, items get the full content menu plus "Delete Immediately".
    const resolvedSurface =
      surface === "content" && isPathInsideTrash(currentPath, homePath) ? "trash" : surface;
    setContextMenuState({
      ...position,
      paths: contextPaths,
      targetPath: path,
      surface: resolvedSurface,
      targetKind: "contentEntry",
      sourceSubview: null,
      scope: contextPaths.length > 0 ? "selection" : "background",
      folderExpansionLabel: null,
    });
  }

  function openTreeItemContextMenu(
    input: {
      path: string;
      sourceSubview: ContextMenuSourceSubview;
      targetKind: "treeFolder" | "favorite";
      folderExpansionLabel: "Expand" | "Collapse" | null;
    } & { position: { x: number; y: number } },
  ) {
    setFocusedPane("tree");
    setContextMenuState({
      x: input.position.x,
      y: input.position.y,
      paths: [input.path],
      targetPath: input.path,
      surface: input.targetKind,
      targetKind: input.targetKind,
      sourceSubview: input.sourceSubview,
      scope: "selection",
      folderExpansionLabel: input.folderExpansionLabel,
    });
  }

  function showModalNotice(title: string, message: string) {
    actionNoticeReturnFocusPaneRef.current =
      focusedPane ??
      lastExplorerFocusPaneRef.current ??
      (contextMenuState
        ? contextMenuState.surface === "treeFolder" || contextMenuState.surface === "favorite"
          ? "tree"
          : "content"
        : null);
    setActionNotice({
      title,
      message,
    });
  }

  function showOpenItemLimitNotice(action: "Open" | "Edit", selectedCount: number) {
    showModalNotice(
      `Too Many Items to ${action}`,
      createOpenItemLimitMessage(action, selectedCount, openItemLimit),
    );
  }

  function dismissActionNotice() {
    const paneToRestore = actionNoticeReturnFocusPaneRef.current;
    actionNoticeReturnFocusPaneRef.current = null;
    setActionNotice(null);
    restoreExplorerPaneFocus(paneToRestore);
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function applyWriteOperationCardState(nextState: WriteOperationCardState | null) {
    if (nextState !== null && !writeOperationLockedRef.current) {
      writeOperationTabIdRef.current = activeTabIdRef.current;
      selectionAtWriteStartRef.current = {
        directoryPath: currentPathRef.current,
        paths: [...selectedPathsInViewOrderRef.current],
      };
    }
    writeOperationLockedRef.current = nextState !== null;
    setWriteOperationCardState(nextState);
  }

  // A drag doesn't start while an operation runs; the notification says why, so the rows
  // don't just seem not to move.
  function noticeDragRefusedWhileBusy() {
    const card = writeOperationCardStateRef.current;
    if (!card) {
      return;
    }
    pushToast({
      kind: "info",
      title: describeDragRefusedWhileBusy(card.action, card.currentSourcePath),
    });
  }

  function pushToast(input: {
    kind: ToastKind;
    title: string;
    message?: string;
  }) {
    if (!notificationsEnabled) {
      return;
    }
    const id = `toast-${nextToastIdRef.current}`;
    nextToastIdRef.current += 1;
    setToasts((current) => enqueueToast(current, createToastEntry(id, input)));
  }

  function surfaceCopyLikePreStartFailureNotice(
    action: WriteStartAction,
    outcome: Extract<CopyLikePreStartOutcome, { status: "blocked" | "error" }>,
  ) {
    showModalNotice(getCopyLikePreStartFailureTitle(action), outcome.message);
  }

  function applyCopyPasteClipboardState(nextClipboard: CopyPasteClipboardState) {
    copyPasteClipboardRef.current = nextClipboard;
    setCopyPasteClipboardState(nextClipboard);
  }

  function isWriteOperationInFlight(): boolean {
    return writeOperationLockedRef.current;
  }

  // One file operation runs at a time. Every write asked for meanwhile says so the same way,
  // in a dialog, since nothing it asked for happened.
  function showWriteOperationBusyNotice(action: WriteStartAction) {
    surfaceCopyLikePreStartFailureNotice(action, getCopyLikeBusyOutcome());
  }

  function isWriteOperationBusyError(error: unknown): boolean {
    return error instanceof Error && error.message.includes(WRITE_OPERATION_BUSY_ERROR);
  }

  // Trash, Delete Immediately, Rename and New Folder take the one-write lock before their
  // request is sent, not when the main process answers: a second press that comes in between
  // (a quick double Command-Delete) then finds the lock taken instead of sending again.
  function takeWriteOperationLock(
    action: Extract<
      WriteStartAction,
      "trash" | "delete_immediately" | "rename" | "batch_rename" | "new_folder"
    >,
    details: {
      targetPath: string | null;
      totalItemCount: number;
      currentSourcePath: string | null;
    },
  ) {
    noteFolderUsed();
    applyWriteOperationCardState({
      action,
      stage: "starting",
      targetPath: details.targetPath,
      completedItemCount: 0,
      totalItemCount: details.totalItemCount,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: details.currentSourcePath,
    });
  }

  function formatItemSummaryFromPathCount(firstPath: string, itemCount: number): string {
    const firstName = getPathLeafName(firstPath);
    if (itemCount <= 1) {
      return firstName;
    }
    return `${firstName} and ${itemCount - 1} more`;
  }

  function formatResultCountLabel(count: number, noun: string): string {
    return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
  }

  function formatPlannedSkipToastMessage(event: WriteOperationProgressEvent): string | null {
    const result = event.result;
    if (!result) {
      return null;
    }
    const { completedItemCount, skippedItemCount } = result.summary;
    const sentences: string[] = [];
    if (completedItemCount > 0) {
      const verb = event.action === "move_to" ? "Moved" : "Copied";
      sentences.push(`${verb} ${formatResultCountLabel(completedItemCount, "item")}.`);
    }
    if (skippedItemCount > 0) {
      sentences.push(
        `Skipped ${formatResultCountLabel(skippedItemCount, "item")} that already ${
          skippedItemCount === 1 ? "exists" : "exist"
        }.`,
      );
    }
    return sentences.length > 0 ? sentences.join(" ") : null;
  }

  function getPlannedSkipToastTitle(
    action: WriteOperationProgressEvent["action"],
    completedItemCount: number,
  ): string {
    if (action === "move_to") {
      return completedItemCount > 0 ? "Move finished with skipped items" : "Nothing moved";
    }
    if (action === "duplicate") {
      return completedItemCount > 0
        ? "Duplicate finished with skipped items"
        : "Nothing duplicated";
    }
    if (action === "copy_to") {
      return completedItemCount > 0 ? "Copy finished with skipped items" : "Nothing copied";
    }
    return completedItemCount > 0 ? "Paste finished with skipped items" : "Nothing pasted";
  }

  function formatClipboardItemSummary(paths: string[]): string {
    const firstPath = paths[0];
    if (!firstPath) {
      return "item";
    }
    return formatItemSummaryFromPathCount(firstPath, paths.length);
  }

  function getWriteOperationRepresentativePath(event: WriteOperationProgressEvent): string | null {
    const result = event.result;
    if (!result) {
      return event.currentSourcePath ?? event.currentDestinationPath;
    }
    const representativeItem = result.items.find((item) => {
      if (event.action === "new_folder") {
        return typeof item.destinationPath === "string" && item.destinationPath.length > 0;
      }
      if (event.action === "rename") {
        return (
          (typeof item.destinationPath === "string" && item.destinationPath.length > 0) ||
          (typeof item.sourcePath === "string" && item.sourcePath.length > 0)
        );
      }
      if (event.action === "trash") {
        return typeof item.sourcePath === "string" && item.sourcePath.length > 0;
      }
      return (
        (typeof item.sourcePath === "string" && item.sourcePath.length > 0) ||
        (typeof item.destinationPath === "string" && item.destinationPath.length > 0)
      );
    });
    if (event.action === "new_folder") {
      return representativeItem?.destinationPath ?? event.currentDestinationPath;
    }
    if (event.action === "rename") {
      return (
        representativeItem?.destinationPath ??
        representativeItem?.sourcePath ??
        event.currentDestinationPath ??
        event.currentSourcePath
      );
    }
    if (event.action === "trash") {
      return representativeItem?.sourcePath ?? event.currentSourcePath;
    }
    return (
      representativeItem?.sourcePath ??
      representativeItem?.destinationPath ??
      event.currentSourcePath ??
      event.currentDestinationPath
    );
  }

  function formatWriteOperationItemSummary(event: WriteOperationProgressEvent): string | null {
    const result = event.result;
    const representativePath = getWriteOperationRepresentativePath(event);
    if (!representativePath) {
      return null;
    }
    const itemCount =
      result?.summary.topLevelItemCount ?? (event.totalItemCount > 0 ? event.totalItemCount : 1);
    // Quoted as macOS quotes names: “notes.md”, or “notes.md” and 2 more.
    const name = `“${getPathLeafName(representativePath)}”`;
    return itemCount <= 1 ? name : `${name} and ${itemCount - 1} more`;
  }

  function pushTerminalCopyPasteToast(event: WriteOperationProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    if (event.action === "undo" || event.action === "redo") {
      const label = runningUndoLabelRef.current;
      runningUndoLabelRef.current = null;
      // Told only when it can't be seen: nothing it changed is in the folder on screen.
      const shownFolder = currentPathRef.current;
      const changedHere = result.items.some((item) =>
        [item.sourcePath, item.destinationPath].some(
          (path) => path !== null && parentDirectoryPath(path) === shownFolder,
        ),
      );
      if (event.status === "completed" && !changedHere) {
        pushToast({
          kind: "success",
          title: event.action === "undo" ? "Undone" : "Redone",
          ...(label ? { message: label } : {}),
        });
      }
      return;
    }
    // What is made or renamed in the folder on screen is already in sight there, and a
    // rename of several that left anything as it was is told in the result dialog.
    if (
      event.action === "new_folder" ||
      event.action === "rename" ||
      event.action === "batch_rename" ||
      event.action === "duplicate"
    ) {
      return;
    }
    const itemSummary = formatWriteOperationItemSummary(event);
    const completedTitle =
      event.action === "move_to"
        ? result.targetPath
          ? `Moved to ${getPathLeafName(result.targetPath)}`
          : "Moved"
        : event.action === "copy_to"
          ? result.targetPath
            ? `Copied to ${getPathLeafName(result.targetPath)}`
            : "Copied"
          : event.action === "trash"
            ? "Moved to Trash"
            : event.action === "delete_immediately"
              ? "Deleted"
              : result.targetPath
                ? `Pasted into ${getPathLeafName(result.targetPath)}`
                : "Pasted";
    if (event.status === "completed") {
      pushToast({
        kind: "success",
        title: completedTitle,
        ...(itemSummary ? { message: itemSummary } : {}),
      });
      return;
    }
    if (event.status === "cancelled") {
      pushToast({
        kind: "info",
        title:
          event.action === "move_to"
            ? "Move cancelled"
            : event.action === "copy_to"
              ? "Copy cancelled"
              : event.action === "trash"
                ? "Move to Trash cancelled"
                : event.action === "delete_immediately"
                  ? "Delete cancelled"
                  : "Paste cancelled",
        ...(itemSummary ? { message: itemSummary } : {}),
      });
      return;
    }
    // A write that failed, or finished with real issues, never gets here: it is reported
    // in the result dialog (shouldRenderCopyPasteResultDialog), not in a notification.
    if (event.status === "partial" && isExpectedPlannedSkipResult(event)) {
      const plannedSkipMessage = formatPlannedSkipToastMessage(event);
      pushToast({
        kind: "info",
        title: getPlannedSkipToastTitle(event.action, result.summary.completedItemCount),
        ...(plannedSkipMessage ? { message: plannedSkipMessage } : {}),
      });
    }
  }

  function beginPendingPasteAttempt(options: {
    action: CopyLikeAction;
    targetPath: string;
    totalItemCount: number;
    totalBytes: number | null;
    currentSourcePath: string | null;
  }): number {
    const pasteAttemptId = nextPasteAttemptIdRef.current + 1;
    nextPasteAttemptIdRef.current = pasteAttemptId;
    pendingPasteAttemptRef.current = {
      id: pasteAttemptId,
      phase: "planning",
      cancelled: false,
    };
    applyWriteOperationCardState({
      action: options.action,
      stage: "starting",
      targetPath: options.targetPath,
      completedItemCount: 0,
      totalItemCount: options.totalItemCount,
      completedByteCount: 0,
      totalBytes: options.totalBytes,
      currentSourcePath: options.currentSourcePath,
    });
    return pasteAttemptId;
  }

  async function copyPathsToClipboard(paths: string[]) {
    await client.invoke("system:copyText", {
      text: paths.map((path) => formatPathForShell(path)).join("\n"),
    });
  }

  async function runCopyPathAction(paths: string[]) {
    try {
      await copyPathsToClipboard(paths);
      pushToast({
        kind: "success",
        title: paths.length === 1 ? "Copied path" : "Copied paths",
        message: formatClipboardItemSummary(paths),
      });
    } catch (error) {
      logger.error("copy path failed", error);
      showModalNotice(
        paths.length === 1 ? "Couldn’t Copy the Path" : "Couldn’t Copy the Paths",
        "File Trail couldn’t put them on the clipboard.",
      );
    }
  }

  // What Copy and Cut take: the right-clicked items; else the tree's folder while the tree
  // has the keyboard; else the selection in the file list. A folder of the tree is never
  // taken because of a selection left behind in the list, nor the other way round.
  function resolveClipboardSource(explicitPaths?: string[]): {
    paths: string[];
    fromTree: boolean;
  } {
    const contextMenuFromTree =
      contextMenuState?.surface === "treeFolder" || contextMenuState?.surface === "favorite";
    if (explicitPaths && explicitPaths.length > 0) {
      return { paths: explicitPaths, fromTree: contextMenuFromTree };
    }
    if (contextMenuState && contextMenuState.paths.length > 0) {
      return { paths: contextMenuState.paths, fromTree: contextMenuFromTree };
    }
    if (focusedPane === "tree") {
      const treePath = getFileSystemItemPath(selectedTreeItemIdRef.current);
      return { paths: treePath ? [treePath] : [], fromTree: true };
    }
    return { paths: selectedPathsInViewOrderRef.current, fromTree: false };
  }

  // What is known about the copied items, for their icons and for saying how many are
  // folders: everything in the tree is a folder, and the file list knows its own entries.
  function resolveClipboardSourceEntries(
    paths: string[],
    fromTree: boolean,
  ): Record<string, ClipboardSourceEntry> {
    const sourceEntries: Record<string, ClipboardSourceEntry> = {};
    if (fromTree) {
      for (const path of paths) {
        sourceEntries[path] = { kind: "directory", isSymlink: false };
      }
      return sourceEntries;
    }
    const pathSet = new Set(paths);
    for (const entry of activeContentEntries) {
      if (pathSet.has(entry.path)) {
        sourceEntries[entry.path] = {
          kind: entry.kind,
          isSymlink: entry.isSymlink,
          ...(entry.isExecutable === undefined ? {} : { isExecutable: entry.isExecutable }),
        };
      }
    }
    return sourceEntries;
  }

  async function runCopyClipboardAction(mode: "copy" | "cut", explicitPaths?: string[]) {
    const { paths, fromTree } = resolveClipboardSource(explicitPaths);
    // Nothing selected: the command is greyed out, and its keys do nothing, as in Finder.
    if (paths.length === 0) {
      return;
    }
    const clipboard = setCopyPasteClipboard(
      mode,
      paths,
      new Date().toISOString(),
      resolveClipboardSourceEntries(paths, fromTree),
    );
    // No notification: the toolbar's clipboard button and the marks on the items show it.
    applyCopyPasteClipboardState(clipboard);
    closeContextMenu();
  }

  function removeClipboardPath(path: string) {
    applyCopyPasteClipboardState(removeClipboardItem(copyPasteClipboardRef.current, path));
  }

  function clearClipboard() {
    applyCopyPasteClipboardState(clearCopyPasteClipboard());
  }

  async function executeCopyLikePlan(
    report: CopyPasteAnalysisReport,
    policy: CopyPastePolicy,
    action: CopyLikeAction,
    options: {
      pasteAttemptId?: number | null;
      clearClipboardOnStart?: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
      overrides?: CopyPasteOverrides;
    } = {},
  ): Promise<CopyLikePreStartOutcome> {
    const pasteAttemptId = options.pasteAttemptId ?? null;
    const clearClipboardOnStart = options.clearClipboardOnStart ?? false;
    const sourceSurface = options.sourceSurface ?? null;
    rememberPendingTreeSelectionPath(options.pendingTreeSelectionPath ?? null);
    if (pasteAttemptId !== null) {
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt || pendingAttempt.id !== pasteAttemptId || pendingAttempt.cancelled) {
        return { status: "cancelled" };
      }
      pendingPasteAttemptRef.current = {
        ...pendingAttempt,
        phase: "starting",
      };
    }
    // Stop pressed while the start request is on its way (from the review sheet) is kept
    // here, and the operation is stopped as soon as its id is known.
    const startRequest = { cancelled: false };
    startRequestRef.current = startRequest;
    applyWriteOperationCardState({
      action,
      stage: "starting",
      targetPath: report.destinationDirectoryPath,
      completedItemCount: 0,
      totalItemCount: report.summary.totalNodeCount,
      completedByteCount: 0,
      totalBytes: report.summary.totalBytes,
      currentSourcePath: report.sourcePaths[0] ?? null,
    });
    try {
      const overrides = Object.entries(options.overrides ?? {}).map(([nodeId, choice]) => ({
        nodeId,
        action: choice,
      }));
      noteFolderUsed();
      const response = await client.invoke("copyPaste:start", {
        analysisId: report.analysisId,
        action,
        policy,
        ...(overrides.length > 0 ? { overrides } : {}),
      });
      if (action === "move_to" && sourceSurface) {
        moveOperationSourceSurfaceRef.current.set(response.operationId, sourceSurface);
      }
      // Like Finder: copied items stay on the clipboard for more pastes; cut items are
      // cleared once something was actually moved.
      const clipboard = copyPasteClipboardRef.current;
      if (
        clearClipboardOnStart &&
        report.mode === "cut" &&
        clipboard.type === "ready" &&
        clipboard.mode === "cut"
      ) {
        clipboardClearAfterMoveRef.current = {
          operationId: response.operationId,
          capturedAt: clipboard.capturedAt,
        };
      }
      const pendingAttempt = pasteAttemptId === null ? null : pendingPasteAttemptRef.current;
      if (startRequestRef.current === startRequest) {
        startRequestRef.current = null;
      }
      if (
        startRequest.cancelled ||
        (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled)
      ) {
        pendingPasteAttemptRef.current = null;
        rememberPendingTreeSelectionPath(null);
        adoptWriteOperation(response.operationId);
        setWriteOperationProgressEvent({
          operationId: response.operationId,
          action,
          status: "queued",
          completedItemCount: 0,
          totalItemCount: report.summary.totalNodeCount,
          completedByteCount: 0,
          totalBytes: report.summary.totalBytes,
          currentSourcePath: report.sourcePaths[0] ?? null,
          currentDestinationPath: null,
          runtimeConflict: null,
          result: null,
        });
        void cancelWriteOperation();
        return { status: "cancelled" };
      }
      pendingPasteAttemptRef.current = null;
      adoptWriteOperation(response.operationId);
      applyWriteOperationCardState({
        action,
        stage: "queued",
        targetPath: report.destinationDirectoryPath,
        completedItemCount: 0,
        totalItemCount: report.summary.totalNodeCount,
        completedByteCount: 0,
        totalBytes: report.summary.totalBytes,
        currentSourcePath: report.sourcePaths[0] ?? null,
      });
      setWriteOperationProgressEvent({
        operationId: response.operationId,
        action,
        status: "queued",
        completedItemCount: 0,
        totalItemCount: report.summary.totalNodeCount,
        completedByteCount: 0,
        totalBytes: report.summary.totalBytes,
        currentSourcePath: report.sourcePaths[0] ?? null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: null,
      });
      setCopyPasteDialogState(null);
      activeAnalysisIdRef.current = null;
      closeContextMenu();
      return { status: "queued" };
    } catch (error) {
      rememberPendingTreeSelectionPath(null);
      const pendingAttempt = pasteAttemptId === null ? null : pendingPasteAttemptRef.current;
      if (startRequestRef.current === startRequest) {
        startRequestRef.current = null;
      }
      if (
        startRequest.cancelled ||
        (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled)
      ) {
        pendingPasteAttemptRef.current = null;
        return { status: "cancelled" };
      }
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("copy paste start failed", error);
      if (isWriteOperationBusyError(error)) {
        return getCopyLikeBusyOutcome();
      }
      return {
        status: "error",
        message: error instanceof Error ? error.message : getCopyLikeStartFailureMessage(action),
      };
    }
  }

  // Starts the reviewed plan. Resolves true once the operation is under way, and false
  // when it did not start (busy, expired analysis, IPC failure) so the review dialog can
  // take its start button out of the busy state and let the user try again.
  async function requestCopyLikePlanStart(
    report: CopyPasteAnalysisReport,
    policy: CopyPastePolicy,
    action: CopyLikeAction,
    options: {
      clearClipboardOnStart: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
      overrides?: CopyPasteOverrides;
    },
  ): Promise<boolean> {
    // A second click on the review dialog's start button must not start it again.
    if (reviewStartInFlightRef.current === report.analysisId) {
      return false;
    }
    reviewStartInFlightRef.current = report.analysisId;
    try {
      const outcome = await executeCopyLikePlan(report, policy, action, options);
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureNotice(action, outcome);
      }
      return outcome.status === "queued";
    } catch (error) {
      logger.error("copy paste review start failed", error);
      return false;
    } finally {
      if (reviewStartInFlightRef.current === report.analysisId) {
        reviewStartInFlightRef.current = null;
      }
    }
  }

  async function analyzeCopyLikeRequest(args: {
    mode: "copy" | "cut";
    sourcePaths: string[];
    destinationDirectoryPath: string;
    action: CopyLikeAction;
    pasteAttemptId: number;
    clearClipboardOnStart: boolean;
    sourceSurface?: InternalMoveSourceSurface | null;
    pendingTreeSelectionPath?: string | null;
    defaultPolicy?: CopyPastePolicy;
    shouldReviewReport?: (report: CopyPasteAnalysisReport) => boolean;
    initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
    // Told which clipboard items were left out because they no longer exist.
    onSourcesMissing?: ((paths: string[]) => void) | undefined;
  }): Promise<CopyLikePreStartOutcome> {
    const defaultPolicy = args.defaultPolicy ?? DEFAULT_COPY_PASTE_POLICY;
    try {
      const handle = await client.invoke("copyPaste:analyzeStart", {
        mode: args.mode,
        sourcePaths: args.sourcePaths,
        destinationDirectoryPath: args.destinationDirectoryPath,
        action: args.action,
      });
      activeAnalysisIdRef.current = handle.analysisId;
      setCopyPasteDialogState({
        type: "analysis",
        analysisId: handle.analysisId,
        action: args.action,
        clearClipboardOnStart: args.clearClipboardOnStart,
        sourceSurface: args.sourceSurface ?? null,
        pendingTreeSelectionPath: args.pendingTreeSelectionPath ?? null,
      });
      applyWriteOperationCardState({
        action: args.action,
        stage: "analyzing",
        targetPath: args.destinationDirectoryPath,
        completedItemCount: 0,
        totalItemCount: 0,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: args.sourcePaths[0] ?? null,
      });

      for (;;) {
        const pendingAttempt = pendingPasteAttemptRef.current;
        if (
          !pendingAttempt ||
          pendingAttempt.id !== args.pasteAttemptId ||
          pendingAttempt.cancelled
        ) {
          if (activeAnalysisIdRef.current) {
            await client
              .invoke("copyPaste:analyzeCancel", { analysisId: handle.analysisId })
              .catch(() => undefined);
            activeAnalysisIdRef.current = null;
          }
          pendingPasteAttemptRef.current = null;
          applyWriteOperationCardState(null);
          setCopyPasteDialogState(null);
          return { status: "cancelled" };
        }
        const update = await client.invoke("copyPaste:analyzeGetUpdate", {
          analysisId: handle.analysisId,
        });
        if (!update.done) {
          await delay(ANALYSIS_POLL_INTERVAL_MS);
          continue;
        }
        activeAnalysisIdRef.current = null;
        if (update.status === "cancelled") {
          pendingPasteAttemptRef.current = null;
          applyWriteOperationCardState(null);
          setCopyPasteDialogState(null);
          return { status: "cancelled" };
        }
        if (update.status !== "complete" || !update.report) {
          pendingPasteAttemptRef.current = null;
          applyWriteOperationCardState(null);
          setCopyPasteDialogState(null);
          logger.error("copy paste analysis failed", update.error ?? update.status);
          return {
            status: "error",
            message: update.error?.trim() || getCopyLikePreparationFailureMessage(args.action),
          };
        }
        if (update.report.issues.length > 0) {
          // Issues are per item, so the items they are about can be left out and the rest
          // still go. Moving items into the folder they are already in leaves them there, like
          // Finder, whether by Paste, a drag (search results from several folders) or Move To.
          // Clipboard items that were moved or deleted since they were copied are dropped.
          const leftOut = collectLeftOutSourcePaths(update.report, args.sourcePaths, {
            alreadyInPlace: args.initiator != null && update.report.mode === "cut",
            missing: args.initiator === "clipboard",
          });
          if (leftOut) {
            if (leftOut.missing.size > 0) {
              args.onSourcesMissing?.([...leftOut.missing]);
            }
            const remainingSourcePaths = args.sourcePaths.filter(
              (path) => !leftOut.alreadyInPlace.has(path) && !leftOut.missing.has(path),
            );
            if (remainingSourcePaths.length > 0) {
              return await analyzeCopyLikeRequest({ ...args, sourcePaths: remainingSourcePaths });
            }
            pendingPasteAttemptRef.current = null;
            applyWriteOperationCardState(null);
            setCopyPasteDialogState(null);
            // Nothing is left to do. A paste into the folder the items are in quietly does
            // nothing, like Finder, and missing items are reported by the paste; a drag or
            // Move To that would move nothing says why.
            if (args.initiator === "clipboard" || leftOut.missing.size > 0) {
              return { status: "cancelled" };
            }
            return { status: "blocked", message: getCopyLikeIssueMessage(update.report) };
          }
          pendingPasteAttemptRef.current = null;
          applyWriteOperationCardState(null);
          setCopyPasteDialogState(null);
          return {
            status: "blocked",
            message: getCopyLikeIssueMessage(update.report),
          };
        }
        const shouldReview =
          args.shouldReviewReport?.(update.report) ?? reportHasConflicts(update.report);
        if (shouldReview) {
          pendingPasteAttemptRef.current = null;
          applyWriteOperationCardState(null);
          setCopyPasteDialogState({
            type: "review",
            report: update.report,
            policy: defaultPolicy,
            overrides: {},
            action: args.action,
            clearClipboardOnStart: args.clearClipboardOnStart,
            sourceSurface: args.sourceSurface ?? null,
            pendingTreeSelectionPath: args.pendingTreeSelectionPath ?? null,
          });
          return { status: "review" };
        }
        return await executeCopyLikePlan(update.report, defaultPolicy, args.action, {
          pasteAttemptId: args.pasteAttemptId,
          clearClipboardOnStart: args.clearClipboardOnStart,
          sourceSurface: args.sourceSurface ?? null,
          pendingTreeSelectionPath: args.pendingTreeSelectionPath ?? null,
        });
      }
    } catch (error) {
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (pendingAttempt && pendingAttempt.id === args.pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        activeAnalysisIdRef.current = null;
        setCopyPasteDialogState(null);
        applyWriteOperationCardState(null);
        return { status: "cancelled" };
      }
      activeAnalysisIdRef.current = null;
      pendingPasteAttemptRef.current = null;
      setCopyPasteDialogState(null);
      applyWriteOperationCardState(null);
      logger.error("copy paste planning failed", error);
      return {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : getCopyLikePreparationFailureMessage(args.action),
      };
    }
  }

  // The source paths that can be left out of the operation: those a cut would leave where
  // they already are, and (when allowed) those that no longer exist. Null when the report has
  // any other issue; those still need the blocking notice.
  function collectLeftOutSourcePaths(
    report: CopyPasteAnalysisReport,
    sourcePaths: readonly string[],
    allowed: { alreadyInPlace: boolean; missing: boolean },
  ): { alreadyInPlace: Set<string>; missing: Set<string> } | null {
    const requestedPaths = new Set(sourcePaths);
    const leftOut = { alreadyInPlace: new Set<string>(), missing: new Set<string>() };
    for (const issue of report.issues) {
      if (issue.sourcePath === null || !requestedPaths.has(issue.sourcePath)) {
        return null;
      }
      if (issue.code === "same_path" && allowed.alreadyInPlace) {
        leftOut.alreadyInPlace.add(issue.sourcePath);
      } else if (issue.code === "source_missing" && allowed.missing) {
        leftOut.missing.add(issue.sourcePath);
      } else {
        return null;
      }
    }
    return leftOut;
  }

  async function startPasteFromClipboard() {
    // No folder to paste into, or nothing to paste: Paste is greyed out, and its keys do
    // nothing, as in Finder.
    if (pasteDestinationPath === null) {
      return;
    }
    const request = buildPasteRequest(copyPasteClipboardRef.current, pasteDestinationPath);
    if (!request) {
      return;
    }
    const action = request.mode === "cut" ? "move_to" : "paste";
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyNotice(action);
      return;
    }
    // Items moved or deleted outside the app since they were copied are taken off the
    // clipboard and the rest are pasted. Which ones were left out is told afterwards.
    const missingSourcePaths: string[] = [];
    const onSourcesMissing = (paths: string[]) => {
      missingSourcePaths.push(...paths);
      applyCopyPasteClipboardState(dropClipboardPaths(copyPasteClipboardRef.current, paths));
    };
    let outcome: CopyLikePreStartOutcome;
    if (request.mode === "cut") {
      outcome = await startMoveToDestination(
        request.sourcePaths,
        request.destinationDirectoryPath,
        {
          clearClipboardOnStart: true,
          initiator: "clipboard",
          onSourcesMissing,
        },
      );
    } else {
      const pasteAttemptId = beginPendingPasteAttempt({
        action: "paste",
        targetPath: request.destinationDirectoryPath,
        totalItemCount: request.sourcePaths.length,
        totalBytes: null,
        currentSourcePath: request.sourcePaths[0] ?? null,
      });
      outcome = await analyzeCopyLikeRequest({
        mode: request.mode,
        sourcePaths: request.sourcePaths,
        destinationDirectoryPath: request.destinationDirectoryPath,
        action: "paste",
        pasteAttemptId,
        clearClipboardOnStart: true,
        initiator: "clipboard",
        onSourcesMissing,
      });
    }
    if (missingSourcePaths.length === 0) {
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureNotice(action, outcome);
      }
      return;
    }
    const verb = action === "move_to" ? "moved" : "pasted";
    const missingMessage = formatMissingClipboardItemsMessage(missingSourcePaths, verb);
    if (outcome.status === "blocked" || outcome.status === "error") {
      surfaceCopyLikePreStartFailureNotice(action, {
        ...outcome,
        message: `${missingMessage} ${outcome.message}`,
      });
      return;
    }
    // The rest are already on their way (or in review); this only says what was left out.
    const nothingPasted = missingSourcePaths.length === request.sourcePaths.length;
    showModalNotice(
      nothingPasted
        ? getCopyLikePreStartFailureTitle(action)
        : missingSourcePaths.length === 1
          ? `An item couldn’t be ${verb}`
          : `Some items couldn’t be ${verb}`,
      missingMessage,
    );
  }

  async function cancelWriteOperation() {
    const operationId = activeWriteOperationIdRef.current;
    if (!operationId && startRequestRef.current) {
      // The start request is on its way: the operation stops once it has an id.
      startRequestRef.current.cancelled = true;
      return;
    }
    if (!operationId) {
      const activeAnalysisId = activeAnalysisIdRef.current;
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt && !activeAnalysisId) {
        return;
      }
      if (pendingAttempt) {
        pendingPasteAttemptRef.current = {
          ...pendingAttempt,
          cancelled: true,
        };
      }
      if (activeAnalysisId) {
        await client
          .invoke("copyPaste:analyzeCancel", { analysisId: activeAnalysisId })
          .catch(() => undefined);
        activeAnalysisIdRef.current = null;
        setCopyPasteDialogState(null);
        applyWriteOperationCardState(null);
        setWriteOperationProgressEvent(null);
        pendingPasteAttemptRef.current = null;
        return;
      }
      if (pendingAttempt?.phase === "planning") {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        setWriteOperationProgressEvent(null);
      }
      return;
    }
    try {
      await client.invoke("writeOperation:cancel", { operationId });
    } catch (error) {
      logger.error("copy paste cancel failed", error);
      showModalNotice(
        "Couldn’t Stop",
        "File Trail couldn’t stop what’s running. Wait for it to finish, then check the result.",
      );
    }
  }

  async function retryFailedCopyPasteItems(event: WriteOperationProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    // A rename is tried again from its sheet, for the items that weren't renamed, where
    // each is now: the names are worked out anew from what the folders hold now.
    // They are taken from the result, not the list: one may be outside what is listed, or
    // under a hidden name.
    if (event.action === "batch_rename") {
      const targets = result.items.flatMap((item) => {
        const path = item.destinationPath ?? item.sourcePath;
        if (item.status === "completed" || !path) {
          return [];
        }
        const isFolder = batchRenameFoldersRef.current.get(item.sourcePath ?? path) ?? false;
        return [{ path, name: getPathLeafName(path), isFolder }];
      });
      dismissCopyPasteDialog();
      openBatchRenameSheet(targets);
      return;
    }
    if (
      event.action !== "paste" &&
      event.action !== "copy_to" &&
      event.action !== "move_to" &&
      event.action !== "duplicate"
    ) {
      dismissCopyPasteDialog();
      return;
    }
    const failedSourcePaths = collectRetrySourcePaths(result.items);
    if (failedSourcePaths.length === 0) {
      dismissCopyPasteDialog();
      return;
    }
    // A retried move clears the cut items off the clipboard once it moves something, like
    // a normal cut and paste. Only a cut of these same items is cleared, never an
    // unrelated clipboard.
    const clipboard = copyPasteClipboardRef.current;
    const retriesClipboardCut =
      event.action === "move_to" &&
      clipboard.type === "ready" &&
      clipboard.mode === "cut" &&
      failedSourcePaths.some((path) => clipboard.sourcePaths.includes(path));
    const pasteAttemptId = beginPendingPasteAttempt({
      action: event.action,
      targetPath: result.targetPath ?? currentPathRef.current,
      totalItemCount: failedSourcePaths.length,
      totalBytes: null,
      currentSourcePath: failedSourcePaths[0] ?? null,
    });
    setWriteOperationProgressEvent(null);
    setCopyPasteDialogState(null);
    const outcome = await analyzeCopyLikeRequest({
      mode: event.action === "move_to" ? "cut" : "copy",
      sourcePaths: failedSourcePaths,
      destinationDirectoryPath: result.targetPath ?? currentPathRef.current,
      action: event.action,
      pasteAttemptId,
      clearClipboardOnStart: retriesClipboardCut,
      defaultPolicy: RETRY_COPY_PASTE_POLICY,
    });
    if (outcome.status === "blocked" || outcome.status === "error") {
      surfaceCopyLikePreStartFailureNotice(event.action, outcome);
    }
  }

  function dismissCopyPasteDialog() {
    setCopyPasteDialogState(null);
    setWriteOperationProgressEvent(null);
    activeWriteOperationIdRef.current = null;
    activeAnalysisIdRef.current = null;
  }

  // Cancel on a question asked before anything starts (Move to Trash?, Delete?, Empty
  // Trash?, a name with a dot): only the question goes. An operation running behind it
  // keeps running and keeps its progress.
  function closeConfirmationDialog() {
    setCopyPasteDialogState((current) => (isConfirmationDialog(current) ? null : current));
  }

  function updateCopyPasteChoices(choices: {
    policy: CopyPastePolicy;
    overrides: CopyPasteOverrides;
  }) {
    setCopyPasteDialogState((current) =>
      current && current.type === "review"
        ? { ...current, policy: choices.policy, overrides: choices.overrides }
        : current,
    );
  }

  async function resolveRuntimeConflict(
    conflictId: string,
    resolution: CopyPasteChoice,
    applyToRemaining: boolean,
  ) {
    const operationId = activeWriteOperationIdRef.current;
    if (!operationId) {
      return;
    }
    try {
      await client.invoke("copyPaste:resolveConflict", {
        operationId,
        conflictId,
        resolution,
        ...(applyToRemaining ? { applyToRemaining } : {}),
      });
    } catch (error) {
      // The question stays on screen, so it can be answered again or the operation stopped.
      logger.error("copy paste conflict resolution failed", error);
    }
  }

  function handleCopyPasteDialogEscape() {
    if (moveDialogState) {
      setMoveDialogState(null);
      return;
    }
    if (renameDialogState) {
      setRenameDialogState(null);
      return;
    }
    if (newFolderDialogState) {
      setNewFolderDialogState(null);
      return;
    }
    // A question on top of a running operation is what Escape answers, not the operation.
    if (isConfirmationDialog(copyPasteDialogState)) {
      setCopyPasteDialogState(null);
      return;
    }
    if (writeOperationProgressEvent) {
      if (
        writeOperationProgressEvent.status === "running" ||
        writeOperationProgressEvent.status === "queued" ||
        writeOperationProgressEvent.status === "awaiting_resolution"
      ) {
        void cancelWriteOperation();
        return;
      }
      dismissCopyPasteDialog();
      return;
    }
    // Escape on "Preparing to Paste…" does what its Cancel does: the analysis stops, so
    // the paste can't start once the sheet is gone.
    if (copyPasteDialogState?.type === "analysis") {
      void cancelWriteOperation();
      return;
    }
    if (copyPasteDialogState) {
      setCopyPasteDialogState(null);
    }
  }

  // Whether the person picked something else while the operation ran: what they picked
  // stays selected, rather than jumping to what the operation made (a ⌘⌫ right after would
  // otherwise act on an item they never chose).
  function selectionChangedSinceWriteStarted(): boolean {
    const atStart = selectionAtWriteStartRef.current;
    selectionAtWriteStartRef.current = null;
    if (atStart === null || atStart.directoryPath !== currentPathRef.current) {
      return false;
    }
    const now = selectedPathsInViewOrderRef.current;
    return now.length !== atStart.paths.length || now.some((path) => !atStart.paths.includes(path));
  }

  function queueWriteOperationSelection(
    result: NonNullable<WriteOperationProgressEvent["result"]>,
  ) {
    const selectedPaths = result.items
      .filter(
        (item): item is typeof item & { destinationPath: string } =>
          item.status === "completed" && typeof item.destinationPath === "string",
      )
      .map((item) => item.destinationPath);
    const selectionDirectoryPath = resolveWriteOperationSelectionDirectoryPath(
      result,
      selectedPaths,
    );

    if (
      isSearchModeRef.current ||
      !selectionDirectoryPath ||
      currentPathRef.current !== selectionDirectoryPath ||
      selectionChangedSinceWriteStarted()
    ) {
      pendingPasteSelectionRef.current = null;
      return;
    }
    pendingPasteSelectionRef.current =
      selectedPaths.length > 0
        ? {
            directoryPath: selectionDirectoryPath,
            selectedPaths,
          }
        : null;
  }

  async function copyGetInfoPath(path: string): Promise<boolean> {
    try {
      await client.invoke("system:copyText", { text: formatPathForShell(path) });
      return true;
    } catch (error) {
      logger.error("Info Panel copy path failed", error);
      setActionNotice({
        title: "Couldn’t Copy the Path",
        message: "File Trail couldn’t put it on the clipboard.",
      });
      return false;
    }
  }

  async function copyGetInfoName(name: string): Promise<boolean> {
    try {
      await client.invoke("system:copyText", { text: name });
      return true;
    } catch (error) {
      logger.error("Info Panel copy name failed", error);
      setActionNotice({
        title: "Couldn’t Copy the Name",
        message: "File Trail couldn’t put it on the clipboard.",
      });
      return false;
    }
  }

  // The info panel can show an item that is not in the file list (a tree folder's file, a
  // search result), so this does not look the entry up the way `editPaths` does.
  async function editPathInTextEditor(path: string) {
    await openPathsWithApplication([path], defaultTextEditor.appPath, defaultTextEditor.appName);
  }

  async function openPathInTerminal(path: string) {
    noteFolderUsed();
    try {
      const response = await client.invoke("system:openInTerminal", {
        path,
      });
      if (!response.ok) {
        throw new Error(response.error ?? "The terminal app didn’t open.");
      }
    } catch (error) {
      logger.error("open in Terminal failed", error);
      setActionNotice({
        title: "Couldn’t Open Terminal",
        message: "File Trail couldn’t open the terminal app in this folder.",
      });
    }
  }

  // `title` says what couldn't be done if the window for choosing an app doesn't open.
  async function pickApplicationForOpenWith(
    title: string,
  ): Promise<{ appPath: string; appName: string } | null> {
    try {
      const response = await client.invoke("system:pickApplication", {});
      if (response.canceled || !response.appPath || !response.appName) {
        return null;
      }
      return {
        appPath: response.appPath,
        appName: response.appName,
      };
    } catch (error) {
      logger.error("open with application picker failed", error);
      setActionNotice({
        title,
        message: "The window for choosing an app didn’t open.",
      });
      return null;
    }
  }

  async function openPathsWithApplication(
    paths: string[],
    applicationPath: string,
    applicationName: string,
  ) {
    noteFolderUsed();
    try {
      const response = await client.invoke("system:openPathsWithApplication", {
        applicationPath,
        paths,
      });
      if (!response.ok) {
        throw new Error(response.error ?? `${applicationName} didn’t answer.`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error("open with application failed", error);
      setActionNotice({
        title: `Couldn’t Open in ${applicationName}`,
        message: `File Trail couldn’t open ${paths.length === 1 ? "it" : "them"} in ${applicationName}. ${detail}`,
      });
    }
  }

  // The main process reveals the items when the application is Finder itself.
  async function showPathsInFinder(paths: string[]) {
    try {
      const response = await client.invoke("system:openPathsWithApplication", {
        applicationPath: FINDER_APP_PATH,
        paths,
      });
      if (!response.ok) {
        throw new Error(response.error ?? "Finder didn’t answer.");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error("show in finder failed", error);
      setActionNotice({
        title: "Couldn’t Show in Finder",
        message: `Finder couldn’t show ${paths.length === 1 ? "it" : "them"}. ${detail}`,
      });
    }
  }

  async function addOpenWithApplication() {
    const selection = await pickApplicationForOpenWith("Couldn’t Add an App");
    if (!selection) {
      return;
    }
    setOpenWithApplications((current) => [
      ...current,
      {
        id: createOpenWithApplicationId(),
        appPath: selection.appPath,
        appName: selection.appName,
      },
    ]);
  }

  async function browseDefaultTextEditor() {
    const selection = await pickApplicationForOpenWith("Couldn’t Choose the Text Editor");
    if (!selection) {
      return;
    }
    setDefaultTextEditor(selection);
  }

  async function browseTerminalApplication() {
    const selection = await pickApplicationForOpenWith("Couldn’t Choose the Terminal App");
    if (!selection) {
      return;
    }
    setTerminalApp(selection);
  }

  async function browseOpenWithApplication(entryId: string) {
    const selection = await pickApplicationForOpenWith("Couldn’t Change the App");
    if (!selection) {
      return;
    }
    setOpenWithApplications((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              appPath: selection.appPath,
              appName: selection.appName,
            }
          : entry,
      ),
    );
  }

  function moveOpenWithApplication(entryId: string, direction: "up" | "down") {
    setOpenWithApplications((current) => {
      const index = current.findIndex((entry) => entry.id === entryId);
      if (index === -1) {
        return current;
      }
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [entry] = next.splice(index, 1);
      if (!entry) {
        return current;
      }
      next.splice(targetIndex, 0, entry);
      return next;
    });
  }

  function removeOpenWithApplication(entryId: string) {
    setOpenWithApplications((current) => current.filter((entry) => entry.id !== entryId));
  }

  // Goes to the folder an item is in and selects the item there.
  async function revealSearchResultInFolder(path: string) {
    const folderPath = parentDirectoryPath(path);
    if (!folderPath) {
      return;
    }
    setSearchPopoverOpen(false);
    searchInputRef.current?.blur();
    const didNavigate = await navigateTo(
      folderPath,
      folderPath === currentPath ? "replace" : "push",
    );
    if (!didNavigate) {
      return;
    }
    setSingleContentSelection(path);
    focusContentPane();
  }

  async function showInfoForPath(path: string) {
    const requestId = ++getInfoRequestRef.current;
    setInfoTargetPathOverride(path);
    setInfoPanelOpen(true);
    setGetInfoLoading(true);
    void client
      .invoke("item:getProperties", { path })
      .then((response) => {
        if (getInfoRequestRef.current !== requestId) {
          return;
        }
        setGetInfoItem(response.item);
      })
      .catch((error) => {
        if (getInfoRequestRef.current !== requestId) {
          return;
        }
        setGetInfoItem(null);
        logger.error("Info Panel load failed", error);
      })
      .finally(() => {
        if (getInfoRequestRef.current === requestId) {
          setGetInfoLoading(false);
        }
      });
  }

  async function revealFavoriteInTree(path: string) {
    await navigateTreeFileSystemPath(path, currentPathRef.current === path ? "replace" : "push");
  }

  function toggleFavoritePath(path: string, options?: { revealInTreeOnRemove?: boolean }) {
    const shouldRemove = isFavoritePath(favorites, path);
    // The Trash is always under Locations: it is never made a favorite.
    if (!shouldRemove && path === getTrashPath(homePath)) {
      return;
    }
    setFavorites((current) =>
      shouldRemove
        ? current.filter((favorite) => favorite.path !== path)
        : [...current, createFavorite(path, homePath)],
    );
    if (shouldRemove && options?.revealInTreeOnRemove) {
      void revealFavoriteInTree(path);
    }
  }

  function getContextMenuWriteAction(actionId: ContextMenuActionId): WriteStartAction {
    switch (actionId) {
      case "move":
        return "move_to";
      case "rename":
        return "rename";
      case "duplicate":
        return "duplicate";
      case "newFolder":
        return "new_folder";
      case "trash":
        return "trash";
      default: {
        const clipboard = copyPasteClipboardRef.current;
        return clipboard.type === "ready" && clipboard.mode === "cut" ? "move_to" : "paste";
      }
    }
  }

  async function runContextMenuAction(actionId: ContextMenuActionId, paths: string[]) {
    const contextMenuSurface = contextMenuState?.surface ?? null;
    const contextMenuTargetPath = contextMenuState?.targetPath ?? null;
    const contextMenuScope = contextMenuState?.scope ?? "selection";
    closeContextMenu();
    if (WRITE_LOCKED_CONTEXT_ACTION_IDS.includes(actionId) && isWriteOperationInFlight()) {
      showWriteOperationBusyNotice(getContextMenuWriteAction(actionId));
      return;
    }
    if (contextMenuSurface === "background" && BACKGROUND_FOLDER_ACTION_IDS.includes(actionId)) {
      // These act on the folder on screen, which the menu state does not carry as a path.
      const folderPath = currentPathRef.current;
      if (folderPath.length === 0) {
        return;
      }
      if (actionId === "showInfo") {
        await showInfoForPath(folderPath);
      } else if (actionId === "calculateSize") {
        // With nothing selected the status bar shows the folder on screen's size.
        callbacks.calculateFolderSize(folderPath);
      } else if (actionId === "copyPath") {
        await runCopyPathAction([folderPath]);
      } else if (actionId === "terminal") {
        await openPathInTerminal(folderPath);
      } else {
        await showPathsInFinder([folderPath]);
      }
      return;
    }
    if (actionId === "revealInFolder") {
      const firstPath = paths[0];
      if (firstPath) {
        await revealSearchResultInFolder(firstPath);
      }
      return;
    }
    if (actionId === "copyPath") {
      if (paths.length > 0) {
        await runCopyPathAction(paths);
      }
      return;
    }
    if (actionId === "copy") {
      await runCopyClipboardAction("copy", paths);
      return;
    }
    if (actionId === "cut") {
      await runCopyClipboardAction("cut", paths);
      return;
    }
    if (actionId === "paste") {
      await startPasteFromClipboard();
      return;
    }
    if (actionId === "open") {
      await openPaths(paths);
      return;
    }
    if (actionId === "quickLook") {
      const firstPath = paths[0];
      if (firstPath) {
        void client.invoke("system:quickLook", { path: firstPath }).catch(() => undefined);
      }
      return;
    }
    if (actionId === "edit") {
      await editPaths(paths);
      return;
    }
    if (actionId === "showInfo") {
      const firstPath = paths[0];
      if (firstPath) {
        await showInfoForPath(firstPath);
      }
      return;
    }
    if (actionId === "calculateSize") {
      // The status bar shows the size as it comes in: the selection's, which a right-clicked
      // item is part of, or the folder on screen's with nothing selected.
      if (contextMenuTargetEntries.length > 1) {
        callbacks.calculateFolderSizes(
          contextMenuTargetEntries
            .filter((entry) => isFolderSizeEligibleKind(entry.kind))
            .map((entry) => entry.path),
        );
        return;
      }
      const targetPath = contextMenuTargetPath ?? paths[0];
      if (!targetPath) {
        return;
      }
      callbacks.calculateFolderSize(targetPath);
      // A folder in the sidebar is not selected in the list, so the status bar shows it only
      // when it is the folder on screen, and the Size column only when it is a row there in
      // the Details view. Anywhere else only the Info panel can show its size.
      const isSidebarFolder =
        contextMenuSurface === "treeFolder" || contextMenuSurface === "favorite";
      const shownInSizeColumn =
        !isSearchMode &&
        viewMode === "details" &&
        detailColumns.size &&
        activeContentEntries.some((entry) => entry.path === targetPath);
      if (isSidebarFolder && targetPath !== currentPathRef.current && !shownInSizeColumn) {
        await showInfoForPath(targetPath);
      }
      return;
    }
    if (actionId === "toggleFavorite") {
      const targetPath = paths[0];
      if (!targetPath) {
        return;
      }
      toggleFavoritePath(targetPath, {
        revealInTreeOnRemove: contextMenuSurface === "favorite",
      });
      return;
    }
    if (actionId === "revealInTree") {
      const targetPath = paths[0];
      if (targetPath) {
        await revealFavoriteInTree(targetPath);
      }
      return;
    }
    if (actionId === "rootTreeHere") {
      const targetPath = contextMenuTargetPath ?? paths[0];
      if (targetPath) {
        rootTreeAtPath(targetPath);
      }
      return;
    }
    if (actionId === "openInNewTab") {
      const targetPath = contextMenuTargetPath ?? paths[0];
      if (targetPath) {
        await openFolderInNewTab(targetPath);
      }
      return;
    }
    if (actionId === "move") {
      openMoveDialog(paths);
      return;
    }
    if (actionId === "rename") {
      openRenameDialog(paths, {
        fromTree: contextMenuSurface === "treeFolder" || contextMenuSurface === "favorite",
      });
      return;
    }
    if (actionId === "duplicate") {
      const targetPath = paths[0];
      const destinationDirectoryPath =
        contextMenuSurface === "treeFolder" && targetPath
          ? (parentDirectoryPath(targetPath) ?? currentPathRef.current)
          : contextMenuSurface === "search"
            ? resolveDuplicateFolder(paths)
            : currentPathRef.current;
      if (destinationDirectoryPath === null) {
        return;
      }
      await startDuplicatePaths(paths, destinationDirectoryPath, {
        selectInTreeOnSuccess: contextMenuSurface === "treeFolder",
      });
      return;
    }
    if (actionId === "newFolder") {
      const targetPath =
        contextMenuSurface === "treeFolder" || contextMenuSurface === "favorite"
          ? contextMenuTargetPath
          : resolveNewFolderTargetPath({
              currentPath,
              selectedEntry: contextMenuTargetEntry,
              selectedPaths: paths,
              isSearchMode,
              contextScope: contextMenuScope,
              homePath,
            });
      if (targetPath) {
        openNewFolderDialog(targetPath, {
          selectInTreeOnSuccess:
            contextMenuSurface === "treeFolder" || contextMenuSurface === "favorite",
        });
      }
      return;
    }
    if (actionId === "trash") {
      if (contextMenuSurface === "treeFolder") {
        setCopyPasteDialogState({
          type: "confirmTrash",
          paths,
          itemLabel: formatItemSummaryFromPathCount(paths[0] ?? "item", paths.length),
        });
        return;
      }
      await startTrashPaths(paths);
      return;
    }
    if (actionId === "showPackageContents") {
      const firstPath = paths[0];
      if (firstPath) {
        await navigateTo(firstPath, "push");
      }
      return;
    }
    if (actionId === "deleteImmediately") {
      requestDeleteImmediately(paths);
      return;
    }
    if (actionId === "emptyTrash") {
      requestEmptyTrash();
      return;
    }
    if (actionId === "terminal") {
      const firstPath = paths[0];
      if (firstPath) {
        await openPathInTerminal(firstPath);
      }
      return;
    }
    if (actionId === "showInFinder") {
      if (paths.length > 0) {
        await showPathsInFinder(paths);
      }
      return;
    }
    logger.error("unhandled context menu action", { actionId, paths, surface: contextMenuSurface });
    showModalNotice("Couldn’t Do That", "This command isn’t available here.");
  }

  // Delete Immediately is asked about first: it can't be undone. While another operation
  // runs it can't start, so it isn't asked about either.
  function requestDeleteImmediately(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    if (isWriteOperationInFlight()) {
      closeContextMenu();
      showWriteOperationBusyNotice("delete_immediately");
      return;
    }
    setCopyPasteDialogState({
      type: "confirmDeleteImmediately",
      paths,
      itemLabel: formatItemSummaryFromPathCount(paths[0] ?? "item", paths.length),
    });
  }

  // So is emptying the Trash, with Finder's question.
  function requestEmptyTrash() {
    if (isWriteOperationInFlight()) {
      closeContextMenu();
      showWriteOperationBusyNotice("empty_trash");
      return;
    }
    setCopyPasteDialogState({ type: "confirmEmptyTrash" });
  }

  async function confirmEmptyTrash() {
    setCopyPasteDialogState(null);
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyNotice("empty_trash");
      return;
    }
    if (await emptyTrash()) {
      // The Trash, or a folder in it, may be on screen: it is read again.
      if (isPathInsideTrash(currentPathRef.current, homePath)) {
        void refreshDirectory({});
      }
    }
  }

  // Finder empties the Trash (the main process asks it to). A failure is told in a dialog;
  // the usual one is that macOS has not let File Trail control Finder.
  async function emptyTrash(): Promise<boolean> {
    let failure: string | null = null;
    try {
      const response = await client.invoke("system:emptyTrash", {});
      if (!response.ok) {
        failure = response.error ?? "";
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (failure === null) {
      return true;
    }
    logger.error("empty trash failed", failure);
    const notice = describeEmptyTrashFailure(failure);
    showModalNotice(notice.title, notice.message);
    return false;
  }

  async function runContextSubmenuAction(action: ContextMenuSubmenuAction, paths: string[]) {
    closeContextMenu();
    // View As and Sort By set the window's view, which the app does (App.tsx).
    if (paths.length === 0 || action.kind === "viewMode" || action.kind === "sortBy") {
      return;
    }
    if (action.kind === "other") {
      const selection = await pickApplicationForOpenWith("Couldn’t Choose an App");
      if (!selection) {
        return;
      }
      await openPathsWithApplication(paths, selection.appPath, selection.appName);
      return;
    }
    await openPathsWithApplication(paths, action.appPath, action.appName);
  }

  async function openEntry(entry: DirectoryEntry) {
    if (entry.kind === "bundle") {
      await openPathExternally(entry.path);
      return;
    }
    if (entry.kind === "directory") {
      await navigateTo(entry.path, "push");
      return;
    }
    if (entry.kind === "symlink_directory") {
      const viewEpoch = navigation.viewEpochRef.current;
      const targetPath = await resolveTargetPath(entry.path);
      // Another tab may have come to the front while the alias was looked up.
      if (targetPath && navigation.viewEpochRef.current === viewEpoch) {
        await navigateTo(targetPath, "push");
      }
      return;
    }
    if (entry.kind === "symlink_file") {
      const targetPath = await resolveTargetPath(entry.path);
      if (targetPath) {
        await openPathExternally(targetPath);
      }
      return;
    }
    await openPathExternally(entry.path);
  }

  async function activateContentEntry(entry: DirectoryEntry) {
    await activateContentPaths([entry.path]);
  }

  // Opens a folder in a new tab. A folder alias opens the folder it points to, as it does
  // when it is opened in place.
  async function openFolderInNewTab(path: string) {
    const entry = activeContentEntries.find((candidate) => candidate.path === path) ?? null;
    const targetPath = entry?.kind === "symlink_directory" ? await resolveTargetPath(path) : path;
    if (targetPath) {
      callbacks.openPathInNewTab(targetPath);
    }
  }

  async function resolveTargetPath(path: string): Promise<string | null> {
    try {
      const response = await client.invoke("path:resolve", { path });
      return response.resolvedPath;
    } catch (error) {
      logger.error("resolve target path failed", error);
      return null;
    }
  }

  async function openPathExternally(path: string) {
    noteFolderUsed();
    try {
      const response = await client.invoke("system:openPath", { path });
      if (!response.ok) {
        throw new Error(response.error ?? "The item didn’t open.");
      }
    } catch (error) {
      logger.error("open in macOS failed", error);
    }
  }

  async function openPaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    if (paths.length > openItemLimit) {
      showOpenItemLimitNotice("Open", paths.length);
      return;
    }
    if (paths.length === 1) {
      const entry = activeContentEntries.find((candidate) => candidate.path === paths[0]);
      if (entry) {
        await openEntry(entry);
        return;
      }
    }
    for (const path of paths) {
      await openPathExternally(path);
    }
  }

  async function editPaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    const entries = paths
      .map((path) => activeContentEntries.find((candidate) => candidate.path === path) ?? null)
      .filter((entry): entry is DirectoryEntry => entry !== null);
    if (entries.length !== paths.length || entries.some((entry) => !isEditableFileEntry(entry))) {
      return;
    }
    if (paths.length > openItemLimit) {
      showOpenItemLimitNotice("Edit", paths.length);
      return;
    }
    await openPathsWithApplication(paths, defaultTextEditor.appPath, defaultTextEditor.appName);
  }

  // The selected items of the list or of the search results, when the list has the
  // keyboard (or had it last).
  function canRunContentSelectionAction(): boolean {
    if (mainView !== "explorer") {
      return false;
    }
    const activePane = focusedPane ?? lastExplorerFocusPaneRef.current;
    return activePane === "content";
  }

  // Where duplicates of these items go: next to them. In search results they may come from
  // several folders, and then there is no one folder for them (null).
  function resolveDuplicateFolder(paths: readonly string[]): string | null {
    const folders = new Set(paths.map((path) => parentDirectoryPath(path) ?? path));
    return folders.size === 1 ? ([...folders][0] ?? null) : null;
  }

  // Duplicate from the keyboard or the menu bar: next to the items, in the list or in the
  // search results.
  function startDuplicateOfSelection(paths: string[]) {
    if (!isSearchModeRef.current) {
      void startDuplicatePaths(paths);
      return;
    }
    const folder = resolveDuplicateFolder(paths);
    if (folder === null) {
      pushToast({ kind: "info", title: "Duplicate items from one folder at a time" });
      return;
    }
    void startDuplicatePaths(paths, folder);
  }

  function resolveContentActionPaths(): string[] {
    if (!canRunContentSelectionAction()) {
      return [];
    }
    return [...selectedPathsInViewOrderRef.current];
  }

  async function startDuplicatePaths(
    paths: string[],
    destinationDirectoryPath = currentPathRef.current,
    options: { selectInTreeOnSuccess?: boolean } = {},
  ) {
    if (paths.length === 0 || destinationDirectoryPath.length === 0) {
      return;
    }
    // Nothing is made in the Trash (the menus offer no Duplicate there).
    if (
      isPathInsideTrash(destinationDirectoryPath, homePath) ||
      paths.some((path) => isPathInsideTrash(path, homePath))
    ) {
      return;
    }
    if (isWriteOperationInFlight()) {
      surfaceCopyLikePreStartFailureNotice("duplicate", getCopyLikeBusyOutcome());
      return;
    }
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "duplicate",
      targetPath: destinationDirectoryPath,
      totalItemCount: paths.length,
      totalBytes: null,
      currentSourcePath: paths[0] ?? null,
    });
    const outcome = await analyzeCopyLikeRequest({
      mode: "copy",
      sourcePaths: paths,
      destinationDirectoryPath,
      action: "duplicate",
      pasteAttemptId,
      clearClipboardOnStart: false,
      pendingTreeSelectionPath: options.selectInTreeOnSuccess ? destinationDirectoryPath : null,
    });
    if (outcome.status === "blocked" || outcome.status === "error") {
      surfaceCopyLikePreStartFailureNotice("duplicate", outcome);
      return;
    }
    closeContextMenu();
  }

  async function validateMoveDestinationDirectory(
    destinationDirectoryPath: string,
  ): Promise<string | null> {
    try {
      const response = await client.invoke("item:getProperties", {
        path: destinationDirectoryPath,
      });
      if (!response.item || response.item.kind !== "directory" || response.item.isSymlink) {
        return "Destination must be an existing folder.";
      }
      return null;
    } catch (error) {
      logger.error("move destination validation failed", error);
      return "File Trail couldn’t check the folder.";
    }
  }

  async function startMoveToDestination(
    sourcePaths: string[],
    destinationDirectoryPath: string,
    options: {
      pendingTreeSelectionPath?: string | null;
      reviewLargeBatchWarning?: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      validateDestinationBeforeAnalyze?: boolean;
      clearClipboardOnStart?: boolean;
      initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
      onSourcesMissing?: (paths: string[]) => void;
    } = {},
  ): Promise<CopyLikePreStartOutcome> {
    if (sourcePaths.length === 0 || destinationDirectoryPath.length === 0) {
      return {
        status: "blocked",
        message: "Choose a destination folder.",
      };
    }
    if (isWriteOperationInFlight()) {
      return getCopyLikeBusyOutcome();
    }
    if (options.validateDestinationBeforeAnalyze) {
      const validationMessage = await validateMoveDestinationDirectory(destinationDirectoryPath);
      if (validationMessage) {
        return {
          status: "blocked",
          message: validationMessage,
        };
      }
    }
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "move_to",
      targetPath: destinationDirectoryPath,
      totalItemCount: sourcePaths.length,
      totalBytes: null,
      currentSourcePath: sourcePaths[0] ?? null,
    });
    return analyzeCopyLikeRequest({
      mode: "cut",
      sourcePaths,
      destinationDirectoryPath,
      action: "move_to",
      pasteAttemptId,
      clearClipboardOnStart: options.clearClipboardOnStart ?? false,
      sourceSurface: options.sourceSurface ?? null,
      pendingTreeSelectionPath: options.pendingTreeSelectionPath ?? null,
      initiator: options.initiator ?? null,
      onSourcesMissing: options.onSourcesMissing,
      defaultPolicy: DEFAULT_COPY_PASTE_POLICY,
      shouldReviewReport: (report) =>
        reportHasConflicts(report) ||
        (options.reviewLargeBatchWarning === true && reportHasWarningCode(report, "large_batch")),
    });
  }

  // Copies items into a folder the way a copy and paste does: a drag that copies (to another
  // disk, or with Option held). Into the folder the items are in, it makes "name copy"
  // duplicates, as an Option-drag does in Finder.
  async function startCopyToDestination(
    sourcePaths: string[],
    destinationDirectoryPath: string,
    options: {
      pendingTreeSelectionPath?: string | null;
      reviewLargeBatchWarning?: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      validateDestinationBeforeAnalyze?: boolean;
      initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
    } = {},
  ): Promise<CopyLikePreStartOutcome> {
    if (sourcePaths.length === 0 || destinationDirectoryPath.length === 0) {
      return {
        status: "blocked",
        message: "Choose a destination folder.",
      };
    }
    if (isWriteOperationInFlight()) {
      return getCopyLikeBusyOutcome();
    }
    if (options.validateDestinationBeforeAnalyze) {
      const validationMessage = await validateMoveDestinationDirectory(destinationDirectoryPath);
      if (validationMessage) {
        return {
          status: "blocked",
          message: validationMessage,
        };
      }
    }
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "copy_to",
      targetPath: destinationDirectoryPath,
      totalItemCount: sourcePaths.length,
      totalBytes: null,
      currentSourcePath: sourcePaths[0] ?? null,
    });
    return analyzeCopyLikeRequest({
      mode: "copy",
      sourcePaths,
      destinationDirectoryPath,
      action: "copy_to",
      pasteAttemptId,
      clearClipboardOnStart: false,
      pendingTreeSelectionPath: options.pendingTreeSelectionPath ?? null,
      initiator: options.initiator ?? null,
      defaultPolicy: DEFAULT_COPY_PASTE_POLICY,
      shouldReviewReport: (report) =>
        reportHasConflicts(report) ||
        (options.reviewLargeBatchWarning === true && reportHasWarningCode(report, "large_batch")),
    });
  }

  function openMoveDialog(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    // Nothing could be moved until the running operation ends: said now, not after a
    // destination was picked.
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyNotice("move_to");
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setFocusedPane(null);
    setMoveDialogState({
      sourcePaths: paths,
      currentPath: currentPathRef.current,
      submitting: false,
      error: null,
    });
    closeContextMenu();
  }

  async function submitMoveDialog(destinationDirectoryPath: string) {
    if (!moveDialogState) {
      return;
    }
    const resolvedDestinationDirectoryPath = expandHomeShortcut(
      destinationDirectoryPath.trim(),
      homePath,
    );
    setMoveDialogState((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const didStart = await startMoveToDestination(
      moveDialogState.sourcePaths,
      resolvedDestinationDirectoryPath,
      {
        initiator: "move_dialog",
        validateDestinationBeforeAnalyze: true,
      },
    );
    if (didStart.status === "queued" || didStart.status === "review") {
      setMoveDialogState(null);
      return;
    }
    if (didStart.status === "cancelled") {
      setMoveDialogState((current) =>
        current
          ? {
              ...current,
              submitting: false,
              error: null,
            }
          : current,
      );
      return;
    }
    setMoveDialogState((current) =>
      current
        ? {
            ...current,
            submitting: false,
            error: didStart.message,
          }
        : current,
    );
  }

  async function browseForDirectoryPath(currentDirectoryPath: string): Promise<string | null> {
    const response = await client.invoke("system:pickDirectory", {
      defaultPath:
        currentDirectoryPath.length > 0 ? expandHomeShortcut(currentDirectoryPath, homePath) : null,
    });
    return response.canceled ? null : response.path;
  }

  // Starts a rename. An item shown in the file list is renamed in its row, like Finder;
  // `fromTree` (the folder tree's menu) and items outside the list use the dialog.
  function openRenameDialog(paths: string[], options: { fromTree?: boolean } = {}) {
    if (paths.length > 1) {
      openBatchRenameFor(paths);
      return;
    }
    if (paths.length !== 1) {
      return;
    }
    const sourcePath = paths[0];
    if (!sourcePath) {
      return;
    }
    // Said now, before a name is typed that couldn't be used until the operation ends.
    if (isWriteOperationInFlight()) {
      closeContextMenu();
      showWriteOperationBusyNotice("rename");
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setFocusedPane(null);
    clearTypeahead();
    setRenameDialogState({
      sourcePath,
      currentName: getPathLeafName(sourcePath),
      error: null,
      refusalCount: 0,
      // In the list or the search results, the name is edited in its row. An item the list
      // filter hides counts too: the filter is cleared to show a folder just made.
      inline:
        !options.fromTree &&
        (activeContentEntries.some((entry) => entry.path === sourcePath) ||
          (!isSearchModeRef.current && currentEntries.some((entry) => entry.path === sourcePath))),
      sessionId: nextRenameSessionId(),
    });
    closeContextMenu();
  }

  // The Rename sheet for several items, in the order the list shows them (which numbers
  // them). A folder's whole name is its name; a package (an .app) keeps its extension.
  function openBatchRenameFor(paths: string[]) {
    const wanted = new Set(paths);
    openBatchRenameSheet(
      activeContentEntries
        .filter((entry) => wanted.has(entry.path))
        .map((entry) => ({
          path: entry.path,
          name: entry.name,
          isFolder: entry.kind === "directory" || entry.kind === "symlink_directory",
        })),
    );
  }

  function openBatchRenameSheet(targets: BatchRenameTarget[]) {
    closeContextMenu();
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyNotice("batch_rename");
      return;
    }
    if (targets.length === 0) {
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    clearTypeahead();
    callbacks.openBatchRename(targets);
  }

  // Renames the items the sheet settled. Like every write, it waits for no other: one that
  // is running is said, and the sheet stays closed.
  async function startBatchRename(request: IpcRequest<"writeOperation:batchRename">) {
    const first = request.items[0]?.sourcePath ?? null;
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyNotice("batch_rename");
      return;
    }
    batchRenameFoldersRef.current = new Map(
      request.items.map((item) => [item.sourcePath, item.isFolder]),
    );
    takeWriteOperationLock("batch_rename", {
      targetPath: first,
      totalItemCount: request.items.length,
      currentSourcePath: first,
    });
    try {
      const response = await client.invoke("writeOperation:batchRename", request);
      adoptWriteOperation(response.operationId);
      applyWriteOperationCardState({
        action: "batch_rename",
        stage: "queued",
        targetPath: first,
        completedItemCount: 0,
        totalItemCount: request.items.length,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: first,
      });
    } catch (error) {
      applyWriteOperationCardState(null);
      if (isWriteOperationBusyError(error)) {
        showWriteOperationBusyNotice("batch_rename");
        return;
      }
      showModalNotice(
        getCopyLikePreStartFailureTitle("batch_rename"),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function submitRenameDialog(typedName: string) {
    const dialogState = renameDialogState;
    if (!dialogState) {
      return;
    }
    // Spaces around a name are dropped (the main process drops them too), before anything
    // is decided from it: " .env" would hide the item as ".env" does.
    const nextName = typedName.trim();
    if (nextName === dialogState.currentName) {
      setRenameDialogState(null);
      return;
    }
    const nameError = getItemNameError(nextName);
    if (nameError) {
      refuseRenameName(nameError);
      return;
    }
    const request = { kind: "rename", sourcePath: dialogState.sourcePath, name: nextName } as const;
    if (isWriteOperationInFlight()) {
      refuseWriteWhileBusy(request);
      return;
    }
    if (needsDotNameConfirmation(nextName, dialogState.currentName)) {
      setRenameDialogState(null);
      setCopyPasteDialogState({ type: "confirmDotName", request });
      return;
    }
    await startRename(request, (message) => {
      // The person may have left the folder while the name was checked (a click on another
      // folder ends the field and opens that folder): with no field left to show it under,
      // the refusal gets a dialog of its own, and nothing waits on a field that is gone.
      if (dialogState.inline && !renameFieldItemShownRef.current(dialogState.sourcePath)) {
        setRenameDialogState(null);
        showModalNotice(
          `“${getPathLeafName(dialogState.sourcePath)}” couldn’t be renamed`,
          message,
        );
        return;
      }
      refuseRenameName(message);
    });
  }

  // Whether the item a rename field is on is still in the list on screen, read when it is
  // asked rather than when the name was submitted.
  const renameFieldItemShownRef = useRef((path: string) =>
    activeContentEntries.some((entry) => entry.path === path),
  );
  renameFieldItemShownRef.current = (path: string) =>
    activeContentEntries.some((entry) => entry.path === path);

  // A rename field whose item has left the list (another folder was opened, the item was
  // removed) closes: it would otherwise hold the keyboard with nothing on screen to type in.
  // A refusal it was showing is said in a dialog instead, so it isn't lost.
  // biome-ignore lint/correctness/useExhaustiveDependencies: showModalNotice reads current state when called; only the list and the field decide this.
  useEffect(() => {
    if (
      !renameDialogState?.inline ||
      activeContentEntries.some((entry) => entry.path === renameDialogState.sourcePath)
    ) {
      return;
    }
    setRenameDialogState(null);
    if (renameDialogState.error !== null) {
      showModalNotice(getCopyLikePreStartFailureTitle("rename"), renameDialogState.error);
    }
  }, [activeContentEntries, renameDialogState, setRenameDialogState]);

  // A refused name keeps the field (or dialog) open with the reason under it. The count lets
  // the field know it was refused again even when the reason reads the same as last time.
  function refuseRenameName(message: string) {
    setRenameDialogState((current) =>
      current ? { ...current, error: message, refusalCount: current.refusalCount + 1 } : current,
    );
  }

  // Nothing is renamed or created while another write runs. The name field or dialog closes,
  // so it is not left waiting, and the same dialog as for every other write says why.
  function refuseWriteWhileBusy(request: DotNameRequest) {
    if (request.kind === "rename") {
      setRenameDialogState(null);
      showWriteOperationBusyNotice("rename");
      return;
    }
    // The folder won't be made, so nothing is waiting to be renamed in its row.
    pendingInlineRenamePathRef.current = null;
    setNewFolderDialogState(null);
    showWriteOperationBusyNotice("new_folder");
  }

  // Like Finder: a name that begins with a dot hides the item, so while hidden files are not
  // shown it would vanish. That is asked first. A name that already began with one hides
  // nothing new.
  function needsDotNameConfirmation(name: string, currentName: string | null): boolean {
    return name.startsWith(".") && !includeHidden && !(currentName ?? "").startsWith(".");
  }

  // "Use “.”" in the dot-name dialog: the rename or new folder goes ahead as asked. A refusal
  // now has no field to go under, so it gets a dialog of its own.
  async function confirmDotNameDialog() {
    const dialogState = copyPasteDialogState;
    if (dialogState?.type !== "confirmDotName") {
      return;
    }
    setCopyPasteDialogState(null);
    const { request } = dialogState;
    const refuse = (message: string) =>
      showModalNotice(
        getCopyLikePreStartFailureTitle(request.kind === "rename" ? "rename" : "new_folder"),
        message,
      );
    if (request.kind === "rename") {
      await startRename(request, refuse);
      return;
    }
    await startCreateFolder(request, refuse);
  }

  // The question an Undo is waiting on: true to go ahead, false when it went without (Cancel,
  // Escape). Either all of the Undo happens or none of it.
  const undoQuestionResolverRef = useRef<((goAhead: boolean) => void) | null>(null);
  // What the Undo running now undoes ("Move of “a.txt”"), to say so when it has finished.
  const runningUndoLabelRef = useRef<string | null>(null);

  function askUndoQuestion(
    question: Omit<
      Extract<NonNullable<typeof copyPasteDialogState>, { type: "undoQuestion" }>,
      "type"
    >,
  ): Promise<boolean> {
    undoQuestionResolverRef.current?.(false);
    return new Promise((resolve) => {
      undoQuestionResolverRef.current = resolve;
      setCopyPasteDialogState({ type: "undoQuestion", ...question });
    });
  }

  function answerUndoQuestion(goAhead: boolean) {
    const resolve = undoQuestionResolverRef.current;
    undoQuestionResolverRef.current = null;
    setCopyPasteDialogState(null);
    resolve?.(goAhead);
  }

  // A question closed some other way (Escape) goes without.
  useEffect(() => {
    if (copyPasteDialogState?.type !== "undoQuestion" && undoQuestionResolverRef.current) {
      const resolve = undoQuestionResolverRef.current;
      undoQuestionResolverRef.current = null;
      resolve(false);
    }
  }, [copyPasteDialogState]);

  // Undoes (or redoes) the last file operation: asks first about what the main process
  // found it can't simply do, then runs all of it as any operation runs, or none of it.
  async function startUndo(direction: "undo" | "redo") {
    if (isWriteOperationInFlight()) {
      return;
    }
    let prepared: IpcResponse<"undo:prepare">;
    try {
      prepared = await client.invoke("undo:prepare", { direction });
    } catch (error) {
      showModalNotice(
        getCopyLikePreStartFailureTitle(direction),
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (prepared.ticket === null) {
      if (prepared.refusal === "busy") {
        showWriteOperationBusyNotice(direction);
      }
      return;
    }
    if (
      prepared.nameTaken.length > 0 &&
      !(await askUndoQuestion({
        question: { kind: "nameTaken", names: prepared.nameTaken },
        direction,
        action: prepared.action,
      }))
    ) {
      return;
    }
    if (
      prepared.changed.length > 0 &&
      !(await askUndoQuestion({
        question: { kind: "changed", items: prepared.changed },
        direction,
        action: prepared.action,
      }))
    ) {
      return;
    }
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyNotice(direction);
      return;
    }
    const card = {
      action: direction,
      targetPath: null,
      completedItemCount: 0,
      totalItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
    } as const;
    applyWriteOperationCardState({ ...card, stage: "starting" });
    runningUndoLabelRef.current = prepared.label;
    try {
      const response = await client.invoke("undo:start", { ticket: prepared.ticket });
      adoptWriteOperation(response.operationId);
      applyWriteOperationCardState({ ...card, stage: "queued" });
    } catch (error) {
      applyWriteOperationCardState(null);
      runningUndoLabelRef.current = null;
      if (isWriteOperationBusyError(error)) {
        showWriteOperationBusyNotice(direction);
        return;
      }
      showModalNotice(
        getCopyLikePreStartFailureTitle(direction),
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function startRename(
    request: Extract<DotNameRequest, { kind: "rename" }>,
    onRefused: (message: string) => void,
  ) {
    if (isWriteOperationInFlight()) {
      refuseWriteWhileBusy(request);
      return;
    }
    takeWriteOperationLock("rename", {
      targetPath: request.sourcePath,
      totalItemCount: 1,
      currentSourcePath: request.sourcePath,
    });
    try {
      const response = await client.invoke("writeOperation:rename", {
        sourcePath: request.sourcePath,
        destinationName: request.name,
      });
      adoptWriteOperation(response.operationId);
      applyWriteOperationCardState({
        action: "rename",
        stage: "queued",
        targetPath: request.sourcePath,
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: request.sourcePath,
      });
      setRenameDialogState(null);
    } catch (error) {
      applyWriteOperationCardState(null);
      if (isWriteOperationBusyError(error)) {
        refuseWriteWhileBusy(request);
        return;
      }
      onRefused(error instanceof Error ? error.message : String(error));
    }
  }

  // A free name in a folder that is not the one on screen (a folder picked in the list or in
  // the tree): the folder is read for the names it has.
  async function readFreeNewFolderName(parentPath: string): Promise<string> {
    try {
      const response = await client.invoke("directory:getSnapshot", {
        path: parentPath,
        includeHidden: true,
      });
      return resolveFreeNewFolderName(response.entries.map((entry) => entry.name));
    } catch (error) {
      logger.error("new folder name lookup failed", error);
      // The main process still refuses a name that is taken; it can be changed then.
      return resolveFreeNewFolderName([]);
    }
  }

  function buildChildPath(parentPath: string, childName: string): string {
    return parentPath === "/" ? `/${childName}` : `${parentPath}/${childName}`;
  }

  function rememberPendingTreeSelectionPath(path: string | null) {
    pendingTreeSelectionPathRef.current = path;
  }

  function resolveCompletedTreeSelectionPath(event: WriteOperationProgressEvent): string | null {
    const result = event.result;
    if (!result) {
      return null;
    }
    const explicitTreeSelectionPath = pendingTreeSelectionPathRef.current;
    if (explicitTreeSelectionPath && (event.status === "completed" || event.status === "partial")) {
      if (
        result.items.some(
          (item) =>
            item.status === "completed" && item.destinationPath === explicitTreeSelectionPath,
        )
      ) {
        return explicitTreeSelectionPath;
      }
      // A duplicate's name ("Folder copy") is only known once it is made; it was asked for
      // by the folder it goes into, and the copy is what is selected, as in Finder.
      if (event.action === "duplicate" && explicitTreeSelectionPath === result.targetPath) {
        const duplicatePath = result.items.find(
          (item) => item.status === "completed" && item.destinationPath,
        )?.destinationPath;
        if (duplicatePath) {
          return duplicatePath;
        }
      }
    }
    return resolveWriteOperationTreeSelectionPath(
      result,
      getFileSystemItemPath(selectedTreeItemIdRef.current),
    );
  }

  // The folder just made in the folder on screen is renamed in its row once it is listed
  // (and selected, see queueWriteOperationSelection). Leaving the folder forgets it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the listing changes.
  useEffect(() => {
    const path = pendingInlineRenamePathRef.current;
    if (!path) {
      return;
    }
    if (dirnameOf(path) !== currentPathRef.current) {
      pendingInlineRenamePathRef.current = null;
      return;
    }
    if (!currentEntries.some((entry) => entry.path === path)) {
      return;
    }
    pendingInlineRenamePathRef.current = null;
    openRenameDialog([path]);
  }, [currentEntries]);

  function openNewFolderDialog(
    parentDirectoryPath: string,
    options: { selectInTreeOnSuccess?: boolean } = {},
  ) {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setFocusedPane(null);
    clearTypeahead();
    closeContextMenu();
    const requestId = newFolderNameRequestRef.current + 1;
    newFolderNameRequestRef.current = requestId;
    // As in Finder: in the folder on screen, the folder is made at once with a free name
    // and its name is then edited in its row. Elsewhere (a selected folder, the tree) the
    // name is asked for first, since the new folder is not in the list.
    if (
      parentDirectoryPath === currentPathRef.current &&
      !isSearchModeRef.current &&
      !options.selectInTreeOnSuccess
    ) {
      const name = resolveFreeNewFolderName(currentEntries.map((entry) => entry.name));
      pendingInlineRenamePathRef.current = buildChildPath(parentDirectoryPath, name);
      void startCreateFolder(
        {
          kind: "newFolder",
          parentDirectoryPath,
          name,
          selectInTreeOnSuccess: false,
          // The listing may not know of a "New Folder" made elsewhere meanwhile.
          nextFreeName: true,
        },
        (message) => {
          pendingInlineRenamePathRef.current = null;
          setActionNotice({ title: "The folder couldn’t be made", message });
        },
      );
      return;
    }
    const showDialog = (initialName: string) => {
      if (newFolderNameRequestRef.current !== requestId) {
        return;
      }
      setNewFolderDialogState({
        parentDirectoryPath,
        initialName,
        error: null,
        selectInTreeOnSuccess: options.selectInTreeOnSuccess ?? false,
      });
    };
    // The name suggested is free in the folder the new one goes into. The folder on screen
    // has its items known, so its dialog opens without a wait.
    if (parentDirectoryPath === currentPathRef.current) {
      showDialog(resolveFreeNewFolderName(currentEntries.map((entry) => entry.name)));
      return;
    }
    void readFreeNewFolderName(parentDirectoryPath).then(showDialog);
  }

  async function submitNewFolderDialog(folderName: string) {
    const dialogState = newFolderDialogState;
    if (!dialogState) {
      return;
    }
    const nameError = getItemNameError(folderName);
    if (nameError) {
      setNewFolderDialogState((current) => (current ? { ...current, error: nameError } : current));
      return;
    }
    const request = {
      kind: "newFolder",
      parentDirectoryPath: dialogState.parentDirectoryPath,
      name: folderName,
      selectInTreeOnSuccess: dialogState.selectInTreeOnSuccess,
    } as const;
    if (isWriteOperationInFlight()) {
      refuseWriteWhileBusy(request);
      return;
    }
    if (needsDotNameConfirmation(folderName, null)) {
      setNewFolderDialogState(null);
      setCopyPasteDialogState({ type: "confirmDotName", request });
      return;
    }
    await startCreateFolder(request, (message) =>
      setNewFolderDialogState((current) => (current ? { ...current, error: message } : current)),
    );
  }

  async function startCreateFolder(
    request: Extract<DotNameRequest, { kind: "newFolder" }>,
    onRefused: (message: string) => void,
  ) {
    if (isWriteOperationInFlight()) {
      refuseWriteWhileBusy(request);
      return;
    }
    takeWriteOperationLock("new_folder", {
      targetPath: request.parentDirectoryPath,
      totalItemCount: 1,
      currentSourcePath: null,
    });
    try {
      const response = await client.invoke("writeOperation:createFolder", {
        parentDirectoryPath: request.parentDirectoryPath,
        folderName: request.name,
        ...(request.nextFreeName ? { nextFreeName: true } : {}),
      });
      rememberPendingTreeSelectionPath(
        request.selectInTreeOnSuccess
          ? buildChildPath(request.parentDirectoryPath, request.name)
          : null,
      );
      adoptWriteOperation(response.operationId);
      applyWriteOperationCardState({
        action: "new_folder",
        stage: "queued",
        targetPath: request.parentDirectoryPath,
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
      });
      setNewFolderDialogState(null);
    } catch (error) {
      applyWriteOperationCardState(null);
      if (isWriteOperationBusyError(error)) {
        refuseWriteWhileBusy(request);
        return;
      }
      onRefused(error instanceof Error ? error.message : String(error));
    }
  }

  // A confirmation that is still open when a write turns out to be busy is closed, so the
  // busy dialog is not stacked on it.
  function closeDeleteConfirmation() {
    setCopyPasteDialogState((current) =>
      current?.type === "confirmTrash" || current?.type === "confirmDeleteImmediately"
        ? null
        : current,
    );
  }

  async function startTrashPaths(paths: string[]) {
    await startRemovePaths(paths, "trash");
  }

  async function startDeleteImmediatelyPaths(paths: string[]) {
    await startRemovePaths(paths, "delete_immediately");
  }

  async function startRemovePaths(paths: string[], action: "trash" | "delete_immediately") {
    if (paths.length === 0) {
      return;
    }
    // What is already in the Trash isn't moved there again: Move to Trash does nothing
    // there, and Delete Immediately is in its menu.
    if (action === "trash" && paths.some((path) => isPathInsideTrash(path, homePath))) {
      closeDeleteConfirmation();
      return;
    }
    if (isWriteOperationInFlight()) {
      closeDeleteConfirmation();
      showWriteOperationBusyNotice(action);
      return;
    }
    setCopyPasteDialogState(null);
    takeWriteOperationLock(action, {
      targetPath: null,
      totalItemCount: paths.length,
      currentSourcePath: paths[0] ?? null,
    });
    try {
      const response =
        action === "trash"
          ? await client.invoke("writeOperation:trash", { paths })
          : await client.invoke("writeOperation:deleteImmediately", { paths });
      rememberPendingTreeSelectionPath(null);
      adoptWriteOperation(response.operationId);
      applyWriteOperationCardState({
        action,
        stage: "queued",
        targetPath: null,
        completedItemCount: 0,
        totalItemCount: paths.length,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: paths[0] ?? null,
      });
      closeContextMenu();
    } catch (error) {
      applyWriteOperationCardState(null);
      logger.error(action === "trash" ? "trash start failed" : "delete immediately failed", error);
      if (isWriteOperationBusyError(error)) {
        showWriteOperationBusyNotice(action);
        return;
      }
      showModalNotice(
        action === "trash" ? "Couldn’t Move to Trash" : "Couldn’t Delete",
        error instanceof Error
          ? error.message
          : action === "trash"
            ? "File Trail couldn’t move the items to the Trash."
            : "File Trail couldn’t delete the items.",
      );
    }
  }

  async function activateContentPaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    if (isSearchMode) {
      await openPaths(paths);
      return;
    }
    const entries = paths
      .map((path) => activeContentEntries.find((candidate) => candidate.path === path) ?? null)
      .filter((entry): entry is DirectoryEntry => entry !== null);
    if (
      fileActivationAction === "edit" &&
      entries.length === paths.length &&
      entries.every((entry) => isEditableFileEntry(entry))
    ) {
      await editPaths(paths);
      return;
    }
    await openPaths(paths);
  }

  return {
    actionNotice,
    applyContentSelection,
    browseDefaultTextEditor,
    browseForDirectoryPath,
    browseOpenWithApplication,
    browseTerminalApplication,
    canRunContentSelectionAction,
    clearContentSelection,
    closeConfirmationDialog,
    closeContextMenu,
    contextMenuDisabledActionIds,
    contextMenuOptions,
    contextMenuHiddenActionIds,
    openWithMenuItems,
    copyGetInfoPath,
    copyGetInfoName,
    dismissActionNotice,
    dismissCopyPasteDialog,
    dismissToast,
    noticeDragRefusedWhileBusy,
    startDuplicateOfSelection,
    requestEmptyTrash,
    confirmEmptyTrash,
    editPaths,
    executeCopyLikePlan,
    requestCopyLikePlanStart,
    surfaceCopyLikePreStartFailureNotice,
    handleContentSelectionGesture,
    selectContentPaths,
    handleCopyPasteDialogEscape,
    moveOpenWithApplication,
    openItemContextMenu,
    openTreeItemContextMenu,
    openMoveDialog,
    openNewFolderDialog,
    openPathExternally,
    openPathInTerminal,
    showPathsInFinder,
    editPathInTextEditor,
    toggleFavoritePath,
    openPaths,
    openRenameDialog,
    startBatchRename,
    removeOpenWithApplication,
    resolveContentActionPaths,
    retryFailedCopyPasteItems,
    resolveRuntimeConflict,
    runContextMenuAction,
    runContextSubmenuAction,
    runCopyClipboardAction,
    removeClipboardPath,
    clearClipboard,
    revealPathInFolder: revealSearchResultInFolder,
    runCopyPathAction,
    selectAllContentEntries,
    setSingleContentSelection,
    showCopyPasteProgressCard,
    showCopyPasteResultDialog,
    startCopyToDestination,
    startDuplicatePaths,
    startMoveToDestination,
    startPasteFromClipboard,
    startTrashPaths,
    startDeleteImmediatelyPaths,
    startUndo,
    answerUndoQuestion,
    submitMoveDialog,
    submitNewFolderDialog,
    submitRenameDialog,
    syncContentSelectionRefs,
    toggleContentSelection,
    extendContentSelectionToPath,
    updateCopyPasteChoices,
    activateContentEntry,
    activateContentPaths,
    openFolderInNewTab,
    addOpenWithApplication,
    cancelWriteOperation,
    confirmDotNameDialog,
  };
}
