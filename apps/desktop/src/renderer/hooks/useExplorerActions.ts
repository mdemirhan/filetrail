import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";

import type { IpcRequest, WriteOperationProgressEvent } from "@filetrail/contracts";

import type {
  ApplicationSelection,
  FileActivationAction,
  OpenWithApplication,
} from "../../shared/appPreferences";
import {
  BROWSE_CONTEXT_MENU_ITEMS,
  type ContextMenuActionId,
  type ContextMenuSubmenuAction,
  type ContextMenuSubmenuItem,
  SEARCH_CONTEXT_MENU_ITEMS,
} from "../components/ItemContextMenu";
import {
  type ContentSelectionState,
  EMPTY_CONTENT_SELECTION,
  setSingleContentSelection as createSingleContentSelection,
  extendContentSelectionToPath as extendSelectionStateToPath,
  selectAllContentEntries as selectAllSelectionStateEntries,
  toggleContentSelection as toggleSelectionState,
  sanitizeContentSelection,
} from "../lib/contentSelection";
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
  resolveWriteOperationSelectionDirectoryPath,
  shouldRenderCopyPasteResultDialog,
} from "../lib/explorerAppUtils";
import type { DirectoryEntry, CopyPastePlan } from "../lib/explorerTypes";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { useFiletrailClient } from "../lib/filetrailClient";
import { createRendererLogger } from "../lib/logging";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "../lib/toasts";
import type {
  ContextMenuState,
  CopyPasteDialogState,
  WriteOperationCardState,
} from "./useWriteOperations";

const logger = createRendererLogger("filetrail.renderer");

const WRITE_OPERATION_BUSY_ERROR = "Another write operation is already running.";
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

export function useExplorerActions(args: {
  client: ReturnType<typeof useFiletrailClient>;
  mainView: "explorer" | "help" | "settings";
  focusedPane: "tree" | "content" | null;
  setFocusedPane: (value: "tree" | "content" | null) => void;
  setInfoPanelOpen: Dispatch<SetStateAction<boolean>>;
  currentPath: string;
  currentEntries: DirectoryEntry[];
  activeContentEntries: DirectoryEntry[];
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
  refreshDirectory: () => Promise<void>;
  contentSelection: ContentSelectionState;
  setContentSelection: Dispatch<SetStateAction<ContentSelectionState>>;
  currentPathRef: MutableRefObject<string>;
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
  } | null;
  setNewFolderDialogState: Dispatch<
    SetStateAction<{
      parentDirectoryPath: string;
      initialName: string;
      error: string | null;
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
}) {
  const {
    client,
    mainView,
    focusedPane,
    setFocusedPane,
    setInfoPanelOpen,
    currentPath,
    currentEntries,
    activeContentEntries,
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
    refreshDirectory,
    contentSelection,
    setContentSelection,
    currentPathRef,
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
  } = args;

  const isWriteOperationLocked = writeOperationCardState !== null;
  const canPasteAtResolvedDestination =
    hasClipboardItems(copyPasteClipboard) && pasteDestinationPath !== null;
  const showCopyPasteProgressCard = writeOperationCardState !== null;
  const showCopyPasteResultDialog = shouldRenderCopyPasteResultDialog(writeOperationProgressEvent);

  const contextMenuDisabledActionIds = useMemo(() => {
    if (!contextMenuState) {
      return [] as ContextMenuActionId[];
    }
    const disabled = new Set<ContextMenuActionId>();
    const isBrowseContext = contextMenuState.source === "browse" && !isSearchMode;
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
    if (!hasOnlyEditableFiles) {
      disabled.add("edit");
    }
    if (!isBrowseContext) {
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
    const items =
      contextMenuState.source === "search" ? SEARCH_CONTEXT_MENU_ITEMS : BROWSE_CONTEXT_MENU_ITEMS;
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
  }, [activeContentEntries]);

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
    if (!notificationsEnabled) {
      setToasts([]);
    }
  }, [notificationsEnabled, setToasts]);

  useEffect(() => {
    if (!contextMenuState) {
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

  useEffect(() => {
    const unsubscribe = client.onWriteOperationProgress((event) => {
      if (event.operationId !== activeWriteOperationIdRef.current) {
        return;
      }
      if (event.status === "queued" || event.status === "running") {
        applyWriteOperationCardState({
          action: event.action,
          stage: event.status,
          targetPath:
            event.result?.targetPath ?? writeOperationCardState?.targetPath ?? currentPathRef.current,
          completedItemCount: event.completedItemCount,
          totalItemCount: event.totalItemCount,
          completedByteCount: event.completedByteCount,
          totalBytes: event.totalBytes,
          currentSourcePath: event.currentSourcePath,
        });
      }
      if (
        event.status === "completed" ||
        event.status === "failed" ||
        event.status === "cancelled" ||
        event.status === "partial"
      ) {
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
        void refreshDirectory();
      }
    });
    return unsubscribe;
  }, [client, refreshDirectory, writeOperationCardState?.targetPath]);

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
    source: "browse" | "search" = "browse",
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
      source,
      scope: contextPaths.length > 0 ? "selection" : "background",
    });
  }

  function showModalNotice(title: string, message: string) {
    actionNoticeReturnFocusPaneRef.current =
      focusedPane ?? lastExplorerFocusPaneRef.current ?? (contextMenuState ? "content" : null);
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

  function pushTerminalCopyPasteToast(event: WriteOperationProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    const itemLabel = `${result.summary.topLevelItemCount} item${result.summary.topLevelItemCount === 1 ? "" : "s"}`;
    const actionLabel =
      event.action === "move_to"
        ? "Moved"
        : event.action === "duplicate"
          ? "Duplicated"
          : event.action === "trash"
            ? "Moved to Trash"
            : event.action === "rename"
              ? "Renamed"
              : event.action === "new_folder"
                ? "Created folder"
                : "Pasted";
    if (event.status === "completed") {
      pushToast({
        kind: "success",
        title:
          result.targetPath &&
          (event.action === "paste" || event.action === "move_to" || event.action === "duplicate")
            ? `${actionLabel} ${itemLabel} into ${getPathLeafName(result.targetPath)}`
            : `${actionLabel} ${itemLabel}`,
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
      });
      return;
    }
    if (event.status === "partial") {
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
      });
      return;
    }
    if (event.status === "failed") {
      pushToast({
        kind: "error",
        title: `${actionLabel} failed`,
        ...(result.error ? { message: result.error } : {}),
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
    await client.invoke("system:copyText" as never, {
      text: paths.map((path) => formatPathForShell(path)).join("\n"),
    } as never);
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
        title: paths.length === 1 ? "Copied path" : `Copied ${paths.length} paths`,
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
    if (selectedEntryRef.current) {
      return [selectedEntryRef.current.path];
    }
    if (currentPathRef.current.length > 0) {
      return [currentPathRef.current];
    }
    return [];
  }

  async function runCopyClipboardAction(mode: "copy" | "cut") {
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
    const paths = resolveClipboardSourcePaths();
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
      title:
        mode === "copy"
          ? paths.length === 1
            ? "Ready to paste 1 item"
            : `Ready to paste ${paths.length} items`
          : paths.length === 1
            ? "Ready to move 1 item"
            : `Ready to move ${paths.length} items`,
    });
    closeContextMenu();
  }

  async function executeCopyLikePlan(
    plan: CopyPastePlan,
    action: "paste" | "move_to" | "duplicate",
    options: {
      pasteAttemptId?: number | null;
      clearClipboardOnStart?: boolean;
    } = {},
  ) {
    const pasteAttemptId = options.pasteAttemptId ?? null;
    const clearClipboardOnStart = options.clearClipboardOnStart ?? false;
    if (pasteAttemptId !== null) {
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt || pendingAttempt.id !== pasteAttemptId || pendingAttempt.cancelled) {
        return;
      }
      pendingPasteAttemptRef.current = {
        ...pendingAttempt,
        phase: "starting",
      };
    }
    applyWriteOperationCardState({
      action,
      stage: "starting",
      targetPath: plan.destinationDirectoryPath,
      completedItemCount: 0,
      totalItemCount: plan.summary.totalItemCount,
      completedByteCount: 0,
      totalBytes: plan.summary.totalBytes,
      currentSourcePath: plan.sourcePaths[0] ?? null,
    });
    try {
      const response = (await client.invoke("copyPaste:start" as never, {
        mode: plan.mode,
        sourcePaths: plan.sourcePaths,
        destinationDirectoryPath: plan.destinationDirectoryPath,
        conflictResolution: plan.conflictResolution,
        action,
      } as never)) as { operationId: string };
      if (clearClipboardOnStart) {
        applyCopyPasteClipboardState(clearCopyPasteClipboard());
      }
      const pendingAttempt = pasteAttemptId === null ? null : pendingPasteAttemptRef.current;
      if (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        activeWriteOperationIdRef.current = response.operationId;
        setWriteOperationProgressEvent({
          operationId: response.operationId,
          action,
          status: "queued",
          completedItemCount: 0,
          totalItemCount: plan.summary.totalItemCount,
          completedByteCount: 0,
          totalBytes: plan.summary.totalBytes,
          currentSourcePath: plan.sourcePaths[0] ?? null,
          currentDestinationPath: null,
          result: null,
        });
        void cancelWriteOperation();
        return;
      }
      pendingPasteAttemptRef.current = null;
      activeWriteOperationIdRef.current = response.operationId;
      applyWriteOperationCardState({
        action,
        stage: "queued",
        targetPath: plan.destinationDirectoryPath,
        completedItemCount: 0,
        totalItemCount: plan.summary.totalItemCount,
        completedByteCount: 0,
        totalBytes: plan.summary.totalBytes,
        currentSourcePath: plan.sourcePaths[0] ?? null,
      });
      setWriteOperationProgressEvent({
        operationId: response.operationId,
        action,
        status: "queued",
        completedItemCount: 0,
        totalItemCount: plan.summary.totalItemCount,
        completedByteCount: 0,
        totalBytes: plan.summary.totalBytes,
        currentSourcePath: plan.sourcePaths[0] ?? null,
        currentDestinationPath: null,
        result: null,
      });
      setCopyPasteDialogState(null);
      closeContextMenu();
    } catch (error) {
      const pendingAttempt = pasteAttemptId === null ? null : pendingPasteAttemptRef.current;
      if (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        return;
      }
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("copy paste start failed", error);
      if (error instanceof Error && error.message.includes(WRITE_OPERATION_BUSY_ERROR)) {
        showWriteOperationBusyToast();
        return;
      }
      showModalNotice(
        "Unable to start paste",
        "File Trail could not start the write operation. No files were written.",
      );
    }
  }

  async function startPasteFromClipboard(
    conflictResolution: IpcRequest<"copyPaste:plan">["conflictResolution"] = "error",
  ) {
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
    if (pasteDestinationPath === null) {
      pushToast({
        kind: "warning",
        title: "Select a destination folder to paste into",
      });
      return;
    }
    const request = buildPasteRequest(
      copyPasteClipboardRef.current,
      pasteDestinationPath,
      conflictResolution,
    );
    if (!request) {
      pushToast({
        kind: "warning",
        title: "Clipboard is empty",
      });
      return;
    }
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "paste",
      targetPath: request.destinationDirectoryPath,
      totalItemCount: request.sourcePaths.length,
      totalBytes: null,
      currentSourcePath: request.sourcePaths[0] ?? null,
    });
    try {
      const plan = (await client.invoke("copyPaste:plan" as never, {
        ...request,
        action: "paste",
      } as never)) as CopyPastePlan;
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt || pendingAttempt.id !== pasteAttemptId || pendingAttempt.cancelled) {
        return;
      }
      if (plan.conflicts.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        setCopyPasteDialogState({
          type: "plan",
          plan,
          action: "paste",
          clearClipboardOnStart: true,
        });
        return;
      }
      if (plan.issues.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        showModalNotice(
          "Paste cannot continue",
          plan.issues[0]?.message ?? "Paste cannot continue.",
        );
        return;
      }
      await executeCopyLikePlan(plan, "paste", {
        pasteAttemptId,
        clearClipboardOnStart: true,
      });
    } catch (error) {
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        return;
      }
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("copy paste planning failed", error);
      showModalNotice(
        "Unable to prepare paste",
        "File Trail could not validate the paste operation. No files were written.",
      );
    }
  }

  async function cancelWriteOperation() {
    const operationId = activeWriteOperationIdRef.current;
    if (!operationId) {
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt) {
        return;
      }
      pendingPasteAttemptRef.current = {
        ...pendingAttempt,
        cancelled: true,
      };
      if (pendingAttempt.phase === "planning") {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        setWriteOperationProgressEvent(null);
      }
      return;
    }
    try {
      await client.invoke("writeOperation:cancel" as never, { operationId } as never);
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
    try {
      const plan = (await client.invoke("copyPaste:plan" as never, {
        mode: event.action === "move_to" ? "cut" : "copy",
        sourcePaths: failedSourcePaths,
        destinationDirectoryPath: result.targetPath ?? currentPathRef.current,
        conflictResolution: "error",
        action: event.action === "move_to" ? "move_to" : event.action,
      } as never)) as CopyPastePlan;
      if (plan.conflicts.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        setCopyPasteDialogState({
          type: "plan",
          plan,
          action: event.action === "move_to" ? "move_to" : "duplicate",
          clearClipboardOnStart: false,
        });
        return;
      }
      if (plan.issues.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        showModalNotice(
          "Paste cannot continue",
          plan.issues[0]?.message ?? "Paste cannot continue.",
        );
        return;
      }
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt || pendingAttempt.id !== pasteAttemptId || pendingAttempt.cancelled) {
        return;
      }
      await executeCopyLikePlan(plan, event.action === "move_to" ? "move_to" : "duplicate", {
        pasteAttemptId,
        clearClipboardOnStart: false,
      });
    } catch (error) {
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (pendingAttempt && pendingAttempt.id === pasteAttemptId && pendingAttempt.cancelled) {
        pendingPasteAttemptRef.current = null;
        return;
      }
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("copy paste retry planning failed", error);
      showModalNotice(
        "Unable to retry failed items",
        "File Trail could not prepare a retry plan for the failed items.",
      );
    }
  }

  function dismissCopyPasteDialog() {
    setCopyPasteDialogState(null);
    setWriteOperationProgressEvent(null);
    activeWriteOperationIdRef.current = null;
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
        writeOperationProgressEvent.status === "queued"
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
    const selectionDirectoryPath = resolveWriteOperationSelectionDirectoryPath(result, selectedPaths);

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
      await client.invoke("system:copyText" as never, { text: path } as never);
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
      const response = (await client.invoke("system:openInTerminal" as never, {
        path,
      } as never)) as { ok: boolean; error?: string | null };
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
      const response = (await client.invoke("system:pickApplication" as never, {} as never)) as {
        canceled: boolean;
        appPath: string | null;
        appName: string | null;
      };
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
      const response = (await client.invoke("system:openPathsWithApplication" as never, {
        applicationPath,
        paths,
      } as never)) as { ok: boolean; error?: string | null };
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
    const didNavigate = await navigateTo(folderPath, folderPath === currentPath ? "replace" : "push");
    if (!didNavigate) {
      return;
    }
    setSingleContentSelection(path);
    focusContentPane();
  }

  async function runContextMenuAction(actionId: ContextMenuActionId, paths: string[]) {
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
      await runCopyClipboardAction("copy");
      return;
    }
    if (actionId === "cut") {
      await runCopyClipboardAction("cut");
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
    if (actionId === "edit") {
      await editPaths(paths);
      return;
    }
    if (actionId === "toggleInfoPanel") {
      setInfoPanelOpen(true);
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
      await startDuplicatePaths(paths);
      return;
    }
    if (actionId === "newFolder") {
      const targetPath = resolveNewFolderTargetPath({
        currentPath,
        selectedEntry: contextMenuTargetEntry,
        selectedPaths: paths,
        isSearchMode,
        contextScope: contextMenuState?.scope ?? "selection",
      });
      if (targetPath) {
        openNewFolderDialog(targetPath);
      }
      return;
    }
    if (actionId === "trash") {
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
    showNotImplementedNotice("Open With");
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
      const response = (await client.invoke("path:resolve" as never, { path } as never)) as {
        resolvedPath: string | null;
      };
      return response.resolvedPath;
    } catch (error) {
      logger.error("resolve target path failed", error);
      return null;
    }
  }

  async function openPathExternally(path: string) {
    try {
      const response = (await client.invoke("system:openPath" as never, { path } as never)) as {
        ok: boolean;
        error?: string | null;
      };
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

  async function startDuplicatePaths(paths: string[]) {
    if (paths.length === 0 || currentPathRef.current.length === 0) {
      return;
    }
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "duplicate",
      targetPath: currentPathRef.current,
      totalItemCount: paths.length,
      totalBytes: null,
      currentSourcePath: paths[0] ?? null,
    });
    try {
      const plan = (await client.invoke("copyPaste:plan" as never, {
        mode: "copy",
        sourcePaths: paths,
        destinationDirectoryPath: currentPathRef.current,
        conflictResolution: "error",
        action: "duplicate",
      } as never)) as CopyPastePlan;
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt || pendingAttempt.id !== pasteAttemptId || pendingAttempt.cancelled) {
        return;
      }
      if (plan.issues.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        showModalNotice(
          "Duplicate cannot continue",
          plan.issues[0]?.message ?? "Duplicate cannot continue.",
        );
        return;
      }
      await executeCopyLikePlan(plan, "duplicate", {
        pasteAttemptId,
        clearClipboardOnStart: false,
      });
      closeContextMenu();
    } catch (error) {
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("duplicate planning failed", error);
      showModalNotice(
        "Unable to prepare duplicate",
        "File Trail could not validate the duplicate operation.",
      );
    }
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
    if (isWriteOperationInFlight()) {
      showWriteOperationBusyToast();
      return;
    }
    setMoveDialogState((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const pasteAttemptId = beginPendingPasteAttempt({
      action: "move_to",
      targetPath: destinationDirectoryPath,
      totalItemCount: moveDialogState.sourcePaths.length,
      totalBytes: null,
      currentSourcePath: moveDialogState.sourcePaths[0] ?? null,
    });
    try {
      const plan = (await client.invoke("copyPaste:plan" as never, {
        mode: "cut",
        sourcePaths: moveDialogState.sourcePaths,
        destinationDirectoryPath,
        conflictResolution: "error",
        action: "move_to",
      } as never)) as CopyPastePlan;
      const pendingAttempt = pendingPasteAttemptRef.current;
      if (!pendingAttempt || pendingAttempt.id !== pasteAttemptId || pendingAttempt.cancelled) {
        return;
      }
      if (plan.conflicts.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        setMoveDialogState(null);
        setCopyPasteDialogState({
          type: "plan",
          plan,
          action: "move_to",
          clearClipboardOnStart: false,
        });
        return;
      }
      if (plan.issues.length > 0) {
        pendingPasteAttemptRef.current = null;
        applyWriteOperationCardState(null);
        setMoveDialogState((current) =>
          current
            ? {
                ...current,
                submitting: false,
                error: plan.issues[0]?.message ?? "Move cannot continue.",
              }
            : current,
        );
        return;
      }
      setMoveDialogState(null);
      await executeCopyLikePlan(plan, "move_to", {
        pasteAttemptId,
        clearClipboardOnStart: false,
      });
    } catch (error) {
      pendingPasteAttemptRef.current = null;
      applyWriteOperationCardState(null);
      logger.error("move planning failed", error);
      setMoveDialogState((current) =>
        current
          ? {
              ...current,
              submitting: false,
              error: "Unable to prepare the move destination.",
            }
          : current,
      );
    }
  }

  async function browseForDirectoryPath(currentDirectoryPath: string): Promise<string | null> {
    const response = (await client.invoke("system:pickDirectory" as never, {
      defaultPath: currentDirectoryPath.length > 0 ? currentDirectoryPath : null,
    } as never)) as { canceled: boolean; path: string };
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
      const response = (await client.invoke("writeOperation:rename" as never, {
        sourcePath: renameDialogState.sourcePath,
        destinationName: nextName,
      } as never)) as { operationId: string };
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
        current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current,
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

  function openNewFolderDialog(parentDirectoryPath: string) {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setFocusedPane(null);
    clearTypeahead();
    setNewFolderDialogState({
      parentDirectoryPath,
      initialName: resolveDefaultNewFolderName(parentDirectoryPath),
      error: null,
    });
    closeContextMenu();
  }

  async function submitNewFolderDialog(folderName: string) {
    if (!newFolderDialogState) {
      return;
    }
    try {
      const response = (await client.invoke("writeOperation:createFolder" as never, {
        parentDirectoryPath: newFolderDialogState.parentDirectoryPath,
        folderName,
      } as never)) as { operationId: string };
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
        current ? { ...current, error: error instanceof Error ? error.message : String(error) } : current,
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
      const response = (await client.invoke("writeOperation:trash" as never, {
        paths,
      } as never)) as { operationId: string };
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
    contextMenuSubmenuItems,
    copyGetInfoPath,
    dismissActionNotice,
    dismissCopyPasteDialog,
    dismissToast,
    editPaths,
    executeCopyLikePlan,
    handleContentSelectionGesture,
    handleCopyPasteDialogEscape,
    moveOpenWithApplication,
    openItemContextMenu,
    openMoveDialog,
    openNewFolderDialog,
    openPathExternally,
    openPathInTerminal,
    openPaths,
    openRenameDialog,
    removeOpenWithApplication,
    resolveContentActionPaths,
    retryFailedCopyPasteItems,
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
    startPasteFromClipboard,
    startTrashPaths,
    submitMoveDialog,
    submitNewFolderDialog,
    submitRenameDialog,
    syncContentSelectionRefs,
    toggleContentSelection,
    extendContentSelectionToPath,
    activateContentEntry,
    activateContentPaths,
    addOpenWithApplication,
    cancelWriteOperation,
  };
}
