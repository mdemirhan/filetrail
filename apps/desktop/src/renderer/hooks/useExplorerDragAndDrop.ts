import { useEffect, useMemo, useRef, useState } from "react";

import type { DirectoryEntry } from "../lib/explorerTypes";
import type { TreePresentationItem } from "../lib/favorites";
import { getTrashPath, isPathInsideTrash } from "../lib/favorites";
import {
  type InternalDragSession,
  type InternalDropOperation,
  type InternalDropTargetSurface,
  type InternalMoveSourceSurface,
  buildInternalDragSession,
  getSourceFolderPaths,
  isRealDirectoryEntry,
  resolveInternalDropOperation,
  resolveOnSameDisk,
  validateInternalDrop,
} from "../lib/internalDragAndDrop";

// How long a drag is held over a tab before that tab comes to the front; the same as a
// folder in the tree takes to open.
const TAB_HOVER_SWITCH_MS = 700;

type DropIndicatorState = "valid" | "invalid" | null;
type ActiveDropTarget = {
  surface: InternalDropTargetSurface;
  path: string;
  validity: Exclude<DropIndicatorState, null>;
};
// The keys held during a drag, which choose between moving and copying.
type DragModifiers = { altKey: boolean; metaKey: boolean };
type ActiveTreeDropElement = {
  surface: InternalDropTargetSurface;
  path: string;
  element: HTMLElement;
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
  activeEntries: DirectoryEntry[];
  selectedPathsInViewOrder: string[];
  homePath: string;
  blocked: boolean;
  /** Moves or copies the dropped items into the folder, as the drag's cursor showed. */
  onDropItems: (
    sourcePaths: string[],
    destinationDirectoryPath: string,
    options: {
      operation: InternalDropOperation;
      initiator?: "clipboard" | "drag_drop" | "move_dialog" | null;
      pendingTreeSelectionPath?: string | null;
      reviewLargeBatchWarning?: boolean;
      sourceSurface?: InternalMoveSourceSurface | null;
      validateDestinationBeforeAnalyze?: boolean;
    },
  ) => Promise<boolean>;
  onToggleTreeNode: (path: string) => void;
  /** Holding a drag over a tab that is not on screen brings that tab to the front. */
  onActivateTab: (tabId: string) => void;
  /** Which disk each path is on (`system:getDiskIds`), to tell a move from a copy. */
  getDiskIds?: (paths: string[]) => Promise<Array<number | null>>;
  /** A drag that couldn't start because something else holds the window. */
  onDragRefused?: () => void;
}) {
  const {
    activeEntries,
    selectedPathsInViewOrder,
    homePath,
    blocked,
    onDropItems,
    onToggleTreeNode,
    onActivateTab,
    getDiskIds,
    onDragRefused,
  } = args;
  // Which disk each folder of this drag is on, as far as the disks have answered.
  const diskIdsRef = useRef(new Map<string, number | null>());
  // Answers on their way, per folder, so the drop can wait for one already asked for.
  const diskIdRequestsRef = useRef(new Map<string, Promise<void>>());
  const onActivateTabRef = useRef(onActivateTab);
  onActivateTabRef.current = onActivateTab;
  const tabHoverSwitchRef = useRef<{ tabId: string; timerId: number } | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragSessionRef = useRef<InternalDragSession | null>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const treeHoverExpandRef = useRef<{ path: string; timerId: number } | null>(null);
  const activeTreeDropElementRef = useRef<ActiveTreeDropElement | null>(null);

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

  function clearTreeDropElementIndicator() {
    const activeTreeDropElement = activeTreeDropElementRef.current;
    if (!activeTreeDropElement) {
      return;
    }
    activeTreeDropElement.element.dataset.dropTargetState = "none";
    activeTreeDropElementRef.current = null;
  }

  function clearTabHoverSwitch() {
    if (!tabHoverSwitchRef.current) {
      return;
    }
    window.clearTimeout(tabHoverSwitchRef.current.timerId);
    tabHoverSwitchRef.current = null;
  }

  function clearDragSession() {
    clearTabHoverSwitch();
    clearTreeHoverExpand();
    clearTreeDropElementIndicator();
    setActiveDropTarget(null);
    setDragActive(false);
    dragSessionRef.current = null;
    diskIdsRef.current = new Map();
    diskIdRequestsRef.current = new Map();
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

  function syncTreeDropElementIndicator(
    event: React.DragEvent<HTMLElement>,
    surface: InternalDropTargetSurface,
    path: string,
    validity: Exclude<DropIndicatorState, null>,
  ) {
    const target = event.target;
    if (!(target instanceof Element)) {
      clearTreeDropElementIndicator();
      return;
    }
    const row = target.closest<HTMLElement>(".tree-row");
    if (!row) {
      clearTreeDropElementIndicator();
      return;
    }
    const activeTreeDropElement = activeTreeDropElementRef.current;
    if (
      activeTreeDropElement &&
      (activeTreeDropElement.element !== row ||
        activeTreeDropElement.path !== path ||
        activeTreeDropElement.surface !== surface)
    ) {
      activeTreeDropElement.element.dataset.dropTargetState = "none";
      activeTreeDropElementRef.current = null;
    }
    row.dataset.dropTargetState = validity;
    activeTreeDropElementRef.current = {
      surface,
      path,
      element: row,
    };
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
      if (blocked && session) {
        onDragRefused?.();
      }
      return;
    }
    dragSessionRef.current = session;
    setDragActive(true);
    void requestDiskIds(getSourceFolderPaths(session.sourceItems.map((item) => item.path)));
    // Showing another tab during the drag takes the dragged row off the page, and a row
    // that is off the page ends its drag without the list hearing of it.
    event.currentTarget.addEventListener("dragend", () => clearDragSession(), { once: true });
    const dragPreview = createDragPreviewElement(session);
    dragPreviewRef.current = dragPreview;
    // Whether the drop moves or copies depends on where it lands and the keys held then.
    event.dataTransfer.effectAllowed = "copyMove";
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

  // Asks the disks about folders not asked about yet in this drag, and resolves once every
  // one asked for has an answer (or the asking failed). Until then, the folder's path
  // decides (see resolveInternalDropOperation).
  function requestDiskIds(paths: string[]): Promise<void> {
    if (!getDiskIds) {
      return Promise.resolve();
    }
    const ids = diskIdsRef.current;
    const requests = diskIdRequestsRef.current;
    const wanted = paths.filter((path) => !ids.has(path) && !requests.has(path));
    if (wanted.length > 0) {
      const request = getDiskIds(wanted)
        .then((answers) => {
          wanted.forEach((path, index) => {
            ids.set(path, answers[index] ?? null);
          });
        })
        .catch(() => {
          // The paths decide, as before the disks could be asked.
        })
        .finally(() => {
          for (const path of wanted) {
            requests.delete(path);
          }
        });
      for (const path of wanted) {
        requests.set(path, request);
      }
    }
    return Promise.all(
      paths.flatMap((path) => {
        const pending = requests.get(path);
        return pending ? [pending] : [];
      }),
    ).then(() => undefined);
  }

  // Whether the dragged items and the target share a disk, once the disks have said.
  function knownOnSameDisk(
    session: InternalDragSession,
    path: string,
    diskIds: ReadonlyMap<string, number | null> = diskIdsRef.current,
  ): boolean | undefined {
    return resolveOnSameDisk(
      getSourceFolderPaths(session.sourceItems.map((item) => item.path)),
      path,
      diskIds,
    );
  }

  // Read again on every dragover, so the cursor changes as soon as Option or Command is
  // pressed or let go, and on the drop itself, so the drop does what the cursor showed.
  function resolveDropOperation(
    path: string | null,
    modifiers: DragModifiers,
  ): InternalDropOperation {
    const session = dragSessionRef.current;
    if (!session || !path) {
      return "move";
    }
    const onSameDisk = knownOnSameDisk(session, path);
    if (onSameDisk === undefined) {
      void requestDiskIds([path]);
    }
    return resolveInternalDropOperation({
      sourcePaths: session.sourceItems.map((item) => item.path),
      targetPath: path,
      altKey: modifiers.altKey,
      metaKey: modifiers.metaKey,
      onSameDisk,
    });
  }

  function resolveDropValidity(args: {
    surface: InternalDropTargetSurface;
    path: string | null;
    targetSupportsMove: boolean;
    targetIsSelected?: boolean | undefined;
    operation: InternalDropOperation;
  }): Exclude<DropIndicatorState, null> {
    const validation = validateInternalDrop({
      session: dragSessionRef.current,
      blocked,
      targetSurface: args.surface,
      targetPath: args.path,
      // Nothing is dropped into the Trash or a folder in it, as nothing is pasted there.
      targetSupportsMove:
        args.targetSupportsMove && !(args.path !== null && isPathInsideTrash(args.path, homePath)),
      targetIsSelected: args.targetIsSelected,
      operation: args.operation,
    });
    return validation.ok ? "valid" : "invalid";
  }

  function applyDropEffect(
    event: React.DragEvent<HTMLElement>,
    validity: Exclude<DropIndicatorState, null>,
    operation: InternalDropOperation,
  ) {
    if (validity === "valid") {
      event.preventDefault();
      event.dataTransfer.dropEffect = operation;
      return;
    }
    event.dataTransfer.dropEffect = "none";
  }

  // Checks a target under the pointer and shows the cursor and highlight for it.
  function evaluateDropTarget(
    event: React.DragEvent<HTMLElement>,
    args: {
      surface: InternalDropTargetSurface;
      path: string | null;
      targetSupportsMove: boolean;
      targetIsSelected?: boolean | undefined;
    },
  ): Exclude<DropIndicatorState, null> {
    const operation = resolveDropOperation(args.path, event);
    const validity = resolveDropValidity({ ...args, operation });
    applyDropEffect(event, validity, operation);
    return validity;
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
    const modifiers = { altKey: event.altKey, metaKey: event.metaKey };
    let operation = resolveDropOperation(path, modifiers);
    const validity = resolveDropValidity({
      surface,
      path,
      targetSupportsMove: options.targetSupportsMove,
      targetIsSelected: options.targetIsSelected,
      operation,
    });
    applyDropEffect(event, validity, operation);
    if (validity !== "valid" || !session || !path) {
      return;
    }
    event.preventDefault();
    clearTreeHoverExpand();
    // The drop does what the disks say, not only what the paths suggested: a network share
    // or a disk mounted outside /Volumes is another disk, and moving there deletes the
    // originals once copied.
    // The drag ends (and forgets its answers) as soon as the drop is in, so this drop keeps
    // its own hold on them while it waits.
    const diskIds = diskIdsRef.current;
    if (!modifiers.altKey && !modifiers.metaKey && knownOnSameDisk(session, path) === undefined) {
      const sourceFolders = getSourceFolderPaths(session.sourceItems.map((item) => item.path));
      await requestDiskIds([...sourceFolders, path]);
      const onSameDisk = knownOnSameDisk(session, path, diskIds);
      if (onSameDisk !== undefined) {
        operation = onSameDisk ? "move" : "copy";
      }
    }
    clearDragSession();
    await onDropItems(
      session.sourceItems.map((item) => item.path),
      path,
      {
        operation,
        initiator: "drag_drop",
        pendingTreeSelectionPath: options.selectTargetInTree ? path : null,
        sourceSurface: session.sourceSurface,
        validateDestinationBeforeAnalyze: options.validateWithItemProperties !== false,
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
    const validity = evaluateDropTarget(event, {
      surface: "content",
      path: entry.path,
      targetSupportsMove: isRealDirectoryEntry(entry),
      targetIsSelected: dragSessionRef.current.sourceItems.some((item) => item.path === entry.path),
    });
    setDropIndicator("content", entry.path, validity);
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
    const validity = evaluateDropTarget(event, {
      surface: targetSurface,
      path: item.path,
      targetSupportsMove,
    });
    syncTreeDropElementIndicator(event, targetSurface, item.path, validity);
    setDropIndicator(targetSurface, item.path, validity);
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

  // ── Tabs ──────────────────────────────────────────────────────────────────────────────
  // A tab takes a drop for the folder it is on. Holding the drag over a tab that is not on
  // screen shows that tab, so the items can be dropped on a folder inside it.

  function handleTabDragOver(
    tab: { id: string; path: string; active: boolean },
    event: React.DragEvent<HTMLElement>,
  ) {
    if (!dragSessionRef.current) {
      return;
    }
    const validity = evaluateDropTarget(event, {
      surface: "tab",
      path: tab.path.length > 0 ? tab.path : null,
      targetSupportsMove: tab.path.length > 0 && tab.path !== trashPath,
    });
    setDropIndicator("tab", tab.id, validity);
    if (tab.active) {
      clearTabHoverSwitch();
      return;
    }
    if (tabHoverSwitchRef.current?.tabId === tab.id) {
      return;
    }
    clearTabHoverSwitch();
    tabHoverSwitchRef.current = {
      tabId: tab.id,
      timerId: window.setTimeout(() => {
        tabHoverSwitchRef.current = null;
        setActiveDropTarget(null);
        onActivateTabRef.current(tab.id);
      }, TAB_HOVER_SWITCH_MS),
    };
  }

  function handleTabDragLeave(tab: { id: string }) {
    if (tabHoverSwitchRef.current?.tabId === tab.id) {
      clearTabHoverSwitch();
    }
    if (activeDropTarget?.surface === "tab" && activeDropTarget.path === tab.id) {
      setActiveDropTarget(null);
    }
  }

  async function handleTabDrop(
    tab: { id: string; path: string },
    event: React.DragEvent<HTMLElement>,
  ) {
    await handleDrop("tab", tab.path.length > 0 ? tab.path : null, event, {
      targetSupportsMove: tab.path.length > 0 && tab.path !== trashPath,
      validateWithItemProperties: true,
    });
  }

  function getTabDropIndicator(tabId: string): DropIndicatorState {
    if (activeDropTarget?.surface !== "tab" || activeDropTarget.path !== tabId) {
      return null;
    }
    return activeDropTarget.validity;
  }

  return {
    handleTabDragOver,
    handleTabDragLeave,
    handleTabDrop,
    getTabDropIndicator,
    dragActive,
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
    handleTreeDragOver,
    handleTreeDrop,
  };
}
