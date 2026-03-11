import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
} from "react";

import { clampZoomPercent } from "../../shared/appPreferences";
import { resolveNewFolderTargetPath } from "../lib/explorerAppUtils";
import type { DirectoryEntry } from "../lib/explorerTypes";
import { isKeyboardOwnedFormControl, resolveFocusedEditTarget } from "../lib/focusedEditTarget";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { useFiletrailClient } from "../lib/filetrailClient";
import {
  canHandleExplorerKeyboardShortcuts,
  canHandleRawExplorerShortcut,
  canHandleRendererCommand,
  type RawExplorerShortcutId,
  type ShortcutContext,
} from "../lib/shortcutPolicy";
import {
  resolveEditSelectionPaths,
  resolveOpenInTerminalPaths,
  resolveOpenSelectionPaths,
} from "../lib/shortcutTargets";
import { getNextSelectionIndex } from "../lib/explorerNavigation";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import type { ContentSelectionState } from "../lib/contentSelection";
import type { ContextMenuState } from "./useWriteOperations";

type RawShortcutBinding = {
  id: RawExplorerShortcutId;
  matches: (event: KeyboardEvent) => boolean;
  run: (event: KeyboardEvent) => void;
};

export function useExplorerShortcuts(args: {
  client: ReturnType<typeof useFiletrailClient>;
  shortcutContext: ShortcutContext;
  actionNotice: { title: string; message: string } | null;
  dismissActionNotice: () => void;
  copyPasteModalOpen: boolean;
  handleCopyPasteDialogEscape: () => void;
  contextMenuState: ContextMenuState | null;
  setContextMenuState: Dispatch<SetStateAction<ContextMenuState | null>>;
  locationDialogOpen: boolean;
  mainView: "explorer" | "help" | "settings" | "action-log";
  setMainView: Dispatch<SetStateAction<"explorer" | "help" | "settings" | "action-log">>;
  openActionLogView: () => void;
  openSettingsView: () => void;
  openLocationSheet: () => void;
  focusFileSearch: (selectContents?: boolean) => void;
  focusedPane: "tree" | "content" | null;
  setFocusedPane: Dispatch<SetStateAction<"tree" | "content" | null>>;
  lastExplorerFocusPaneRef: MutableRefObject<"tree" | "content" | null>;
  treePaneRef: RefObject<HTMLElement | null>;
  contentPaneRef: RefObject<HTMLElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  clearTypeahead: () => void;
  setSearchPopoverOpen: Dispatch<SetStateAction<boolean>>;
  setSearchResultsVisible: Dispatch<SetStateAction<boolean>>;
  searchPointerIntentRef: MutableRefObject<boolean>;
  searchCommittedQueryRef: MutableRefObject<string>;
  cachedSearchSelectionRef: MutableRefObject<ContentSelectionState>;
  searchResultEntries: DirectoryEntry[];
  applyContentSelection: (selection: ContentSelectionState, entries: DirectoryEntry[]) => void;
  selectedTreeTargetPath: string | null;
  selectedPathsInViewOrder: string[];
  currentPath: string;
  selectedEntry: DirectoryEntry | null;
  activeContentEntries: DirectoryEntry[];
  contentSelection: ContentSelectionState;
  contentColumns: number;
  isSearchMode: boolean;
  hasCachedSearch: boolean;
  tabSwitchesExplorerPanes: boolean;
  typeaheadEnabled: boolean;
  viewMode: "list" | "details";
  showCachedSearchResults: (options?: { focusPane?: boolean }) => void;
  hideSearchResults: () => void;
  goBack: () => void;
  goForward: () => void;
  navigateTo: (path: string, historyMode: "push" | "replace" | "skip") => Promise<boolean>;
  navigateTreeFileSystemPath: (
    path: string,
    historyMode: "push" | "replace" | "skip",
  ) => Promise<void>;
  navigateFavoritePath: (path: string, historyMode: "push" | "replace" | "skip") => Promise<boolean>;
  openTreeNode: () => Promise<void>;
  toggleHiddenFiles: () => void;
  refreshDirectory: (options?: {
    path?: string;
    treeSelectionPath?: string | null;
  }) => Promise<void>;
  applySearchResultsSort: () => void;
  runCopyClipboardAction: (mode: "copy" | "cut") => Promise<void>;
  startPasteFromClipboard: () => Promise<void>;
  resolveContentActionPaths: () => string[];
  startDuplicatePaths: (paths: string[]) => Promise<void>;
  startTrashPaths: (paths: string[]) => Promise<void>;
  openMoveDialog: (paths: string[]) => void;
  openRenameDialog: (paths: string[]) => void;
  openNewFolderDialog: (targetPath: string) => void;
  runCopyPathAction: (paths: string[]) => Promise<void>;
  openPaths: (paths: string[]) => Promise<void>;
  editPaths: (paths: string[]) => Promise<void>;
  openPathInTerminal: (path: string) => Promise<void>;
  focusContentPane: () => void;
  handlePagedPaneScroll: (direction: "backward" | "forward") => boolean;
  handleTypeaheadInput: (key: string, pane: "tree" | "content") => void;
  handleTreeKeyboardAction: (
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
  ) => Promise<boolean>;
  navigateTreeSelectionToParent: () => Promise<void>;
  activateContentPaths: (paths: string[]) => Promise<void>;
  extendContentSelectionToPath: (path: string, additive?: boolean) => void;
  setSingleContentSelection: (path: string) => void;
  selectAllContentEntries: () => void;
  setInfoPanelOpen: Dispatch<SetStateAction<boolean>>;
  setInfoRowOpen: Dispatch<SetStateAction<boolean>>;
  setZoomPercent: Dispatch<SetStateAction<number>>;
}) {
  const {
    client,
    shortcutContext,
    actionNotice,
    dismissActionNotice,
    copyPasteModalOpen,
    handleCopyPasteDialogEscape,
    contextMenuState,
    setContextMenuState,
    locationDialogOpen,
    mainView,
    setMainView,
    openActionLogView,
    openSettingsView,
    openLocationSheet,
    focusFileSearch,
    focusedPane,
    setFocusedPane,
    lastExplorerFocusPaneRef,
    treePaneRef,
    contentPaneRef,
    searchInputRef,
    clearTypeahead,
    setSearchPopoverOpen,
    setSearchResultsVisible,
    searchPointerIntentRef,
    searchCommittedQueryRef,
    cachedSearchSelectionRef,
    searchResultEntries,
    applyContentSelection,
    selectedTreeTargetPath,
    selectedPathsInViewOrder,
    currentPath,
    selectedEntry,
    activeContentEntries,
    contentSelection,
    contentColumns,
    isSearchMode,
    hasCachedSearch,
    tabSwitchesExplorerPanes,
    typeaheadEnabled,
    viewMode,
    showCachedSearchResults,
    hideSearchResults,
    goBack,
    goForward,
    navigateTo,
    navigateTreeFileSystemPath,
    navigateFavoritePath,
    openTreeNode,
    toggleHiddenFiles,
    refreshDirectory,
    applySearchResultsSort,
    runCopyClipboardAction,
    startPasteFromClipboard,
    resolveContentActionPaths,
    startDuplicatePaths,
    startTrashPaths,
    openMoveDialog,
    openRenameDialog,
    openNewFolderDialog,
    runCopyPathAction,
    openPaths,
    editPaths,
    openPathInTerminal,
    focusContentPane,
    handlePagedPaneScroll,
    handleTypeaheadInput,
    handleTreeKeyboardAction,
    navigateTreeSelectionToParent,
    activateContentPaths,
    extendContentSelectionToPath,
    setSingleContentSelection,
    selectAllContentEntries,
    setInfoPanelOpen,
    setInfoRowOpen,
    setZoomPercent,
  } = args;

  const rawShortcutBindings = useMemo<readonly RawShortcutBinding[]>(
    () => [
      {
        id: "paneTabSwitch",
        matches: (keyboardEvent) => {
          if (!tabSwitchesExplorerPanes || keyboardEvent.key !== "Tab") {
            return false;
          }
          const target = keyboardEvent.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const isAutocompleteContext =
            targetElement?.closest(".pathbar-editor-shell, .location-sheet-input-shell") !== null;
          if (isAutocompleteContext) {
            return false;
          }
          const isTreeFocusTarget =
            target instanceof Node && !!treePaneRef.current?.contains(target);
          const isContentFocusTarget =
            target instanceof Node && !!contentPaneRef.current?.contains(target);
          return (
            isTreeFocusTarget ||
            isContentFocusTarget ||
            (document.activeElement === document.body && focusedPane !== null)
          );
        },
        run: (keyboardEvent) => {
          const target = keyboardEvent.target;
          const isTreeFocusTarget =
            target instanceof Node && !!treePaneRef.current?.contains(target);
          keyboardEvent.preventDefault();
          if (isTreeFocusTarget || focusedPane === "tree") {
            contentPaneRef.current?.focus({ preventScroll: true });
            setFocusedPane("content");
            return;
          }
          treePaneRef.current?.focus({ preventScroll: true });
          setFocusedPane("tree");
        },
      },
      {
        id: "copySelection",
        matches: (keyboardEvent) =>
          (keyboardEvent.metaKey || keyboardEvent.ctrlKey) &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "c",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void runCopyClipboardAction("copy");
        },
      },
      {
        id: "cutSelection",
        matches: (keyboardEvent) =>
          (keyboardEvent.metaKey || keyboardEvent.ctrlKey) &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "x",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void runCopyClipboardAction("cut");
        },
      },
      {
        id: "pasteSelection",
        matches: (keyboardEvent) =>
          (keyboardEvent.metaKey || keyboardEvent.ctrlKey) &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "v",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void startPasteFromClipboard();
        },
      },
      {
        id: "duplicateSelection",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "d",
        run: (keyboardEvent) => {
          const paths = resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          void startDuplicatePaths(paths);
        },
      },
      {
        id: "trashSelection",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "Backspace",
        run: (keyboardEvent) => {
          const paths = resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          void startTrashPaths(paths);
        },
      },
      {
        id: "renameSelection",
        matches: (keyboardEvent) =>
          !keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "F2",
        run: (keyboardEvent) => {
          const paths = resolveContentActionPaths();
          if (paths.length !== 1) {
            return;
          }
          keyboardEvent.preventDefault();
          openRenameDialog(paths);
        },
      },
      {
        id: "selectAllContent",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "a" &&
          focusedPane === "content",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          selectAllContentEntries();
        },
      },
      {
        id: "focusTreePane",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "1",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          treePaneRef.current?.focus({ preventScroll: true });
          setFocusedPane("tree");
        },
      },
      {
        id: "focusContentPane",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "2",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          contentPaneRef.current?.focus({ preventScroll: true });
          setFocusedPane("content");
        },
      },
      {
        id: "showCachedSearchResults",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "f" &&
          hasCachedSearch,
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          showCachedSearchResults({ focusPane: true });
        },
      },
      {
        id: "focusFileSearch",
        matches: (keyboardEvent) =>
          (keyboardEvent.metaKey || keyboardEvent.ctrlKey) &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "f",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          focusFileSearch(true);
        },
      },
      {
        id: "historyBack",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "ArrowLeft",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          goBack();
        },
      },
      {
        id: "historyForward",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "ArrowRight",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          goForward();
        },
      },
      {
        id: "openParentTree",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "ArrowUp" &&
          focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void navigateTreeSelectionToParent();
        },
      },
      {
        id: "openParentContent",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "ArrowUp" &&
          focusedPane === "content",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          const nextPath = parentDirectoryPath(currentPath);
          if (nextPath) {
            void navigateTo(nextPath, "push");
          }
        },
      },
      {
        id: "openSelectedContentWithCommand",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "ArrowDown" &&
          focusedPane === "content" &&
          selectedEntry !== null,
        run: (keyboardEvent) => {
          if (!selectedEntry) {
            return;
          }
          keyboardEvent.preventDefault();
          const pathsToActivate =
            selectedPathsInViewOrder.length > 0 ? selectedPathsInViewOrder : [selectedEntry.path];
          void activateContentPaths(pathsToActivate);
        },
      },
      {
        id: "openTreeNodeWithCommand",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === "ArrowDown" &&
          focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void openTreeNode();
        },
      },
      {
        id: "toggleHiddenFiles",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key === ".",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          toggleHiddenFiles();
        },
      },
      {
        id: "refreshOrApplySearchSort",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "r",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          if (isSearchMode) {
            applySearchResultsSort();
            return;
          }
          void refreshDirectory();
        },
      },
      {
        id: "copyPath",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          keyboardEvent.altKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          keyboardEvent.code === "KeyC",
        run: (keyboardEvent) => {
          const pathsToCopy =
            contextMenuState && contextMenuState.paths.length > 0
              ? contextMenuState.paths
              : focusedPane === "tree" && selectedTreeTargetPath
                ? [selectedTreeTargetPath]
              : selectedPathsInViewOrder.length > 0
                ? selectedPathsInViewOrder
                : [];
          if (pathsToCopy.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          void runCopyPathAction(pathsToCopy);
        },
      },
      {
        id: "openInTerminal",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "t",
        run: (keyboardEvent) => {
          const pathsToOpen = resolveOpenInTerminalPaths({
            focusedPane,
            lastFocusedPane: lastExplorerFocusPaneRef.current,
            contextMenuPaths: contextMenuState?.paths ?? [],
            selectedContentPaths: selectedPathsInViewOrder,
            selectedTreePath: selectedTreeTargetPath,
            currentPath,
          });
          const firstPath = pathsToOpen[0];
          if (!firstPath) {
            return;
          }
          keyboardEvent.preventDefault();
          void openPathInTerminal(firstPath);
        },
      },
      {
        id: "moveSelection",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          keyboardEvent.shiftKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "m",
        run: (keyboardEvent) => {
          const paths = resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          openMoveDialog(paths);
        },
      },
      {
        id: "newFolder",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          keyboardEvent.shiftKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "n",
        run: (keyboardEvent) => {
          const targetPath = resolveNewFolderTargetPath({
            currentPath,
            selectedEntry,
            selectedPaths: selectedPathsInViewOrder,
            isSearchMode,
          });
          if (!targetPath) {
            return;
          }
          keyboardEvent.preventDefault();
          openNewFolderDialog(targetPath);
        },
      },
      {
        id: "openLocationSheet",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          keyboardEvent.shiftKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "g",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          openLocationSheet();
        },
      },
      {
        id: "toggleInfoRow",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          keyboardEvent.shiftKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "i",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          setInfoRowOpen((value) => !value);
        },
      },
      {
        id: "toggleInfoPanel",
        matches: (keyboardEvent) =>
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.shiftKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "i",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          setInfoPanelOpen((value) => !value);
        },
      },
      {
        id: "pagedScrollBackward",
        matches: (keyboardEvent) =>
          keyboardEvent.ctrlKey &&
          !keyboardEvent.metaKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "u",
        run: (keyboardEvent) => {
          const didHandle = handlePagedPaneScroll("backward");
          if (!didHandle) {
            return;
          }
          keyboardEvent.preventDefault();
        },
      },
      {
        id: "pagedScrollForward",
        matches: (keyboardEvent) =>
          keyboardEvent.ctrlKey &&
          !keyboardEvent.metaKey &&
          !keyboardEvent.altKey &&
          keyboardEvent.key.toLowerCase() === "d",
        run: (keyboardEvent) => {
          const didHandle = handlePagedPaneScroll("forward");
          if (!didHandle) {
            return;
          }
          keyboardEvent.preventDefault();
        },
      },
      {
        id: "typeahead",
        matches: (keyboardEvent) =>
          typeaheadEnabled &&
          !keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          (focusedPane === "tree" || focusedPane === "content") &&
          isTypeaheadCharacterKey(keyboardEvent.key),
        run: (keyboardEvent) => {
          if (focusedPane !== "tree" && focusedPane !== "content") {
            return;
          }
          keyboardEvent.preventDefault();
          handleTypeaheadInput(keyboardEvent.key, focusedPane);
        },
      },
      {
        id: "treeArrowNavigation",
        matches: (keyboardEvent) =>
          !keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          (keyboardEvent.key === "ArrowUp" ||
            keyboardEvent.key === "ArrowDown" ||
            keyboardEvent.key === "ArrowLeft" ||
            keyboardEvent.key === "ArrowRight" ||
            keyboardEvent.key === "Home" ||
            keyboardEvent.key === "End") &&
          focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void handleTreeKeyboardAction(
            keyboardEvent.key as
              | "ArrowUp"
              | "ArrowDown"
              | "ArrowLeft"
              | "ArrowRight"
              | "Home"
              | "End",
          );
        },
      },
      {
        id: "contentArrowNavigation",
        matches: (keyboardEvent) =>
          !keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          (keyboardEvent.key === "ArrowUp" ||
            keyboardEvent.key === "ArrowDown" ||
            keyboardEvent.key === "ArrowLeft" ||
            keyboardEvent.key === "ArrowRight" ||
            keyboardEvent.key === "Home" ||
            keyboardEvent.key === "End") &&
          focusedPane === "content",
        run: (keyboardEvent) => {
          if (activeContentEntries.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          const currentIndex = activeContentEntries.findIndex(
            (entry) => entry.path === contentSelection.leadPath,
          );
          const nextIndex = getNextSelectionIndex({
            itemCount: activeContentEntries.length,
            currentIndex,
            key: keyboardEvent.key as
              | "ArrowUp"
              | "ArrowDown"
              | "ArrowLeft"
              | "ArrowRight"
              | "Home"
              | "End",
            columns: isSearchMode ? 1 : viewMode === "list" ? contentColumns : 1,
            viewMode: isSearchMode ? "details" : viewMode,
          });
          const nextEntry = activeContentEntries[nextIndex];
          if (!nextEntry) {
            return;
          }
          if (keyboardEvent.shiftKey) {
            extendContentSelectionToPath(nextEntry.path);
            return;
          }
          setSingleContentSelection(nextEntry.path);
        },
      },
      {
        id: "treeEnter",
        matches: (keyboardEvent) => keyboardEvent.key === "Enter" && focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void openTreeNode();
        },
      },
      {
        id: "contentEnter",
        matches: (keyboardEvent) =>
          keyboardEvent.key === "Enter" && focusedPane === "content" && selectedEntry !== null,
        run: (keyboardEvent) => {
          if (!selectedEntry) {
            return;
          }
          keyboardEvent.preventDefault();
          const pathsToActivate =
            selectedPathsInViewOrder.length > 0 ? selectedPathsInViewOrder : [selectedEntry.path];
          void activateContentPaths(pathsToActivate);
        },
      },
    ],
    [
      activeContentEntries,
      applySearchResultsSort,
      contentColumns,
      contentSelection.leadPath,
      contextMenuState,
      currentPath,
      focusedPane,
      handlePagedPaneScroll,
      handleTypeaheadInput,
      hasCachedSearch,
      isSearchMode,
      navigateTo,
      openLocationSheet,
      openMoveDialog,
      openNewFolderDialog,
      openRenameDialog,
      openTreeNode,
      refreshDirectory,
      resolveContentActionPaths,
      runCopyClipboardAction,
      runCopyPathAction,
      selectedTreeTargetPath,
      selectedEntry,
      selectedPathsInViewOrder,
      showCachedSearchResults,
      startDuplicatePaths,
      startPasteFromClipboard,
      startTrashPaths,
      tabSwitchesExplorerPanes,
      toggleHiddenFiles,
      typeaheadEnabled,
      viewMode,
      focusFileSearch,
      goBack,
      goForward,
      selectAllContentEntries,
      setSingleContentSelection,
      activateContentPaths,
      extendContentSelectionToPath,
      handleTreeKeyboardAction,
      navigateTreeSelectionToParent,
      setFocusedPane,
      setInfoPanelOpen,
      setInfoRowOpen,
    ],
  );

  const performNativeEditAction = (action: "cut" | "copy" | "paste" | "selectAll"): void => {
    void client.invoke("system:performEditAction", { action });
  };

  const runGenericEditCommand = (
    command: "editCut" | "editCopy" | "editPaste" | "editSelectAll",
  ): void => {
    const targetType = resolveFocusedEditTarget(document.activeElement);
    if (targetType === "editable-text") {
      performNativeEditAction(
        command === "editCut"
          ? "cut"
          : command === "editCopy"
            ? "copy"
            : command === "editPaste"
              ? "paste"
              : "selectAll",
      );
      return;
    }

    if (targetType === "readonly-text") {
      if (command === "editCopy" || command === "editSelectAll") {
        performNativeEditAction(command === "editCopy" ? "copy" : "selectAll");
      }
      return;
    }

    if (command === "editSelectAll") {
      if (canHandleExplorerKeyboardShortcuts(shortcutContext) && focusedPane === "content") {
        selectAllContentEntries();
      }
      return;
    }

    const fallbackCommand =
      command === "editCopy"
        ? "copySelection"
        : command === "editCut"
          ? "cutSelection"
          : "pasteSelection";
    if (!canHandleRendererCommand(fallbackCommand, shortcutContext)) {
      return;
    }

    if (fallbackCommand === "copySelection") {
      void runCopyClipboardAction("copy");
      return;
    }
    if (fallbackCommand === "cutSelection") {
      void runCopyClipboardAction("cut");
      return;
    }
    void startPasteFromClipboard();
  };

  useEffect(() => {
    const unsubscribe = client.onCommand((command) => {
      if (
        command.type === "editCut" ||
        command.type === "editCopy" ||
        command.type === "editPaste" ||
        command.type === "editSelectAll"
      ) {
        runGenericEditCommand(command.type);
        return;
      }
      if (!canHandleRendererCommand(command.type, shortcutContext)) {
        return;
      }
      if (command.type === "openSelection") {
        const pathsToOpen = resolveOpenSelectionPaths({
          focusedPane,
          lastFocusedPane: lastExplorerFocusPaneRef.current,
          contextMenuPaths: contextMenuState?.paths ?? [],
          selectedContentPaths: selectedPathsInViewOrder,
          selectedTreePath: selectedTreeTargetPath,
          currentPath,
        });
        const firstPath = pathsToOpen[0];
        if (focusedPane === "tree" && firstPath) {
          if (shortcutContext.selectedTreeTargetKind === "favorite") {
            void navigateFavoritePath(firstPath, "push");
            return;
          }
          if (shortcutContext.selectedTreeTargetKind === "filesystemFolder") {
            void navigateTreeFileSystemPath(firstPath, "push");
            return;
          }
        }
        if (pathsToOpen.length > 0) {
          void openPaths(pathsToOpen);
        }
        return;
      }
      if (command.type === "editSelection") {
        const pathsToEdit = resolveEditSelectionPaths({
          focusedPane,
          lastFocusedPane: lastExplorerFocusPaneRef.current,
          contextMenuPaths: contextMenuState?.paths ?? [],
          selectedContentPaths: selectedPathsInViewOrder,
          selectedTreePath: selectedTreeTargetPath,
        });
        if (pathsToEdit.length > 0) {
          void editPaths(pathsToEdit);
        }
        return;
      }
      if (command.type === "openInTerminal") {
        const pathsToOpen = resolveOpenInTerminalPaths({
          focusedPane,
          lastFocusedPane: lastExplorerFocusPaneRef.current,
          contextMenuPaths: contextMenuState?.paths ?? [],
          selectedContentPaths: selectedPathsInViewOrder,
          selectedTreePath: selectedTreeTargetPath,
          currentPath,
        });
        const firstPath = pathsToOpen[0];
        if (firstPath) {
          void openPathInTerminal(firstPath);
        }
        return;
      }
      if (command.type === "moveSelection") {
        const paths = resolveContentActionPaths();
        if (paths.length > 0) {
          openMoveDialog(paths);
        }
        return;
      }
      if (command.type === "renameSelection") {
        const paths = resolveContentActionPaths();
        if (paths.length === 1) {
          openRenameDialog(paths);
        }
        return;
      }
      if (command.type === "duplicateSelection") {
        const paths = resolveContentActionPaths();
        if (paths.length > 0) {
          void startDuplicatePaths(paths);
        }
        return;
      }
      if (command.type === "newFolder") {
        const targetPath = resolveNewFolderTargetPath({
          currentPath,
          selectedEntry,
          selectedPaths: selectedPathsInViewOrder,
          isSearchMode,
        });
        if (targetPath) {
          openNewFolderDialog(targetPath);
        }
        return;
      }
      if (command.type === "trashSelection") {
        const paths = resolveContentActionPaths();
        if (paths.length > 0) {
          void startTrashPaths(paths);
        }
        return;
      }
      if (command.type === "copySelection") {
        void runCopyClipboardAction("copy");
        return;
      }
      if (command.type === "cutSelection") {
        void runCopyClipboardAction("cut");
        return;
      }
      if (command.type === "pasteSelection") {
        void startPasteFromClipboard();
        return;
      }
      if (command.type === "openLocationSheet") {
        openLocationSheet();
        return;
      }
      if (command.type === "openSettings") {
        openSettingsView();
        return;
      }
      if (command.type === "openActionLog") {
        openActionLogView();
        return;
      }
      if (command.type === "zoomIn") {
        setZoomPercent((value) => clampZoomPercent(value + 10));
        return;
      }
      if (command.type === "zoomOut") {
        setZoomPercent((value) => clampZoomPercent(value - 10));
        return;
      }
      if (command.type === "resetZoom") {
        setZoomPercent(100);
        return;
      }
      if (command.type === "copyPath") {
        const pathsToCopy =
          (contextMenuState?.paths.length ?? 0) > 0
            ? (contextMenuState?.paths ?? [])
            : focusedPane === "tree" && selectedTreeTargetPath
              ? [selectedTreeTargetPath]
            : selectedPathsInViewOrder.length > 0
              ? selectedPathsInViewOrder
              : [];
        if (pathsToCopy.length > 0) {
          void runCopyPathAction(pathsToCopy);
        }
        return;
      }
      if (command.type === "refreshOrApplySearchSort") {
        if (isSearchMode) {
          applySearchResultsSort();
          return;
        }
        void refreshDirectory();
        return;
      }
      if (command.type === "toggleInfoPanel") {
        setInfoPanelOpen((value) => !value);
        return;
      }
      if (command.type === "toggleInfoRow") {
        setInfoRowOpen((value) => !value);
        return;
      }
      if (command.type !== "focusFileSearch") {
        return;
      }
      setMainView("explorer");
      window.requestAnimationFrame(() => {
        searchPointerIntentRef.current = true;
        setFocusedPane(null);
        clearTypeahead();
        setSearchPopoverOpen(true);
        if (searchCommittedQueryRef.current.trim().length > 0) {
          setSearchResultsVisible(true);
          applyContentSelection(cachedSearchSelectionRef.current, searchResultEntries);
        }
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          searchPointerIntentRef.current = false;
        });
      });
    });
    return unsubscribe;
  }, [
    applyContentSelection,
    applySearchResultsSort,
    cachedSearchSelectionRef,
    clearTypeahead,
    client,
    contextMenuState,
    currentPath,
    editPaths,
    focusedPane,
    lastExplorerFocusPaneRef,
    isSearchMode,
    navigateFavoritePath,
    openLocationSheet,
    openMoveDialog,
    openNewFolderDialog,
    openPathInTerminal,
    openPaths,
    openRenameDialog,
    openSettingsView,
    openActionLogView,
    refreshDirectory,
    resolveContentActionPaths,
    runGenericEditCommand,
    runCopyClipboardAction,
    runCopyPathAction,
    selectedTreeTargetPath,
    searchCommittedQueryRef,
    searchInputRef,
    searchPointerIntentRef,
    searchResultEntries,
    selectedEntry,
    selectedPathsInViewOrder,
    setFocusedPane,
    setInfoPanelOpen,
    setInfoRowOpen,
    setMainView,
    setSearchPopoverOpen,
    setSearchResultsVisible,
    setZoomPercent,
    shortcutContext,
    startDuplicatePaths,
    startPasteFromClipboard,
    startTrashPaths,
    navigateTreeFileSystemPath,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target;
      const targetElement = target instanceof HTMLElement ? target : null;
      if (actionNotice) {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          dismissActionNotice();
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          return;
        }
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          return;
        }
        return;
      }
      if (event.key === "Escape" && contextMenuState) {
        event.preventDefault();
        setContextMenuState(null);
        return;
      }
      if (event.key === "Escape" && locationDialogOpen) {
        return;
      }
      if (event.key === "Escape" && mainView !== "explorer") {
        event.preventDefault();
        setMainView("explorer");
        return;
      }
      if (isKeyboardOwnedFormControl(target)) {
        return;
      }
      if (targetElement?.closest(".pathbar-editor-shell")) {
        return;
      }
      if (locationDialogOpen) {
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setMainView((value) => (value === "help" ? "explorer" : "help"));
        return;
      }
      if (
        event.metaKey &&
        event.key === "," &&
        canHandleRendererCommand("openSettings", shortcutContext)
      ) {
        event.preventDefault();
        openSettingsView();
        return;
      }
      if (copyPasteModalOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          handleCopyPasteDialogEscape();
          return;
        }
        if (targetElement?.closest(".copy-paste-dialog, .location-sheet")) {
          return;
        }
        event.preventDefault();
        return;
      }
      if (!canHandleExplorerKeyboardShortcuts(shortcutContext)) {
        return;
      }
      for (const rawShortcutBinding of rawShortcutBindings) {
        if (!rawShortcutBinding.matches(event)) {
          continue;
        }
        if (!canHandleRawExplorerShortcut(rawShortcutBinding.id, shortcutContext)) {
          return;
        }
        rawShortcutBinding.run(event);
        return;
      }
      if (event.key === "Escape" && focusedPane === "content" && isSearchMode) {
        event.preventDefault();
        hideSearchResults();
        focusContentPane();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    actionNotice,
    contextMenuState,
    copyPasteModalOpen,
    dismissActionNotice,
    focusedPane,
    focusContentPane,
    handleCopyPasteDialogEscape,
    hideSearchResults,
    isSearchMode,
    locationDialogOpen,
    mainView,
    openSettingsView,
    openActionLogView,
    rawShortcutBindings,
    setContextMenuState,
    setMainView,
    shortcutContext,
  ]);
}
