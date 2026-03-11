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

import type { IpcRequest, IpcResponse, WriteOperationProgressEvent } from "@filetrail/contracts";

import type {
  ApplicationSelection,
  FavoritePreference,
  FileActivationAction,
  OpenWithApplication,
} from "../../shared/appPreferences";
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
  type ContextMenuSourceSubview,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuItem,
  getContextMenuItems,
} from "../lib/contextMenu";
import {
  type CopyPasteClipboardState,
  buildPasteRequest,
  clearCopyPasteClipboard,
  hasClipboardItems,
  setCopyPasteClipboard,
} from "../lib/copyPasteClipboard";
import {
  createOpenItemLimitMessage,
  formatPathForShell,
  getPathLeafName,
  isDirectoryLikeEntry,
  isEditableFileEntry,
  resolveNewFolderTargetPath,
  resolveWriteOperationRefreshPath,
  resolveWriteOperationSelectionDirectoryPath,
  resolveWriteOperationTreeReloadPaths,
  resolveWriteOperationTreeSelectionPath,
  isExpectedPlannedSkipResult,
  shouldRenderCopyPasteResultDialog,
} from "../lib/explorerAppUtils";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import type { DirectoryEntry } from "../lib/explorerTypes";
import { createFavorite, getFileSystemItemPath, isFavoritePath } from "../lib/favorites";
import type { useFiletrailClient } from "../lib/filetrailClient";
import type { InternalMoveSourceSurface } from "../lib/internalDragAndDrop";
import { createRendererLogger } from "../lib/logging";
import { expandHomeShortcut } from "../lib/pathUtils";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "../lib/toasts";
import type {
  ContextMenuState,
  CopyPasteDialogState,
  WriteOperationCardState,
} from "./useWriteOperations";

const logger = createRendererLogger("filetrail.renderer");

const WRITE_OPERATION_BUSY_ERROR = "Another write operation is already running.";
const ANALYSIS_POLL_INTERVAL_MS = 120;
const DEFAULT_COPY_PASTE_POLICY: Extract<
  IpcRequest<"copyPaste:start">,
  { analysisId: string }
>["policy"] = {
  file: "skip",
  directory: "skip",
  mismatch: "skip",
};
const CONTEXT_MENU_WIDTH = 240;
const CONTEXT_SUBMENU_WIDTH = 180;
const CONTEXT_MENU_SAFE_MARGIN = 12;
const CONTEXT_MENU_MAX_HEIGHT = 420;
const WRITE_LOCKED_CONTEXT_ACTION_IDS: ContextMenuActionId[] = [
  "cut",
  "copy",
  "paste",
  "move",
  "rename",
  "duplicate",
  "newFolder",
  "copyPath",
  "trash",
];

function createOpenWithApplicationId(): string {
  return `open-with-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

type CopyPasteAnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
type CopyPastePolicy = Extract<IpcRequest<"copyPaste:start">, { analysisId: string }>["policy"];
type CopyLikeAction = "paste" | "move_to" | "duplicate";
type CopyLikePreStartOutcome =
  | { status: "queued" }
  | { status: "review" }
  | { status: "blocked"; message: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };

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
  return "paste";
}

function getCopyLikePreStartFailureTitle(action: CopyLikeAction): string {
  if (action === "move_to") {
    return "Move couldn't start";
  }
  if (action === "duplicate") {
    return "Duplicate couldn't start";
  }
  return "Paste couldn't start";
}

function getCopyLikePreparationFailureMessage(action: CopyLikeAction): string {
  return `File Trail couldn't prepare the ${getCopyLikeActionLabel(action)} operation. No files were written.`;
}

function getCopyLikeStartFailureMessage(action: CopyLikeAction): string {
  return `File Trail couldn't start the ${getCopyLikeActionLabel(action)} operation. No files were written.`;
}

function getCopyLikeBusyOutcome(): Extract<CopyLikePreStartOutcome, { status: "blocked" }> {
  return {
    status: "blocked",
    message: "Wait for the current write to finish.",
  };
}

function getCopyLikeIssueMessage(report: CopyPasteAnalysisReport): string {
  const issue = report.issues[0];
  if (!issue) {
    return "The operation couldn't continue.";
  }
  switch (issue.code) {
    case "destination_missing":
      return "Destination folder does not exist.";
    case "destination_not_directory":
      return "Destination must be an existing folder.";
    case "source_missing":
      return "A source item no longer exists.";
    case "same_path":
      return "Source and destination cannot be the same.";
    case "parent_into_child":
      return "You can't place a folder into its own descendant.";
    default:
      return issue.message;
  }
}

export function useExplorerActions(args: {
  client: ReturnType<typeof useFiletrailClient>;
  mainView: "explorer" | "help" | "settings" | "action-log";
  focusedPane: "tree" | "content" | null;
  setFocusedPane: (value: "tree" | "content" | null) => void;
  setInfoPanelOpen: Dispatch<SetStateAction<boolean>>;
  setInfoTargetPathOverride: Dispatch<SetStateAction<string | null>>;
  setGetInfoItem: Dispatch<SetStateAction<IpcResponse<"item:getProperties">["item"] | null>>;
  setGetInfoLoading: Dispatch<SetStateAction<boolean>>;
  getInfoRequestRef: MutableRefObject<number>;
  homePath: string;
  currentPath: string;
  currentEntries: DirectoryEntry[];
  activeContentEntries: DirectoryEntry[];
  favorites: FavoritePreference[];
  setFavorites: Dispatch<SetStateAction<FavoritePreference[]>>;
  selectedEntry: DirectoryEntry | null;
  selectedPathsInViewOrder: string[];
  selectedPathSet: Set<string>;
  contextMenuTargetEntries: DirectoryEntry[];
  contextMenuTargetEntry: DirectoryEntry | null;
  pasteDestinationPath: string | null;
  isSearchMode: boolean;
  openItemLimit: number;
  notificationsEnabled: boolean;
  notificationDurationSeconds: number;
  fileActivationAction: FileActivationAction;
  defaultTextEditor: ApplicationSelection;
  setDefaultTextEditor: Dispatch<SetStateAction<ApplicationSelection>>;
  setTerminalApp: Dispatch<SetStateAction<ApplicationSelection | null>>;
  openWithApplications: OpenWithApplication[];
  setOpenWithApplications: Dispatch<SetStateAction<OpenWithApplication[]>>;
  contentPaneRef: RefObject<HTMLElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  setSearchPopoverOpen: Dispatch<SetStateAction<boolean>>;
  clearTypeahead: () => void;
  focusContentPane: () => void;
  restoreExplorerPaneFocus: (preferredPane?: "tree" | "content" | null) => void;
  navigateTo: (path: string, historyMode: "push" | "replace" | "skip") => Promise<boolean>;
  navigateTreeFileSystemPath: (
    path: string,
    historyMode: "push" | "replace" | "skip",
  ) => Promise<void>;
  navigateFavoritePath: (
    path: string,
    historyMode: "push" | "replace" | "skip",
  ) => Promise<boolean>;
  toggleTreeNode: (path: string) => void;
  refreshDirectory: (options?: {
    path?: string;
    treeSelectionPath?: string | null;
    extraTreeReloadPaths?: string[];
  }) => Promise<void>;
  restartActiveSearch?: (() => Promise<void>) | null;
  contentSelection: ContentSelectionState;
  setContentSelection: Dispatch<SetStateAction<ContentSelectionState>>;
  currentPathRef: MutableRefObject<string>;
  selectedTreeItemIdRef: MutableRefObject<string | null>;
  isSearchModeRef: MutableRefObject<boolean>;
  selectedPathsInViewOrderRef: MutableRefObject<string[]>;
  selectedEntryRef: MutableRefObject<DirectoryEntry | null>;
  lastExplorerFocusPaneRef: MutableRefObject<"tree" | "content" | null>;
  browseSelectionRef: MutableRefObject<ContentSelectionState>;
  cachedSearchSelectionRef: MutableRefObject<ContentSelectionState>;
  contextMenuState: ContextMenuState | null;
  setContextMenuState: Dispatch<SetStateAction<ContextMenuState | null>>;
  actionNotice: { title: string; message: string } | null;
  setActionNotice: Dispatch<SetStateAction<{ title: string; message: string } | null>>;
  toasts: ToastEntry[];
  setToasts: Dispatch<SetStateAction<ToastEntry[]>>;
  copyPasteClipboard: CopyPasteClipboardState;
  setCopyPasteClipboardState: Dispatch<SetStateAction<CopyPasteClipboardState>>;
  copyPasteDialogState: CopyPasteDialogState;
  setCopyPasteDialogState: Dispatch<SetStateAction<CopyPasteDialogState>>;
  writeOperationCardState: WriteOperationCardState | null;
  setWriteOperationCardState: Dispatch<SetStateAction<WriteOperationCardState | null>>;
  writeOperationProgressEvent: WriteOperationProgressEvent | null;
  setWriteOperationProgressEvent: Dispatch<SetStateAction<WriteOperationProgressEvent | null>>;
  renameDialogState: {
    sourcePath: string;
    currentName: string;
    error: string | null;
  } | null;
  setRenameDialogState: Dispatch<
    SetStateAction<{
      sourcePath: string;
      currentName: string;
      error: string | null;
    } | null>
  >;
  newFolderDialogState: {
    parentDirectoryPath: string;
    initialName: string;
    error: string | null;
    selectInTreeOnSuccess: boolean;
  } | null;
  setNewFolderDialogState: Dispatch<
    SetStateAction<{
      parentDirectoryPath: string;
      initialName: string;
      error: string | null;
      selectInTreeOnSuccess: boolean;
    } | null>
  >;
  moveDialogState: {
    sourcePaths: string[];
    currentPath: string;
    submitting: boolean;
    error: string | null;
  } | null;
  setMoveDialogState: Dispatch<
    SetStateAction<{
      sourcePaths: string[];
      currentPath: string;
      submitting: boolean;
      error: string | null;
    } | null>
  >;
  actionNoticeReturnFocusPaneRef: MutableRefObject<"tree" | "content" | null>;
  activeWriteOperationIdRef: MutableRefObject<string | null>;
  nextPasteAttemptIdRef: MutableRefObject<number>;
  pendingPasteAttemptRef: MutableRefObject<{
    id: number;
    phase: "planning" | "starting";
    cancelled: boolean;
  } | null>;
  nextToastIdRef: MutableRefObject<number>;
  copyPasteClipboardRef: MutableRefObject<CopyPasteClipboardState>;
  writeOperationLockedRef: MutableRefObject<boolean>;
  pendingPasteSelectionRef: MutableRefObject<{
    directoryPath: string;
    selectedPaths: string[];
  } | null>;
  pendingTreeSelectionPathRef: MutableRefObject<string | null>;
}) {
  const {
    client,
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
    activeContentEntries,
    favorites,
    setFavorites,
    selectedEntry,
    selectedPathsInViewOrder,
    selectedPathSet,
    contextMenuTargetEntries,
    contextMenuTargetEntry,
    pasteDestinationPath,
    isSearchMode,
    openItemLimit,
    notificationsEnabled,
    notificationDurationSeconds,
    fileActivationAction,
    defaultTextEditor,
    setDefaultTextEditor,
    setTerminalApp,
    openWithApplications,
    setOpenWithApplications,
    contentPaneRef,
    searchInputRef,
    setSearchPopoverOpen,
    clearTypeahead,
    focusContentPane,
    restoreExplorerPaneFocus,
    navigateTo,
    navigateTreeFileSystemPath,
    navigateFavoritePath,
    toggleTreeNode,
    refreshDirectory,
    restartActiveSearch,
    contentSelection,
    setContentSelection,
    currentPathRef,
    selectedTreeItemIdRef,
    isSearchModeRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
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
  } = args;
  const activeAnalysisIdRef = useRef<string | null>(null);
  const moveOperationSourceSurfaceRef = useRef(new Map<string, InternalMoveSourceSurface>());
  const restartActiveSearchRef = useRef(restartActiveSearch ?? null);

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
    if (contextMenuState.surface === "favorite") {
      return "Remove from Favorites";
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
  }, [contextMenuState, contextMenuTargetEntries, favorites, isSearchMode]);

  const contextMenuHiddenActionIds = useMemo(() => {
    if (!contextMenuState) {
      return [] as ContextMenuActionId[];
    }
    const hidden = new Set<ContextMenuActionId>();
    if (contextMenuFavoriteToggleLabel === null) {
      hidden.add("toggleFavorite");
    }
    if (contextMenuState.surface === "favorite") {
      return Array.from(hidden);
    }
    if (contextMenuState.surface === "treeFolder") {
      return Array.from(hidden);
    }
    if (contextMenuState.surface === "search") {
      hidden.add("toggleFavorite");
    }
    return Array.from(hidden);
  }, [contextMenuFavoriteToggleLabel, contextMenuState]);

  const contextMenuDisabledActionIds = useMemo(() => {
    if (!contextMenuState) {
      return [] as ContextMenuActionId[];
    }
    const disabled = new Set<ContextMenuActionId>();
    const isContentContext = contextMenuState.surface === "content" && !isSearchMode;
    const isTreeFolderContext = contextMenuState.surface === "treeFolder";
    const isFavoriteContext = contextMenuState.surface === "favorite";
    const hasOnlyEditableFiles =
      contextMenuTargetEntries.length > 0 &&
      contextMenuTargetEntries.length === contextMenuState.paths.length &&
      contextMenuTargetEntries.every((entry) => isEditableFileEntry(entry));
    const hasSingleContextItem = contextMenuState.paths.length === 1;
    const hasSingleSelectedFolder =
      contextMenuState.paths.length === 1 &&
      isDirectoryLikeEntry(contextMenuTargetEntries[0] ?? null);
    if (!canPasteAtResolvedDestination) {
      disabled.add("paste");
    }
    if (isWriteOperationLocked) {
      for (const actionId of WRITE_LOCKED_CONTEXT_ACTION_IDS) {
        disabled.add(actionId);
      }
    }
    if (isTreeFolderContext) {
      disabled.add("openWith");
      disabled.add("edit");
      if (!contextMenuState.targetPath) {
        disabled.add("open");
        disabled.add("showInfo");
        disabled.add("toggleFavorite");
        disabled.add("terminal");
        disabled.add("copyPath");
        disabled.add("copy");
        disabled.add("cut");
        disabled.add("move");
        disabled.add("rename");
        disabled.add("duplicate");
        disabled.add("newFolder");
        disabled.add("trash");
      }
      return Array.from(disabled);
    }
    if (isFavoriteContext) {
      disabled.add("openWith");
      disabled.add("edit");
      disabled.add("copy");
      disabled.add("cut");
      disabled.add("move");
      disabled.add("rename");
      disabled.add("duplicate");
      disabled.add("trash");
      if (!contextMenuState.targetPath) {
        disabled.add("open");
        disabled.add("revealInTree");
        disabled.add("showInfo");
        disabled.add("toggleFavorite");
        disabled.add("terminal");
        disabled.add("copyPath");
        disabled.add("newFolder");
      }
      return Array.from(disabled);
    }
    if (!hasOnlyEditableFiles) {
      disabled.add("edit");
    }
    if (!isContentContext) {
      disabled.add("move");
      disabled.add("rename");
      disabled.add("duplicate");
      disabled.add("newFolder");
      disabled.add("trash");
    } else {
      if (contextMenuState.scope === "background") {
        disabled.add("move");
        disabled.add("rename");
        disabled.add("duplicate");
        disabled.add("trash");
      }
      if (!hasSingleContextItem) {
        disabled.add("rename");
      }
      if (contextMenuState.scope === "selection" && contextMenuState.paths.length === 0) {
        disabled.add("move");
        disabled.add("duplicate");
        disabled.add("trash");
      }
      const canCreateNewFolder =
        contextMenuState.scope === "background" ||
        (contextMenuState.paths.length === 1 && hasSingleSelectedFolder);
      if (!canCreateNewFolder) {
        disabled.add("newFolder");
      }
    }
    if (contextMenuTargetEntries.length > 0) {
      return Array.from(disabled);
    }
    const items = getContextMenuItems({
      surface: contextMenuState.surface,
      favoriteToggleLabel: contextMenuFavoriteToggleLabel,
    });
    for (const item of items) {
      if (item.type === "separator" || item.id === "newFolder") {
        continue;
      }
      if (item.id !== "paste") {
        disabled.add(item.id);
      }
    }
    return Array.from(disabled);
  }, [
    canPasteAtResolvedDestination,
    contextMenuFavoriteToggleLabel,
    contextMenuState,
    contextMenuTargetEntries,
    isSearchMode,
    isWriteOperationLocked,
  ]);

  const contextMenuSubmenuItems = useMemo(() => {
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
    items.push(
      {
        action: {
          kind: "finder",
          id: "finder",
          label: "Finder",
          appPath: "Finder",
          appName: "Finder",
        },
      },
      {
        action: {
          kind: "other",
          id: "other",
          label: "Other…",
          appName: "Other…",
        },
      },
    );
    return items;
  }, [openWithApplications]);

  useEffect(() => {
    setContentSelection((current) => {
      const nextSelection = sanitizeContentSelection(current, activeContentEntries);
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
    });
  }, [activeContentEntries, setContentSelection]);

  useEffect(() => {
    if (isSearchMode) {
      cachedSearchSelectionRef.current = contentSelection;
      return;
    }
    browseSelectionRef.current = contentSelection;
  }, [browseSelectionRef, cachedSearchSelectionRef, contentSelection, isSearchMode]);

  useLayoutEffect(() => {
    selectedPathsInViewOrderRef.current = selectedPathsInViewOrder;
  }, [selectedPathsInViewOrder, selectedPathsInViewOrderRef]);

  useLayoutEffect(() => {
    selectedEntryRef.current = selectedEntry;
  }, [selectedEntry, selectedEntryRef]);

  useLayoutEffect(() => {
    copyPasteClipboardRef.current = copyPasteClipboard;
  }, [copyPasteClipboard, copyPasteClipboardRef]);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: write-operation progress should stay subscribed to stable refs without resubscribing on every ref.current mutation.
  useEffect(() => {
    const unsubscribe = client.onWriteOperationProgress((event) => {
      if (event.operationId !== activeWriteOperationIdRef.current) {
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
            writeOperationCardState?.targetPath ??
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
        activeWriteOperationIdRef.current = null;
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        if (event.result) {
          queueWriteOperationSelection(event.result);
        }
        if (shouldRenderCopyPasteResultDialog(event)) {
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
        if (
          sourceSurface === "search" &&
          event.action === "move_to" &&
          event.result &&
          event.result.summary.completedItemCount > 0
        ) {
          void restartActiveSearchRef.current?.();
        }
      }
    });
    return unsubscribe;
  }, [
    client,
    refreshDirectory,
    setWriteOperationProgressEvent,
    writeOperationCardState?.targetPath,
  ]);

  function closeContextMenu() {
    setContextMenuState(null);
  }

  function resolveContextMenuPosition(x: number, y: number) {
    const maxX =
      window.innerWidth - (CONTEXT_MENU_WIDTH + CONTEXT_SUBMENU_WIDTH + CONTEXT_MENU_SAFE_MARGIN);
    const maxY = window.innerHeight - (CONTEXT_MENU_MAX_HEIGHT + CONTEXT_MENU_SAFE_MARGIN);
    return {
      x: Math.max(CONTEXT_MENU_SAFE_MARGIN, Math.min(x, maxX)),
      y: Math.max(CONTEXT_MENU_SAFE_MARGIN, Math.min(y, maxY)),
    };
  }

  function syncContentSelectionRefs(
    selection: ContentSelectionState,
    entries: DirectoryEntry[] = activeContentEntries,
  ) {
    const selectedPaths = entries
      .filter((entry) => selection.paths.includes(entry.path))
      .map((entry) => entry.path);
    selectedPathsInViewOrderRef.current = selectedPaths;
    selectedEntryRef.current =
      entries.find((entry) => entry.path === selection.leadPath) ??
      entries.find((entry) => selectedPaths.includes(entry.path)) ??
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

  function selectAllContentEntries() {
    applyContentSelection(selectAllSelectionStateEntries(activeContentEntries));
  }

  function openItemContextMenu(
    path: string | null,
    position: { x: number; y: number },
    surface: "content" | "search" = "content",
  ) {
    const resolvedPosition = resolveContextMenuPosition(position.x, position.y);
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
    setContextMenuState({
      ...resolvedPosition,
      paths: contextPaths,
      targetPath: path,
      surface,
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
    const resolvedPosition = resolveContextMenuPosition(input.position.x, input.position.y);
    setFocusedPane("tree");
    setContextMenuState({
      ...resolvedPosition,
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

  function showNotImplementedNotice(title: string) {
    showModalNotice(title, `${title} is not implemented yet.`);
  }

  function showOpenItemLimitNotice(action: "Open" | "Edit", selectedCount: number) {
    showModalNotice(action, createOpenItemLimitMessage(action, selectedCount, openItemLimit));
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
    writeOperationLockedRef.current = nextState !== null;
    setWriteOperationCardState(nextState);
  }

  function pushToast(input: { kind: ToastKind; title: string; message?: string }) {
    if (!notificationsEnabled) {
      return;
    }
    const id = `toast-${nextToastIdRef.current}`;
    nextToastIdRef.current += 1;
    setToasts((current) =>
      enqueueToast(
        current,
        createToastEntry(id, {
          ...input,
          durationMs: notificationDurationSeconds * 1000,
        }),
      ),
    );
  }

  function surfaceCopyLikePreStartFailureToast(
    action: CopyLikeAction,
    outcome: Extract<CopyLikePreStartOutcome, { status: "blocked" | "error" }>,
  ) {
    pushToast({
      kind: outcome.status === "error" ? "error" : "warning",
      title: getCopyLikePreStartFailureTitle(action),
      message: outcome.message,
    });
  }

  function applyCopyPasteClipboardState(nextClipboard: CopyPasteClipboardState) {
    copyPasteClipboardRef.current = nextClipboard;
    setCopyPasteClipboardState(nextClipboard);
  }

  function isWriteOperationInFlight(): boolean {
    return writeOperationLockedRef.current;
  }

  function showWriteOperationBusyToast() {
    pushToast({
      kind: "warning",
      title: "Wait for the current write to finish",
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
    const parts: string[] = [];
    if (result.summary.completedItemCount > 0) {
      parts.push(formatResultCountLabel(result.summary.completedItemCount, "item"));
      parts[parts.length - 1] = `${parts.at(-1)} moved`;
    }
    if (result.summary.skippedItemCount > 0) {
      parts.push(`${formatResultCountLabel(result.summary.skippedItemCount, "item")} skipped`);
    }
    if (parts.length > 0) {
      return `${parts.join(", ")} by the selected conflict handling.`;
    }
    return null;
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
    return formatItemSummaryFromPathCount(representativePath, itemCount);
  }

  function pushTerminalCopyPasteToast(event: WriteOperationProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    const itemSummary = formatWriteOperationItemSummary(event);
    const completedTitle =
      event.action === "move_to"
        ? result.targetPath
          ? `Moved to ${getPathLeafName(result.targetPath)}`
          : "Moved"
        : event.action === "duplicate"
          ? result.targetPath
            ? `Duplicated into ${getPathLeafName(result.targetPath)}`
            : "Duplicated"
          : event.action === "trash"
            ? "Moved to Trash"
            : event.action === "rename"
              ? "Renamed"
              : event.action === "new_folder"
                ? "Created folder"
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
            : event.action === "duplicate"
              ? "Duplicate cancelled"
              : event.action === "trash"
                ? "Trash cancelled"
                : event.action === "rename"
                  ? "Rename cancelled"
                  : event.action === "new_folder"
                    ? "Create folder cancelled"
                    : "Paste cancelled",
        ...(itemSummary ? { message: itemSummary } : {}),
      });
      return;
    }
    if (event.status === "partial") {
      if (isExpectedPlannedSkipResult(event)) {
        const plannedSkipMessage = formatPlannedSkipToastMessage(event);
        pushToast({
          kind: "info",
          title: getPlannedSkipToastTitle(event.action, result.summary.completedItemCount),
          ...(plannedSkipMessage ? { message: plannedSkipMessage } : {}),
        });
        return;
      }
      pushToast({
        kind: "warning",
        title:
          event.action === "move_to"
            ? "Move completed with some issues"
            : event.action === "duplicate"
              ? "Duplicate completed with some issues"
              : event.action === "trash"
                ? "Trash completed with some issues"
                : "Paste completed with some issues",
        ...(itemSummary ? { message: itemSummary } : {}),
      });
      return;
    }
    if (event.status === "failed") {
      const failureMessage =
        itemSummary && result.error
          ? `${itemSummary}: ${result.error}`
          : (itemSummary ?? result.error ?? null);
      pushToast({
        kind: "error",
        title:
          event.action === "move_to"
            ? "Move failed"
            : event.action === "duplicate"
              ? "Duplicate failed"
              : event.action === "trash"
                ? "Trash failed"
                : event.action === "rename"
                  ? "Rename failed"
                  : event.action === "new_folder"
                    ? "Create folder failed"
                    : "Paste failed",
        ...(failureMessage ? { message: failureMessage } : {}),
      });
    }
  }

  function beginPendingPasteAttempt(options: {
    action: "paste" | "move_to" | "duplicate";
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
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
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
        "Unable to copy the selected path(s)",
        "File Trail could not copy the selected path text to the clipboard.",
      );
    }
  }

  function resolveClipboardSourcePaths(): string[] {
    if (contextMenuState && contextMenuState.paths.length > 0) {
      return contextMenuState.paths;
    }
    if (selectedPathsInViewOrderRef.current.length > 0) {
      return selectedPathsInViewOrderRef.current;
    }
    return [];
  }

  async function runCopyClipboardAction(mode: "copy" | "cut", explicitPaths?: string[]) {
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
    const paths =
      explicitPaths && explicitPaths.length > 0 ? explicitPaths : resolveClipboardSourcePaths();
    if (paths.length === 0) {
      pushToast({
        kind: "warning",
        title: `Select at least one item to ${mode}.`,
      });
      return;
    }
    applyCopyPasteClipboardState(setCopyPasteClipboard(mode, paths, new Date().toISOString()));
    pushToast({
      kind: "info",
      title: mode === "copy" ? "Ready to paste" : "Ready to move",
      message: formatClipboardItemSummary(paths),
    });
    closeContextMenu();
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
      initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
    } = {},
  ): Promise<CopyLikePreStartOutcome> {
    const pasteAttemptId = options.pasteAttemptId ?? null;
    const clearClipboardOnStart = options.clearClipboardOnStart ?? false;
    const sourceSurface = options.sourceSurface ?? null;
    const initiator = options.initiator ?? null;
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
      const response = await client.invoke("copyPaste:start", {
        analysisId: report.analysisId,
        action,
        policy,
        initiator,
      });
      if (action === "move_to" && sourceSurface) {
        moveOperationSourceSurfaceRef.current.set(response.operationId, sourceSurface);
      }
      if (clearClipboardOnStart) {
        applyCopyPasteClipboardState(clearCopyPasteClipboard());
      }
      const pendingAttempt = pasteAttemptId === null ? null : pendingPasteAttemptRef.current;
      if (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        rememberPendingTreeSelectionPath(null);
        activeWriteOperationIdRef.current = response.operationId;
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
      activeWriteOperationIdRef.current = response.operationId;
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
      if (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        return { status: "cancelled" };
      }
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("copy paste start failed", error);
      if (error instanceof Error && error.message.includes(WRITE_OPERATION_BUSY_ERROR)) {
        return {
          status: "blocked",
          message: "Wait for the current write to finish.",
        };
      }
      return {
        status: "error",
        message: getCopyLikeStartFailureMessage(action),
      };
    }
  }

  function requestCopyLikePlanStart(
    report: CopyPasteAnalysisReport,
    policy: CopyPastePolicy,
    action: CopyLikeAction,
    options: {
      clearClipboardOnStart: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
      initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
    },
  ) {
    void executeCopyLikePlan(report, policy, action, options).then((outcome) => {
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureToast(action, outcome);
      }
    });
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
        initiator: args.initiator ?? null,
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
            action: args.action,
            clearClipboardOnStart: args.clearClipboardOnStart,
            sourceSurface: args.sourceSurface ?? null,
            pendingTreeSelectionPath: args.pendingTreeSelectionPath ?? null,
            initiator: args.initiator ?? null,
          });
          return { status: "review" };
        }
        return await executeCopyLikePlan(update.report, defaultPolicy, args.action, {
          pasteAttemptId: args.pasteAttemptId,
          clearClipboardOnStart: args.clearClipboardOnStart,
          sourceSurface: args.sourceSurface ?? null,
          pendingTreeSelectionPath: args.pendingTreeSelectionPath ?? null,
          initiator: args.initiator ?? null,
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
        message: getCopyLikePreparationFailureMessage(args.action),
      };
    }
  }

  async function startPasteFromClipboard() {
    if (pasteDestinationPath === null) {
      pushToast({
        kind: "warning",
        title: "Select a destination folder to paste into",
      });
      return;
    }
    const request = buildPasteRequest(copyPasteClipboardRef.current, pasteDestinationPath, "error");
    if (!request) {
      pushToast({
        kind: "warning",
        title: "Clipboard is empty",
      });
      return;
    }
    if (isWriteOperationInFlight()) {
      surfaceCopyLikePreStartFailureToast(
        request.mode === "cut" ? "move_to" : "paste",
        getCopyLikeBusyOutcome(),
      );
      return;
    }
    if (request.mode === "cut") {
      const outcome = await startMoveToDestination(request.sourcePaths, request.destinationDirectoryPath, {
        clearClipboardOnStart: true,
        initiator: "clipboard",
      });
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureToast("move_to", outcome);
      }
      return;
    }
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "paste",
      targetPath: request.destinationDirectoryPath,
      totalItemCount: request.sourcePaths.length,
      totalBytes: null,
      currentSourcePath: request.sourcePaths[0] ?? null,
    });
    const outcome = await analyzeCopyLikeRequest({
      mode: request.mode,
      sourcePaths: request.sourcePaths,
      destinationDirectoryPath: request.destinationDirectoryPath,
      action: "paste",
      pasteAttemptId,
      clearClipboardOnStart: true,
      initiator: "clipboard",
    });
    if (outcome.status === "blocked" || outcome.status === "error") {
      surfaceCopyLikePreStartFailureToast("paste", outcome);
    }
  }

  async function cancelWriteOperation() {
    const operationId = activeWriteOperationIdRef.current;
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
        "Unable to cancel write operation",
        "File Trail could not stop the active write operation. Wait for it to finish, then verify the results.",
      );
    }
  }

  async function retryFailedCopyPasteItems(event: WriteOperationProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    if (event.action !== "paste" && event.action !== "move_to" && event.action !== "duplicate") {
      dismissCopyPasteDialog();
      return;
    }
    const failedSourcePaths = result.items
      .filter(
        (item): item is typeof item & { sourcePath: string } =>
          item.status === "failed" && typeof item.sourcePath === "string",
      )
      .map((item) => item.sourcePath);
    if (failedSourcePaths.length === 0) {
      dismissCopyPasteDialog();
      return;
    }
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
      clearClipboardOnStart: false,
    });
    if (outcome.status === "blocked" || outcome.status === "error") {
      surfaceCopyLikePreStartFailureToast(event.action, outcome);
    }
  }

  function dismissCopyPasteDialog() {
    setCopyPasteDialogState(null);
    setWriteOperationProgressEvent(null);
    activeWriteOperationIdRef.current = null;
    activeAnalysisIdRef.current = null;
  }

  function updateCopyPastePolicy(policy: CopyPastePolicy) {
    setCopyPasteDialogState((current) =>
      current && current.type === "review" ? { ...current, policy } : current,
    );
  }

  async function resolveRuntimeConflict(
    conflictId: string,
    resolution: "overwrite" | "skip" | "keep_both" | "merge",
  ) {
    const operationId = activeWriteOperationIdRef.current;
    if (!operationId) {
      return;
    }
    await client.invoke("copyPaste:resolveConflict", {
      operationId,
      conflictId,
      resolution,
    });
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
    if (copyPasteDialogState) {
      setCopyPasteDialogState(null);
    }
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
      currentPathRef.current !== selectionDirectoryPath
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
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return false;
    }
    try {
      await client.invoke("system:copyText", { text: path });
      return true;
    } catch (error) {
      logger.error("Info Panel copy path failed", error);
      setActionNotice({
        title: "Copy Path",
        message: "Unable to copy this path to the clipboard.",
      });
      return false;
    }
  }

  async function openPathInTerminal(path: string) {
    try {
      const response = await client.invoke("system:openInTerminal", {
        path,
      });
      if (!response.ok) {
        throw new Error(response.error ?? "Unable to open Terminal for the selected path.");
      }
    } catch (error) {
      logger.error("open in Terminal failed", error);
      setActionNotice({
        title: "Terminal",
        message: "Unable to open Terminal for this location.",
      });
    }
  }

  async function pickApplicationForOpenWith(
    title: string,
    failureMessage: string,
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
        message: failureMessage,
      });
      return null;
    }
  }

  async function openPathsWithApplication(
    paths: string[],
    applicationPath: string,
    applicationName: string,
  ) {
    try {
      const response = await client.invoke("system:openPathsWithApplication", {
        applicationPath,
        paths,
      });
      if (!response.ok) {
        throw new Error(response.error ?? `Unable to open with ${applicationName}.`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error("open with application failed", error);
      setActionNotice({
        title: `Open With ${applicationName}`,
        message: `Unable to open the selected ${paths.length === 1 ? "item" : "items"} with ${applicationName}. ${detail}`,
      });
    }
  }

  async function addOpenWithApplication() {
    const selection = await pickApplicationForOpenWith(
      "Open With Applications",
      "Unable to choose an application.",
    );
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
    const selection = await pickApplicationForOpenWith(
      "Default Text Editor",
      "Unable to choose a default text editor.",
    );
    if (!selection) {
      return;
    }
    setDefaultTextEditor(selection);
  }

  async function browseTerminalApplication() {
    const selection = await pickApplicationForOpenWith(
      "Terminal App",
      "Unable to choose a terminal application.",
    );
    if (!selection) {
      return;
    }
    setTerminalApp(selection);
  }

  async function browseOpenWithApplication(entryId: string) {
    const selection = await pickApplicationForOpenWith(
      "Open With Applications",
      "Unable to choose an application.",
    );
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

  async function openTreeContextTarget(path: string, surface: ContextMenuState["surface"] | null) {
    if (surface === "favorite") {
      await navigateFavoritePath(path, "push");
      return;
    }
    await navigateTreeFileSystemPath(path, "push");
  }

  async function revealFavoriteInTree(path: string) {
    await navigateTreeFileSystemPath(path, currentPathRef.current === path ? "replace" : "push");
  }

  function toggleFavoritePath(path: string, options?: { revealInTreeOnRemove?: boolean }) {
    const shouldRemove = isFavoritePath(favorites, path);
    setFavorites((current) =>
      shouldRemove
        ? current.filter((favorite) => favorite.path !== path)
        : [...current, createFavorite(path, homePath)],
    );
    if (shouldRemove && options?.revealInTreeOnRemove) {
      void revealFavoriteInTree(path);
    }
  }

  async function runContextMenuAction(actionId: ContextMenuActionId, paths: string[]) {
    const contextMenuSurface = contextMenuState?.surface ?? null;
    const contextMenuTargetPath = contextMenuState?.targetPath ?? null;
    const contextMenuScope = contextMenuState?.scope ?? "selection";
    closeContextMenu();
    if (WRITE_LOCKED_CONTEXT_ACTION_IDS.includes(actionId) && isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
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
      const firstPath = paths[0];
      if (!firstPath) {
        return;
      }
      if (contextMenuSurface === "treeFolder" || contextMenuSurface === "favorite") {
        await openTreeContextTarget(firstPath, contextMenuSurface);
        return;
      }
      await openPaths(paths);
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
    if (actionId === "move") {
      openMoveDialog(paths);
      return;
    }
    if (actionId === "rename") {
      openRenameDialog(paths);
      return;
    }
    if (actionId === "duplicate") {
      const targetPath = paths[0];
      const destinationDirectoryPath =
        contextMenuSurface === "treeFolder" && targetPath
          ? (parentDirectoryPath(targetPath) ?? currentPathRef.current)
          : currentPathRef.current;
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
    if (actionId === "terminal") {
      const firstPath = paths[0];
      if (firstPath) {
        await openPathInTerminal(firstPath);
      }
      return;
    }
    logger.error("unhandled context menu action", { actionId, paths, surface: contextMenuSurface });
    showModalNotice("Unsupported action", `File Trail could not run the "${actionId}" action.`);
  }

  async function runContextSubmenuAction(action: ContextMenuSubmenuAction, paths: string[]) {
    closeContextMenu();
    if (paths.length === 0) {
      return;
    }
    if (action.kind === "other") {
      const selection = await pickApplicationForOpenWith(
        "Open With Other…",
        "Unable to choose an application.",
      );
      if (!selection) {
        return;
      }
      await openPathsWithApplication(paths, selection.appPath, selection.appName);
      return;
    }
    if (action.kind === "finder") {
      await openPathsWithApplication(paths, action.appPath, action.appName);
      return;
    }
    await openPathsWithApplication(paths, action.appPath, action.appName);
  }

  async function openEntry(entry: DirectoryEntry) {
    if (entry.kind === "directory") {
      await navigateTo(entry.path, "push");
      return;
    }
    if (entry.kind === "symlink_directory") {
      const targetPath = await resolveTargetPath(entry.path);
      if (targetPath) {
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
    try {
      const response = await client.invoke("system:openPath", { path });
      if (!response.ok) {
        throw new Error(response.error ?? "Unable to open the selected item.");
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

  function canRunContentSelectionAction(): boolean {
    if (mainView !== "explorer" || isSearchMode) {
      return false;
    }
    const activePane = focusedPane ?? lastExplorerFocusPaneRef.current;
    return activePane === "content";
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
    if (isWriteOperationInFlight()) {
      surfaceCopyLikePreStartFailureToast("duplicate", getCopyLikeBusyOutcome());
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
      surfaceCopyLikePreStartFailureToast("duplicate", outcome);
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
      return "Unable to verify the destination folder.";
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
    const resolvedDestinationDirectoryPath = expandHomeShortcut(destinationDirectoryPath.trim(), homePath);
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
        currentDirectoryPath.length > 0
          ? expandHomeShortcut(currentDirectoryPath, homePath)
          : null,
    });
    return response.canceled ? null : response.path;
  }

  function openRenameDialog(paths: string[]) {
    if (paths.length !== 1) {
      return;
    }
    const sourcePath = paths[0];
    if (!sourcePath) {
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
    });
    closeContextMenu();
  }

  async function submitRenameDialog(nextName: string) {
    if (!renameDialogState) {
      return;
    }
    try {
      const response = await client.invoke("writeOperation:rename", {
        sourcePath: renameDialogState.sourcePath,
        destinationName: nextName,
      });
      activeWriteOperationIdRef.current = response.operationId;
      applyWriteOperationCardState({
        action: "rename",
        stage: "queued",
        targetPath: renameDialogState.sourcePath,
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: renameDialogState.sourcePath,
      });
      setRenameDialogState(null);
    } catch (error) {
      setRenameDialogState((current) =>
        current
          ? { ...current, error: error instanceof Error ? error.message : String(error) }
          : current,
      );
    }
  }

  function resolveDefaultNewFolderName(parentPath: string): string {
    if (parentPath !== currentPathRef.current) {
      return "New Folder";
    }
    const existingNames = new Set(currentEntries.map((entry) => entry.name));
    if (!existingNames.has("New Folder")) {
      return "New Folder";
    }
    for (let index = 2; index < 500; index += 1) {
      const candidate = `New Folder ${index}`;
      if (!existingNames.has(candidate)) {
        return candidate;
      }
    }
    return "New Folder";
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
    if (
      explicitTreeSelectionPath &&
      (event.status === "completed" || event.status === "partial") &&
      result.items.some(
        (item) => item.status === "completed" && item.destinationPath === explicitTreeSelectionPath,
      )
    ) {
      return explicitTreeSelectionPath;
    }
    return resolveWriteOperationTreeSelectionPath(
      result,
      getFileSystemItemPath(selectedTreeItemIdRef.current),
    );
  }

  function openNewFolderDialog(
    parentDirectoryPath: string,
    options: { selectInTreeOnSuccess?: boolean } = {},
  ) {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setFocusedPane(null);
    clearTypeahead();
    setNewFolderDialogState({
      parentDirectoryPath,
      initialName: resolveDefaultNewFolderName(parentDirectoryPath),
      error: null,
      selectInTreeOnSuccess: options.selectInTreeOnSuccess ?? false,
    });
    closeContextMenu();
  }

  async function submitNewFolderDialog(folderName: string) {
    if (!newFolderDialogState) {
      return;
    }
    try {
      const response = await client.invoke("writeOperation:createFolder", {
        parentDirectoryPath: newFolderDialogState.parentDirectoryPath,
        folderName,
      });
      rememberPendingTreeSelectionPath(
        newFolderDialogState.selectInTreeOnSuccess
          ? buildChildPath(newFolderDialogState.parentDirectoryPath, folderName)
          : null,
      );
      activeWriteOperationIdRef.current = response.operationId;
      applyWriteOperationCardState({
        action: "new_folder",
        stage: "queued",
        targetPath: newFolderDialogState.parentDirectoryPath,
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
      });
      setNewFolderDialogState(null);
    } catch (error) {
      setNewFolderDialogState((current) =>
        current
          ? { ...current, error: error instanceof Error ? error.message : String(error) }
          : current,
      );
    }
  }

  async function startTrashPaths(paths: string[]) {
    if (paths.length === 0) {
      return;
    }
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
    try {
      setCopyPasteDialogState(null);
      const response = await client.invoke("writeOperation:trash", {
        paths,
      });
      rememberPendingTreeSelectionPath(null);
      activeWriteOperationIdRef.current = response.operationId;
      applyWriteOperationCardState({
        action: "trash",
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
      logger.error("trash start failed", error);
      if (error instanceof Error && error.message.includes(WRITE_OPERATION_BUSY_ERROR)) {
        showWriteOperationBusyToast();
        return;
      }
      showModalNotice("Move to Trash", "File Trail could not move the selected items to Trash.");
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
    closeContextMenu,
    contextMenuDisabledActionIds,
    contextMenuFavoriteToggleLabel,
    contextMenuHiddenActionIds,
    contextMenuSubmenuItems,
    copyGetInfoPath,
    dismissActionNotice,
    dismissCopyPasteDialog,
    dismissToast,
    editPaths,
    executeCopyLikePlan,
    requestCopyLikePlanStart,
    surfaceCopyLikePreStartFailureToast,
    handleContentSelectionGesture,
    handleCopyPasteDialogEscape,
    moveOpenWithApplication,
    openItemContextMenu,
    openTreeItemContextMenu,
    openMoveDialog,
    openNewFolderDialog,
    openPathExternally,
    openPathInTerminal,
    openPaths,
    openRenameDialog,
    removeOpenWithApplication,
    resolveContentActionPaths,
    retryFailedCopyPasteItems,
    resolveRuntimeConflict,
    runContextMenuAction,
    runContextSubmenuAction,
    runCopyClipboardAction,
    runCopyPathAction,
    selectAllContentEntries,
    setSingleContentSelection,
    showCopyPasteProgressCard,
    showCopyPasteResultDialog,
    showWriteOperationBusyToast,
    startDuplicatePaths,
    startMoveToDestination,
    startPasteFromClipboard,
    startTrashPaths,
    submitMoveDialog,
    submitNewFolderDialog,
    submitRenameDialog,
    syncContentSelectionRefs,
    toggleContentSelection,
    extendContentSelectionToPath,
    updateCopyPastePolicy,
    activateContentEntry,
    activateContentPaths,
    addOpenWithApplication,
    cancelWriteOperation,
  };
}
