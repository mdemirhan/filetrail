import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import { ContentPane } from "./components/ContentPane";
import { HelpView } from "./components/HelpView";
import { LocationSheet } from "./components/LocationSheet";
import { PropertiesDrawer } from "./components/PropertiesDrawer";
import { SettingsView } from "./components/SettingsView";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { type TreeNodeState, TreePane } from "./components/TreePane";
import { useExplorerPaneLayout } from "./hooks/useExplorerPaneLayout";
import { getAncestorChain, getNextSelectionIndex } from "./lib/explorerNavigation";
import { useFiletrailClient } from "./lib/filetrailClient";
import { createRendererLogger } from "./lib/logging";
import { type ThemeMode, applyTheme, persistTheme, resolveInitialTheme } from "./lib/theme";
import { getTreeKeyboardAction } from "./lib/treeView";
import { persistUiState, readStoredUiState } from "./lib/uiState";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];

const logger = createRendererLogger("filetrail.renderer");
const SHORTCUT_ITEMS = [
  { group: "Navigation", shortcut: "Cmd+Left", description: "Go back to the previous folder" },
  { group: "Navigation", shortcut: "Cmd+Right", description: "Go forward to the next folder" },
  { group: "Navigation", shortcut: "Cmd+Up", description: "Open the parent folder from list view" },
  {
    group: "Navigation",
    shortcut: "Cmd+Down",
    description: "Open the selected folder or open the selected file from list view",
  },
  { group: "Navigation", shortcut: "Cmd+L", description: "Open Go to Folder" },
  { group: "Navigation", shortcut: "Cmd+R", description: "Refresh the current folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+Shift+.",
    description: "Toggle hidden files",
  },
  { group: "Panels", shortcut: "Cmd+I", description: "Toggle the inspector drawer" },
  {
    group: "Panels",
    shortcut: "Tab",
    description: "Move focus between the folder tree and file list",
  },
  {
    group: "Panels",
    shortcut: "Shift+Tab",
    description: "Move focus back between the file list and folder tree",
  },
  { group: "Views", shortcut: "?", description: "Open help" },
  { group: "Views", shortcut: "Esc", description: "Return from Help or Settings to Explorer" },
] as const;

const REFERENCE_ITEMS = [
  {
    label: "Single click path segment",
    description: "Navigate directly to that folder in the current browsing history.",
  },
  {
    label: "Double click path bar",
    description: "Switch the path bar into editable mode without opening a separate dialog.",
  },
  {
    label: "Inline path suggestions",
    description: "Autocomplete shows real directory names under the typed parent folder.",
  },
  {
    label: "List view activation",
    description: "Double click a folder to enter it, or double click a file to open it in macOS.",
  },
] as const;

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  const initialUiState = useMemo(() => readStoredUiState(), []);
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());
  const [mainView, setMainView] = useState<"explorer" | "help" | "settings">("explorer");
  const [treeRootPath, setTreeRootPath] = useState("");
  const [homePath, setHomePath] = useState("");
  const [treeNodes, setTreeNodes] = useState<Record<string, TreeNodeState>>({});
  const [currentPath, setCurrentPath] = useState("");
  const [currentEntries, setCurrentEntries] = useState<DirectoryEntry[]>([]);
  const [metadataByPath, setMetadataByPath] = useState<Record<string, DirectoryEntryMetadata>>({});
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [includeHidden, setIncludeHidden] = useState(initialUiState.includeHidden);
  const [viewMode, setViewMode] = useState<"list" | "details">(initialUiState.viewMode);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [propertiesOpen, setPropertiesOpen] = useState(initialUiState.propertiesOpen);
  const [selectedPath, setSelectedPath] = useState("");
  const [historyPaths, setHistoryPaths] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [visiblePaths, setVisiblePaths] = useState<string[]>([]);
  const [contentColumns, setContentColumns] = useState(1);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesItem, setPropertiesItem] = useState<
    IpcResponse<"item:getProperties">["item"] | null
  >(null);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [locationSubmitting, setLocationSubmitting] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<"tree" | "content" | null>(null);
  const treePaneRef = useRef<HTMLElement | null>(null);
  const contentPaneRef = useRef<HTMLElement | null>(null);
  const directoryRequestRef = useRef(0);
  const metadataRequestRef = useRef(0);
  const propertiesRequestRef = useRef(0);
  const treeRequestRef = useRef<Record<string, number>>({});
  const panes = useExplorerPaneLayout({
    initialTreeWidth: initialUiState.treeWidth,
    initialInspectorWidth: initialUiState.inspectorWidth,
  });

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistUiState({
      viewMode,
      treeOpen: true,
      propertiesOpen,
      includeHidden,
      treeWidth: panes.treeWidth,
      inspectorWidth: panes.inspectorWidth,
    });
  }, [includeHidden, panes.inspectorWidth, panes.treeWidth, propertiesOpen, viewMode]);

  useEffect(() => {
    void client.invoke("app:getHomeDirectory", {}).then((response) => {
      setHomePath(response.path);
      initializeTree(response.path);
      void navigateTo(response.path, "replace");
    });
  }, [client]);

  useEffect(() => {
    if (viewMode !== "details" || currentPath.length === 0) {
      return;
    }
    const missingPaths = visiblePaths.filter((path) => !metadataByPath[path]);
    if (missingPaths.length === 0) {
      return;
    }
    const requestId = ++metadataRequestRef.current;
    void client
      .invoke("directory:getMetadataBatch", {
        directoryPath: currentPath,
        paths: missingPaths,
      })
      .then((response) => {
        if (metadataRequestRef.current !== requestId) {
          return;
        }
        setMetadataByPath((current) => {
          const next = { ...current };
          for (const item of response.items) {
            next[item.path] = item;
          }
          return next;
        });
      })
      .catch((error) => {
        logger.debug("metadata batch failed", error);
      });
  }, [client, currentPath, metadataByPath, viewMode, visiblePaths]);

  useEffect(() => {
    if (!propertiesOpen || currentPath.length === 0) {
      return;
    }
    const targetPath = selectedPath || currentPath;
    const requestId = ++propertiesRequestRef.current;
    setPropertiesLoading(true);
    void client
      .invoke("item:getProperties", { path: targetPath })
      .then((response) => {
        if (propertiesRequestRef.current !== requestId) {
          return;
        }
        setPropertiesItem(response.item);
      })
      .catch((error) => {
        if (propertiesRequestRef.current !== requestId) {
          return;
        }
        setPropertiesItem(null);
        logger.error("properties load failed", error);
      })
      .finally(() => {
        if (propertiesRequestRef.current === requestId) {
          setPropertiesLoading(false);
        }
      });
  }, [client, currentPath, propertiesOpen, selectedPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const currentSelectedEntry =
        currentEntries.find((entry) => entry.path === selectedPath) ?? null;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Tab" && mainView === "explorer" && !locationSheetOpen) {
        event.preventDefault();
        const treePane = treePaneRef.current;
        const contentPane = contentPaneRef.current;
        if (!treePane || !contentPane) {
          return;
        }
        const activeElement = document.activeElement;
        const focusTree = () => treePane.focus({ preventScroll: true });
        const focusContent = () => contentPane.focus({ preventScroll: true });
        if (activeElement instanceof Node && treePane.contains(activeElement)) {
          focusContent();
          return;
        }
        if (activeElement instanceof Node && contentPane.contains(activeElement)) {
          focusTree();
          return;
        }
        if (event.shiftKey) {
          focusTree();
        } else {
          focusContent();
        }
        return;
      }
      if (event.key === "Escape" && mainView !== "explorer") {
        event.preventDefault();
        setMainView("explorer");
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setMainView((value) => (value === "help" ? "explorer" : "help"));
        return;
      }
      if (mainView !== "explorer") {
        return;
      }
      if (event.metaKey && event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.metaKey && event.key === "ArrowRight") {
        event.preventDefault();
        goForward();
        return;
      }
      if (event.metaKey && event.key === "ArrowUp" && focusedPane === "content") {
        event.preventDefault();
        const nextPath =
          currentPath === "/" ? null : currentPath.split("/").slice(0, -1).join("/") || "/";
        if (nextPath) {
          void navigateTo(nextPath, "push");
        }
        return;
      }
      if (
        event.metaKey &&
        event.key === "ArrowDown" &&
        focusedPane === "content" &&
        currentSelectedEntry
      ) {
        event.preventDefault();
        if (currentSelectedEntry.kind === "directory") {
          void navigateTo(currentSelectedEntry.path, "push");
          return;
        }
        if (currentSelectedEntry.kind !== "symlink_directory") {
          void openExternally(currentSelectedEntry.path);
        }
        return;
      }
      if (event.metaKey && event.shiftKey && event.key === ".") {
        event.preventDefault();
        toggleHiddenFiles();
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refreshDirectory();
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setLocationError(null);
        setLocationSheetOpen(true);
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setPropertiesOpen((value) => !value);
        return;
      }
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        if (focusedPane === "tree") {
          const action = getTreeKeyboardAction({
            key: event.key,
            currentPath,
            rootPath: treeRootPath,
            nodes: treeNodes,
          });
          if (action.type === "none") {
            return;
          }
          event.preventDefault();
          if (action.type === "navigate") {
            void navigateTo(action.path, "push");
            return;
          }
          if (action.type === "expand" || action.type === "collapse") {
            toggleTreeNode(action.path);
            return;
          }
          if (action.type === "load") {
            void loadTreeChildren(action.path, includeHidden, true);
            return;
          }
          return;
        }
        if (focusedPane !== "content" || currentEntries.length === 0) {
          return;
        }
        event.preventDefault();
        const currentIndex = currentEntries.findIndex((entry) => entry.path === selectedPath);
        const nextIndex = getNextSelectionIndex({
          itemCount: currentEntries.length,
          currentIndex,
          key: event.key,
          columns: viewMode === "list" ? contentColumns : 1,
          viewMode,
        });
        const nextEntry = currentEntries[nextIndex];
        if (nextEntry) {
          setSelectedPath(nextEntry.path);
        }
        return;
      }
      if (event.key === "Enter" && focusedPane === "content" && currentSelectedEntry) {
        event.preventDefault();
        if (currentSelectedEntry.kind === "directory") {
          void navigateTo(currentSelectedEntry.path, "push");
          return;
        }
        if (currentSelectedEntry.kind !== "symlink_directory") {
          void openExternally(currentSelectedEntry.path);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    contentColumns,
    currentEntries,
    currentPath,
    focusedPane,
    includeHidden,
    locationSheetOpen,
    mainView,
    selectedPath,
    treeNodes,
    treeRootPath,
    viewMode,
  ]);

  const selectedEntry = useMemo(
    () => currentEntries.find((entry) => entry.path === selectedPath) ?? null,
    [currentEntries, selectedPath],
  );
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyPaths.length - 1;

  function goBack() {
    const nextPath = historyPaths[historyIndex - 1];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(historyIndex - 1);
    void navigateTo(nextPath, "skip");
  }

  function goForward() {
    const nextPath = historyPaths[historyIndex + 1];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(historyIndex + 1);
    void navigateTo(nextPath, "skip");
  }

  function initializeTree(path: string) {
    treeRequestRef.current = {};
    setTreeRootPath(path);
    setTreeNodes({
      [path]: createTreeNode(path, true),
    });
    void loadTreeChildren(path);
  }

  function reinitializeTree(rootPath: string, focusPath: string) {
    treeRequestRef.current = {};
    setTreeRootPath(rootPath);
    setTreeNodes({
      [rootPath]: createTreeNode(rootPath, true),
      ...(focusPath !== rootPath ? { [focusPath]: createTreeNode(focusPath, true) } : {}),
    });
    void loadTreeChildren(rootPath);
  }

  async function navigateTo(
    path: string,
    historyMode: "push" | "replace" | "skip",
    includeHiddenOverride = includeHidden,
    sortByOverride = sortBy,
    sortDirectionOverride = sortDirection,
  ): Promise<boolean> {
    const requestId = ++directoryRequestRef.current;
    setDirectoryLoading(true);
    setDirectoryError(null);
    setLocationError(null);
    try {
      const response = await client.invoke("directory:getSnapshot", {
        path,
        includeHidden: includeHiddenOverride,
        sortBy: sortByOverride,
        sortDirection: sortDirectionOverride,
      });
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
      setCurrentPath(response.path);
      setCurrentEntries(response.entries);
      setMetadataByPath({});
      setSelectedPath(response.entries[0]?.path ?? "");
      setPropertiesItem(null);
      await syncTreeToPath(response.path, includeHiddenOverride);
      if (historyMode === "push") {
        setHistoryPaths((current) => {
          const base = current.slice(0, historyIndex + 1);
          return [...base, response.path];
        });
        setHistoryIndex((current) => current + 1);
      } else if (historyMode === "replace") {
        setHistoryPaths((current) => {
          if (current.length === 0) {
            return [response.path];
          }
          const next = [...current];
          next[Math.max(0, historyIndex)] = response.path;
          return next;
        });
        setHistoryIndex((current) => (current < 0 ? 0 : current));
      }
      return true;
    } catch (error) {
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setDirectoryError(message);
      setLocationError(message);
      logger.error("directory navigation failed", error);
      return false;
    } finally {
      if (directoryRequestRef.current === requestId) {
        setDirectoryLoading(false);
      }
    }
  }

  function ensureTreeNode(path: string) {
    setTreeNodes((current) => {
      if (current[path]) {
        return {
          ...current,
          [path]: {
            ...current[path],
            expanded: true,
          },
        };
      }
      return {
        ...current,
        [path]: createTreeNode(path, true),
      };
    });
  }

  async function loadTreeChildren(
    path: string,
    includeHiddenOverride = includeHidden,
    expandOnSuccess = false,
  ) {
    const requestId = (treeRequestRef.current[path] ?? 0) + 1;
    treeRequestRef.current[path] = requestId;

    setTreeNodes((current) => ({
      ...current,
      [path]: {
        ...(current[path] ?? createTreeNode(path, true)),
        loading: true,
        error: null,
      },
    }));
    try {
      const response = await client.invoke("tree:getChildren", {
        path,
        includeHidden: includeHiddenOverride,
      });
      if (treeRequestRef.current[path] !== requestId) {
        return;
      }
      setTreeNodes((current) => {
        const next = { ...current };
        const existingNode = current[path] ?? createTreeNode(path, true);
        next[path] = {
          ...existingNode,
          expanded: response.children.length > 0 ? existingNode.expanded || expandOnSuccess : false,
          loading: false,
          loaded: true,
          childPaths: response.children.map((child) => child.path),
        };
        for (const child of response.children) {
          next[child.path] = {
            path: child.path,
            name: child.name,
            kind: child.kind,
            isHidden: child.isHidden,
            isSymlink: child.isSymlink,
            expanded: current[child.path]?.expanded ?? false,
            loading: false,
            loaded: current[child.path]?.loaded ?? false,
            error: null,
            childPaths: current[child.path]?.childPaths ?? [],
          };
        }
        return next;
      });
    } catch (error) {
      if (treeRequestRef.current[path] !== requestId) {
        return;
      }
      setTreeNodes((current) => ({
        ...current,
        [path]: {
          ...(current[path] ?? createTreeNode(path, true)),
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      logger.error("tree load failed", error);
    }
  }

  async function syncTreeToPath(path: string, includeHiddenOverride: boolean) {
    const nextRootPath =
      treeRootPath.length === 0 || !isPathWithinRoot(path, treeRootPath) ? path : treeRootPath;

    if (nextRootPath !== treeRootPath) {
      treeRequestRef.current = {};
      setTreeRootPath(nextRootPath);
      setTreeNodes({
        [nextRootPath]: createTreeNode(nextRootPath, true),
      });
    } else {
      ensureTreeNode(nextRootPath);
    }

    for (const ancestorPath of getAncestorChain(nextRootPath, path)) {
      ensureTreeNode(ancestorPath);
      await loadTreeChildren(ancestorPath, includeHiddenOverride);
    }
  }

  function toggleTreeNode(path: string) {
    const node = treeNodes[path];
    if (!node || node.isSymlink) {
      return;
    }
    if (!node.loaded) {
      if (!node.loading) {
        void loadTreeChildren(path, includeHidden, true);
      }
      return;
    }
    if (node.childPaths.length === 0) {
      return;
    }
    const nextExpanded = !node.expanded;
    setTreeNodes((current) => ({
      ...current,
      [path]: {
        ...node,
        expanded: nextExpanded,
      },
    }));
  }

  async function openExternally(path: string) {
    try {
      await client.invoke("system:openPath", { path });
    } catch (error) {
      logger.error("open in macOS failed", error);
    }
  }

  function toggleHiddenFiles() {
    const nextValue = !includeHidden;
    setIncludeHidden(nextValue);
    if (!currentPath) {
      return;
    }
    reinitializeTree(treeRootPath || currentPath, currentPath);
    void navigateTo(currentPath, "replace", nextValue);
  }

  async function refreshDirectory() {
    await client.invoke("app:clearCaches", {});
    if (!currentPath) {
      return;
    }
    reinitializeTree(treeRootPath || currentPath, currentPath);
    await navigateTo(currentPath, "replace");
  }

  function handleSortChange(nextSortBy: SortBy) {
    const nextSortDirection =
      nextSortBy === sortBy
        ? sortDirection === "asc"
          ? "desc"
          : "asc"
        : nextSortBy === "modified" || nextSortBy === "size"
          ? "desc"
          : "asc";

    if (nextSortBy !== sortBy) {
      setSortBy(nextSortBy);
    }
    setSortDirection(nextSortDirection);

    if (!currentPath) {
      return;
    }
    void navigateTo(currentPath, "replace", includeHidden, nextSortBy, nextSortDirection);
  }

  async function submitLocationPath(path: string) {
    setLocationSubmitting(true);
    try {
      const didNavigate = await navigateTo(path.trim(), "push");
      if (didNavigate) {
        setLocationSheetOpen(false);
      }
    } finally {
      setLocationSubmitting(false);
    }
  }

  function handlePaneResizeKey(
    pane: "tree" | "inspector",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const step = event.shiftKey ? 24 : 12;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    if (pane === "tree") {
      panes.setTreeWidth((current) =>
        Math.max(220, Math.min(520, current + (event.key === "ArrowRight" ? step : -step))),
      );
      return;
    }
    panes.setInspectorWidth((current) =>
      Math.max(260, Math.min(480, current + (event.key === "ArrowLeft" ? step : -step))),
    );
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="app-title">
            <strong>FILE TRAIL</strong>
          </div>
          <div className="titlebar-actions">
            <fieldset className="toolbar-segmented">
              <legend className="sr-only">History navigation</legend>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={!canGoBack}
                onClick={goBack}
                title="Back (Cmd+Left)"
                aria-label="Back"
              >
                <ToolbarIcon name="back" />
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={!canGoForward}
                onClick={goForward}
                title="Forward (Cmd+Right)"
                aria-label="Forward"
              >
                <ToolbarIcon name="forward" />
              </button>
            </fieldset>
            <fieldset className="toolbar-segmented">
              <legend className="sr-only">Home and location</legend>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={homePath.length === 0 || currentPath === homePath}
                onClick={() => {
                  if (homePath) {
                    void navigateTo(homePath, "push");
                  }
                }}
                title="Home"
                aria-label="Home"
              >
                <ToolbarIcon name="up" />
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                onClick={() => {
                  setLocationError(null);
                  setLocationSheetOpen(true);
                }}
                title="Go to Folder (Cmd+L)"
                aria-label="Go to Folder"
              >
                <ToolbarIcon name="location" />
              </button>
            </fieldset>
            <button
              type="button"
              className="tb-btn tb-btn-icon"
              onClick={() => void refreshDirectory()}
              title="Refresh (Cmd+R)"
              aria-label="Refresh"
            >
              <ToolbarIcon name="refresh" />
            </button>
          </div>
        </div>

        <div className="titlebar-center">
          <div className="toolbar-search" title="Search placeholder">
            <ToolbarIcon name="search" />
            <span>Search coming soon</span>
          </div>
        </div>

        <div className="titlebar-actions">
          <button
            type="button"
            className={includeHidden ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
            onClick={toggleHiddenFiles}
            title="Toggle hidden files (Cmd+Shift+.)"
            aria-label="Toggle hidden files"
          >
            <ToolbarIcon name="hidden" />
          </button>
          <fieldset className="toolbar-segmented">
            <legend className="sr-only">View mode</legend>
            <button
              type="button"
              className={viewMode === "list" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
              onClick={() => setViewMode("list")}
              title="List view"
              aria-label="List view"
            >
              <ToolbarIcon name="list" />
            </button>
            <button
              type="button"
              className={
                viewMode === "details" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
              }
              onClick={() => setViewMode("details")}
              title="Details view"
              aria-label="Details view"
            >
              <ToolbarIcon name="details" />
            </button>
          </fieldset>
          <button
            type="button"
            className={propertiesOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
            onClick={() => setPropertiesOpen((value) => !value)}
            title="Toggle inspector (Cmd+I)"
            aria-label="Toggle inspector"
          >
            <ToolbarIcon name="drawer" />
          </button>
          <span className="titlebar-divider" aria-hidden />
          <fieldset className="toolbar-select-group">
            <legend className="sr-only">Sorting controls</legend>
            <button
              type="button"
              className="tb-btn tb-btn-icon"
              onClick={() => handleSortChange(sortBy)}
              title={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
              aria-label={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
            >
              <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
            </button>
            <select
              className="toolbar-select"
              value={sortBy}
              onChange={(event) => handleSortChange(event.currentTarget.value as SortBy)}
              title="Sort by"
              aria-label="Sort by"
            >
              <option value="name">Name</option>
              <option value="modified">Date Modified</option>
              <option value="kind">Kind</option>
              <option value="size">Size</option>
            </select>
          </fieldset>
          <button
            type="button"
            className={mainView === "help" ? "tb-btn active" : "tb-btn"}
            onClick={() => setMainView((value) => (value === "help" ? "explorer" : "help"))}
            title={mainView === "help" ? "Return to explorer (Esc)" : "Open help (?)"}
            aria-label={mainView === "help" ? "Return to explorer" : "Open help"}
          >
            <ToolbarIcon name="help" />
            Help
          </button>
          <div className="theme-toggle" aria-label="Theme toggle">
            <svg
              className={`toggle-icon ${theme === "dark" ? "active" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <title>Dark theme</title>
              <path d="M21 12.79A9 9 0 1111.21 3A7 7 0 0021 12.79z" />
            </svg>
            <button
              type="button"
              className="toggle-track"
              onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              aria-label={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme`}
              title={`Switch to ${theme === "dark" ? "Light" : "Dark"} theme`}
            >
              <span className="toggle-thumb" />
            </button>
            <svg
              className={`toggle-icon ${theme === "light" ? "active" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <title>Light theme</title>
              <circle cx="12" cy="12" r="5" />
              <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </div>
          <span className="titlebar-divider" aria-hidden />
          <button
            type="button"
            className={mainView === "settings" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
            onClick={() => setMainView((value) => (value === "settings" ? "explorer" : "settings"))}
            title={mainView === "settings" ? "Return to explorer (Esc)" : "Open settings"}
            aria-label={mainView === "settings" ? "Return to explorer" : "Open settings"}
          >
            <ToolbarIcon name="settings" />
          </button>
        </div>
      </header>

      {mainView === "explorer" ? (
        <section
          className="workspace"
          style={{
            gridTemplateColumns: `${panes.treeWidth}px 8px minmax(0, 1fr)${
              propertiesOpen ? ` 8px ${panes.inspectorWidth}px` : ""
            }`,
          }}
        >
          <TreePane
            paneRef={treePaneRef}
            currentPath={currentPath}
            nodes={treeNodes}
            rootPath={treeRootPath}
            onFocusChange={(focused) => setFocusedPane(focused ? "tree" : null)}
            onNavigate={(path) => void navigateTo(path, "push")}
            onToggleExpand={toggleTreeNode}
          />
          <div
            className="pane-resizer"
            onPointerDown={panes.beginResize("tree")}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize folders pane"
            onKeyDown={(event) => handlePaneResizeKey("tree", event)}
          />
          <ContentPane
            paneRef={contentPaneRef}
            currentPath={currentPath}
            entries={currentEntries}
            loading={directoryLoading}
            error={directoryError}
            metadataByPath={metadataByPath}
            selectedPath={selectedPath}
            viewMode={viewMode}
            onSelectPath={setSelectedPath}
            onActivateEntry={(entry) => {
              if (entry.kind === "directory") {
                void navigateTo(entry.path, "push");
                return;
              }
              if (entry.kind === "symlink_directory") {
                return;
              }
              void openExternally(entry.path);
            }}
            onFocusChange={(focused) => setFocusedPane(focused ? "content" : null)}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            onLayoutColumnsChange={setContentColumns}
            onVisiblePathsChange={setVisiblePaths}
            onNavigatePath={(path) => void navigateTo(path, "push")}
            onRequestPathSuggestions={(inputPath) =>
              client.invoke("path:getSuggestions", {
                inputPath,
                includeHidden,
                limit: 12,
              })
            }
          />
          {propertiesOpen ? (
            <>
              <div
                className="pane-resizer"
                onPointerDown={panes.beginResize("inspector")}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize inspector pane"
                onKeyDown={(event) => handlePaneResizeKey("inspector", event)}
              />
              <PropertiesDrawer
                open={propertiesOpen}
                loading={propertiesLoading}
                item={propertiesItem}
                onClose={() => setPropertiesOpen(false)}
                onOpenExternally={() => {
                  const targetPath = selectedEntry?.path ?? currentPath;
                  if (targetPath) {
                    void openExternally(targetPath);
                  }
                }}
              />
            </>
          ) : null}
        </section>
      ) : (
        <section className="workspace single-panel-layout">
          <section className="pane content-pane">
            {mainView === "help" ? (
              <HelpView shortcutItems={[...SHORTCUT_ITEMS]} referenceItems={[...REFERENCE_ITEMS]} />
            ) : (
              <SettingsView />
            )}
          </section>
        </section>
      )}

      {mainView === "explorer" ? (
        <footer className="status-bar">
          <span>{currentEntries.length} items</span>
        </footer>
      ) : null}

      <LocationSheet
        open={locationSheetOpen}
        currentPath={currentPath}
        submitting={locationSubmitting}
        error={locationError}
        onClose={() => setLocationSheetOpen(false)}
        onSubmit={(path) => void submitLocationPath(path)}
      />
    </main>
  );
}

function createTreeNode(path: string, expanded: boolean): TreeNodeState {
  return {
    path,
    name: path === "/" ? "/" : (path.split("/").filter(Boolean).at(-1) ?? path),
    kind: "directory",
    isHidden: false,
    isSymlink: false,
    expanded,
    loading: false,
    loaded: false,
    error: null,
    childPaths: [],
  };
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
