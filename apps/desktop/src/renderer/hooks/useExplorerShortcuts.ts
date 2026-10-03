import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { clampZoomPercent } from "../../shared/appPreferences";
import { RENDERER_COMMAND_TYPES, type RendererCommandType } from "../../shared/rendererCommands";
import {
  type ResolvedShortcuts,
  type ShortcutCommandId,
  getMenuShortcut,
  isShortcutCommandId,
  isTextEditingShortcut,
  shortcutFromKeyboardEvent,
} from "../../shared/shortcuts";
import type { ContentSelectionState } from "../lib/contentSelection";
import { isDirectoryLikeEntry, resolveNewFolderTargetPath } from "../lib/explorerAppUtils";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { getNextSelectionIndex } from "../lib/explorerNavigation";
import type { DirectoryEntry } from "../lib/explorerTypes";
import { isKeyboardOwnedFormControl, resolveFocusedEditTarget } from "../lib/focusedEditTarget";
import type { HelpTopicId } from "../lib/helpContent";
import {
  resolveFavoriteTargetPath,
  resolveNewTabTargetPath,
  resolveShowInFinderPaths,
} from "../lib/rendererCommandAvailability";
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
  resolveRootTreeTargetPath,
} from "../lib/shortcutTargets";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import type {
  ExplorerServices,
  NavigationStore,
  PreferencesStore,
  SearchStore,
  WriteOperationsStore,
} from "../state/explorerStores";

// Every modal marks itself with aria-modal; the class names cover older dialogs.
const MODAL_KEYBOARD_OWNER_SELECTOR = '[aria-modal="true"], .copy-paste-dialog';

// Cmd+. is the macOS "cancel" shortcut and closes a dialog just like Escape.
function isModalCancelKey(event: KeyboardEvent): boolean {
  if (event.key === "Escape") {
    return true;
  }
  return event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key === ".";
}

// How long after a key press a menu command still counts as chosen by that key.
const MENU_SHORTCUT_WINDOW_MS = 500;

const RENDERER_COMMANDS = new Set<string>(RENDERER_COMMAND_TYPES);

function isRendererCommand(
  command: ShortcutCommandId,
): command is ShortcutCommandId & RendererCommandType {
  return RENDERER_COMMANDS.has(command);
}

function isShortcutCommand(
  command: RendererCommandType,
): command is RendererCommandType & ShortcutCommandId {
  return isShortcutCommandId(command);
}

const SORT_COMMAND_KEYS = {
  sortByName: "name",
  sortByModified: "modified",
  sortBySize: "size",
  sortByKind: "kind",
} as const;

// A key the window acts on itself. One that belongs to a command is triggered by whatever
// keys the command has (Settings → Shortcuts); the others are the keyboard's own way of
// moving around and typing, and look at the key pressed.
type RawShortcutBinding = {
  id: RawExplorerShortcutId;
  command?: ShortcutCommandId;
  // What must also hold for the binding to take the key.
  matches?: (event: KeyboardEvent) => boolean;
  run: (event: KeyboardEvent) => void;
};

type ExplorerShortcutActions = {
  dismissActionNotice: () => void;
  handleCopyPasteDialogEscape: () => void;
  openSettingsView: () => void;
  openLocationSheet: () => void;
  focusFileSearch: (selectContents?: boolean) => void;
  clearTypeahead: () => void;
  showCachedSearchResults: (options?: { focusPane?: boolean; fromField?: boolean }) => void;
  hideSearchResults: () => void;
  goBack: () => void;
  goForward: () => void;
  goHomeAndRootTree: () => void;
  rootTreeAtPath: (path: string) => void;
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
  rerunSearch: () => void;
  runCopyClipboardAction: (mode: "copy" | "cut") => Promise<void>;
  showClipboard: () => void;
  clearClipboard: () => void;
  startPasteFromClipboard: () => Promise<void>;
  resolveContentActionPaths: () => string[];
  startDuplicateOfSelection: (paths: string[]) => void;
  startTrashPaths: (paths: string[]) => Promise<void>;
  requestDeleteImmediately: (paths: string[]) => void;
  requestEmptyTrash: () => void;
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
  eraseListFilterCharacter: () => void;
  clearListFilter: () => void;
  listFilterTakesSpace: () => boolean;
  handleTreeKeyboardAction: (
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
  ) => Promise<boolean>;
  navigateTreeSelectionToParent: () => Promise<void>;
  activateContentPaths: (paths: string[]) => Promise<void>;
  extendContentSelectionToPath: (path: string, additive?: boolean) => void;
  setSingleContentSelection: (path: string) => void;
  selectAllContentEntries: () => void;
  openNewTab: () => void;
  reopenClosedTab: () => void;
  closeTab: () => void;
  activateAdjacentTab: (direction: "next" | "previous") => void;
  openFolderInNewTab: (path: string) => Promise<void>;
  toggleFavoritePath: (path: string) => void;
  showPathsInFinder: (paths: string[]) => Promise<void>;
  handleSortChange: (sortBy: "name" | "modified" | "size" | "kind") => void;
  toggleFoldersFirst: () => void;
  openHelp: (topic?: HelpTopicId) => void;
};

type UseExplorerShortcutsArgs = {
  services: ExplorerServices;
  navigation: NavigationStore;
  preferences: PreferencesStore;
  search: SearchStore;
  writeOperations: WriteOperationsStore;
  derived: {
    // The keys every command has, as chosen in Settings → Shortcuts.
    shortcuts: ResolvedShortcuts;
    shortcutContext: ShortcutContext;
    copyPasteModalOpen: boolean;
    preparingSheetOpen: boolean;
    locationDialogOpen: boolean;
    selectedTreeTargetPath: string | null;
    selectedPathsInViewOrder: string[];
    selectedEntry: DirectoryEntry | null;
    activeContentEntries: DirectoryEntry[];
    isSearchMode: boolean;
    hasCachedSearch: boolean;
    trashPath: string | null;
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
    listFilterActive: navigation.listFilterQuery.length > 0,
    returnKeyAction: preferences.returnKeyAction,
    viewMode: preferences.viewMode,
    setViewMode: preferences.setViewMode,
    setZoomPercent: preferences.setZoomPercent,
    actionNotice: writeOperations.actionNotice,
    contextMenuState: writeOperations.contextMenuState,
    setContextMenuState: writeOperations.setContextMenuState,
    ...derived,
    ...actions,
    quickLookPath: (path: string) => {
      void services.client.invoke("system:quickLook", { path }).catch(() => undefined);
    },
    selectionLeadOrSelectedPath: () =>
      navigation.contentSelection.leadPath ?? derived.selectedEntry?.path ?? null,
    rootTreeAtSelection: () => {
      const contextMenu = writeOperations.contextMenuState;
      const selectedContentEntry =
        derived.selectedPathsInViewOrder.length === 1
          ? (derived.activeContentEntries.find(
              (entry) => entry.path === derived.selectedPathsInViewOrder[0],
            ) ?? null)
          : null;
      const targetPath = resolveRootTreeTargetPath({
        focusedPane: navigation.focusedPane,
        lastFocusedPane: navigation.lastExplorerFocusPaneRef.current,
        contextMenuFolderPath:
          contextMenu?.surface === "treeFolder" || contextMenu?.surface === "favorite"
            ? contextMenu.targetPath
            : null,
        selectedContentFolderPath: isDirectoryLikeEntry(selectedContentEntry)
          ? selectedContentEntry.path
          : null,
        selectedTreePath: derived.selectedTreeTargetPath,
        currentPath: navigation.currentPath,
      });
      if (targetPath) {
        actions.rootTreeAtPath(targetPath);
      }
    },
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
          if (keyboardEvent.key !== "Tab") {
            return false;
          }
          // ⌃Tab moves between tabs.
          if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) {
            return false;
          }
          const target = keyboardEvent.target;
          const targetElement = target instanceof HTMLElement ? target : null;
          const isAutocompleteContext =
            targetElement?.closest(".pathbar-editor-shell, .go-to-folder-input-shell") !== null;
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
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
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
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
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
          keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
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
        command: "duplicateSelection",
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          const paths = current.resolveContentActionPaths();
          if (paths.length === 0) {
            return;
          }
          keyboardEvent.preventDefault();
          current.startDuplicateOfSelection(paths);
        },
      },
      {
        id: "trashSelection",
        command: "trashSelection",
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
        command: "renameSelection",
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
        command: "focusTreePane",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          focusTreePane();
          latestArgsRef.current.setFocusedPane("tree");
        },
      },
      {
        id: "focusContentPane",
        command: "focusContentPane",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          focusContentPaneRef();
          latestArgsRef.current.setFocusedPane("content");
        },
      },
      {
        id: "showCachedSearchResults",
        command: "showLastSearchResults",
        matches: () => latestArgsRef.current.hasCachedSearch,
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.showCachedSearchResults({ focusPane: true });
        },
      },
      {
        id: "focusFileSearch",
        command: "focusFileSearch",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.focusFileSearch(true);
        },
      },
      {
        id: "historyBack",
        command: "goBack",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.goBack();
        },
      },
      {
        id: "historyForward",
        command: "goForward",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.goForward();
        },
      },
      {
        id: "openParentTree",
        command: "goEnclosingFolder",
        matches: () => latestArgsRef.current.focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void latestArgsRef.current.navigateTreeSelectionToParent();
        },
      },
      {
        id: "openParentContent",
        command: "goEnclosingFolder",
        matches: () => latestArgsRef.current.focusedPane === "content",
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
        command: "openSelectedItem",
        matches: () =>
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
        command: "openSelectedItem",
        matches: () => latestArgsRef.current.focusedPane === "tree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          void latestArgsRef.current.openTreeNode();
        },
      },
      {
        id: "toggleHiddenFiles",
        command: "toggleHiddenFiles",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.toggleHiddenFiles();
        },
      },
      {
        id: "refreshOrApplySearchSort",
        command: "refreshOrApplySearchSort",
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          keyboardEvent.preventDefault();
          if (current.isSearchMode) {
            current.rerunSearch();
            return;
          }
          void current.refreshDirectory();
        },
      },
      {
        id: "copyPath",
        command: "copyPath",
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
        id: "newTab",
        command: "newTab",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.openNewTab();
        },
      },
      {
        id: "reopenClosedTab",
        command: "reopenClosedTab",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.reopenClosedTab();
        },
      },
      {
        id: "closeTab",
        command: "closeTab",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.closeTab();
        },
      },
      {
        id: "selectNextTab",
        command: "selectNextTab",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.activateAdjacentTab("next");
        },
      },
      {
        id: "selectPreviousTab",
        command: "selectPreviousTab",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.activateAdjacentTab("previous");
        },
      },
      {
        id: "openInTerminal",
        command: "openInTerminal",
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
        command: "moveSelection",
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
        command: "newFolder",
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
        command: "openLocationSheet",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.openLocationSheet();
        },
      },
      {
        id: "toggleInfoRow",
        command: "toggleInfoRow",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.setInfoRowOpen((value) => !value);
        },
      },
      {
        id: "toggleInfoPanel",
        command: "toggleInfoPanel",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.setInfoPanelOpen((value) => !value);
        },
      },
      {
        id: "goHomeRootTree",
        command: "goHomeRootTree",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.goHomeAndRootTree();
        },
      },
      {
        id: "rootTreeAtSelection",
        command: "rootTreeAtSelection",
        run: (keyboardEvent) => {
          keyboardEvent.preventDefault();
          latestArgsRef.current.rootTreeAtSelection();
        },
      },
      {
        id: "pagedScrollBackward",
        command: "pageUp",
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
        command: "pageDown",
        run: (keyboardEvent) => {
          const didHandle = latestArgsRef.current.handlePagedPaneScroll("forward");
          if (!didHandle) {
            return;
          }
          keyboardEvent.preventDefault();
        },
      },
      {
        // While a filter is typed into the file list, Backspace and Esc edit it, and Space
        // is part of the text for a moment after each character.
        id: "listFilterEdit",
        matches: (keyboardEvent) =>
          latestArgsRef.current.listFilterActive &&
          latestArgsRef.current.focusedPane === "content" &&
          !keyboardEvent.metaKey &&
          !keyboardEvent.ctrlKey &&
          !keyboardEvent.altKey &&
          (keyboardEvent.key === "Backspace" ||
            keyboardEvent.key === "Escape" ||
            (keyboardEvent.key === " " && latestArgsRef.current.listFilterTakesSpace())),
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          keyboardEvent.preventDefault();
          if (keyboardEvent.key === "Backspace") {
            current.eraseListFilterCharacter();
          } else if (keyboardEvent.key === "Escape") {
            current.clearListFilter();
          } else {
            current.handleTypeaheadInput(" ", "content");
          }
        },
      },
      {
        id: "typeahead",
        matches: (keyboardEvent) =>
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
              : current.viewMode === "details"
                ? 1
                : current.contentColumns,
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
        id: "quickLook",
        command: "quickLookSelection",
        matches: () =>
          latestArgsRef.current.focusedPane === "content" &&
          latestArgsRef.current.selectedEntry !== null,
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          const path = current.selectionLeadOrSelectedPath();
          if (!path) {
            return;
          }
          keyboardEvent.preventDefault();
          current.quickLookPath(path);
        },
      },
      {
        id: "contentEnter",
        matches: (keyboardEvent) =>
          keyboardEvent.key === "Enter" &&
          !keyboardEvent.metaKey &&
          latestArgsRef.current.focusedPane === "content" &&
          latestArgsRef.current.selectedEntry !== null,
        run: (keyboardEvent) => {
          const current = latestArgsRef.current;
          if (!current.selectedEntry) {
            return;
          }
          keyboardEvent.preventDefault();
          if (current.returnKeyAction === "rename") {
            // Finder behavior: Return renames a single selected item; ⌘O / ⌘↓ open.
            if (current.selectedPathsInViewOrder.length <= 1) {
              current.openRenameDialog([current.selectedEntry.path]);
            }
            return;
          }
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

  // The last key pressed in the window, to tell a menu command chosen by its key from one
  // chosen with the pointer.
  const lastKeyDownRef = useRef<{ shortcut: string; time: number } | null>(null);

  const rawShortcutCommands = useMemo(
    () => new Set(rawShortcutBindings.flatMap((binding) => binding.command ?? [])),
    [rawShortcutBindings],
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
    (commandType: RendererCommandType, options: { viaShortcut?: boolean } = {}) => {
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
      // A key that moves the caret or deletes (⌘↑, ⌘⌫) stays with a text field that has
      // the keyboard, even when the menu hears it too.
      if (
        options.viaShortcut &&
        lastKeyDownRef.current &&
        isTextEditingShortcut(lastKeyDownRef.current.shortcut) &&
        resolveFocusedEditTarget(document.activeElement) === "editable-text"
      ) {
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
          current.startDuplicateOfSelection(paths);
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
      if (commandType === "deleteImmediately") {
        // Move to Trash covers search results; Delete Immediately is for the list.
        const paths = current.isSearchMode ? [] : current.resolveContentActionPaths();
        if (paths.length > 0) {
          current.requestDeleteImmediately(paths);
        }
        return;
      }
      if (commandType === "emptyTrash") {
        current.requestEmptyTrash();
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
      if (commandType === "showClipboard") {
        current.showClipboard();
        return;
      }
      if (commandType === "clearClipboard") {
        current.clearClipboard();
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
          current.rerunSearch();
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
      if (commandType === "goHomeRootTree") {
        current.goHomeAndRootTree();
        return;
      }
      if (commandType === "rootTreeAtSelection") {
        current.rootTreeAtSelection();
        return;
      }
      if (commandType === "newTab") {
        current.openNewTab();
        return;
      }
      if (commandType === "reopenClosedTab") {
        current.reopenClosedTab();
        return;
      }
      if (commandType === "closeTab") {
        current.closeTab();
        return;
      }
      if (commandType === "selectNextTab") {
        current.activateAdjacentTab("next");
        return;
      }
      if (commandType === "selectPreviousTab") {
        current.activateAdjacentTab("previous");
        return;
      }
      if (commandType === "openSelectionInNewTab") {
        const targetPath = resolveNewTabTargetPath(current);
        if (targetPath) {
          void current.openFolderInNewTab(targetPath);
        }
        return;
      }
      if (commandType === "quickLookSelection") {
        const path = current.selectionLeadOrSelectedPath();
        if (path) {
          current.quickLookPath(path);
        }
        return;
      }
      if (commandType === "toggleFavorite") {
        const targetPath = resolveFavoriteTargetPath(current);
        if (targetPath) {
          current.toggleFavoritePath(targetPath);
        }
        return;
      }
      if (commandType === "showInFinder") {
        const paths = resolveShowInFinderPaths(current);
        if (paths.length > 0) {
          void current.showPathsInFinder(paths);
        }
        return;
      }
      if (commandType === "showLastSearchResults") {
        if (current.hasCachedSearch) {
          current.showCachedSearchResults({ focusPane: true });
        }
        return;
      }
      if (commandType === "viewAsIcons") {
        current.setViewMode("icons");
        return;
      }
      if (commandType === "viewAsList" || commandType === "viewAsDetails") {
        current.setViewMode(commandType === "viewAsList" ? "list" : "details");
        return;
      }
      if (
        commandType === "sortByName" ||
        commandType === "sortByModified" ||
        commandType === "sortBySize" ||
        commandType === "sortByKind"
      ) {
        if (!current.isSearchMode) {
          current.handleSortChange(SORT_COMMAND_KEYS[commandType]);
        }
        return;
      }
      if (commandType === "toggleFoldersFirst") {
        if (!current.isSearchMode) {
          current.toggleFoldersFirst();
        }
        return;
      }
      if (commandType === "toggleHiddenFiles") {
        current.toggleHiddenFiles();
        return;
      }
      if (commandType === "goBack") {
        current.goBack();
        return;
      }
      if (commandType === "goForward") {
        current.goForward();
        return;
      }
      if (commandType === "goEnclosingFolder") {
        if (current.focusedPane === "tree") {
          void current.navigateTreeSelectionToParent();
          return;
        }
        const parentPath = current.currentPath ? parentDirectoryPath(current.currentPath) : null;
        if (parentPath) {
          void current.navigateTo(parentPath, "push");
        }
        return;
      }
      if (commandType === "focusTreePane") {
        focusTreePane();
        current.setFocusedPane("tree");
        return;
      }
      if (commandType === "focusContentPane") {
        focusContentPaneRef();
        current.setFocusedPane("content");
        return;
      }
      if (commandType === "openHelp" || commandType === "openKeyboardShortcuts") {
        // Help opens where it was left; Keyboard Shortcuts always opens that page.
        current.openHelp(commandType === "openHelp" ? undefined : "shortcuts");
        return;
      }
      if (commandType !== "focusFileSearch") {
        return;
      }
      current.setMainView("explorer");
      window.requestAnimationFrame(() => {
        latestArgsRef.current.focusFileSearch(true);
      });
    },
    [focusContentPaneRef, focusTreePane, runGenericEditCommand],
  );

  useEffect(() => {
    const unsubscribe = client.onCommand((command) => {
      // The menu sends the command a moment after the key that chose it, if a key did.
      const lastKeyDown = lastKeyDownRef.current;
      const menuShortcut = isShortcutCommand(command.type)
        ? getMenuShortcut(latestArgsRef.current.shortcuts.bindings[command.type])
        : undefined;
      runRendererCommand(command.type, {
        viaShortcut:
          lastKeyDown !== null &&
          lastKeyDown.shortcut === menuShortcut &&
          performance.now() - lastKeyDown.time < MENU_SHORTCUT_WINDOW_MS,
      });
    });
    return unsubscribe;
  }, [client, runRendererCommand]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latestArgsRef.current;
      const pressedShortcut = shortcutFromKeyboardEvent(event);
      lastKeyDownRef.current = pressedShortcut
        ? { shortcut: pressedShortcut, time: performance.now() }
        : null;
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
      // Escape (or Cmd+.) cancels the open dialog even from one of its menus or fields,
      // which would otherwise keep the key to themselves below.
      if ((current.copyPasteModalOpen || current.preparingSheetOpen) && isModalCancelKey(event)) {
        event.preventDefault();
        current.handleCopyPasteDialogEscape();
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
      const pressedCommand = pressedShortcut
        ? (current.shortcuts.commandByShortcut.get(pressedShortcut) ?? null)
        : null;
      if (pressedCommand === "openHelp") {
        event.preventDefault();
        if (current.mainView === "help") {
          current.setMainView("explorer");
        } else {
          current.openHelp();
        }
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
        // Keys inside the dialog (Tab, Return, Space, arrows) belong to it; anything aimed
        // at the explorer behind it is swallowed.
        if (targetElement?.closest(MODAL_KEYBOARD_OWNER_SELECTOR)) {
          return;
        }
        event.preventDefault();
        return;
      }
      // A command the window has no binding of its own for runs as it does from the menu.
      // The menu only listens for a command's first key, and not for one without ⌘ or ⌃.
      if (
        pressedCommand &&
        isRendererCommand(pressedCommand) &&
        !rawShortcutCommands.has(pressedCommand)
      ) {
        if (canHandleRendererCommand(pressedCommand, current.shortcutContext)) {
          event.preventDefault();
          runRendererCommand(pressedCommand);
        }
        return;
      }
      if (!canHandleExplorerKeyboardShortcuts(current.shortcutContext)) {
        return;
      }
      for (const rawShortcutBinding of rawShortcutBindings) {
        if (
          (rawShortcutBinding.command !== undefined &&
            rawShortcutBinding.command !== pressedCommand) ||
          !(rawShortcutBinding.matches?.(event) ?? true)
        ) {
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
  }, [rawShortcutBindings, rawShortcutCommands, runRendererCommand]);

  return {
    runRendererCommand,
  };
}
