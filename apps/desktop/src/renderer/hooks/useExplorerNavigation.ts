import { useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { EMPTY_CONTENT_SELECTION, type ContentSelectionState } from "../lib/contentSelection";
import type { TreeNodeState } from "../components/TreePane";
import type { TreeItemId } from "../lib/favorites";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];

export function useExplorerNavigation() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const [mainView, setMainView] = useState<"explorer" | "help" | "settings" | "action-log">(
    "explorer",
  );
  const [treeRootPath, setTreeRootPath] = useState("");
  const [homePath, setHomePath] = useState("");
  const [treeNodes, setTreeNodes] = useState<Record<string, TreeNodeState>>({});
  const [selectedTreeItemId, setSelectedTreeItemId] = useState<TreeItemId | null>("favorites-root");
  const [currentPath, setCurrentPath] = useState("");
  const [currentEntries, setCurrentEntries] = useState<DirectoryEntry[]>([]);
  const [metadataByPath, setMetadataByPath] = useState<Record<string, DirectoryEntryMetadata>>({});
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [contentSelection, setContentSelection] =
    useState<ContentSelectionState>(EMPTY_CONTENT_SELECTION);
  const [historyPaths, setHistoryPaths] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [visiblePaths, setVisiblePaths] = useState<string[]>([]);
  const [contentColumns, setContentColumns] = useState(1);
  const [getInfoLoading, setGetInfoLoading] = useState(false);
  const [getInfoItem, setGetInfoItem] = useState<IpcResponse<"item:getProperties">["item"] | null>(
    null,
  );
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [locationSubmitting, setLocationSubmitting] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<"tree" | "content" | null>(null);
  const [leftPaneSubview, setLeftPaneSubview] = useState<"favorites" | "tree">("tree");
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [typeaheadQuery, setTypeaheadQuery] = useState("");
  const [typeaheadPane, setTypeaheadPane] = useState<"tree" | "content" | null>(null);
  const [infoTargetPathOverride, setInfoTargetPathOverride] = useState<string | null>(null);
  const [infoPanelOpen, setInfoPanelOpen] = useState(DEFAULT_APP_PREFERENCES.propertiesOpen);
  const [infoRowOpen, setInfoRowOpen] = useState(DEFAULT_APP_PREFERENCES.detailRowOpen);
  const [restoredPaneWidths, setRestoredPaneWidths] = useState<{
    treeWidth: number;
    inspectorWidth: number;
  } | null>(null);
  const directoryRequestRef = useRef(0);
  const getInfoRequestRef = useRef(0);
  const treeRequestRef = useRef<Record<string, number>>({});
  const treeNodesRef = useRef<Record<string, TreeNodeState>>({});
  const selectedTreeItemIdRef = useRef<TreeItemId | null>(selectedTreeItemId);
  const treeRootPathRef = useRef(treeRootPath);
  const metadataCacheRef = useRef<Map<string, DirectoryEntryMetadata>>(new Map());
  const metadataInflightRef = useRef<Set<string>>(new Set());
  const currentPathRef = useRef(currentPath);
  const isSearchModeRef = useRef(false);
  const selectedPathsInViewOrderRef = useRef<string[]>([]);
  const selectedEntryRef = useRef<DirectoryEntry | null>(null);
  const lastExplorerFocusPaneRef = useRef<"tree" | "content" | null>(null);
  const leftPaneSubviewRef = useRef<"favorites" | "tree">(leftPaneSubview);
  const lastLeftPaneSubviewRef = useRef<"favorites" | "tree">("tree");

  return {
    mainView,
    setMainView,
    treeRootPath,
    setTreeRootPath,
    homePath,
    setHomePath,
    treeNodes,
    setTreeNodes,
    selectedTreeItemId,
    setSelectedTreeItemId,
    currentPath,
    setCurrentPath,
    currentEntries,
    setCurrentEntries,
    metadataByPath,
    setMetadataByPath,
    directoryLoading,
    setDirectoryLoading,
    directoryError,
    setDirectoryError,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    contentSelection,
    setContentSelection,
    historyPaths,
    setHistoryPaths,
    historyIndex,
    setHistoryIndex,
    visiblePaths,
    setVisiblePaths,
    contentColumns,
    setContentColumns,
    getInfoLoading,
    setGetInfoLoading,
    getInfoItem,
    setGetInfoItem,
    locationSheetOpen,
    setLocationSheetOpen,
    locationSubmitting,
    setLocationSubmitting,
    locationError,
    setLocationError,
    focusedPane,
    setFocusedPane,
    leftPaneSubview,
    setLeftPaneSubview,
    themeMenuOpen,
    setThemeMenuOpen,
    typeaheadQuery,
    setTypeaheadQuery,
    typeaheadPane,
    setTypeaheadPane,
    infoTargetPathOverride,
    setInfoTargetPathOverride,
    infoPanelOpen,
    setInfoPanelOpen,
    infoRowOpen,
    setInfoRowOpen,
    restoredPaneWidths,
    setRestoredPaneWidths,
    directoryRequestRef,
    getInfoRequestRef,
    treeRequestRef,
    treeNodesRef,
    selectedTreeItemIdRef,
    treeRootPathRef,
    metadataCacheRef,
    metadataInflightRef,
    currentPathRef,
    isSearchModeRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    leftPaneSubviewRef,
    lastLeftPaneSubviewRef,
  };
}
