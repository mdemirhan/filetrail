import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { clampZoomPercent } from "../../shared/appPreferences";
import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ContentSelectionState } from "../lib/contentSelection";
import { resolveNewFolderTargetPath } from "../lib/explorerAppUtils";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { getNextSelectionIndex } from "../lib/explorerNavigation";
import type { DirectoryEntry } from "../lib/explorerTypes";
import { isKeyboardOwnedFormControl, resolveFocusedEditTarget } from "../lib/focusedEditTarget";
import {
  type RawExplorerShortcutId,
  type ShortcutContext,
  canHandleExplorerKeyboardShortcuts,
  canHandleRawExplorerShortcut,
  canHandleRendererCommand,
} from "../lib/shortcutPolicy";
import {
  resolveEditSelectionPaths,
  resolveOpenInTerminalPaths,
  resolveOpenSelectionPaths,
} from "../lib/shortcutTargets";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import type {
  ExplorerServices,
  NavigationStore,
  PreferencesStore,
  SearchStore,
  WriteOperationsStore,
} from "../state/explorerStores";

type RawShortcutBinding = {
  id: RawExplorerShortcutId;
  matches: (event: KeyboardEvent) => boolean;
  run: (event: KeyboardEvent) => void;
};

type ExplorerShortcutActions = {
  dismissActionNotice: () => void;
  handleCopyPasteDialogEscape: () => void;
  openActionLogView: () => void;
  openSettingsView: () => void;
  openLocationSheet: () => void;
  focusFileSearch: (selectContents?: boolean) => void;
  clearTypeahead: () => void;
  applyContentSelection: (selection: ContentSelectionState, entries: DirectoryEntry[]) => void;
  showCachedSearchResults: (options?: { focusPane?: boolean }) => void;
  hideSearchResults: () => void;
  goBack: () => void;
  goForward: () => void;
  navigateTo: (path: string, historyMode: "push" | "replace" | "skip") => Promise<boolean>;
  navigateTreeFileSystemPath: (
    path: string,
    historyMode: "push" | "replace" | "skip",
  ) => Promise<void>;
  navigateFavoritePath: (
    path: string,
    historyMode: "push" | "replace" | "skip",
  ) => Promise<boolean>;
  openTreeNode: () => Promise<void>;
  toggleHiddenFiles: () => void;
  refreshDirectory: (options?: {
    path?: string;
    treeSelectionPath?: string | null;
    extraTreeReloadPaths?: string[];
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
};

type UseExplorerShortcutsArgs = {
  services: ExplorerServices;
  navigation: NavigationStore;
  preferences: PreferencesStore;
  search: SearchStore;
  writeOperations: WriteOperationsStore;
  derived: {
    shortcutContext: ShortcutContext;
    copyPasteModalOpen: boolean;
    locationDialogOpen: boolean;
    searchResultEntries: DirectoryEntry[];
    selectedTreeTargetPath: string | null;
    selectedPathsInViewOrder: string[];
    selectedEntry: DirectoryEntry | null;
    activeContentEntries: DirectoryEntry[];
    isSearchMode: boolean;
    hasCachedSearch: boolean;
  };
  actions: ExplorerShortcutActions;
};

export function useExplorerShortcuts(args: UseExplorerShortcutsArgs) {
  const { services, navigation, preferences, search, writeOperations, derived, actions } = args;
  const { client } = services;

  // Flattened view of the grouped stores limited to the fields the shortcut
  // bindings consume. Shortcut handlers must observe the CURRENT state at
  // keypress time without forcing the bindings (and the window keydown
  // listener) to be rebuilt on every render, so the flattened snapshot is kept
  // in a ref and read through it at call time.
  const flatArgs = {
    treePaneRef: services.treePaneRef,
    contentPaneRef: services.contentPaneRef,
    searchInputRef: services.searchInputRef,
    mainView: navigation.mainView,
    setMainView: navigation.setMainView,
    focusedPane: navigation.focusedPane,
    setFocusedPane: navigation.setFocusedPane,
    lastExplorerFocusPaneRef: navigation.lastExplorerFocusPaneRef,
    currentPath: navigation.currentPath,
    contentSelection: navigation.contentSelection,
    contentColumns: navigation.contentColumns,
    setInfoPanelOpen: navigation.setInfoPanelOpen,
    setInfoRowOpen: navigation.setInfoRowOpen,
    tabSwitchesExplorerPanes: preferences.tabSwitchesExplorerPanes,
    typeaheadEnabled: preferences.typeaheadEnabled,
    viewMode: preferences.viewMode,
    setZoomPercent: preferences.setZoomPercent,
    setSearchPopoverOpen: search.setSearchPopoverOpen,
    setSearchResultsVisible: search.setSearchResultsVisible,
    searchPointerIntentRef: search.searchPointerIntentRef,
    searchCommittedQueryRef: search.searchCommittedQueryRef,
    cachedSearchSelectionRef: search.cachedSearchSelectionRef,
    actionNotice: writeOperations.actionNotice,
    contextMenuState: writeOperations.contextMenuState,
    setContextMenuState: writeOperations.setContextMenuState,
    ...derived,
    ...actions,
  };
  const latestArgsRef = useRef(flatArgs);
  useLayoutEffect(() => {
    latestArgsRef.current = flatArgs;
  });

  const isTreeFocusTarget = useCallback(
    (target: EventTarget | null): target is Node =>
      target instanceof Node && !!latestArgsRef.current.treePaneRef.current?.contains(target),
    [],
  );

  const isContentFocusTarget = useCallback(
    (target: EventTarget | null): target is Node =>
      target instanceof Node && !!latestArgsRef.current.contentPaneRef.current?.contains(target),
    [],
  );

  const focusTreePane = useCallback(() => {
    latestArgsRef.current.treePaneRef.current?.focus({ preventScroll: true });
  }, []);

  const focusContentPaneRef = useCallback(() => {
    latestArgsRef.current.contentPaneRef.current?.focus({ preventScroll: true });
  }, []);

  const getLastExplorerFocusPane = useCallback(
    () => latestArgsRef.current.lastExplorerFocusPaneRef.current,
    [],
  );

  const rawShortcutBindings = useMemo<readonly RawShortcutBinding[]>(
    () => [
      {
        id: "paneTabSwitch",
        matches: (keyboardEvent) => {
          const current = latestArgsRef.current;
          if (!current.tabSwitchesExplorerPanes || keyboardEvent.key !== "Tab") {
            return false;
          }
          const target = keyboardEvent.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const isAutocompleteContext =
            targetElement?.closest(".pathbar-editor-shell, .location-sheet-input-shell") !== null;
          if (isAutocompleteContext) {
            return false;
          }
          const treeFocusTarget = isTreeFocusTarget(target);
          const contentFocusTarget = isContentFocusTarget(target);
          return (
            treeFocusTarget ||
            contentFocusTarget ||
            (document.activeElement === document.body && current.focusedPane !== null)
          );
        },
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          const target = keyboardEvent.target;
          const treeFocusTarget = isTreeFocusTarget(target);
          keyboardEvent.preventDefault();
          if (treeFocusTarget || current.focusedPane === "tree") {
            focusContentPaneRef();
            current.setFocusedPane("content");
            return;
          }
          focusTreePane();
          current.setFocusedPane("tree");
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
          void latestArgsRef.current.runCopyClipboardAction("copy");
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
          void latestArgsRef.current.runCopyClipboardAction("cut");
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
          void latestArgsRef.current.startPasteFromClipboard();
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
          const current = latestArgsRef.current;
          const paths = current.resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          void current.startDuplicatePaths(paths);
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
          const current = latestArgsRef.current;
          const paths = current.resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          void current.startTrashPaths(paths);
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
          const current = latestArgsRef.current;
          const paths = current.resolveContentActionPaths();
          if (paths.length !== 1) {
            return;
          }
          keyboardEvent.preventDefault();
          current.openRenameDialog(paths);
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
          latestArgsRef.current.focusedPane === "content",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.selectAllContentEntries();
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
          focusTreePane();
          latestArgsRef.current.setFocusedPane("tree");
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
          focusContentPaneRef();
          latestArgsRef.current.setFocusedPane("content");
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
          latestArgsRef.current.hasCachedSearch,
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.showCachedSearchResults({ focusPane: true });
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
          latestArgsRef.current.focusFileSearch(true);
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
          latestArgsRef.current.goBack();
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
          latestArgsRef.current.goForward();
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
          latestArgsRef.current.focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void latestArgsRef.current.navigateTreeSelectionToParent();
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
          latestArgsRef.current.focusedPane === "content",
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          keyboardEvent.preventDefault();
          const nextPath = parentDirectoryPath(current.currentPath);
          if (nextPath) {
            void current.navigateTo(nextPath, "push");
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
          latestArgsRef.current.focusedPane === "content" &&
          latestArgsRef.current.selectedEntry !== null,
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          if (!current.selectedEntry) {
            return;
          }
          keyboardEvent.preventDefault();
          const pathsToActivate =
            current.selectedPathsInViewOrder.length > 0
              ? current.selectedPathsInViewOrder
              : [current.selectedEntry.path];
          void current.activateContentPaths(pathsToActivate);
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
          latestArgsRef.current.focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void latestArgsRef.current.openTreeNode();
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
          latestArgsRef.current.toggleHiddenFiles();
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
          const current = latestArgsRef.current;
          keyboardEvent.preventDefault();
          if (current.isSearchMode) {
            current.applySearchResultsSort();
            return;
          }
          void current.refreshDirectory();
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
          const current = latestArgsRef.current;
          const pathsToCopy =
            current.contextMenuState && current.contextMenuState.paths.length > 0
              ? current.contextMenuState.paths
              : current.focusedPane === "tree" && current.selectedTreeTargetPath
                ? [current.selectedTreeTargetPath]
                : current.selectedPathsInViewOrder.length > 0
                  ? current.selectedPathsInViewOrder
                  : [];
          if (pathsToCopy.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          void current.runCopyPathAction(pathsToCopy);
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
          const current = latestArgsRef.current;
          const pathsToOpen = resolveOpenInTerminalPaths({
            focusedPane: current.focusedPane,
            lastFocusedPane: getLastExplorerFocusPane(),
            contextMenuPaths: current.contextMenuState?.paths ?? [],
            selectedContentPaths: current.selectedPathsInViewOrder,
            selectedTreePath: current.selectedTreeTargetPath,
            currentPath: current.currentPath,
          });
          const firstPath = pathsToOpen[0];
          if (!firstPath) {
            return;
          }
          keyboardEvent.preventDefault();
          void current.openPathInTerminal(firstPath);
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
          const current = latestArgsRef.current;
          const paths = current.resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          current.openMoveDialog(paths);
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
          const current = latestArgsRef.current;
          const targetPath = resolveNewFolderTargetPath({
            currentPath: current.currentPath,
            selectedEntry: current.selectedEntry,
            selectedPaths: current.selectedPathsInViewOrder,
            isSearchMode: current.isSearchMode,
          });
          if (!targetPath) {
            return;
          }
          keyboardEvent.preventDefault();
          current.openNewFolderDialog(targetPath);
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
          latestArgsRef.current.openLocationSheet();
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
          latestArgsRef.current.setInfoRowOpen((value) => !value);
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
          latestArgsRef.current.setInfoPanelOpen((value) => !value);
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
          const didHandle = latestArgsRef.current.handlePagedPaneScroll("backward");
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
          const didHandle = latestArgsRef.current.handlePagedPaneScroll("forward");
          if (!didHandle) {
            return;
          }
          keyboardEvent.preventDefault();
        },
      },
      {
        id: "typeahead",
        matches: (keyboardEvent) =>
          latestArgsRef.current.typeaheadEnabled &&
          !keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          (latestArgsRef.current.focusedPane === "tree" ||
            latestArgsRef.current.focusedPane === "content") &&
          isTypeaheadCharacterKey(keyboardEvent.key),
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          if (current.focusedPane !== "tree" && current.focusedPane !== "content") {
            return;
          }
          keyboardEvent.preventDefault();
          current.handleTypeaheadInput(keyboardEvent.key, current.focusedPane);
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
          latestArgsRef.current.focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void latestArgsRef.current.handleTreeKeyboardAction(
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
          latestArgsRef.current.focusedPane === "content",
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          if (current.activeContentEntries.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          const currentIndex = current.activeContentEntries.findIndex(
            (entry) => entry.path === current.contentSelection.leadPath,
          );
          const nextIndex = getNextSelectionIndex({
            itemCount: current.activeContentEntries.length,
            currentIndex,
            key: keyboardEvent.key as
              | "ArrowUp"
              | "ArrowDown"
              | "ArrowLeft"
              | "ArrowRight"
              | "Home"
              | "End",
            columns: current.isSearchMode
              ? 1
              : current.viewMode === "list"
                ? current.contentColumns
                : 1,
            viewMode: current.isSearchMode ? "details" : current.viewMode,
          });
          const nextEntry = current.activeContentEntries[nextIndex];
          if (!nextEntry) {
            return;
          }
          if (keyboardEvent.shiftKey) {
            current.extendContentSelectionToPath(nextEntry.path);
            return;
          }
          current.setSingleContentSelection(nextEntry.path);
        },
      },
      {
        id: "treeEnter",
        matches: (keyboardEvent) =>
          keyboardEvent.key === "Enter" && latestArgsRef.current.focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void latestArgsRef.current.openTreeNode();
        },
      },
      {
        id: "contentEnter",
        matches: (keyboardEvent) =>
          keyboardEvent.key === "Enter" &&
          latestArgsRef.current.focusedPane === "content" &&
          latestArgsRef.current.selectedEntry !== null,
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          if (!current.selectedEntry) {
            return;
          }
          keyboardEvent.preventDefault();
          const pathsToActivate =
            current.selectedPathsInViewOrder.length > 0
              ? current.selectedPathsInViewOrder
              : [current.selectedEntry.path];
          void current.activateContentPaths(pathsToActivate);
        },
      },
    ],
    [
      focusContentPaneRef,
      focusTreePane,
      getLastExplorerFocusPane,
      isContentFocusTarget,
      isTreeFocusTarget,
    ],
  );

  const performNativeEditAction = useCallback(
    (action: "cut" | "copy" | "paste" | "selectAll"): void => {
      void client.invoke("system:performEditAction", { action });
    },
    [client],
  );

  const runGenericEditCommand = useCallback(
    (command: "editCut" | "editCopy" | "editPaste" | "editSelectAll"): void => {
      const current = latestArgsRef.current;
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
        if (
          canHandleExplorerKeyboardShortcuts(current.shortcutContext) &&
          current.focusedPane === "content"
        ) {
          current.selectAllContentEntries();
        }
        return;
      }

      const fallbackCommand =
        command === "editCopy"
          ? "copySelection"
          : command === "editCut"
            ? "cutSelection"
            : "pasteSelection";
      if (!canHandleRendererCommand(fallbackCommand, current.shortcutContext)) {
        return;
      }

      if (fallbackCommand === "copySelection") {
        void current.runCopyClipboardAction("copy");
        return;
      }
      if (fallbackCommand === "cutSelection") {
        void current.runCopyClipboardAction("cut");
        return;
      }
      void current.startPasteFromClipboard();
    },
    [performNativeEditAction],
  );

  const runRendererCommand = useCallback(
    (commandType: RendererCommandType) => {
      const current = latestArgsRef.current;
      if (
        commandType === "editCut" ||
        commandType === "editCopy" ||
        commandType === "editPaste" ||
        commandType === "editSelectAll"
      ) {
        runGenericEditCommand(commandType);
        return;
      }
      if (!canHandleRendererCommand(commandType, current.shortcutContext)) {
        return;
      }
      if (commandType === "openSelection") {
        const pathsToOpen = resolveOpenSelectionPaths({
          focusedPane: current.focusedPane,
          lastFocusedPane: current.lastExplorerFocusPaneRef.current,
          contextMenuPaths: current.contextMenuState?.paths ?? [],
          selectedContentPaths: current.selectedPathsInViewOrder,
          selectedTreePath: current.selectedTreeTargetPath,
          currentPath: current.currentPath,
        });
        const firstPath = pathsToOpen[0];
        if (current.focusedPane === "tree" && firstPath) {
          if (current.shortcutContext.selectedTreeTargetKind === "favorite") {
            void current.navigateFavoritePath(firstPath, "push");
            return;
          }
          if (current.shortcutContext.selectedTreeTargetKind === "filesystemFolder") {
            void current.navigateTreeFileSystemPath(firstPath, "push");
            return;
          }
        }
        if (pathsToOpen.length > 0) {
          void current.openPaths(pathsToOpen);
        }
        return;
      }
      if (commandType === "editSelection") {
        const pathsToEdit = resolveEditSelectionPaths({
          focusedPane: current.focusedPane,
          lastFocusedPane: current.lastExplorerFocusPaneRef.current,
          contextMenuPaths: current.contextMenuState?.paths ?? [],
          selectedContentPaths: current.selectedPathsInViewOrder,
          selectedTreePath: current.selectedTreeTargetPath,
        });
        if (pathsToEdit.length > 0) {
          void current.editPaths(pathsToEdit);
        }
        return;
      }
      if (commandType === "openInTerminal") {
        const pathsToOpen = resolveOpenInTerminalPaths({
          focusedPane: current.focusedPane,
          lastFocusedPane: current.lastExplorerFocusPaneRef.current,
          contextMenuPaths: current.contextMenuState?.paths ?? [],
          selectedContentPaths: current.selectedPathsInViewOrder,
          selectedTreePath: current.selectedTreeTargetPath,
          currentPath: current.currentPath,
        });
        const firstPath = pathsToOpen[0];
        if (firstPath) {
          void current.openPathInTerminal(firstPath);
        }
        return;
      }
      if (commandType === "moveSelection") {
        const paths = current.resolveContentActionPaths();
        if (paths.length > 0) {
          current.openMoveDialog(paths);
        }
        return;
      }
      if (commandType === "renameSelection") {
        const paths = current.resolveContentActionPaths();
        if (paths.length === 1) {
          current.openRenameDialog(paths);
        }
        return;
      }
      if (commandType === "duplicateSelection") {
        const paths = current.resolveContentActionPaths();
        if (paths.length > 0) {
          void current.startDuplicatePaths(paths);
        }
        return;
      }
      if (commandType === "newFolder") {
        const targetPath = resolveNewFolderTargetPath({
          currentPath: current.currentPath,
          selectedEntry: current.selectedEntry,
          selectedPaths: current.selectedPathsInViewOrder,
          isSearchMode: current.isSearchMode,
        });
        if (targetPath) {
          current.openNewFolderDialog(targetPath);
        }
        return;
      }
      if (commandType === "trashSelection") {
        const paths = current.resolveContentActionPaths();
        if (paths.length > 0) {
          void current.startTrashPaths(paths);
        }
        return;
      }
      if (commandType === "copySelection") {
        void current.runCopyClipboardAction("copy");
        return;
      }
      if (commandType === "cutSelection") {
        void current.runCopyClipboardAction("cut");
        return;
      }
      if (commandType === "pasteSelection") {
        void current.startPasteFromClipboard();
        return;
      }
      if (commandType === "openLocationSheet") {
        current.openLocationSheet();
        return;
      }
      if (commandType === "openSettings") {
        current.openSettingsView();
        return;
      }
      if (commandType === "openActionLog") {
        current.openActionLogView();
        return;
      }
      if (commandType === "zoomIn") {
        current.setZoomPercent((value) => clampZoomPercent(value + 10));
        return;
      }
      if (commandType === "zoomOut") {
        current.setZoomPercent((value) => clampZoomPercent(value - 10));
        return;
      }
      if (commandType === "resetZoom") {
        current.setZoomPercent(100);
        return;
      }
      if (commandType === "copyPath") {
        const pathsToCopy =
          (current.contextMenuState?.paths.length ?? 0) > 0
            ? (current.contextMenuState?.paths ?? [])
            : current.focusedPane === "tree" && current.selectedTreeTargetPath
              ? [current.selectedTreeTargetPath]
              : current.selectedPathsInViewOrder.length > 0
                ? current.selectedPathsInViewOrder
                : [];
        if (pathsToCopy.length > 0) {
          void current.runCopyPathAction(pathsToCopy);
        }
        return;
      }
      if (commandType === "refreshOrApplySearchSort") {
        if (current.isSearchMode) {
          current.applySearchResultsSort();
          return;
        }
        void current.refreshDirectory();
        return;
      }
      if (commandType === "toggleInfoPanel") {
        current.setInfoPanelOpen((value) => !value);
        return;
      }
      if (commandType === "toggleInfoRow") {
        current.setInfoRowOpen((value) => !value);
        return;
      }
      if (commandType !== "focusFileSearch") {
        return;
      }
      current.setMainView("explorer");
      window.requestAnimationFrame(() => {
        const latest = latestArgsRef.current;
        latest.searchPointerIntentRef.current = true;
        latest.setFocusedPane(null);
        latest.clearTypeahead();
        latest.setSearchPopoverOpen(true);
        if (latest.searchCommittedQueryRef.current.trim().length > 0) {
          latest.setSearchResultsVisible(true);
          latest.applyContentSelection(
            latest.cachedSearchSelectionRef.current,
            latest.searchResultEntries,
          );
        }
        window.requestAnimationFrame(() => {
          latest.searchInputRef.current?.focus();
          latest.searchInputRef.current?.select();
          latest.searchPointerIntentRef.current = false;
        });
      });
    },
    [runGenericEditCommand],
  );

  useEffect(() => {
    const unsubscribe = client.onCommand((command) => {
      runRendererCommand(command.type);
    });
    return unsubscribe;
  }, [client, runRendererCommand]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latestArgsRef.current;
      if (event.defaultPrevented) {
        return;
      }
      const target = event.target;
      const targetElement = target instanceof HTMLElement ? target : null;
      if (current.actionNotice) {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          current.dismissActionNotice();
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
      if (event.key === "Escape" && current.contextMenuState) {
        event.preventDefault();
        current.setContextMenuState(null);
        return;
      }
      if (event.key === "Escape" && current.locationDialogOpen) {
        return;
      }
      if (event.key === "Escape" && current.mainView !== "explorer") {
        event.preventDefault();
        current.setMainView("explorer");
        return;
      }
      if (isKeyboardOwnedFormControl(target)) {
        return;
      }
      if (targetElement?.closest(".pathbar-editor-shell")) {
        return;
      }
      if (current.locationDialogOpen) {
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        current.setMainView((value) => (value === "help" ? "explorer" : "help"));
        return;
      }
      if (
        event.metaKey &&
        event.key === "," &&
        canHandleRendererCommand("openSettings", current.shortcutContext)
      ) {
        event.preventDefault();
        current.openSettingsView();
        return;
      }
      if (current.copyPasteModalOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          current.handleCopyPasteDialogEscape();
          return;
        }
        if (targetElement?.closest(".copy-paste-dialog, .location-sheet")) {
          return;
        }
        event.preventDefault();
        return;
      }
      if (!canHandleExplorerKeyboardShortcuts(current.shortcutContext)) {
        return;
      }
      for (const rawShortcutBinding of rawShortcutBindings) {
        if (!rawShortcutBinding.matches(event)) {
          continue;
        }
        if (!canHandleRawExplorerShortcut(rawShortcutBinding.id, current.shortcutContext)) {
          return;
        }
        rawShortcutBinding.run(event);
        return;
      }
      if (event.key === "Escape" && current.focusedPane === "content" && current.isSearchMode) {
        event.preventDefault();
        current.hideSearchResults();
        current.focusContentPane();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rawShortcutBindings]);

  return {
    runRendererCommand,
  };
}
