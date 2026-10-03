import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clampPaneWidth } from "../../shared/appPreferences";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";

type Pane = "tree" | "inspector";

// Coordinates the draggable tree/info panel widths while respecting a minimum center content area.
// A pane keeps the width it was given (by dragging, or from the saved state): a window made
// too narrow for it shows it narrower, and it comes back when the window is widened again.
export function useExplorerPaneLayout(args: {
  initialTreeWidth: number;
  initialInspectorWidth: number;
  inspectorVisible: boolean;
  minContentWidth: number;
}) {
  const { initialTreeWidth, initialInspectorWidth, inspectorVisible, minContentWidth } = args;
  const [treeWidth, setTreeWidth] = useState(initialTreeWidth);
  const [inspectorWidth, setInspectorWidth] = useState(initialInspectorWidth);
  // The widths chosen for the panes, which the ones on screen follow as far as they fit.
  const [preferredTreeWidth, setPreferredTreeWidth] = useState(initialTreeWidth);
  const [preferredInspectorWidth, setPreferredInspectorWidth] = useState(initialInspectorWidth);
  const treeWidthRef = useRef(treeWidth);
  const inspectorWidthRef = useRef(inspectorWidth);
  const preferredTreeWidthRef = useRef(preferredTreeWidth);
  const preferredInspectorWidthRef = useRef(preferredInspectorWidth);
  const resizeState = useRef<{
    pane: Pane;
    startX: number;
    treeWidth: number;
    inspectorWidth: number;
  } | null>(null);

  const beginResize = useCallback(
    (pane: Pane) => (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeState.current = {
        pane,
        startX: event.clientX,
        treeWidth,
        inspectorWidth,
      };
      // Global class lets CSS disable selection and show the resize cursor consistently.
      document.body.classList.add("resizing-panels");
    },
    [inspectorWidth, treeWidth],
  );

  useEffect(() => {
    setTreeWidth(initialTreeWidth);
    setPreferredTreeWidth(initialTreeWidth);
    preferredTreeWidthRef.current = initialTreeWidth;
  }, [initialTreeWidth]);

  useEffect(() => {
    setInspectorWidth(initialInspectorWidth);
    setPreferredInspectorWidth(initialInspectorWidth);
    preferredInspectorWidthRef.current = initialInspectorWidth;
  }, [initialInspectorWidth]);

  useEffect(() => {
    treeWidthRef.current = treeWidth;
  }, [treeWidth]);

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeState.current;
      if (!active) {
        return;
      }
      // Both side panes share the same horizontal budget once minimum content width is reserved.
      const availableSideWidth = getAvailableSideWidth(window.innerWidth, {
        inspectorVisible,
        minContentWidth,
      });
      const delta = event.clientX - active.startX;
      if (active.pane === "tree") {
        const maxTreeWidth = inspectorVisible
          ? Math.max(EXPLORER_LAYOUT.treeMinWidth, availableSideWidth - inspectorWidthRef.current)
          : Math.max(EXPLORER_LAYOUT.treeMinWidth, availableSideWidth);
        const nextTreeWidth = clampPaneWidth(
          active.treeWidth + delta,
          EXPLORER_LAYOUT.treeMinWidth,
          Math.min(EXPLORER_LAYOUT.treeMaxWidth, maxTreeWidth),
        );
        setTreeWidth(nextTreeWidth);
        setPreferredTreeWidth(nextTreeWidth);
        preferredTreeWidthRef.current = nextTreeWidth;
        return;
      }
      const maxInspectorWidth = Math.max(
        EXPLORER_LAYOUT.inspectorMinWidth,
        availableSideWidth - treeWidthRef.current,
      );
      const nextInspectorWidth = clampPaneWidth(
        active.inspectorWidth - delta,
        EXPLORER_LAYOUT.inspectorMinWidth,
        Math.min(EXPLORER_LAYOUT.inspectorMaxWidth, maxInspectorWidth),
      );
      setInspectorWidth(nextInspectorWidth);
      setPreferredInspectorWidth(nextInspectorWidth);
      preferredInspectorWidthRef.current = nextInspectorWidth;
    };

    const onPointerUp = () => {
      resizeState.current = null;
      document.body.classList.remove("resizing-panels");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [inspectorVisible, minContentWidth]);

  useEffect(() => {
    const syncToViewport = () => {
      // Window resizes and inspector toggles can make previously valid widths illegal.
      const availableSideWidth = getAvailableSideWidth(window.innerWidth, {
        inspectorVisible,
        minContentWidth,
      });

      let nextTreeWidth = clampPaneWidth(
        preferredTreeWidthRef.current,
        EXPLORER_LAYOUT.treeMinWidth,
        EXPLORER_LAYOUT.treeMaxWidth,
      );
      let nextInspectorWidth = clampPaneWidth(
        preferredInspectorWidthRef.current,
        EXPLORER_LAYOUT.inspectorMinWidth,
        EXPLORER_LAYOUT.inspectorMaxWidth,
      );

      if (inspectorVisible) {
        nextInspectorWidth = Math.min(
          nextInspectorWidth,
          Math.max(EXPLORER_LAYOUT.inspectorMinWidth, availableSideWidth - nextTreeWidth),
        );
        nextTreeWidth = Math.min(
          nextTreeWidth,
          Math.max(EXPLORER_LAYOUT.treeMinWidth, availableSideWidth - nextInspectorWidth),
        );
      } else {
        nextTreeWidth = Math.min(
          nextTreeWidth,
          Math.max(EXPLORER_LAYOUT.treeMinWidth, availableSideWidth),
        );
      }

      if (nextTreeWidth !== treeWidthRef.current) {
        treeWidthRef.current = nextTreeWidth;
        setTreeWidth(nextTreeWidth);
      }
      if (inspectorVisible && nextInspectorWidth !== inspectorWidthRef.current) {
        inspectorWidthRef.current = nextInspectorWidth;
        setInspectorWidth(nextInspectorWidth);
      }
    };

    syncToViewport();
    window.addEventListener("resize", syncToViewport);
    return () => {
      window.removeEventListener("resize", syncToViewport);
    };
  }, [inspectorVisible, minContentWidth, preferredTreeWidth, preferredInspectorWidth]);

  // Widths given from outside (the saved ones) are chosen widths too.
  const restoreWidths = useCallback((widths: { treeWidth: number; inspectorWidth: number }) => {
    preferredTreeWidthRef.current = widths.treeWidth;
    preferredInspectorWidthRef.current = widths.inspectorWidth;
    setPreferredTreeWidth(widths.treeWidth);
    setPreferredInspectorWidth(widths.inspectorWidth);
    setTreeWidth(widths.treeWidth);
    setInspectorWidth(widths.inspectorWidth);
  }, []);

  // A pane widened or narrowed from the keyboard, by a step, within its limits.
  const nudgeWidth = useCallback((pane: Pane, delta: number) => {
    if (pane === "tree") {
      const next = clampPaneWidth(
        treeWidthRef.current + delta,
        EXPLORER_LAYOUT.treeMinWidth,
        EXPLORER_LAYOUT.treeMaxWidth,
      );
      preferredTreeWidthRef.current = next;
      setPreferredTreeWidth(next);
      setTreeWidth(next);
      return;
    }
    const next = clampPaneWidth(
      inspectorWidthRef.current + delta,
      EXPLORER_LAYOUT.inspectorMinWidth,
      EXPLORER_LAYOUT.inspectorMaxWidth,
    );
    preferredInspectorWidthRef.current = next;
    setPreferredInspectorWidth(next);
    setInspectorWidth(next);
  }, []);

  return {
    treeWidth,
    inspectorWidth,
    restoreWidths,
    nudgeWidth,
    // What is saved: the widths chosen, not the ones a narrow window squeezed them to.
    preferredTreeWidth,
    preferredInspectorWidth,
    beginResize,
  };
}

function getAvailableSideWidth(
  viewportWidth: number,
  args: { inspectorVisible: boolean; minContentWidth: number },
): number {
  // Total side-pane budget after reserving the center content area and resizer gutters.
  const { inspectorVisible, minContentWidth } = args;
  const resizerCount = inspectorVisible ? 2 : 1;
  return Math.max(
    EXPLORER_LAYOUT.treeMinWidth + (inspectorVisible ? EXPLORER_LAYOUT.inspectorMinWidth : 0),
    viewportWidth - minContentWidth - resizerCount * EXPLORER_LAYOUT.resizerWidth,
  );
}
