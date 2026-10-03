import {
  type ComponentProps,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { IpcRequest } from "@filetrail/contracts";

import type { ExplorerViewMode, ThemePreference } from "../../shared/appPreferences";
import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ShortcutCommandId } from "../../shared/shortcuts";
import {
  DEFAULT_TOP_TOOLBAR_ITEMS,
  type ToolbarItemId,
  addTopToolbarItem,
  getToolbarItemDefinition,
  getTopToolbarPaletteItems,
  insertTopToolbarItem,
  isRequiredTopToolbarItem,
  moveTopToolbarItem,
  removeTopToolbarItem,
  sanitizeTopToolbarItems,
} from "../../shared/toolbarItems";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import type { HistoryMenuEntry } from "../lib/historyMenu";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { placeDropdownMenu } from "../lib/menuPlacement";
import { PANE_LAYOUT_CHANGE_MS, PaneLayoutChangeContext } from "../lib/paneLayoutChange";
import { formatTooltip, getToolbarItemTooltip } from "../lib/tooltips";
import {
  type TopToolbarSlot,
  resolveToolbarCapsules,
  resolveToolbarDropIndex,
  resolveTopToolbarSlots,
  resolveVisibleOptionalCount,
  selectTopToolbarSlots,
} from "../lib/topToolbarLayout";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { InfoPanel } from "./GetInfoPanel";
import { HistoryButton } from "./HistoryButton";
import { MenuCheck } from "./MenuCheck";
import { SearchOptionsMenu } from "./SearchOptionsMenu";
import { SearchWorkspace } from "./SearchWorkspace";
import { ThemeMenuButton } from "./ThemeMenuButton";
import { ToolbarCustomizePanel } from "./ToolbarCustomizePanel";
import { ToolbarIcon } from "./ToolbarIcon";
import { TreePane } from "./TreePane";

type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type TreePaneProps = ComponentProps<typeof TreePane>;
type SearchWorkspaceProps = ComponentProps<typeof SearchWorkspace>;
type InfoPanelProps = ComponentProps<typeof InfoPanel>;

function getSortByLabel(sortBy: SortBy) {
  if (sortBy === "size") {
    return "Size";
  }
  if (sortBy === "modified") {
    return "Date Modified";
  }
  if (sortBy === "kind") {
    return "Kind";
  }
  return "Name";
}

// `command` is the shortcut command the item stands for; its key is shown beside the label.
type ViewOptionsMenuItem =
  | {
      kind: "toggle";
      id: string;
      label: string;
      command: ShortcutCommandId;
      checked: boolean;
      onSelect: () => void;
    }
  | { kind: "action"; id: string; label: string; command?: ShortcutCommandId; onSelect: () => void }
  | { kind: "separator"; id: string };

// An item being dragged while the toolbar is customized.
type ToolbarDrag = {
  itemId: ToolbarItemId;
  // Its place in the saved order, or null for an item dragged in from the palette.
  fromIndex: number | null;
  // Where it would land among the other items, or null while it is away from the toolbar
  // (letting go then takes it off, or leaves a palette item out). An item that always stays
  // keeps the last place it had.
  targetIndex: number | null;
};

// How far the pointer moves before a press on an item becomes a drag.
const TOOLBAR_DRAG_THRESHOLD = 4;
// How far below the toolbar a dragged item still counts as over it.
const TOOLBAR_DROP_REACH_BELOW = 28;
const TOOLBAR_REORDER_MS = 180;
const TOOLBAR_FLASH_MS = 900;

// The edges of each item on screen while the toolbar is customized, from the toolbar's
// top left corner: where its handle goes.
type ToolbarHandleRect = { key: string; left: number; top: number; width: number; height: number };

export function ExplorerWorkspace({
  preferencesReady,
  restoredPaneWidths,
  treeWidth,
  inspectorWidth,
  beginResize,
  infoPanelOpen,
  treePaneProps,
  searchWorkspaceProps,
  infoPanelProps,
  currentPath,
  topToolbarItems,
  canGoBack,
  canGoForward,
  backHistory = [],
  forwardHistory = [],
  onGoToHistoryIndex = () => undefined,
  focusedPane,
  selectedEntryExists,
  goBack,
  goForward,
  navigateToParentFolder,
  refreshDirectory,
  viewMode,
  onViewModeChange,
  sortBy,
  sortDirection,
  onSortChange,
  foldersFirst = false,
  onToggleFoldersFirst = () => undefined,
  includeHidden = false,
  onToggleHidden = () => undefined,
  onToggleInfoPanel = () => undefined,
  infoRowOpen = false,
  onToggleInfoRow = () => undefined,
  theme = "auto",
  onSelectTheme = () => undefined,
  searchShellRef,
  searchPopoverOpen,
  onSearchShellBlur,
  searchPointerIntentRef,
  onSearchShellPointerIntent,
  onSearchSubmit,
  searchInputRef,
  searchDraftQuery,
  onSearchInputFocus,
  onSearchDraftQueryChange,
  onSearchInputEscape,
  onSearchInputArrowDown,
  onClearSearchDraft,
  searchPatternMode,
  onSearchPatternModeChange,
  searchMatchScope,
  onSearchMatchScopeChange,
  searchRecursive,
  onSearchRecursiveChange,
  searchSkipGitFolders,
  onSearchSkipGitFoldersChange,
  searchSkipGitIgnored,
  onSearchSkipGitIgnoredChange,
  canRunRendererCommand,
  onRendererCommand,
  onCustomizeToolbar,
  customizingToolbar = false,
  onFinishCustomizingToolbar = () => undefined,
  onTopToolbarItemsChange = () => undefined,
  onPaneResizeKey,
  toolbarTitle = "",
  toolbarSubtitle = "",
  tabStrip = null,
  clipboardButton = null,
}: {
  preferencesReady: boolean;
  restoredPaneWidths: { treeWidth: number; inspectorWidth: number } | null;
  treeWidth: number;
  inspectorWidth: number;
  beginResize: (pane: "tree" | "inspector") => (event: React.PointerEvent<HTMLDivElement>) => void;
  infoPanelOpen: boolean;
  treePaneProps: TreePaneProps;
  searchWorkspaceProps: SearchWorkspaceProps;
  infoPanelProps: InfoPanelProps;
  currentPath: string;
  topToolbarItems: ToolbarItemId[];
  canGoBack: boolean;
  canGoForward: boolean;
  /** The folders Back and Forward lead to, nearest first, for their hold menus. */
  backHistory?: HistoryMenuEntry[];
  forwardHistory?: HistoryMenuEntry[];
  onGoToHistoryIndex?: (historyIndex: number) => void;
  focusedPane: "tree" | "content" | null;
  selectedEntryExists: boolean;
  goBack: () => void;
  goForward: () => void;
  navigateToParentFolder: () => void;
  refreshDirectory: () => Promise<void>;
  /** The row of tabs, while there is more than one. */
  tabStrip?: React.ReactNode;
  /** The clipboard button, while files or folders are waiting to be pasted. */
  clipboardButton?: React.ReactNode;
  viewMode: ExplorerViewMode;
  onViewModeChange: (value: ExplorerViewMode) => void;
  sortBy: SortBy;
  sortDirection: "asc" | "desc";
  onSortChange: (value: SortBy) => void;
  foldersFirst?: boolean;
  onToggleFoldersFirst?: () => void;
  includeHidden?: boolean;
  onToggleHidden?: () => void;
  onToggleInfoPanel?: () => void;
  infoRowOpen?: boolean;
  onToggleInfoRow?: () => void;
  theme?: ThemePreference;
  onSelectTheme?: (theme: ThemePreference) => void;
  searchShellRef: React.RefObject<HTMLDivElement | null>;
  searchPopoverOpen: boolean;
  onSearchShellBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  searchPointerIntentRef: MutableRefObject<boolean>;
  onSearchShellPointerIntent: () => void;
  onSearchSubmit: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchDraftQuery: string;
  onSearchInputFocus: () => void;
  onSearchDraftQueryChange: (value: string) => void;
  onSearchInputEscape: () => void;
  onSearchInputArrowDown: () => void;
  onClearSearchDraft: () => void;
  searchPatternMode: SearchPatternMode;
  onSearchPatternModeChange: (value: SearchPatternMode) => void;
  searchMatchScope: SearchMatchScope;
  onSearchMatchScopeChange: (value: SearchMatchScope) => void;
  searchRecursive: boolean;
  onSearchRecursiveChange: (value: boolean) => void;
  searchSkipGitFolders: boolean;
  onSearchSkipGitFoldersChange: (value: boolean) => void;
  searchSkipGitIgnored: boolean;
  onSearchSkipGitIgnoredChange: (value: boolean) => void;
  canRunRendererCommand: (command: RendererCommandType) => boolean;
  onRendererCommand: (command: RendererCommandType) => void;
  /** Starts customizing the toolbar, in place. */
  onCustomizeToolbar: () => void;
  /** True while the toolbar is customized: its items are moved, not used. */
  customizingToolbar?: boolean;
  onFinishCustomizingToolbar?: () => void;
  onTopToolbarItemsChange?: (items: ToolbarItemId[]) => void;
  onPaneResizeKey: (pane: "tree" | "inspector", event: ReactKeyboardEvent<HTMLDivElement>) => void;
  toolbarTitle?: string;
  toolbarSubtitle?: string;
}) {
  const toolbarRef = useRef<HTMLElement | null>(null);
  const toolbarRowRef = useRef<HTMLDivElement | null>(null);
  const sortMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const clipboardShown = clipboardButton !== null && clipboardButton !== undefined;
  const savedToolbarItems = useMemo(
    () => sanitizeTopToolbarItems(topToolbarItems),
    [topToolbarItems],
  );
  // The toolbar's items in their saved order. One of the required ones is not always there:
  // the clipboard button, which shows only while something waits to be pasted (and while
  // the toolbar is customized, so that it can be moved).
  const topToolbarSlots = useMemo(
    () =>
      resolveTopToolbarSlots(savedToolbarItems).filter(
        (slot) => slot.id !== "clipboard" || clipboardShown || customizingToolbar,
      ),
    [clipboardShown, customizingToolbar, savedToolbarItems],
  );
  const optionalTopToolbarSlots = useMemo(
    () => topToolbarSlots.filter((slot) => !isRequiredTopToolbarItem(slot.id)),
    [topToolbarSlots],
  );
  const [visibleOptionalCount, setVisibleOptionalCount] = useState(optionalTopToolbarSlots.length);
  const viewOptionsButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [viewOptionsMenuStyle, setViewOptionsMenuStyle] = useState<ReturnType<
    typeof placeDropdownMenu
  > | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  useKeepInViewport(sortMenuRef, sortMenuOpen);
  useKeepInViewport(viewOptionsMenuRef, viewOptionsMenuStyle !== null);
  const [sortMenuViewportPosition, setSortMenuViewportPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // The toolbar is not on screen until preferences and pane widths are restored.
  const workspaceReady =
    preferencesReady &&
    (restoredPaneWidths === null ||
      (treeWidth === restoredPaneWidths.treeWidth &&
        inspectorWidth === restoredPaneWidths.inspectorWidth));

  // Opening or closing the Info panel changes the content pane's width in one step; the panel
  // slides in over the space it takes, or out over the content, and icon view moves its
  // items to their new places (see PaneLayoutChangeContext). A closing panel stays on screen,
  // out of reach, until it has slid away.
  const [infoPanelChange, setInfoPanelChange] = useState({
    open: infoPanelOpen,
    count: 0,
    slide: null as "in" | "out" | null,
  });
  if (infoPanelChange.open !== infoPanelOpen) {
    setInfoPanelChange({
      open: infoPanelOpen,
      count: infoPanelChange.count + 1,
      slide: workspaceReady ? (infoPanelOpen ? "in" : "out") : null,
    });
  }
  useEffect(() => {
    if (infoPanelChange.slide === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setInfoPanelChange((current) => ({ ...current, slide: null })),
      PANE_LAYOUT_CHANGE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [infoPanelChange]);
  const infoPanelClosing = !infoPanelOpen && infoPanelChange.slide === "out";

  // Works out how many of the removable items fit, from the width of the row and the
  // widths of the items: the removable ones are measured in a hidden copy (those that do
  // not fit are not in the row), the clipboard button and View Options where they are.
  // Measured again once the toolbar appears: a saved toolbar arrives before it does, and
  // would otherwise stay cut to the number of buttons in the default one.
  useLayoutEffect(() => {
    void workspaceReady;
    void customizingToolbar;
    const toolbar = toolbarRef.current;
    const row = toolbarRowRef.current;
    if (!toolbar || !row) {
      return;
    }
    const measuredItems = Array.from(
      toolbar.querySelectorAll<HTMLElement>("[data-top-toolbar-measure]"),
    );

    const updateVisibleCount = () => {
      const widths = new Map(
        measuredItems.map((item) => [
          item.dataset.topToolbarMeasure ?? "",
          Math.ceil(item.getBoundingClientRect().width),
        ]),
      );
      const nextVisibleCount = resolveVisibleOptionalCount({
        slots: topToolbarSlots,
        widths,
        availableWidth: Math.floor(row.clientWidth),
      });
      setVisibleOptionalCount((currentCount) =>
        currentCount === nextVisibleCount ? currentCount : nextVisibleCount,
      );
    };

    updateVisibleCount();
    const observer = new ResizeObserver(() => {
      updateVisibleCount();
    });
    observer.observe(row);
    for (const item of measuredItems) {
      observer.observe(item);
    }
    return () => {
      observer.disconnect();
    };
  }, [topToolbarSlots, workspaceReady, customizingToolbar]);

  useLayoutEffect(() => {
    if (!sortMenuOpen) {
      setSortMenuViewportPosition(null);
      return;
    }
    const updateSortMenuPosition = () => {
      const button = sortMenuButtonRef.current;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      const rect = button.getBoundingClientRect();
      const menuWidth = 200;
      setSortMenuViewportPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12)),
        top: rect.bottom + 8,
      });
    };
    updateSortMenuPosition();
    window.addEventListener("resize", updateSortMenuPosition);
    window.addEventListener("scroll", updateSortMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateSortMenuPosition);
      window.removeEventListener("scroll", updateSortMenuPosition, true);
    };
  }, [sortMenuOpen]);

  useEffect(() => {
    if (!sortMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (sortMenuRef.current?.contains(target) || sortMenuButtonRef.current?.contains(target)) {
        return;
      }
      setSortMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [sortMenuOpen]);

  const visibleTopToolbarSlots = useMemo(
    () => selectTopToolbarSlots(topToolbarSlots, visibleOptionalCount),
    [topToolbarSlots, visibleOptionalCount],
  );

  // When the row changes the sort button may have moved or gone; its menu does not stay behind.
  const sortMenuResetKey = visibleTopToolbarSlots.map((slot) => slot.key).join(" ");
  useEffect(() => {
    void sortMenuResetKey;
    setSortMenuOpen(false);
  }, [sortMenuResetKey]);

  useEffect(() => {
    if (!viewOptionsMenuStyle) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (viewOptionsMenuRef.current?.contains(target) ||
          viewOptionsButtonRef.current?.contains(target))
      ) {
        return;
      }
      setViewOptionsMenuStyle(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setViewOptionsMenuStyle(null);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewOptionsMenuStyle]);

  // ── Customizing the toolbar ────────────────────────────────────────────────────────────
  // The toolbar is edited where it is, as in Finder: its items are drawn as always but do
  // nothing (the row is inert), and a handle over each one moves it. An item dragged along
  // the row opens a gap where it will land and the items around it slide aside; one dragged
  // away from the toolbar is taken off when let go. The panel under the toolbar holds what
  // can be added. Every change is saved at once; Done (or Escape) ends customizing.
  const toolbarPanelRef = useRef<HTMLDialogElement | null>(null);
  const toolbarGhostRef = useRef<HTMLDivElement | null>(null);
  const [toolbarDrag, setToolbarDragState] = useState<ToolbarDrag | null>(null);
  // The drag as of the last change, for the window's pointer listeners.
  const toolbarDragRef = useRef<ToolbarDrag | null>(null);
  const setToolbarDrag = useCallback((next: ToolbarDrag | null) => {
    toolbarDragRef.current = next;
    setToolbarDragState(next);
  }, []);
  // A press on an item that becomes a drag once the pointer has moved far enough.
  const pendingToolbarDragRef = useRef<{
    itemId: ToolbarItemId;
    fromIndex: number | null;
    startX: number;
    startY: number;
  } | null>(null);
  // The pointer, kept out of state so that following it redraws only the dragged item.
  const toolbarPointerRef = useRef({ x: 0, y: 0 });
  // The item pressed in the toolbar, until its gap is drawn: it is not one of the others.
  const pressedToolbarSlotRef = useRef<string | null>(null);
  // A drag from the palette ends in a click on the item when let go over it; that click
  // must not add the item.
  const suppressPaletteClickRef = useRef(false);
  const [toolbarHandleRects, setToolbarHandleRects] = useState<ToolbarHandleRect[]>([]);
  const toolbarSlotLeftsRef = useRef(new Map<string, number>());
  const focusToolbarHandleRef = useRef<string | null>(null);
  const [flashedToolbarSlot, setFlashedToolbarSlot] = useState<{
    key: string;
    count: number;
  } | null>(null);

  // The order on screen: the saved one, with the dragged item where it would land.
  const previewToolbarItems = useMemo(() => {
    if (!toolbarDrag) {
      return savedToolbarItems;
    }
    const others =
      toolbarDrag.fromIndex === null
        ? savedToolbarItems
        : savedToolbarItems.filter((_, index) => index !== toolbarDrag.fromIndex);
    return toolbarDrag.targetIndex === null
      ? others
      : insertTopToolbarItem(others, toolbarDrag.itemId, toolbarDrag.targetIndex);
  }, [savedToolbarItems, toolbarDrag]);
  const editToolbarSlots = useMemo(
    () => resolveTopToolbarSlots(previewToolbarItems),
    [previewToolbarItems],
  );
  const placeholderToolbarIndex = toolbarDrag?.targetIndex ?? null;
  const removingToolbarItem =
    toolbarDrag !== null && toolbarDrag.fromIndex !== null && toolbarDrag.targetIndex === null;
  // The buttons the window has no room for are hidden while it is used: here they are
  // drawn faint, the last ones first, as they would go.
  const hiddenOptionalCount = Math.max(0, optionalTopToolbarSlots.length - visibleOptionalCount);
  const overflowToolbarKeys = useMemo(() => {
    const optional = editToolbarSlots.filter((slot) => !isRequiredTopToolbarItem(slot.id));
    return new Set(optional.slice(optional.length - hiddenOptionalCount).map((slot) => slot.key));
  }, [editToolbarSlots, hiddenOptionalCount]);
  const paletteToolbarItems = useMemo(
    () => getTopToolbarPaletteItems(savedToolbarItems),
    [savedToolbarItems],
  );
  const isDefaultToolbar =
    savedToolbarItems.length === DEFAULT_TOP_TOOLBAR_ITEMS.length &&
    savedToolbarItems.every((itemId, index) => itemId === DEFAULT_TOP_TOOLBAR_ITEMS[index]);

  const commitToolbarItems = useCallback(
    (next: ToolbarItemId[]) => {
      if (
        next.length === savedToolbarItems.length &&
        next.every((itemId, index) => itemId === savedToolbarItems[index])
      ) {
        return;
      }
      onTopToolbarItemsChange(next);
    },
    [savedToolbarItems, onTopToolbarItemsChange],
  );
  // What the window's listeners need of this render.
  const toolbarEditingRef = useRef({
    savedToolbarItems,
    commitToolbarItems,
    onFinishCustomizingToolbar,
  });
  toolbarEditingRef.current = { savedToolbarItems, commitToolbarItems, onFinishCustomizingToolbar };

  // Where the dragged item would land for a pointer at (x, y): its index among the other
  // items while the pointer is over the toolbar (or just below it), otherwise nowhere. An
  // item that always stays keeps its last place instead.
  const resolveToolbarTarget = useCallback((drag: ToolbarDrag, x: number, y: number) => {
    const toolbar = toolbarRef.current;
    const row = toolbarRowRef.current;
    if (!toolbar || !row) {
      return drag.targetIndex;
    }
    const bounds = toolbar.getBoundingClientRect();
    const overToolbar =
      y >= bounds.top &&
      y <= bounds.bottom + TOOLBAR_DROP_REACH_BELOW &&
      x >= bounds.left &&
      x <= bounds.right;
    if (!overToolbar) {
      return drag.fromIndex !== null && isRequiredTopToolbarItem(drag.itemId)
        ? drag.targetIndex
        : null;
    }
    const centers = Array.from(row.querySelectorAll<HTMLElement>(":scope > [data-toolbar-slot]"))
      .filter(
        (element) =>
          !element.hasAttribute("data-toolbar-placeholder") &&
          element.dataset.toolbarSlot !== pressedToolbarSlotRef.current,
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
    return resolveToolbarDropIndex(centers, x);
  }, []);

  const placeToolbarGhost = useCallback(() => {
    const ghost = toolbarGhostRef.current;
    if (ghost) {
      const { x, y } = toolbarPointerRef.current;
      ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }, []);

  // A drag runs on the window's pointer events, so that it goes on wherever the pointer
  // goes, including over the item's own place after its handle has moved.
  useEffect(() => {
    if (!customizingToolbar) {
      return;
    }
    const endDrag = (commit: boolean) => {
      const drag = toolbarDragRef.current;
      pendingToolbarDragRef.current = null;
      pressedToolbarSlotRef.current = null;
      if (!drag) {
        return;
      }
      if (commit) {
        const { savedToolbarItems: saved, commitToolbarItems: save } = toolbarEditingRef.current;
        if (drag.fromIndex === null) {
          if (drag.targetIndex !== null) {
            save(insertTopToolbarItem(saved, drag.itemId, drag.targetIndex));
          }
        } else if (drag.targetIndex === null) {
          save(removeTopToolbarItem(saved, drag.fromIndex));
        } else {
          save(moveTopToolbarItem(saved, drag.fromIndex, drag.targetIndex));
        }
      }
      setToolbarDrag(null);
      // The click that may follow a palette drag comes right after the pointer is let go.
      window.setTimeout(() => {
        suppressPaletteClickRef.current = false;
      }, 0);
    };
    const handlePointerMove = (event: PointerEvent) => {
      toolbarPointerRef.current = { x: event.clientX, y: event.clientY };
      let drag = toolbarDragRef.current;
      if (!drag) {
        const pending = pendingToolbarDragRef.current;
        if (
          !pending ||
          Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY) <
            TOOLBAR_DRAG_THRESHOLD
        ) {
          return;
        }
        drag = {
          itemId: pending.itemId,
          fromIndex: pending.fromIndex,
          targetIndex: pending.fromIndex,
        };
        if (pending.fromIndex === null) {
          suppressPaletteClickRef.current = true;
        }
      }
      const targetIndex = resolveToolbarTarget(drag, event.clientX, event.clientY);
      if (drag !== toolbarDragRef.current || targetIndex !== drag.targetIndex) {
        setToolbarDrag({ ...drag, targetIndex });
      }
      placeToolbarGhost();
    };
    const handlePointerUp = () => endDrag(true);
    const handleCancel = () => endDrag(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      if (toolbarDragRef.current) {
        endDrag(false);
        return;
      }
      toolbarEditingRef.current.onFinishCustomizingToolbar();
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("blur", handleCancel);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("blur", handleCancel);
      window.removeEventListener("keydown", handleKeyDown);
      endDrag(false);
    };
  }, [customizingToolbar, placeToolbarGhost, resolveToolbarTarget, setToolbarDrag]);

  // Puts a handle over each item, and slides the items that a change of order moved from
  // where they were to their new places.
  const measureToolbarHandles = useCallback((animate: boolean) => {
    const toolbar = toolbarRef.current;
    const row = toolbarRowRef.current;
    if (!toolbar || !row) {
      return;
    }
    const origin = toolbar.getBoundingClientRect();
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lefts = new Map<string, number>();
    const rects: ToolbarHandleRect[] = [];
    for (const element of Array.from(
      row.querySelectorAll<HTMLElement>(":scope > [data-toolbar-slot]"),
    )) {
      const key = element.dataset.toolbarSlot ?? "";
      // Where the item is drawn now (part way through an earlier slide, perhaps), and where
      // it is laid out.
      const shownLeft = element.getBoundingClientRect().left;
      for (const animation of element.getAnimations?.() ?? []) {
        animation.cancel();
      }
      const rect = element.getBoundingClientRect();
      lefts.set(key, rect.left);
      rects.push({
        key,
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      });
      const previousLeft = toolbarSlotLeftsRef.current.get(key);
      if (!animate || reduceMotion || previousLeft === undefined) {
        continue;
      }
      // Its old place, moved by the part of the earlier slide still to run.
      const offset = previousLeft + (shownLeft - rect.left) - rect.left;
      if (Math.abs(offset) > 0.5) {
        element.animate?.(
          [{ transform: `translateX(${offset}px)` }, { transform: "translateX(0)" }],
          { duration: TOOLBAR_REORDER_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
    }
    toolbarSlotLeftsRef.current = lefts;
    setToolbarHandleRects(rects);
  }, []);

  const editOrderKey = customizingToolbar ? editToolbarSlots.map((slot) => slot.key).join(" ") : "";
  useLayoutEffect(() => {
    void editOrderKey;
    if (!customizingToolbar) {
      toolbarSlotLeftsRef.current = new Map();
      setToolbarHandleRects((current) => (current.length === 0 ? current : []));
      return;
    }
    measureToolbarHandles(true);
  }, [customizingToolbar, editOrderKey, measureToolbarHandles]);

  // Once the dragged item's gap is drawn, the gap stands for it.
  useLayoutEffect(() => {
    if (toolbarDrag) {
      pressedToolbarSlotRef.current = null;
    }
  }, [toolbarDrag]);

  useEffect(() => {
    if (!customizingToolbar) {
      return;
    }
    const row = toolbarRowRef.current;
    if (!row) {
      return;
    }
    const observer = new ResizeObserver(() => measureToolbarHandles(false));
    observer.observe(row);
    return () => observer.disconnect();
  }, [customizingToolbar, measureToolbarHandles]);

  // An item moved or removed from the keyboard keeps the focus on the toolbar.
  useLayoutEffect(() => {
    const key = focusToolbarHandleRef.current;
    if (!key || toolbarHandleRects.length === 0) {
      return;
    }
    focusToolbarHandleRef.current = null;
    findByData(toolbarRef.current, "toolbarHandle", key)?.focus();
  }, [toolbarHandleRects]);

  // The panel takes the focus, so that Escape and Tab start there.
  useEffect(() => {
    if (customizingToolbar) {
      toolbarPanelRef.current?.focus();
    }
  }, [customizingToolbar]);

  // An item added with a click flashes where it landed.
  useEffect(() => {
    if (!flashedToolbarSlot) {
      return;
    }
    const element = findByData(toolbarRowRef.current, "toolbarSlot", flashedToolbarSlot.key);
    if (!element) {
      return;
    }
    element.removeAttribute("data-toolbar-flash");
    void element.offsetWidth;
    element.setAttribute("data-toolbar-flash", "");
    const timer = window.setTimeout(
      () => element.removeAttribute("data-toolbar-flash"),
      TOOLBAR_FLASH_MS,
    );
    return () => window.clearTimeout(timer);
  }, [flashedToolbarSlot]);

  function handleToolbarHandlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    slotKey: string,
  ) {
    if (event.button !== 0 || toolbarDragRef.current) {
      return;
    }
    const index = editToolbarSlots.findIndex((slot) => slot.key === slotKey);
    const slot = editToolbarSlots[index];
    if (!slot) {
      return;
    }
    toolbarPointerRef.current = { x: event.clientX, y: event.clientY };
    pendingToolbarDragRef.current = {
      itemId: slot.id,
      fromIndex: index,
      startX: event.clientX,
      startY: event.clientY,
    };
    pressedToolbarSlotRef.current = slotKey;
  }

  function handlePalettePointerDown(
    itemId: ToolbarItemId,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (event.button !== 0 || toolbarDragRef.current) {
      return;
    }
    toolbarPointerRef.current = { x: event.clientX, y: event.clientY };
    pendingToolbarDragRef.current = {
      itemId,
      fromIndex: null,
      startX: event.clientX,
      startY: event.clientY,
    };
    pressedToolbarSlotRef.current = null;
  }

  function handlePaletteAdd(itemId: ToolbarItemId) {
    if (suppressPaletteClickRef.current) {
      suppressPaletteClickRef.current = false;
      return;
    }
    const next = addTopToolbarItem(savedToolbarItems, itemId);
    commitToolbarItems(next);
    const key = resolveTopToolbarSlots(next).at(-1)?.key;
    if (key) {
      setFlashedToolbarSlot((current) => ({ key, count: (current?.count ?? 0) + 1 }));
    }
  }

  // ←/→ go from item to item; ⌥←/⌥→ move the item; Delete takes it off.
  function handleToolbarHandleKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    slotKey: string,
  ) {
    const index = editToolbarSlots.findIndex((slot) => slot.key === slotKey);
    const slot = editToolbarSlots[index];
    if (!slot || toolbarDragRef.current) {
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -1 : 1;
      if (event.altKey) {
        const to = index + step;
        if (to < 0 || to >= savedToolbarItems.length) {
          return;
        }
        const next = moveTopToolbarItem(savedToolbarItems, index, to);
        focusToolbarHandleRef.current = resolveTopToolbarSlots(next)[to]?.key ?? null;
        commitToolbarItems(next);
        return;
      }
      const neighbour = editToolbarSlots[index + step];
      if (neighbour) {
        findByData(toolbarRef.current, "toolbarHandle", neighbour.key)?.focus();
      }
      return;
    }
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !isRequiredTopToolbarItem(slot.id)
    ) {
      event.preventDefault();
      const next = removeTopToolbarItem(savedToolbarItems, index);
      const nextSlots = resolveTopToolbarSlots(next);
      focusToolbarHandleRef.current = nextSlots[Math.min(index, nextSlots.length - 1)]?.key ?? null;
      commitToolbarItems(next);
    }
  }

  // A right-click on the toolbar's empty room or its title offers Customize Toolbar…; the
  // items keep their own right-clicks.
  const [toolbarMenuPosition, setToolbarMenuPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const toolbarMenuRef = useRef<HTMLDivElement | null>(null);
  useKeepInViewport(toolbarMenuRef, toolbarMenuPosition !== null);
  useEffect(() => {
    if (!toolbarMenuPosition) {
      return;
    }
    const close = () => setToolbarMenuPosition(null);
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbarMenuRef.current?.contains(event.target)) {
        return;
      }
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    toolbarMenuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [toolbarMenuPosition]);
  useEffect(() => {
    if (customizingToolbar) {
      setToolbarMenuPosition(null);
    }
  }, [customizingToolbar]);

  function handleToolbarContextMenu(event: React.MouseEvent<HTMLElement>) {
    if (customizingToolbar) {
      event.preventDefault();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const slot = target.closest<HTMLElement>("[data-toolbar-slot]");
    if (slot && slot.dataset.toolbarSlot !== "title") {
      return;
    }
    event.preventDefault();
    setToolbarMenuPosition({ x: event.clientX, y: event.clientY });
  }

  const shortcutDisplay = useShortcutDisplay();
  // How the list and the panels are shown, worded and ordered as in the View menu, and the
  // way from the toolbar to the place where it is arranged.
  const viewOptionsItems: ViewOptionsMenuItem[] = [
    {
      kind: "toggle",
      id: "foldersFirst",
      label: "Folders First",
      command: "toggleFoldersFirst",
      checked: foldersFirst,
      onSelect: onToggleFoldersFirst,
    },
    {
      kind: "toggle",
      id: "hidden",
      label: "Hidden Files",
      command: "toggleHiddenFiles",
      checked: includeHidden,
      onSelect: onToggleHidden,
    },
    { kind: "separator", id: "separator-1" },
    {
      kind: "toggle",
      id: "infoPanel",
      label: "Info Panel",
      command: "toggleInfoPanel",
      checked: infoPanelOpen,
      onSelect: onToggleInfoPanel,
    },
    {
      kind: "toggle",
      id: "infoRow",
      label: "Info Row",
      command: "toggleInfoRow",
      checked: infoRowOpen,
      onSelect: onToggleInfoRow,
    },
    { kind: "separator", id: "separator-2" },
    {
      kind: "action",
      id: "customizeToolbar",
      label: "Customize Toolbar…",
      onSelect: onCustomizeToolbar,
    },
  ];

  function renderViewOptions(slot: TopToolbarSlot) {
    return (
      <div
        key={slot.key}
        className="toolbar-view-options"
        data-top-toolbar-item={slot.id}
        data-top-toolbar-measure={slot.key}
      >
        <button
          ref={viewOptionsButtonRef}
          type="button"
          className={`tb-btn tb-btn-icon${viewOptionsMenuStyle ? " active" : ""}`}
          title="View Options"
          aria-label="View options"
          aria-haspopup="menu"
          aria-expanded={viewOptionsMenuStyle !== null}
          onClick={() => {
            if (viewOptionsMenuStyle) {
              setViewOptionsMenuStyle(null);
              return;
            }
            const rect = viewOptionsButtonRef.current?.getBoundingClientRect();
            if (!rect) {
              return;
            }
            setViewOptionsMenuStyle(
              placeDropdownMenu({ anchor: rect, viewportWidth: window.innerWidth }),
            );
          }}
        >
          <ToolbarIcon name="more" />
        </button>
        {viewOptionsMenuStyle
          ? createPortal(
              <div
                ref={viewOptionsMenuRef}
                className="toolbar-menu"
                role="menu"
                aria-label="View options"
                style={viewOptionsMenuStyle}
              >
                {viewOptionsItems.map((item) => {
                  if (item.kind === "separator") {
                    return <hr key={item.id} className="toolbar-menu-separator" />;
                  }
                  // The key the command has now; nothing for a command without one.
                  const shortcut = item.command ? shortcutDisplay.label(item.command) : null;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="toolbar-menu-item"
                      role={item.kind === "toggle" ? "menuitemcheckbox" : "menuitem"}
                      aria-checked={item.kind === "toggle" ? item.checked : undefined}
                      onClick={() => {
                        setViewOptionsMenuStyle(null);
                        item.onSelect();
                      }}
                    >
                      <MenuCheck checked={item.kind === "toggle" && item.checked} />
                      <span className="toolbar-menu-label">{item.label}</span>
                      {shortcut ? <span className="toolbar-menu-shortcut">{shortcut}</span> : null}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )
          : null}
      </div>
    );
  }
  const getToolbarTooltip = (itemId: ToolbarItemId) =>
    getToolbarItemTooltip(
      itemId,
      {
        foldersFirst,
        hiddenFilesShown: includeHidden,
        infoPanelOpen,
        infoRowOpen,
      },
      shortcutDisplay,
    );

  function renderTopToolbarItem(
    itemId: ToolbarItemId,
    mode: "interactive" | "measure" = "interactive",
  ) {
    if (itemId === "topSeparator") {
      return <div key={itemId} className="titlebar-divider" aria-hidden="true" />;
    }
    if (itemId === "back") {
      return (
        <HistoryButton
          key={itemId}
          className="tb-btn tb-btn-icon toolbar-btn-muted"
          label="Back"
          title={getToolbarTooltip(itemId)}
          disabled={!canGoBack}
          entries={backHistory}
          interactive={mode === "interactive"}
          onStep={goBack}
          onSelectEntry={onGoToHistoryIndex}
        >
          <ToolbarIcon name="back" />
        </HistoryButton>
      );
    }
    if (itemId === "forward") {
      return (
        <HistoryButton
          key={itemId}
          className="tb-btn tb-btn-icon toolbar-btn-muted"
          label="Forward"
          title={getToolbarTooltip(itemId)}
          disabled={!canGoForward}
          entries={forwardHistory}
          interactive={mode === "interactive"}
          onStep={goForward}
          onSelectEntry={onGoToHistoryIndex}
        >
          <ToolbarIcon name="forward" />
        </HistoryButton>
      );
    }
    if (itemId === "up") {
      return (
        <button
          key={itemId}
          type="button"
          className="tb-btn tb-btn-icon"
          disabled={!parentDirectoryPath(currentPath)}
          onClick={navigateToParentFolder}
          title={getToolbarTooltip(itemId)}
          aria-label="Enclosing Folder"
        >
          <ToolbarIcon name="up" />
        </button>
      );
    }
    if (itemId === "view") {
      return (
        <div key={itemId} className="toolbar-group toolbar-group-view">
          <fieldset className="toolbar-segmented toolbar-segmented-native">
            <legend className="sr-only">View mode</legend>
            <button
              type="button"
              className={viewMode === "icons" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
              onClick={() => onViewModeChange("icons")}
              title={formatTooltip("View as Icons", shortcutDisplay.written("viewAsIcons"))}
              aria-label="View as Icons"
            >
              <ToolbarIcon name="icons" />
            </button>
            <button
              type="button"
              className={
                viewMode === "details" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
              }
              onClick={() => onViewModeChange("details")}
              title={formatTooltip("View as List", shortcutDisplay.written("viewAsDetails"))}
              aria-label="View as List"
            >
              <ToolbarIcon name="details" />
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
              onClick={() => onViewModeChange("list")}
              title={formatTooltip("View as Compact List", shortcutDisplay.written("viewAsList"))}
              aria-label="View as Compact List"
            >
              <ToolbarIcon name="list" />
            </button>
          </fieldset>
        </div>
      );
    }
    if (itemId === "sort") {
      // One icon button opening a menu of sort fields and direction, like Finder's
      // "Sort By" toolbar item. Choosing the active field again reverses the direction.
      const sortMenu =
        mode === "interactive" && sortMenuOpen && sortMenuViewportPosition
          ? createPortal(
              <div
                ref={sortMenuRef}
                className="toolbar-menu toolbar-sort-menu"
                role="menu"
                style={{
                  position: "fixed",
                  left: `${sortMenuViewportPosition.left}px`,
                  top: `${sortMenuViewportPosition.top}px`,
                }}
              >
                {(["name", "kind", "modified", "size"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="toolbar-menu-item"
                    onClick={() => {
                      if (value !== sortBy) {
                        onSortChange(value);
                      }
                      setSortMenuOpen(false);
                    }}
                    role="menuitemradio"
                    aria-checked={sortBy === value}
                  >
                    <MenuCheck checked={sortBy === value} />
                    <span className="toolbar-menu-label">{getSortByLabel(value)}</span>
                  </button>
                ))}
                <hr className="toolbar-menu-separator" />
                {(["asc", "desc"] as const).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    className="toolbar-menu-item"
                    onClick={() => {
                      if (direction !== sortDirection) {
                        onSortChange(sortBy);
                      }
                      setSortMenuOpen(false);
                    }}
                    role="menuitemradio"
                    aria-checked={sortDirection === direction}
                  >
                    <MenuCheck checked={sortDirection === direction} />
                    <span className="toolbar-menu-label">
                      {direction === "asc" ? "Ascending" : "Descending"}
                    </span>
                  </button>
                ))}
              </div>,
              document.body,
            )
          : null;
      return (
        <div key={itemId} className="toolbar-group">
          <button
            ref={mode === "interactive" ? sortMenuButtonRef : undefined}
            type="button"
            className={`tb-btn tb-btn-icon${sortMenuOpen ? " active" : ""}`}
            onClick={mode === "interactive" ? () => setSortMenuOpen((value) => !value) : undefined}
            tabIndex={mode === "interactive" ? undefined : -1}
            title={`Sort By: ${getSortByLabel(sortBy)}, ${
              sortDirection === "asc" ? "Ascending" : "Descending"
            }`}
            aria-label="Sort by"
            aria-haspopup="menu"
            aria-expanded={sortMenuOpen}
          >
            <ToolbarIcon name="sort" />
          </button>
          {sortMenu}
        </div>
      );
    }
    if (itemId === "search") {
      return (
        <div key={itemId} className="toolbar-search-slot" data-top-toolbar-item={itemId}>
          <div
            ref={searchShellRef}
            className={`toolbar-search-shell${searchPopoverOpen ? " active" : ""}`}
            onBlurCapture={onSearchShellBlur}
          >
            <form
              className="toolbar-search"
              aria-label="Find files in current folder"
              onMouseDownCapture={(event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                  return;
                }
                if (target.closest(".toolbar-search-clear") !== null) {
                  return;
                }
                searchPointerIntentRef.current = true;
                onSearchShellPointerIntent();
              }}
              onSubmit={(event) => {
                event.preventDefault();
                onSearchSubmit();
              }}
            >
              <div className="toolbar-search-row">
                <SearchOptionsMenu
                  anchorRef={searchShellRef}
                  inputRef={searchInputRef}
                  interactive={mode === "interactive"}
                  patternMode={searchPatternMode}
                  onPatternModeChange={onSearchPatternModeChange}
                  matchScope={searchMatchScope}
                  onMatchScopeChange={onSearchMatchScopeChange}
                  recursive={searchRecursive}
                  onRecursiveChange={onSearchRecursiveChange}
                  skipGitFolders={searchSkipGitFolders}
                  onSkipGitFoldersChange={onSearchSkipGitFoldersChange}
                  skipGitIgnored={searchSkipGitIgnored}
                  onSkipGitIgnoredChange={onSearchSkipGitIgnoredChange}
                />
                <input
                  ref={searchInputRef}
                  className="toolbar-search-input"
                  type="text"
                  value={searchDraftQuery}
                  onFocus={onSearchInputFocus}
                  onChange={(event) => onSearchDraftQueryChange(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      onSearchInputArrowDown();
                      return;
                    }
                    if (event.key !== "Escape") {
                      return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    onSearchInputEscape();
                  }}
                  placeholder="Search"
                  spellCheck={false}
                />
                {searchDraftQuery.trim().length > 0 ? (
                  <button
                    type="button"
                    className="toolbar-search-clear"
                    title="Clear Search"
                    aria-label="Clear file search"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={onClearSearchDraft}
                  >
                    <ToolbarIcon name="close" />
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </div>
      );
    }

    if (itemId === "foldersFirst") {
      return (
        <button
          key={itemId}
          type="button"
          className={foldersFirst ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleFoldersFirst}
          title={getToolbarTooltip(itemId)}
          aria-label="Folders First"
          aria-pressed={foldersFirst}
        >
          <ToolbarIcon name="foldersFirst" />
        </button>
      );
    }
    if (itemId === "hidden") {
      return (
        <button
          key={itemId}
          type="button"
          className={includeHidden ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleHidden}
          title={getToolbarTooltip(itemId)}
          aria-label="Hidden Files"
          aria-pressed={includeHidden}
        >
          <ToolbarIcon name={includeHidden ? "hiddenShown" : "hidden"} />
        </button>
      );
    }
    if (itemId === "infoPanel") {
      return (
        <button
          key={itemId}
          type="button"
          className={infoPanelOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleInfoPanel}
          title={getToolbarTooltip(itemId)}
          aria-label="Info Panel"
          aria-pressed={infoPanelOpen}
        >
          <ToolbarIcon name="drawer" />
        </button>
      );
    }
    if (itemId === "infoRow") {
      return (
        <button
          key={itemId}
          type="button"
          className={infoRowOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
          onClick={onToggleInfoRow}
          title={getToolbarTooltip(itemId)}
          aria-label="Info Row"
          aria-pressed={infoRowOpen}
        >
          <ToolbarIcon name="infoRow" />
        </button>
      );
    }
    if (itemId === "theme") {
      return (
        <ThemeMenuButton
          key={itemId}
          theme={theme}
          onSelectTheme={onSelectTheme}
          interactive={mode === "interactive"}
        />
      );
    }

    const definition = getToolbarItemDefinition(itemId);
    const commandType = definition.commandType;
    if (!commandType) {
      return null;
    }
    return (
      <button
        key={itemId}
        type="button"
        className="tb-btn tb-btn-icon"
        disabled={!canRunRendererCommand(commandType)}
        onClick={() => onRendererCommand(commandType)}
        title={getToolbarTooltip(itemId)}
        aria-label={definition.label}
      >
        <ToolbarIcon name={definition.icon} />
      </button>
    );
  }

  // While customizing, every item is in the row (those without room drawn faint), the
  // dragged one where it would land.
  const rowToolbarSlots = customizingToolbar ? editToolbarSlots : visibleTopToolbarSlots;
  // Buttons side by side share a capsule; each knows whether it starts or ends one.
  const toolbarCapsules = resolveToolbarCapsules(
    rowToolbarSlots,
    (slot) => customizingToolbar || slot.id !== "clipboard" || clipboardShown,
  );

  function renderTopToolbarSlot(slot: TopToolbarSlot, index: number) {
    const element = renderTopToolbarSlotContent(slot);
    if (!isValidElement<Record<string, unknown>>(element)) {
      return element;
    }
    const edges = toolbarCapsules.get(slot.key);
    return cloneElement(element, {
      "data-toolbar-slot": slot.key,
      "data-capsule": edges
        ? edges.start && edges.end
          ? "single"
          : edges.start
            ? "start"
            : edges.end
              ? "end"
              : "middle"
        : undefined,
      "data-toolbar-placeholder":
        (customizingToolbar && index === placeholderToolbarIndex) || undefined,
      "data-toolbar-overflow":
        (customizingToolbar && overflowToolbarKeys.has(slot.key)) || undefined,
    });
  }

  function renderTopToolbarSlotContent(slot: TopToolbarSlot) {
    if (slot.id === "title") {
      return (
        <div key={slot.key} className="toolbar-title-block" data-top-toolbar-item={slot.id}>
          <span className="toolbar-title" title={currentPath}>
            {toolbarTitle}
          </span>
          {toolbarSubtitle ? <span className="toolbar-subtitle">{toolbarSubtitle}</span> : null}
        </div>
      );
    }
    if (slot.id === "search") {
      return renderTopToolbarItem(slot.id);
    }
    if (slot.id === "clipboard") {
      return (
        <div
          key={slot.key}
          className="toolbar-clipboard"
          data-top-toolbar-item={slot.id}
          data-top-toolbar-measure={slot.key}
        >
          {clipboardButton ??
            // While customizing, a stand-in for the button, so that it can be moved.
            (customizingToolbar ? (
              <span className="tb-btn tb-btn-icon toolbar-clipboard-stand-in" aria-hidden="true">
                <ToolbarIcon name="clipboard" />
              </span>
            ) : null)}
        </div>
      );
    }
    if (slot.id === "viewOptions") {
      return renderViewOptions(slot);
    }
    return (
      <div key={slot.key} className="toolbar-item" data-top-toolbar-item={slot.id}>
        {renderTopToolbarItem(slot.id)}
      </div>
    );
  }

  const toolbar = (
    <header
      ref={toolbarRef}
      className="window-toolbar"
      style={{ gridColumn: "3 / -1", gridRow: "1" }}
      data-customizing={customizingToolbar || undefined}
      onContextMenu={handleToolbarContextMenu}
    >
      <div ref={toolbarRowRef} className="toolbar-row" inert={customizingToolbar || undefined}>
        {rowToolbarSlots.map(renderTopToolbarSlot)}
      </div>
      <div className="toolbar-row-measure" aria-hidden="true">
        {optionalTopToolbarSlots.map((slot) => (
          <div key={slot.key} className="toolbar-item" data-top-toolbar-measure={slot.key}>
            {renderTopToolbarItem(slot.id, "measure")}
          </div>
        ))}
      </div>
      {customizingToolbar ? (
        <div className="toolbar-edit-layer" data-dragging={toolbarDrag !== null || undefined}>
          {toolbarHandleRects.map((rect) => {
            const slot = editToolbarSlots.find((candidate) => candidate.key === rect.key);
            if (!slot) {
              return null;
            }
            const { label } = getToolbarItemDefinition(slot.id);
            const overflow = overflowToolbarKeys.has(slot.key);
            return (
              <button
                key={rect.key}
                type="button"
                className="toolbar-edit-handle"
                data-toolbar-handle={rect.key}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                aria-label={label}
                title={`${label}: ${
                  isRequiredTopToolbarItem(slot.id)
                    ? "drag to move. It is always in the toolbar."
                    : "drag to move, or out of the toolbar to remove."
                }${overflow ? " Hidden while the window is too narrow for it." : ""}`}
                onPointerDown={(event) => handleToolbarHandlePointerDown(event, rect.key)}
                onKeyDown={(event) => handleToolbarHandleKeyDown(event, rect.key)}
              />
            );
          })}
        </div>
      ) : null}
      {customizingToolbar ? (
        <ToolbarCustomizePanel
          panelRef={toolbarPanelRef}
          items={paletteToolbarItems}
          draggedItemId={toolbarDrag?.fromIndex === null ? toolbarDrag.itemId : null}
          removing={removingToolbarItem}
          onItemPointerDown={handlePalettePointerDown}
          onAddItem={handlePaletteAdd}
          onRestoreDefaults={() => commitToolbarItems([...DEFAULT_TOP_TOOLBAR_ITEMS])}
          restoreDisabled={isDefaultToolbar}
          onDone={onFinishCustomizingToolbar}
        />
      ) : null}
      {customizingToolbar && toolbarDrag
        ? createPortal(
            <div
              ref={toolbarGhostRef}
              className="toolbar-drag-ghost"
              data-wide={
                toolbarDrag.itemId === "title" ||
                toolbarDrag.itemId === "search" ||
                toolbarDrag.itemId === "view" ||
                undefined
              }
              data-removing={removingToolbarItem || undefined}
              style={{
                transform: `translate(${toolbarPointerRef.current.x}px, ${toolbarPointerRef.current.y}px) translate(-50%, -50%)`,
              }}
              aria-hidden="true"
            >
              <ToolbarDragGhostContent itemId={toolbarDrag.itemId} title={toolbarTitle} />
              {removingToolbarItem ? <span className="toolbar-drag-ghost-remove" /> : null}
            </div>,
            document.body,
          )
        : null}
      {toolbarMenuPosition
        ? createPortal(
            <div
              ref={toolbarMenuRef}
              className="toolbar-menu"
              role="menu"
              aria-label="Toolbar"
              style={{
                position: "fixed",
                left: `${toolbarMenuPosition.x}px`,
                top: `${toolbarMenuPosition.y}px`,
              }}
            >
              <button
                type="button"
                className="toolbar-menu-item"
                role="menuitem"
                onClick={() => {
                  setToolbarMenuPosition(null);
                  onCustomizeToolbar();
                }}
              >
                <MenuCheck checked={false} />
                <span className="toolbar-menu-label">Customize Toolbar…</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </header>
  );

  return (
    <section className="workspace explorer-workspace">
      {!workspaceReady ? (
        <section className="workspace-body workspace-loading" />
      ) : (
        <section
          className="workspace-body"
          style={{
            gridTemplateColumns: `${treeWidth}px ${EXPLORER_LAYOUT.resizerWidth}px minmax(0, 1fr)${
              infoPanelOpen ? ` ${EXPLORER_LAYOUT.resizerWidth}px ${inspectorWidth}px` : ""
            }`,
            // Toolbar, tab strip (no height while there is a single view), panes.
            gridTemplateRows: "auto auto minmax(0, 1fr)",
          }}
        >
          <div
            className="workspace-sidebar-cell"
            style={{ gridColumn: "1", gridRow: "1 / -1" }}
            inert={customizingToolbar || undefined}
          >
            <TreePane {...treePaneProps} />
          </div>
          <div
            className="pane-resizer pane-resizer-tree"
            style={{ gridColumn: "2", gridRow: "1 / -1" }}
            onPointerDown={beginResize("tree")}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize folders pane"
            onKeyDown={(event) => onPaneResizeKey("tree", event)}
          />
          {/* While the toolbar is customized the rest of the window waits, under a veil. */}
          {customizingToolbar ? (
            <div
              className="toolbar-customize-scrim"
              style={{ gridColumn: "1 / -1", gridRow: "1 / -1" }}
              aria-hidden="true"
            />
          ) : null}
          {toolbar}
          {tabStrip}
          <div
            className="workspace-main-cell"
            style={{ gridColumn: "3", gridRow: "3" }}
            inert={customizingToolbar || undefined}
          >
            <PaneLayoutChangeContext.Provider value={infoPanelChange.count}>
              <SearchWorkspace {...searchWorkspaceProps} />
            </PaneLayoutChangeContext.Provider>
          </div>
          {infoPanelOpen ? (
            <>
              <div
                className="pane-resizer"
                style={{ gridColumn: "4", gridRow: "3" }}
                onPointerDown={beginResize("inspector")}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize Info Panel pane"
                onKeyDown={(event) => onPaneResizeKey("inspector", event)}
              />
              <div
                className={`workspace-inspector-cell${
                  infoPanelChange.slide === "in" ? " is-sliding-in" : ""
                }`}
                style={{ gridColumn: "5", gridRow: "3" }}
                inert={customizingToolbar || undefined}
              >
                <InfoPanel {...infoPanelProps} />
              </div>
            </>
          ) : infoPanelClosing ? (
            // Over the right edge of the content, which already has the whole width.
            <div
              className="workspace-inspector-cell is-sliding-out"
              style={{ gridColumn: "3", gridRow: "3", justifySelf: "end", width: inspectorWidth }}
              inert
            >
              <InfoPanel {...infoPanelProps} />
            </div>
          ) : null}
        </section>
      )}
    </section>
  );
}

// What follows the pointer while an item is dragged: the item's icon, and the title and the
// search field as small stand-ins for themselves.
function ToolbarDragGhostContent({ itemId, title }: { itemId: ToolbarItemId; title: string }) {
  if (itemId === "title") {
    return <span className="toolbar-drag-ghost-title">{title || "Title"}</span>;
  }
  if (itemId === "search") {
    return (
      <>
        <ToolbarIcon name="search" />
        <span className="toolbar-drag-ghost-label">Search</span>
      </>
    );
  }
  if (itemId === "view") {
    return (
      <>
        <ToolbarIcon name="icons" />
        <ToolbarIcon name="list" />
        <ToolbarIcon name="details" />
      </>
    );
  }
  return <ToolbarIcon name={getToolbarItemDefinition(itemId).icon} />;
}

// The element under `root` whose `data-*` value (`name` in its dataset spelling) is `value`.
function findByData(root: HTMLElement | null, name: string, value: string): HTMLElement | null {
  if (!root) {
    return null;
  }
  const attribute = `data-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  return (
    Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
      (element) => element.dataset[name] === value,
    ) ?? null
  );
}
