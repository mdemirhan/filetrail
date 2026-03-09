import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clampPaneWidth } from "../../shared/appPreferences";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";

type Pane = "tree" | "inspector";

// Coordinates the draggable tree/info panel widths while respecting a minimum center content area.
export function useExplorerPaneLayout(args: {
  initialTreeWidth: number;
  initialInspectorWidth: number;
  inspectorVisible: boolean;
  minContentWidth: number;
}) {
  const { initialTreeWidth, initialInspectorWidth, inspectorVisible, minContentWidth } = args;
  const [treeWidth, setTreeWidth] = useState(initialTreeWidth);
  const [inspectorWidth, setInspectorWidth] = useState(initialInspectorWidth);
  const treeWidthRef = useRef(treeWidth);
  const inspectorWidthRef = useRef(inspectorWidth);
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
  }, [initialTreeWidth]);

  useEffect(() => {
    setInspectorWidth(initialInspectorWidth);
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
        setTreeWidth(
          clampPaneWidth(
            active.treeWidth + delta,
            EXPLORER_LAYOUT.treeMinWidth,
            Math.min(EXPLORER_LAYOUT.treeMaxWidth, maxTreeWidth),
          ),
        );
        return;
      }
      const maxInspectorWidth = Math.max(
        EXPLORER_LAYOUT.inspectorMinWidth,
        availableSideWidth - treeWidthRef.current,
      );
      setInspectorWidth(
        clampPaneWidth(
          active.inspectorWidth - delta,
          EXPLORER_LAYOUT.inspectorMinWidth,
          Math.min(EXPLORER_LAYOUT.inspectorMaxWidth, maxInspectorWidth),
        ),
      );
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
        treeWidthRef.current,
        EXPLORER_LAYOUT.treeMinWidth,
        EXPLORER_LAYOUT.treeMaxWidth,
      );
      let nextInspectorWidth = clampPaneWidth(
        inspectorWidthRef.current,
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
  }, [inspectorVisible, minContentWidth]);

  return {
    treeWidth,
    setTreeWidth,
    inspectorWidth,
    setInspectorWidth,
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
