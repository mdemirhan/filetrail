import { useEffect, useLayoutEffect, useRef } from "react";

import {
  type DragSelectionBox,
  type DragSelectionHit,
  type DragSelectionSize,
  type DragSelectionSizes,
  combineDragSelection,
  getDragSelectionAutoScrollStep,
  getDragSelectionMode,
  makeDragSelectionBox,
} from "../lib/dragSelection";

// How far the pointer moves before a press on empty space becomes a drag.
const DRAG_SELECTION_THRESHOLD = 4;

// Controls that keep their own clicks: a press on them never starts a drag.
const DRAG_SELECTION_EXCLUDED = "button, a, input, textarea, select, [contenteditable]";

type DragSelectionOptions = {
  // The view's scroll area. The box is drawn inside it, so it scrolls with the items.
  containerRef: React.RefObject<HTMLElement | null>;
  // The element that holds the items: `getItemsInBox` takes the box relative to it.
  itemsRef: React.RefObject<HTMLElement | null>;
  getItemsInBox: (box: DragSelectionBox, sizes: DragSelectionSizes) => DragSelectionHit[];
  // The part of each item whose size depends on its name, measured on screen for
  // `getItemsInBox` (see `DragSelectionSizes`).
  measuredPartSelector?: string;
  selectedPaths: string[];
  selectionLeadPath: string | null;
  // Unset, no drag starts.
  onSelectPaths: ((paths: string[], leadPath: string | null) => void) | undefined;
};

// Drag-to-select (see `lib/dragSelection`). A press on empty space in the view starts it:
// the view calls `startDragSelection` from its mouse-down handler and draws `boxRef`, a
// `.drag-select-box`, inside its scroll area. The box follows the pointer, the selection
// follows the box, and the view scrolls while the pointer is past one of its edges.
export function useDragSelection(options: DragSelectionOptions) {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const boxRef = useRef<HTMLDivElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      stopRef.current?.();
    },
    [],
  );

  function startDragSelection(event: React.MouseEvent<HTMLElement>) {
    const { containerRef, selectedPaths, selectionLeadPath, onSelectPaths } = optionsRef.current;
    const container = containerRef.current;
    const target = event.target;
    if (
      !container ||
      !onSelectPaths ||
      event.button !== 0 ||
      event.ctrlKey ||
      (target instanceof Element && target.closest(DRAG_SELECTION_EXCLUDED))
    ) {
      return;
    }
    // A press on a scrollbar scrolls.
    const bounds = container.getBoundingClientRect();
    if (
      event.clientX - bounds.left - container.clientLeft >= container.clientWidth ||
      event.clientY - bounds.top - container.clientTop >= container.clientHeight
    ) {
      return;
    }
    stopRef.current?.();

    // Points are kept in the scroll area's content coordinates, which stay put as it scrolls.
    const toContent = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      return {
        x: clientX - rect.left - container.clientLeft + container.scrollLeft,
        y: clientY - rect.top - container.clientTop + container.scrollTop,
      };
    };
    const start = toContent(event.clientX, event.clientY);
    const startPointer = { x: event.clientX, y: event.clientY };
    const mode = getDragSelectionMode(event);
    const startPaths = mode === "replace" ? [] : selectedPaths;
    // A replaced selection has no lead until the drag ends, so the view does not scroll to
    // reveal one while the box is drawn.
    const startLeadPath = mode === "replace" ? null : selectionLeadPath;
    let pointer = startPointer;
    let dragging = false;
    // What the box touches, and the selection that makes: at first nothing, and the
    // selection as it is.
    let shownKey = "";
    let shownPaths = startPaths;
    let hits: DragSelectionHit[] = [];
    let end = { x: 0, y: 0 };
    let frame: number | null = null;

    const getVisibleArea = () => {
      const rect = container.getBoundingClientRect();
      const left = rect.left + container.clientLeft;
      const top = rect.top + container.clientTop;
      return {
        left,
        top,
        right: left + container.clientWidth,
        bottom: top + container.clientHeight,
      };
    };

    // Sizes of the items shown so far during this drag: an item keeps its size after it
    // scrolls away and is no longer drawn.
    const sizes = new Map<string, DragSelectionSize>();
    const measureShownItems = (items: HTMLElement) => {
      const selector = optionsRef.current.measuredPartSelector;
      if (!selector) {
        return;
      }
      for (const part of Array.from(items.querySelectorAll<HTMLElement>(selector))) {
        const path = part.closest<HTMLElement>("[data-selectable-entry-path]")?.dataset
          .selectableEntryPath;
        if (!path || sizes.has(path)) {
          continue;
        }
        const { width, height } = part.getBoundingClientRect();
        // Nothing laid out (a test environment): the item is taken at the largest size.
        if (width > 0 && height > 0) {
          sizes.set(path, { width, height });
        }
      }
    };

    const leadPathFor = (paths: string[]) =>
      startLeadPath && paths.includes(startLeadPath) ? startLeadPath : null;

    const update = () => {
      // The box ends at the pointer, kept within the part of the view on screen.
      const area = getVisibleArea();
      const pointerInArea = toContent(
        Math.min(Math.max(pointer.x, area.left), area.right),
        Math.min(Math.max(pointer.y, area.top), area.bottom),
      );
      const box = makeDragSelectionBox(start, pointerInArea);
      const boxElement = boxRef.current;
      if (boxElement) {
        boxElement.style.left = `${box.left}px`;
        boxElement.style.top = `${box.top}px`;
        boxElement.style.width = `${box.right - box.left}px`;
        boxElement.style.height = `${box.bottom - box.top}px`;
        boxElement.hidden = false;
      }
      const items = optionsRef.current.itemsRef.current;
      if (!items) {
        return;
      }
      measureShownItems(items);
      const itemsRect = items.getBoundingClientRect();
      const origin = toContent(itemsRect.left, itemsRect.top);
      end = { x: pointerInArea.x - origin.x, y: pointerInArea.y - origin.y };
      hits = optionsRef.current.getItemsInBox(
        {
          left: box.left - origin.x,
          top: box.top - origin.y,
          right: box.right - origin.x,
          bottom: box.bottom - origin.y,
        },
        sizes,
      );
      const key = hits.map((hit) => hit.path).join("\0");
      if (key === shownKey) {
        return;
      }
      shownKey = key;
      shownPaths = combineDragSelection(
        startPaths,
        hits.map((hit) => hit.path),
        mode,
      );
      optionsRef.current.onSelectPaths?.(shownPaths, leadPathFor(shownPaths));
    };

    const autoScroll = () => {
      frame = window.requestAnimationFrame(autoScroll);
      const area = getVisibleArea();
      const overshootX =
        pointer.x < area.left ? pointer.x - area.left : Math.max(0, pointer.x - area.right);
      const overshootY =
        pointer.y < area.top ? pointer.y - area.top : Math.max(0, pointer.y - area.bottom);
      const { scrollLeft, scrollTop } = container;
      container.scrollLeft += getDragSelectionAutoScrollStep(overshootX);
      container.scrollTop += getDragSelectionAutoScrollStep(overshootY);
      if (container.scrollLeft !== scrollLeft || container.scrollTop !== scrollTop) {
        update();
      }
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
      if (!dragging) {
        if (
          Math.hypot(pointer.x - startPointer.x, pointer.y - startPointer.y) <
          DRAG_SELECTION_THRESHOLD
        ) {
          return;
        }
        dragging = true;
        frame = window.requestAnimationFrame(autoScroll);
      }
      update();
    };

    const handleMouseUp = () => {
      const wasDragging = dragging;
      stop();
      if (!wasDragging || shownPaths.length === 0 || leadPathFor(shownPaths) !== null) {
        return;
      }
      // The selection's lead, which the arrow keys move from: the touched item nearest the
      // pointer, or the last item selected when the box touches none.
      const nearest = hits.reduce<{ path: string; distance: number } | null>((best, hit) => {
        const dx = Math.max(hit.rect.left - end.x, 0, end.x - hit.rect.right);
        const dy = Math.max(hit.rect.top - end.y, 0, end.y - hit.rect.bottom);
        const distance = Math.hypot(dx, dy);
        return best && best.distance <= distance ? best : { path: hit.path, distance };
      }, null);
      optionsRef.current.onSelectPaths?.(shownPaths, nearest?.path ?? shownPaths.at(-1) ?? null);
    };

    const stop = () => {
      stopRef.current = null;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("scroll", handleScroll);
      if (boxRef.current) {
        boxRef.current.hidden = true;
      }
    };

    // A scroll by the wheel or the trackpad while the box is drawn moves it too.
    const handleScroll = () => {
      if (dragging) {
        update();
      }
    };

    stopRef.current = stop;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("scroll", handleScroll);
  }

  return { boxRef, startDragSelection };
}
