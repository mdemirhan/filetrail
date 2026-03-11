import { useEffect, useMemo, useRef, useState } from "react";

import type { DirectoryEntry } from "../lib/explorerTypes";
import type { TreePresentationItem } from "../lib/favorites";
import { getTrashPath } from "../lib/favorites";
import type { useFiletrailClient } from "../lib/filetrailClient";
import {
  type InternalDragSession,
  type InternalDropTargetSurface,
  type InternalMoveSourceSurface,
  buildInternalDragSession,
  isRealDirectoryEntry,
  validateInternalDrop,
} from "../lib/internalDragAndDrop";

type DropIndicatorState = "valid" | "invalid" | null;
type ActiveDropTarget = {
  surface: InternalDropTargetSurface;
  path: string;
  validity: Exclude<DropIndicatorState, null>;
};

function createDragPreviewElement(session: InternalDragSession): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "internal-drag-preview";

  const icon = document.createElement("div");
  icon.className =
    session.leadKind === "directory" || session.leadKind === "symlink_directory"
      ? "internal-drag-preview-icon folder"
      : "internal-drag-preview-icon file";

  const label = document.createElement("div");
  label.className = "internal-drag-preview-label";
  label.textContent = session.leadPath.split("/").filter(Boolean).at(-1) ?? session.leadPath;

  const badge = document.createElement("div");
  badge.className = "internal-drag-preview-badge";
  badge.textContent = String(session.sourceItems.length);

  root.append(icon, label, badge);
  document.body.append(root);
  return root;
}

export function useExplorerDragAndDrop(args: {
  client: ReturnType<typeof useFiletrailClient>;
  activeEntries: DirectoryEntry[];
  selectedPathsInViewOrder: string[];
  homePath: string;
  blocked: boolean;
  onMoveToDestination: (
    sourcePaths: string[],
    destinationDirectoryPath: string,
    options: {
      pendingTreeSelectionPath?: string | null;
      reviewLargeBatchWarning?: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      validateDestinationBeforeAnalyze?: boolean;
    },
  ) => Promise<boolean>;
  onToggleTreeNode: (path: string) => void;
}) {
  const {
    client,
    activeEntries,
    selectedPathsInViewOrder,
    homePath,
    blocked,
    onMoveToDestination,
    onToggleTreeNode,
  } = args;
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null);
  const dragSessionRef = useRef<InternalDragSession | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const treeHoverExpandRef = useRef<{ path: string; timerId: number } | null>(null);

  const entriesByPath = useMemo(
    () => new Map(activeEntries.map((entry) => [entry.path, entry])),
    [activeEntries],
  );
  const trashPath = useMemo(() => getTrashPath(homePath), [homePath]);

  useEffect(
    () => () => {
      if (treeHoverExpandRef.current) {
        window.clearTimeout(treeHoverExpandRef.current.timerId);
      }
      dragPreviewRef.current?.remove();
    },
    [],
  );

  useEffect(() => {
    if (blocked) {
      clearDragSession();
    }
  }, [blocked]);

  function clearTreeHoverExpand() {
    if (!treeHoverExpandRef.current) {
      return;
    }
    window.clearTimeout(treeHoverExpandRef.current.timerId);
    treeHoverExpandRef.current = null;
  }

  function clearDragSession() {
    clearTreeHoverExpand();
    setActiveDropTarget(null);
    dragSessionRef.current = null;
    dragPreviewRef.current?.remove();
    dragPreviewRef.current = null;
  }

  function setDropIndicator(
    surface: InternalDropTargetSurface,
    path: string,
    validity: Exclude<DropIndicatorState, null>,
  ) {
    setActiveDropTarget({ surface, path, validity });
  }

  function scheduleTreeHoverExpand(item: TreePresentationItem) {
    if (
      item.kind !== "filesystem" ||
      item.isSymlink ||
      item.expanded ||
      item.loading ||
      !item.path ||
      !item.canExpand
    ) {
      clearTreeHoverExpand();
      return;
    }
    if (treeHoverExpandRef.current?.path === item.path) {
      return;
    }
    clearTreeHoverExpand();
    treeHoverExpandRef.current = {
      path: item.path,
      timerId: window.setTimeout(() => {
        treeHoverExpandRef.current = null;
        onToggleTreeNode(item.path as string);
      }, 700),
    };
  }

  function handleDragStart(
    entry: DirectoryEntry,
    sourceSurface: InternalMoveSourceSurface,
    event: React.DragEvent<HTMLElement>,
  ) {
    const session = buildInternalDragSession({
      sourceSurface,
      draggedPath: entry.path,
      selectedPathsInViewOrder,
      entriesByPath,
    });
    if (blocked || !session) {
      event.preventDefault();
      clearDragSession();
      return;
    }
    dragSessionRef.current = session;
    const dragPreview = createDragPreviewElement(session);
    dragPreviewRef.current = dragPreview;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "text/plain",
      session.sourceItems.map((item) => item.path).join("\n"),
    );
    event.dataTransfer.setDragImage(dragPreview, 20, 18);
    window.setTimeout(() => {
      dragPreview.remove();
      if (dragPreviewRef.current === dragPreview) {
        dragPreviewRef.current = null;
      }
    }, 0);
  }

  function handleDragEnd() {
    clearDragSession();
  }

  function resolveDropValidity(args: {
    surface: InternalDropTargetSurface;
    path: string | null;
    targetSupportsMove: boolean;
    targetIsSelected?: boolean | undefined;
  }): Exclude<DropIndicatorState, null> {
    const validation = validateInternalDrop({
      session: dragSessionRef.current,
      blocked,
      targetSurface: args.surface,
      targetPath: args.path,
      targetSupportsMove: args.targetSupportsMove,
      targetIsSelected: args.targetIsSelected,
    });
    return validation.ok ? "valid" : "invalid";
  }

  function applyDropEffect(
    event: React.DragEvent<HTMLElement>,
    validity: Exclude<DropIndicatorState, null>,
  ) {
    if (validity === "valid") {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      return;
    }
    event.dataTransfer.dropEffect = "none";
  }

  async function confirmTargetPath(path: string): Promise<boolean> {
    try {
      const response = await client.invoke("item:getProperties", { path });
      return response.item?.kind === "directory" && response.item.isSymlink === false;
    } catch {
      return false;
    }
  }

  async function handleDrop(
    surface: InternalDropTargetSurface,
    path: string | null,
    event: React.DragEvent<HTMLElement>,
    options: {
      targetSupportsMove: boolean;
      targetIsSelected?: boolean | undefined;
      selectTargetInTree?: boolean | undefined;
      validateWithItemProperties?: boolean | undefined;
    },
  ) {
    const session = dragSessionRef.current;
    const validity = resolveDropValidity({
      surface,
      path,
      targetSupportsMove: options.targetSupportsMove,
      targetIsSelected: options.targetIsSelected,
    });
    applyDropEffect(event, validity);
    if (validity !== "valid" || !session || !path) {
      return;
    }
    event.preventDefault();
    clearTreeHoverExpand();
    const confirmedTargetPath =
      options.validateWithItemProperties === false ? true : await confirmTargetPath(path);
    clearDragSession();
    if (!confirmedTargetPath) {
      return;
    }
    await onMoveToDestination(
      session.sourceItems.map((item) => item.path),
      path,
      {
        pendingTreeSelectionPath: options.selectTargetInTree ? path : null,
        sourceSurface: session.sourceSurface,
        validateDestinationBeforeAnalyze: false,
      },
    );
  }

  function getContentItemDropIndicator(path: string): DropIndicatorState {
    if (activeDropTarget?.surface !== "content" || activeDropTarget.path !== path) {
      return null;
    }
    return activeDropTarget.validity;
  }

  function getTreeItemDropIndicator(
    path: string | null,
    surface: InternalDropTargetSurface,
  ): DropIndicatorState {
    if (!path || activeDropTarget?.surface !== surface || activeDropTarget.path !== path) {
      return null;
    }
    return activeDropTarget.validity;
  }

  function handleContentDragEnter(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
    if (!dragSessionRef.current) {
      return;
    }
    const validity = resolveDropValidity({
      surface: "content",
      path: entry.path,
      targetSupportsMove: isRealDirectoryEntry(entry),
      targetIsSelected: dragSessionRef.current.sourceItems.some((item) => item.path === entry.path),
    });
    setDropIndicator("content", entry.path, validity);
    applyDropEffect(event, validity);
  }

  function handleContentDragOver(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
    handleContentDragEnter(entry, event);
  }

  function handleContentDragLeave(entry: DirectoryEntry) {
    if (activeDropTarget?.surface === "content" && activeDropTarget.path === entry.path) {
      setActiveDropTarget(null);
    }
  }

  async function handleContentDrop(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
    await handleDrop("content", entry.path, event, {
      targetSupportsMove: isRealDirectoryEntry(entry),
      targetIsSelected: dragSessionRef.current?.sourceItems.some(
        (item) => item.path === entry.path,
      ),
      validateWithItemProperties: true,
    });
  }

  function handleTreeDragEnter(
    item: TreePresentationItem,
    event: React.DragEvent<HTMLElement>,
    subview: "favorites" | "tree",
  ) {
    if (!dragSessionRef.current || !item.path) {
      return;
    }
    const isFavorite = item.kind === "favorite";
    const targetSurface = isFavorite ? "favorite" : "tree";
    const targetSupportsMove =
      item.kind === "filesystem"
        ? !item.isSymlink
        : item.kind === "favorite"
          ? item.path !== trashPath
          : false;
    const validity = resolveDropValidity({
      surface: targetSurface,
      path: item.path,
      targetSupportsMove,
    });
    setDropIndicator(targetSurface, item.path, validity);
    applyDropEffect(event, validity);
    if (subview === "tree" && validity === "valid") {
      scheduleTreeHoverExpand(item);
    } else {
      clearTreeHoverExpand();
    }
  }

  function handleTreeDragOver(
    item: TreePresentationItem,
    event: React.DragEvent<HTMLElement>,
    subview: "favorites" | "tree",
  ) {
    handleTreeDragEnter(item, event, subview);
  }

  function handleTreeDragLeave(item: TreePresentationItem) {
    clearTreeHoverExpand();
    if (!item.path) {
      return;
    }
    const targetSurface = item.kind === "favorite" ? "favorite" : "tree";
    if (activeDropTarget?.surface === targetSurface && activeDropTarget.path === item.path) {
      setActiveDropTarget(null);
    }
  }

  async function handleTreeDrop(
    item: TreePresentationItem,
    event: React.DragEvent<HTMLElement>,
    subview: "favorites" | "tree",
  ) {
    if (!item.path) {
      return;
    }
    await handleDrop(item.kind === "favorite" ? "favorite" : "tree", item.path, event, {
      targetSupportsMove:
        item.kind === "filesystem"
          ? !item.isSymlink
          : item.kind === "favorite" && item.path !== trashPath,
      selectTargetInTree: subview === "tree" || item.kind === "favorite",
      validateWithItemProperties: true,
    });
  }

  return {
    getContentItemDropIndicator,
    getTreeItemDropIndicator,
    handleContentDragEnter,
    handleContentDragLeave,
    handleContentDragOver,
    handleContentDragStart: handleDragStart,
    handleContentDrop,
    handleDragEnd,
    handleSearchDragStart: handleDragStart,
    handleTreeDragEnter,
    handleTreeDragLeave,
    handleTreeDragOver,
    handleTreeDrop,
  };
}
