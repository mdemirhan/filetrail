import { useEffect, useMemo, useRef, useState } from "react";

import type { DirectoryEntry } from "../lib/explorerTypes";
import type { TreePresentationItem } from "../lib/favorites";
import { getTrashPath, isPathInsideTrash } from "../lib/favorites";
import {
  type InternalDragItem,
  type InternalDragSession,
  type InternalDropOperation,
  type InternalDropTargetSurface,
  type InternalMoveSourceSurface,
  allowedBySource,
  buildInternalDragSession,
  getDragFacts,
  isFileDrag,
  isRealDirectoryEntry,
  resolveInternalDropOperation,
  resolveOnSameDisk,
  validateInternalDrop,
} from "../lib/internalDragAndDrop";

// When the disk is asked which dragged-out items left, after the drag ends: a move in
// Finder can finish a little after the drop.
const DRAGGED_AWAY_CHECK_DELAYS_MS = [250, 1000, 3000];

type FileDragResult = {
  started: boolean;
  operation: "copy" | "move" | "link" | "delete" | "none";
  // Where the drag ended: a window of the app takes a drop on it itself.
  endedOver: "this_window" | "another_window" | "elsewhere";
};

// The window's own drag can be heard to end before its drop on the window arrives; the drop
// is waited for this long.
const OWN_DROP_WAIT_MS = 1000;
// A drag holds the mouse button down: a press, or the pointer moving with no button held,
// means the window's own drag is over even if its end was never heard. Not so soon after it
// started that the page may still be handed what happened before it, and not while
// drag-overs are still coming in.
const OWN_DRAG_STALE_AFTER_MS = 500;
const OWN_DRAG_OVER_QUIET_MS = 300;
// A drag that comes over the window after this long with no drag-overs was away from it, and
// may be another drag: the one the window knows may have ended without its end being heard.
const DRAG_AWAY_MS = 300;
// How many of a drop's files are looked at to tell whether it is the drag the window knows.
const DROPPED_FILES_CHECKED = 64;
// How long a drop waits for the disks to say whether it moves or copies; then the paths
// decide, as they did for the drag's cursor.
const DISK_ANSWER_WAIT_MS = 1500;

// How long a drag is held over a tab before that tab comes to the front; the same as a
// folder in the tree takes to open, and a folder in the content pane to spring open.
const TAB_HOVER_SWITCH_MS = 700;
const SPRING_LOAD_MS = 700;
// Then the folder shows it is about to open (its icon wiggles) for this long, while moving
// the pointer can still stop it.
const SPRING_WARN_MS = 625;
// The pointer must rest on the folder: moving it further than this starts the hold again.
// A folder opened under a pointer that hasn't moved since doesn't start a hold at all.
const SPRING_MOVE_PX = 3;
// A drag over a folder is still being held there while its drag-overs keep coming (they
// come many times a second, even when the pointer is still); a longer gap means it left.
const SPRING_HOLD_GAP_MS = 300;

type PointerPosition = { x: number; y: number };

// A drag from another app is still over the window while its drag-overs keep coming; this
// long without one, it has left (or was dropped elsewhere, or cancelled). The page is told
// nothing else: the drag isn't its own.
const EXTERNAL_DRAG_GONE_MS = 400;
const EXTERNAL_DRAG_CHECK_MS = 100;

// What a drag from another app carries, read from the drag itself (`system:readDraggedIn`).
export type DraggedIn = { changeCount: number; items: InternalDragItem[] };

// A drag from another app over the window: its items once read (null until then, and for a
// drag of no files), which drag it is (the drag pasteboard's change count, once read), and
// when it was last heard from.
type ExternalDrag = {
  session: InternalDragSession | null;
  changeCount: number | null;
  lastOverAt: number;
  lastCheckAt: number;
  timerId: number;
};

/**
 * Springing into folders in the content pane, as Finder does: a drag held over a folder
 * opens it in the tab, and a drag that ends without a drop in File Trail brings each tab it
 * sprang in back to where it started, whether that tab is on screen or not.
 */
export type SpringLoading = {
  /** The tab on screen. */
  tabId: string;
  /**
   * Opens the folder in the tab on screen, and answers whether it opened. Null where
   * folders don't spring open (search results).
   */
  openFolder: ((path: string) => Promise<boolean>) | null;
  /** Notes where the tab on screen is before its first spring, to come back to. */
  remember: () => unknown;
  /** Brings the tab `remember` noted back there. */
  restore: (start: unknown) => void;
};

// The drag that sprang into folders, and, for each tab it sprang in, where that tab was
// before its first spring and whether a folder has opened in it yet.
type Springs = {
  session: InternalDragSession;
  tabs: Map<string, { start: unknown; opened: boolean }>;
};

// The window's own system drag, from its start until its end is heard (or found to have
// been missed). Its drag-overs are its own, never a drag from another app's, even once its
// session has ended here (dropped, or cut short while an operation holds the window).
type OwnDrag = {
  session: InternalDragSession;
  startedAt: number;
  // Which drag it is: the drag pasteboard's change count once read, as it started.
  changeCount: number | null;
  // Waiting for the drop on this window, the drag's end already heard.
  awaitingDrop: (() => void) | null;
};

// Which disk each folder of a drag is on, as far as the disks have answered, and the answers
// on their way, per folder, so a drop can wait for one already asked for.
type DiskAnswers = {
  ids: Map<string, number | null>;
  requests: Map<string, Promise<void>>;
};

function noDiskAnswers(): DiskAnswers {
  return { ids: new Map(), requests: new Map() };
}

type DropIndicatorState = "valid" | "invalid" | null;
type ActiveDropTarget = {
  surface: InternalDropTargetSurface;
  path: string;
  validity: Exclude<DropIndicatorState, null>;
};
// The keys held during a drag, which choose between moving and copying, and what the app the
// drag came from allows (`effectAllowed`; the app's own drags allow both).
type DragModifiers = { altKey: boolean; metaKey: boolean; effectAllowed?: string | undefined };
type ActiveTreeDropElement = {
  surface: InternalDropTargetSurface;
  path: string;
  element: HTMLElement;
};

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
  /**
   * A drag that couldn't start ("drag"), or one from another app that can't be dropped
   * ("drop", once per drag), because something else holds the window.
   */
  onDragRefused?: (gesture: "drag" | "drop") => void;
  /**
   * Drags the items as a system file drag (`system:startFileDrag`), so Finder and other apps
   * take them as files; answers when the drag ends.
   */
  startFileDrag: (items: InternalDragItem[]) => Promise<FileDragResult>;
  /**
   * Which of the paths are gone from where they were (`system:findDraggedAway`); `intoTrash`
   * when the Dock's Trash took them.
   */
  findDraggedAway: (paths: string[], options: { intoTrash: boolean }) => Promise<string[]>;
  /** Items dragged out that another app moved away or put in the Trash. */
  onDraggedAway: (gonePaths: string[], options: { intoTrash: boolean }) => void;
  /** The folder on screen; once a drag has sprung into it, it takes drops itself. */
  currentPath: string;
  springLoading: SpringLoading;
  /**
   * What a drag from Finder or another app carries, while it is over the window. Without
   * it, such drags are refused.
   */
  readDraggedIn?: () => Promise<DraggedIn>;
  /**
   * Which drag is going on now (`system:readDragChangeCount`): a drag that comes back over
   * the window is checked to be the one it knows.
   */
  readDragChangeCount?: () => Promise<number>;
  /** Where a dropped file is on disk ("" when it isn't one there). */
  getPathForFile?: (file: File) => string;
  /**
   * The content pane shows search results: their folders take drops from other apps only
   * (the app's own drags from them have nowhere there to go).
   */
  contentShowsSearchResults?: boolean;
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
    startFileDrag,
    findDraggedAway,
    onDraggedAway,
    currentPath,
  } = args;
  const springLoadingRef = useRef(args.springLoading);
  springLoadingRef.current = args.springLoading;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const readDraggedInRef = useRef(args.readDraggedIn);
  readDraggedInRef.current = args.readDraggedIn;
  const readDragChangeCountRef = useRef(args.readDragChangeCount);
  readDragChangeCountRef.current = args.readDragChangeCount;
  const getPathForFileRef = useRef(args.getPathForFile);
  getPathForFileRef.current = args.getPathForFile;
  const onDragRefusedRef = useRef(onDragRefused);
  onDragRefusedRef.current = onDragRefused;
  const contentShowsSearchResults = args.contentShowsSearchResults ?? false;
  const externalDragRef = useRef<ExternalDrag | null>(null);
  // The drag (by its change count) last told it can't be dropped, so it is told once.
  const refusedDragChangeCountRef = useRef<number | null>(null);
  // The window listens for drags from other apps, and for the pointer once its own drag may
  // be over; it calls the latest of these.
  const noteFileDragOverRef = useRef<(cameBack: boolean) => void>(() => undefined);
  const noteOwnDragMaybeOverRef = useRef<() => void>(() => undefined);
  // The folder a drag is being held over in the content pane, since when, and when it was
  // last heard from.
  const contentHoverRef = useRef<{
    path: string;
    since: number;
    lastAt: number;
    at: PointerPosition;
    // When the folder started showing it is about to open.
    warnedAt: number | null;
  } | null>(null);
  // Where the pointer was when the last folder sprang open, until it moves away from there.
  const springRestRef = useRef<PointerPosition | null>(null);
  // The folder showing it is about to open.
  const [springWarningPath, setSpringWarningPath] = useState<string | null>(null);
  const springRef = useRef<Springs | null>(null);
  const ownDragRef = useRef<OwnDrag | null>(null);
  // When a drag of files was last over the window, the app's own or another app's.
  const lastFileDragOverAtRef = useRef(0);
  // A drag that came back over the window is being checked to be the one it knows; until
  // then nothing takes it.
  const checkingDragRef = useRef(false);
  // What is still to happen after a drag, which stops when the window goes away.
  const timersRef = useRef(new Set<number>());
  const unmountedRef = useRef(false);
  const [backgroundDropIndicator, setBackgroundDropIndicator] = useState<DropIndicatorState>(null);
  // What the disks have said about this drag's folders.
  const diskAnswersRef = useRef<DiskAnswers>(noDiskAnswers());
  const onActivateTabRef = useRef(onActivateTab);
  onActivateTabRef.current = onActivateTab;
  const tabHoverSwitchRef = useRef<{ tabId: string; timerId: number } | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragSessionRef = useRef<InternalDragSession | null>(null);
  // The last drag dropped inside the window: its move or copy is the app's own.
  const droppedSessionRef = useRef<InternalDragSession | null>(null);
  const treeHoverExpandRef = useRef<{ path: string; timerId: number } | null>(null);
  const activeTreeDropElementRef = useRef<ActiveTreeDropElement | null>(null);

  const trashPath = useMemo(() => getTrashPath(homePath), [homePath]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      clearTreeHoverExpand();
      clearTabHoverSwitch();
      for (const timerId of timersRef.current) {
        window.clearTimeout(timerId);
      }
      timersRef.current.clear();
    };
  }, []);

  // Waits `ms`, unless the window goes away first: then never.
  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timerId = window.setTimeout(() => {
        timersRef.current.delete(timerId);
        resolve();
      }, ms);
      timersRef.current.add(timerId);
    });
  }

  // Waits for `promise`, `ms` at most.
  function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timerId = window.setTimeout(done, ms);
      timersRef.current.add(timerId);
      void promise.then(done, done);
      function done() {
        window.clearTimeout(timerId);
        timersRef.current.delete(timerId);
        resolve();
      }
    });
  }

  // A drag from another app goes on whatever the window does; its drop is refused while the
  // window is held (see resolveDropValidity). The window's own ends here, though the system
  // drag goes on (and may still be dropped in another app).
  useEffect(() => {
    if (blocked && dragSessionRef.current?.sourceSurface !== "external") {
      clearDragSession();
    }
  }, [blocked]);

  noteFileDragOverRef.current = noteFileDragOver;
  noteOwnDragMaybeOverRef.current = noteOwnDragMaybeOver;
  // Drags of files from other apps are seen by the whole window first, before any target.
  useEffect(() => {
    function handleWindowDragOver(event: DragEvent) {
      if (!isFileDrag(event.dataTransfer)) {
        return;
      }
      const now = Date.now();
      const cameBack = now - lastFileDragOverAtRef.current >= DRAG_AWAY_MS;
      lastFileDragOverAtRef.current = now;
      noteFileDragOverRef.current(cameBack);
      // The path bar and the search field take no files: a drop there would type them in.
      if (isTextField(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "none";
        }
      }
    }
    function handleWindowDrop(event: DragEvent) {
      if (isFileDrag(event.dataTransfer) && isTextField(event.target)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function handleWindowPointer(event: PointerEvent) {
      // A press, or a move with the button let go.
      if (event.type === "pointerdown" || (event.buttons & 1) === 0) {
        noteOwnDragMaybeOverRef.current();
      }
    }
    window.addEventListener("dragenter", handleWindowDragOver, true);
    window.addEventListener("dragover", handleWindowDragOver, true);
    window.addEventListener("drop", handleWindowDrop, true);
    window.addEventListener("pointerdown", handleWindowPointer, true);
    window.addEventListener("pointermove", handleWindowPointer, true);
    return () => {
      window.removeEventListener("dragenter", handleWindowDragOver, true);
      window.removeEventListener("dragover", handleWindowDragOver, true);
      window.removeEventListener("drop", handleWindowDrop, true);
      window.removeEventListener("pointerdown", handleWindowPointer, true);
      window.removeEventListener("pointermove", handleWindowPointer, true);
      const drag = externalDragRef.current;
      if (drag) {
        window.clearInterval(drag.timerId);
        externalDragRef.current = null;
      }
    };
  }, []);

  // A new folder on screen: a hold over a folder starts again in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the folder changes.
  useEffect(() => {
    resetSpringHold();
    setBackgroundDropIndicator(null);
  }, [currentPath]);

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
    diskAnswersRef.current = noDiskAnswers();
    resetSpringHold();
    springRestRef.current = null;
    setBackgroundDropIndicator(null);
  }

  function setDropIndicator(
    surface: InternalDropTargetSurface,
    path: string,
    validity: Exclude<DropIndicatorState, null>,
  ) {
    // Drag-overs come many times a second; the window draws again only when this changes.
    setActiveDropTarget((current) =>
      current?.surface === surface && current.path === path && current.validity === validity
        ? current
        : { surface, path, validity },
    );
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
    // Looked up as the drag starts, not each time the list changes: a filter keystroke in a
    // large folder would otherwise pay for it.
    const session = buildInternalDragSession({
      sourceSurface,
      draggedPath: entry.path,
      selectedPathsInViewOrder,
      entriesByPath: new Map(activeEntries.map((activeEntry) => [activeEntry.path, activeEntry])),
    });
    if (blocked || !session) {
      event.preventDefault();
      clearDragSession();
      if (blocked && session) {
        onDragRefused?.("drag");
      }
      return;
    }
    dragSessionRef.current = session;
    setDragActive(true);
    void requestDiskIds(getDragFacts(session).folderPaths);
    // A system drag, not the page's: only it can leave the window. Its drops here still
    // come to the handlers below, while it is still this session.
    event.preventDefault();
    const ownDrag: OwnDrag = {
      session,
      startedAt: Date.now(),
      changeCount: null,
      awaitingDrop: null,
    };
    ownDragRef.current = ownDrag;
    const dragging = startFileDrag(session.sourceItems);
    // Asked after the drag has started, which puts it on the drag pasteboard: a later drag
    // over the window with another count is another drag.
    readDragChangeCountRef
      .current?.()
      .then((changeCount) => {
        ownDrag.changeCount ??= changeCount;
      })
      .catch(() => undefined);
    void dragging
      .then(async (result) => {
        // It was dropped on this window, but the page hasn't been handed the drop yet.
        if (
          result.endedOver === "this_window" &&
          result.operation !== "none" &&
          droppedSessionRef.current !== session &&
          ownDragRef.current === ownDrag
        ) {
          await waitForOwnDrop(ownDrag);
        }
        return result;
      })
      .then(
        (result) => endOwnDrag(ownDrag, result),
        // The drag never started; nothing was dropped.
        () => endOwnDrag(ownDrag, null),
      );
  }

  // Waits for the drop on this window that the drag's end says was made, a while at most.
  function waitForOwnDrop(ownDrag: OwnDrag): Promise<void> {
    return new Promise((resolve) => {
      const timerId = window.setTimeout(done, OWN_DROP_WAIT_MS);
      timersRef.current.add(timerId);
      function done() {
        window.clearTimeout(timerId);
        timersRef.current.delete(timerId);
        ownDrag.awaitingDrop = null;
        resolve();
      }
      ownDrag.awaitingDrop = done;
    });
  }

  // The window's own drag is over. Tabs it sprang in go back unless it was dropped here; items
  // another app (or the Dock's Trash) took are followed. A drop on another window of the app
  // is that window's own: it follows what it moves itself. `result` is null for a drag whose
  // end was never heard, or that never started.
  function endOwnDrag(ownDrag: OwnDrag, result: FileDragResult | null) {
    if (unmountedRef.current) {
      return;
    }
    const { session } = ownDrag;
    if (ownDragRef.current === ownDrag) {
      ownDragRef.current = null;
    }
    settleSprings(session);
    if (
      result !== null &&
      result.endedOver === "elsewhere" &&
      droppedSessionRef.current !== session &&
      (result.operation === "move" || result.operation === "delete")
    ) {
      void followDraggedAway(getDragFacts(session).sourcePaths, {
        intoTrash: result.operation === "delete",
      });
    }
    if (dragSessionRef.current === session) {
      clearDragSession();
    }
  }

  // The pointer was pressed, or moved with no button held, while the window's own drag is
  // still thought to be going: its end was missed (AppKit didn't say), so it ends now, as a
  // drag that ended without a drop here. Were it left, the window would take every later
  // drag from Finder for it, and ignore it.
  function noteOwnDragMaybeOver() {
    const ownDrag = ownDragRef.current;
    const now = Date.now();
    if (
      !ownDrag ||
      ownDrag.awaitingDrop !== null ||
      now - ownDrag.startedAt < OWN_DRAG_STALE_AFTER_MS ||
      now - lastFileDragOverAtRef.current < OWN_DRAG_OVER_QUIET_MS
    ) {
      return;
    }
    endOwnDrag(ownDrag, null);
  }

  // A drag that ends without a drop in this window brings every tab it sprang in back to
  // where it was: the tab on screen, and those it left for another.
  function settleSprings(session: InternalDragSession) {
    const springs = springRef.current?.session === session ? springRef.current : null;
    if (!springs) {
      return;
    }
    springRef.current = null;
    if (droppedSessionRef.current === session) {
      return;
    }
    for (const { start } of springs.tabs.values()) {
      springLoadingRef.current.restore(start);
    }
  }

  // Another app said it moved the items, or the Dock's Trash took them. Some apps say so for
  // a drop that moved nothing (Terminal only types the path), and Finder may finish a move
  // after the drag has ended, so the disk is asked a few times what really left.
  async function followDraggedAway(paths: string[], options: { intoTrash: boolean }) {
    let remaining = paths;
    for (const delayMs of DRAGGED_AWAY_CHECK_DELAYS_MS) {
      await wait(delayMs);
      let gone: string[];
      try {
        gone = await findDraggedAway(remaining, options);
      } catch {
        return;
      }
      if (unmountedRef.current) {
        return;
      }
      if (gone.length === 0) {
        continue;
      }
      onDraggedAway(gone, options);
      const goneSet = new Set(gone);
      remaining = remaining.filter((path) => !goneSet.has(path));
      if (remaining.length === 0) {
        return;
      }
    }
  }

  function handleDragEnd() {
    clearDragSession();
  }

  // ── Drags from other apps ─────────────────────────────────────────────────────────────
  // Finder and other apps drag files over the window as the app's own drags do, but the
  // page learns which files only at the drop. So, as one comes in, they are read from the
  // drag itself, and from then on it is a drag session like the app's own, with the same
  // targets and rules. It ends when it is dropped here, or when its drag-overs stop.

  // A drag of files over the window. `cameBack`: it comes after a while with none.
  function noteFileDragOver(cameBack: boolean) {
    const now = Date.now();
    const ownDrag = ownDragRef.current;
    if (ownDrag) {
      // The window's own drag, even once its session here has ended; unless its end went
      // unheard, and this is another drag.
      if (
        cameBack &&
        ownDrag.awaitingDrop === null &&
        now - ownDrag.startedAt >= OWN_DRAG_STALE_AFTER_MS
      ) {
        void checkDragStillKnown();
      }
      return;
    }
    const known = externalDragRef.current;
    if (known) {
      known.lastOverAt = now;
      if (cameBack) {
        void checkDragStillKnown();
      }
      return;
    }
    void readExternalDrag(startExternalDrag());
  }

  function startExternalDrag(): ExternalDrag {
    const now = Date.now();
    const drag: ExternalDrag = {
      session: null,
      changeCount: null,
      lastOverAt: now,
      lastCheckAt: now,
      timerId: 0,
    };
    drag.timerId = window.setInterval(
      () => checkExternalDragStillOver(drag),
      EXTERNAL_DRAG_CHECK_MS,
    );
    externalDragRef.current = drag;
    return drag;
  }

  // The drag came back over the window after a while away from it. It may be another one:
  // the window's own drag can end without its end being heard, and a drag from another app
  // says nothing as it ends. Every new drag changes the drag pasteboard's count, so a count
  // other than the one noted is another drag, and the one the window knew is over. Until
  // the count has come, nothing takes the drag.
  async function checkDragStillKnown() {
    const readCount = readDragChangeCountRef.current;
    const ownDrag = ownDragRef.current;
    const externalDrag = ownDrag ? null : externalDragRef.current;
    // A drag from another app not read yet is being read: that is its check.
    if (!readCount || checkingDragRef.current || (!ownDrag && externalDrag?.changeCount == null)) {
      return;
    }
    checkingDragRef.current = true;
    try {
      const changeCount = await readCount();
      if (ownDrag) {
        if (ownDragRef.current === ownDrag && changeCount !== ownDrag.changeCount) {
          await checkOwnDragStillGoing(ownDrag);
        }
      } else if (
        externalDrag &&
        externalDragRef.current === externalDrag &&
        changeCount !== externalDrag.changeCount
      ) {
        endExternalDrag(externalDrag);
        void readExternalDrag(startExternalDrag());
      }
    } catch {
      // Asked again when the drag next comes back.
    } finally {
      checkingDragRef.current = false;
    }
  }

  // The drag pasteboard's count isn't the one noted for the window's own drag (or none was
  // noted, the count not read before it changed): what it carries tells. The window's own
  // items are its own drag; anything else is another drag, and the window's own is over.
  async function checkOwnDragStillGoing(ownDrag: OwnDrag) {
    const read = readDraggedInRef.current;
    const contents = read ? await read() : null;
    if (ownDragRef.current !== ownDrag) {
      return;
    }
    if (contents && carriesOnlyItemsOf(contents, ownDrag.session)) {
      ownDrag.changeCount = contents.changeCount;
      return;
    }
    endOwnDrag(ownDrag, null);
    if (contents && externalDragRef.current === null) {
      takeExternalDrag(startExternalDrag(), contents);
    }
  }

  async function readExternalDrag(drag: ExternalDrag) {
    const read = readDraggedInRef.current;
    if (!read) {
      return;
    }
    let contents: DraggedIn;
    try {
      contents = await read();
    } catch {
      return;
    }
    takeExternalDrag(drag, contents);
  }

  function takeExternalDrag(drag: ExternalDrag, contents: DraggedIn) {
    // Gone meanwhile, or this window's own drag started: nothing to take. A drag of the
    // app's own that this window didn't start comes from another of its windows, and is
    // taken as a drop from Finder would be. One of no files (promised files, text, links)
    // is refused.
    if (
      externalDragRef.current !== drag ||
      dragSessionRef.current !== null ||
      ownDragRef.current !== null
    ) {
      return;
    }
    drag.changeCount = contents.changeCount;
    if (contents.items.length === 0) {
      return;
    }
    const [lead] = contents.items as [InternalDragItem, ...InternalDragItem[]];
    const session: InternalDragSession = {
      sourceSurface: "external",
      sourceItems: contents.items,
      leadPath: lead.path,
      leadKind: lead.kind,
    };
    drag.session = session;
    dragSessionRef.current = session;
    setDragActive(true);
    void requestDiskIds(getDragFacts(session).folderPaths);
    if (blockedRef.current && refusedDragChangeCountRef.current !== contents.changeCount) {
      refusedDragChangeCountRef.current = contents.changeCount;
      onDragRefusedRef.current?.("drop");
    }
  }

  function checkExternalDragStillOver(drag: ExternalDrag) {
    const now = Date.now();
    // The check came late, so the window was busy: the drag-overs it held back come next.
    // A hidden window's checks come late as a rule (its timers are slowed), and no drag is
    // over a window that can't be seen.
    if (now - drag.lastCheckAt > EXTERNAL_DRAG_GONE_MS && document.visibilityState !== "hidden") {
      drag.lastOverAt = now;
    }
    drag.lastCheckAt = now;
    if (now - drag.lastOverAt > EXTERNAL_DRAG_GONE_MS) {
      endExternalDrag(drag);
    }
  }

  // The drag left the window, was dropped here or elsewhere, or was cancelled. One that
  // sprang into folders and wasn't dropped here brings the tab back to where it was.
  function endExternalDrag(drag: ExternalDrag) {
    window.clearInterval(drag.timerId);
    if (externalDragRef.current === drag) {
      externalDragRef.current = null;
    }
    const session = drag.session;
    if (!session) {
      return;
    }
    settleSprings(session);
    if (dragSessionRef.current === session) {
      clearDragSession();
    }
  }

  // Asks the disks about folders not asked about yet in this drag, and resolves once every
  // one asked for has an answer (or the asking failed). Until then, the folder's path
  // decides (see resolveInternalDropOperation).
  function requestDiskIds(
    paths: string[],
    answers: DiskAnswers = diskAnswersRef.current,
  ): Promise<void> {
    if (!getDiskIds) {
      return Promise.resolve();
    }
    const { ids, requests } = answers;
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
    diskIds: ReadonlyMap<string, number | null> = diskAnswersRef.current.ids,
  ): boolean | undefined {
    return resolveOnSameDisk(getDragFacts(session).folderPaths, path, diskIds);
  }

  // The drag the targets take: none while a drag that came back is checked to be the one
  // the window knows.
  function targetSession(): InternalDragSession | null {
    return checkingDragRef.current ? null : dragSessionRef.current;
  }

  // Whether the drop hands over one of the items the window took the drag to carry. A drop
  // of another drag (the one the window knew having ended unheard) isn't taken for it. Files
  // the page can't place on disk (a drop of promised files has none) tell nothing.
  function dropCarriesDraggedItems(
    event: React.DragEvent<HTMLElement>,
    session: InternalDragSession,
  ): boolean {
    const getPathForFile = getPathForFileRef.current;
    const files = event.dataTransfer?.files;
    if (!getPathForFile || !files) {
      return true;
    }
    const { paths } = getDragFacts(session);
    let normalizedPaths: Set<string> | null = null;
    let placed = 0;
    for (let index = 0; index < Math.min(files.length, DROPPED_FILES_CHECKED); index += 1) {
      const file = files[index];
      const path = file ? getPathForFile(file) : "";
      if (path.length === 0) {
        continue;
      }
      if (paths.has(path)) {
        return true;
      }
      // The same name may come composed one way from the drag and another from the disk.
      normalizedPaths ??= new Set([...paths].map((sourcePath) => sourcePath.normalize("NFC")));
      if (normalizedPaths.has(path.normalize("NFC"))) {
        return true;
      }
      placed += 1;
    }
    return placed === 0;
  }

  // The drag the window knew is over, another drag having been dropped: it ends as one that
  // wasn't dropped here.
  function endStaleDrag(session: InternalDragSession) {
    const ownDrag = ownDragRef.current;
    const externalDrag = externalDragRef.current;
    if (ownDrag?.session === session) {
      endOwnDrag(ownDrag, null);
    } else if (externalDrag?.session === session) {
      endExternalDrag(externalDrag);
    } else if (dragSessionRef.current === session) {
      clearDragSession();
    }
  }

  // Read again on every dragover, so the cursor changes as soon as Option or Command is
  // pressed or let go, and on the drop itself, so the drop does what the cursor showed.
  function resolveDropOperation(
    path: string | null,
    modifiers: DragModifiers,
  ): InternalDropOperation {
    const session = targetSession();
    if (!session || !path) {
      return "move";
    }
    const onSameDisk = knownOnSameDisk(session, path);
    if (onSameDisk === undefined) {
      void requestDiskIds([path]);
    }
    return allowedBySource(
      resolveInternalDropOperation({
        sourcePaths: getDragFacts(session).sourcePaths,
        targetPath: path,
        altKey: modifiers.altKey,
        metaKey: modifiers.metaKey,
        onSameDisk,
      }),
      modifiers.effectAllowed,
    );
  }

  function resolveDropValidity(args: {
    surface: InternalDropTargetSurface;
    path: string | null;
    targetSupportsMove: boolean;
    targetIsSelected?: boolean | undefined;
    operation: InternalDropOperation;
    // The drag on its way; a drop waiting on the disks holds on to its own.
    session?: InternalDragSession | null;
  }): Exclude<DropIndicatorState, null> {
    const validation = validateInternalDrop({
      session: args.session !== undefined ? args.session : targetSession(),
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
    const operation = resolveDropOperation(args.path, dragModifiers(event));
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
    const session = targetSession();
    const modifiers = dragModifiers(event);
    let operation = resolveDropOperation(path, modifiers);
    const validityFor = (dropOperation: InternalDropOperation) =>
      resolveDropValidity({
        surface,
        path,
        targetSupportsMove: options.targetSupportsMove,
        targetIsSelected: options.targetIsSelected,
        operation: dropOperation,
        session,
      });
    const validity = validityFor(operation);
    applyDropEffect(event, validity, operation);
    if (validity !== "valid" || !session || !path) {
      return;
    }
    event.preventDefault();
    if (!dropCarriesDraggedItems(event, session)) {
      endStaleDrag(session);
      return;
    }
    droppedSessionRef.current = session;
    // The drag's end may have been heard first, and waits for this.
    if (ownDragRef.current?.session === session) {
      ownDragRef.current.awaitingDrop?.();
    }
    // The drag ends with its drop, before the disks are waited for: a drag that comes over
    // the window meanwhile is a new one. This drop keeps its own hold on what the disks
    // have said, and are still to say.
    const answers = diskAnswersRef.current;
    const externalDrag =
      externalDragRef.current?.session === session ? externalDragRef.current : null;
    if (externalDrag) {
      endExternalDrag(externalDrag);
    } else {
      clearDragSession();
    }
    // The drop does what the disks say, not only what the paths suggested: a network share
    // or a disk mounted outside /Volumes is another disk, and moving there deletes the
    // originals once copied. A disk that is slow to say (a share that doesn't answer)
    // leaves it to the paths.
    let stillValid = true;
    if (
      !modifiers.altKey &&
      !modifiers.metaKey &&
      knownOnSameDisk(session, path, answers.ids) === undefined
    ) {
      await waitAtMost(
        requestDiskIds([...getDragFacts(session).folderPaths, path], answers),
        DISK_ANSWER_WAIT_MS,
      );
      const onSameDisk = knownOnSameDisk(session, path, answers.ids);
      if (onSameDisk !== undefined) {
        operation = allowedBySource(onSameDisk ? "move" : "copy", modifiers.effectAllowed);
        // A move where the paths suggested a copy may be one into the items' own folder.
        stillValid = validityFor(operation) === "valid";
      }
    }
    if (!stillValid) {
      return;
    }
    await onDropItems(getDragFacts(session).sourcePaths, path, {
      operation,
      initiator: "drag_drop",
      pendingTreeSelectionPath: options.selectTargetInTree ? path : null,
      sourceSurface: session.sourceSurface,
      validateDestinationBeforeAnalyze: options.validateWithItemProperties !== false,
    });
  }

  function getContentItemDropIndicator(path: string): DropIndicatorState | "springing" {
    if (activeDropTarget?.surface !== "content" || activeDropTarget.path !== path) {
      return null;
    }
    return springWarningPath === path && activeDropTarget.validity === "valid"
      ? "springing"
      : activeDropTarget.validity;
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
    const session = targetSession();
    if (!session || !isFolderLike(entry) || !contentTakesDrag()) {
      return;
    }
    // A folder decides for itself; the pane behind it takes only what is dropped elsewhere.
    event.stopPropagation();
    const validity = evaluateDropTarget(event, {
      surface: "content",
      path: entry.path,
      targetSupportsMove: isRealDirectoryEntry(entry),
      targetIsSelected: getDragFacts(session).paths.has(entry.path),
    });
    setDropIndicator("content", entry.path, validity);
    setBackgroundDropIndicator(null);
    springWhenHeld(entry.path, validity === "valid" && isRealDirectoryEntry(entry), {
      x: event.clientX,
      y: event.clientY,
    });
  }

  // Search results take drops from other apps only.
  function contentTakesDrag(): boolean {
    return !contentShowsSearchResults || targetSession()?.sourceSurface === "external";
  }

  // The pane's own folder takes a drag from another app wherever it is held (the empty space,
  // a file), and the app's own drags once they have sprung into it, in this tab.
  function backgroundTakesDrop(session: InternalDragSession): boolean {
    return (
      currentPath.length > 0 &&
      (session.sourceSurface === "external" ||
        (springRef.current?.session === session &&
          springRef.current.tabs.get(springLoadingRef.current.tabId)?.opened === true))
    );
  }

  function resetSpringHold() {
    contentHoverRef.current = null;
    setSpringWarningPath(null);
  }

  // A folder the drag rests on opens, as in Finder: after a hold it shows it is about to
  // open, and then opens, unless the pointer moves first.
  function springWhenHeld(path: string, canSpring: boolean, pointer: PointerPosition) {
    const session = targetSession();
    const springLoading = springLoadingRef.current;
    const openFolder = springLoading.openFolder;
    if (!canSpring || !session || !openFolder || blocked || path === currentPath) {
      resetSpringHold();
      return;
    }
    // A folder that came under the pointer as the last one opened waits for it to move.
    const rest = springRestRef.current;
    if (rest) {
      if (distance(pointer, rest) <= SPRING_MOVE_PX) {
        return;
      }
      springRestRef.current = null;
    }
    const now = Date.now();
    const hover = contentHoverRef.current;
    if (
      hover?.path !== path ||
      now - hover.lastAt > SPRING_HOLD_GAP_MS ||
      distance(pointer, hover.at) > SPRING_MOVE_PX
    ) {
      contentHoverRef.current = { path, since: now, lastAt: now, at: pointer, warnedAt: null };
      setSpringWarningPath(null);
      return;
    }
    hover.lastAt = now;
    if (hover.warnedAt === null) {
      if (now - hover.since >= SPRING_LOAD_MS) {
        hover.warnedAt = now;
        setSpringWarningPath(path);
      }
      return;
    }
    if (now - hover.warnedAt < SPRING_WARN_MS) {
      return;
    }
    resetSpringHold();
    springRestRef.current = pointer;
    setActiveDropTarget(null);
    void springOpen(session, springLoading, openFolder, path);
  }

  // Opens the folder in the tab on screen. Where the tab was before the drag's first spring
  // in it is noted first, to come back to even if the drag ends before the folder is on
  // screen. Only a folder that opens makes the tab's folder take drops: one that can't be
  // read leaves the drag as it was.
  async function springOpen(
    session: InternalDragSession,
    springLoading: SpringLoading,
    openFolder: (path: string) => Promise<boolean>,
    path: string,
  ) {
    let springs = springRef.current;
    if (springs?.session !== session) {
      springs = { session, tabs: new Map() };
      springRef.current = springs;
    }
    const { tabId } = springLoading;
    let tab = springs.tabs.get(tabId);
    if (!tab) {
      tab = { start: springLoading.remember(), opened: false };
      springs.tabs.set(tabId, tab);
    }
    const opened = await openFolder(path).catch(() => false);
    if (opened) {
      tab.opened = true;
    } else if (!tab.opened) {
      // Nothing opened in the tab: it is where it was.
      springs.tabs.delete(tabId);
    }
  }

  // A drag over the content pane away from its folders: on a file or on empty space. The
  // folder on screen takes the drop of a drag from another app, and of the app's own once it
  // has sprung into that folder.
  function handleContentBackgroundDragOver(event: React.DragEvent<HTMLElement>) {
    const session = targetSession();
    if (!session) {
      return;
    }
    resetSpringHold();
    if (!backgroundTakesDrop(session)) {
      event.dataTransfer.dropEffect = "none";
      setBackgroundDropIndicator(null);
      return;
    }
    setBackgroundDropIndicator(
      evaluateDropTarget(event, {
        surface: "content",
        path: currentPath,
        targetSupportsMove: true,
      }),
    );
  }

  function handleContentBackgroundDragLeave(event: React.DragEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
      setBackgroundDropIndicator(null);
    }
  }

  async function handleContentBackgroundDrop(event: React.DragEvent<HTMLElement>) {
    const session = targetSession();
    if (!session || !backgroundTakesDrop(session)) {
      return;
    }
    setBackgroundDropIndicator(null);
    await handleDrop("content", currentPath, event, {
      targetSupportsMove: true,
      validateWithItemProperties: true,
    });
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
    if (!isFolderLike(entry) || !contentTakesDrag()) {
      return;
    }
    event.stopPropagation();
    const session = targetSession();
    await handleDrop("content", entry.path, event, {
      targetSupportsMove: isRealDirectoryEntry(entry),
      targetIsSelected: session !== null && getDragFacts(session).paths.has(entry.path),
      validateWithItemProperties: true,
    });
  }

  function handleTreeDragEnter(
    item: TreePresentationItem,
    event: React.DragEvent<HTMLElement>,
    subview: "favorites" | "tree",
  ) {
    if (!targetSession() || !item.path) {
      return;
    }
    resetSpringHold();
    const targetSurface = treeItemSurface(item);
    const validity = evaluateDropTarget(event, {
      surface: targetSurface,
      path: item.path,
      targetSupportsMove: treeItemTakesDrops(item),
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
    await handleDrop(treeItemSurface(item), item.path, event, {
      targetSupportsMove: treeItemTakesDrops(item),
      selectTargetInTree:
        item.kind !== "location" && (subview === "tree" || item.kind === "favorite"),
      validateWithItemProperties: true,
    });
  }

  // A disk under Locations takes a drop as a favorite does.
  function treeItemSurface(item: TreePresentationItem): InternalDropTargetSurface {
    return item.kind === "favorite" || item.kind === "location" ? "favorite" : "tree";
  }

  // A folder in the tree takes drops, a link to one doesn't; a favorite or a disk does,
  // the Trash doesn't.
  function treeItemTakesDrops(item: TreePresentationItem): boolean {
    if (item.kind === "filesystem") {
      return !item.isSymlink;
    }
    return treeItemSurface(item) === "favorite" && item.path !== trashPath;
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────────────────
  // A tab takes a drop for the folder it is on. Holding the drag over a tab that is not on
  // screen shows that tab, so the items can be dropped on a folder inside it.

  function handleTabDragOver(
    tab: { id: string; path: string; active: boolean; kind?: string },
    event: React.DragEvent<HTMLElement>,
  ) {
    if (!targetSession()) {
      return;
    }
    resetSpringHold();
    const validity = evaluateDropTarget(event, {
      surface: "tab",
      path: tab.path.length > 0 ? tab.path : null,
      targetSupportsMove: tabTakesDrops(tab),
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
    tab: { id: string; path: string; kind?: string },
    event: React.DragEvent<HTMLElement>,
  ) {
    await handleDrop("tab", tab.path.length > 0 ? tab.path : null, event, {
      targetSupportsMove: tabTakesDrops(tab),
      validateWithItemProperties: true,
    });
  }

  // A tab takes a drop for the folder it shows. One showing search results shows no
  // folder (the folder behind them isn't on screen), so, as Paste there, it takes none.
  function tabTakesDrops(tab: { path: string; kind?: string }): boolean {
    return tab.path.length > 0 && tab.path !== trashPath && tab.kind !== "search";
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
    handleContentBackgroundDragOver,
    handleContentBackgroundDragLeave,
    handleContentBackgroundDrop,
    backgroundDropIndicator,
    handleContentDrop,
    handleDragEnd,
    handleSearchDragStart: handleDragStart,
    handleTreeDragEnter,
    handleTreeDragOver,
    handleTreeDrop,
  };
}

function dragModifiers(event: React.DragEvent<HTMLElement>): DragModifiers {
  return {
    altKey: event.altKey,
    metaKey: event.metaKey,
    effectAllowed: event.dataTransfer?.effectAllowed,
  };
}

// Where typing goes: a drop of files there would type their paths in.
function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") !== null
  );
}

// Whether everything a drag carries (and it carries something) is among the session's items:
// the window's own drag, read back from the drag pasteboard, less any item gone since.
function carriesOnlyItemsOf(contents: DraggedIn, session: InternalDragSession): boolean {
  const { paths } = getDragFacts(session);
  return contents.items.length > 0 && contents.items.every((item) => paths.has(item.path));
}

// Folders take drops (and spring open); a link to one is refused as a target.
function isFolderLike(entry: DirectoryEntry): boolean {
  return entry.kind === "directory" || entry.kind === "symlink_directory";
}

function distance(a: PointerPosition, b: PointerPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
