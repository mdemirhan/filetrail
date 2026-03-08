import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clampPaneWidth } from "../../shared/appPreferences";

type Pane = "tree" | "inspector";

const TREE_MIN_WIDTH = 220;
const TREE_MAX_WIDTH = 520;
const INSPECTOR_MIN_WIDTH = 260;
const INSPECTOR_MAX_WIDTH = 480;
const RESIZER_WIDTH = 8;

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
      const availableSideWidth = getAvailableSideWidth(window.innerWidth, {
        inspectorVisible,
        minContentWidth,
      });
      const delta = event.clientX - active.startX;
      if (active.pane === "tree") {
        const maxTreeWidth = inspectorVisible
          ? Math.max(TREE_MIN_WIDTH, availableSideWidth - inspectorWidthRef.current)
          : Math.max(TREE_MIN_WIDTH, availableSideWidth);
        setTreeWidth(
          clampPaneWidth(
            active.treeWidth + delta,
            TREE_MIN_WIDTH,
            Math.min(TREE_MAX_WIDTH, maxTreeWidth),
          ),
        );
        return;
      }
      const maxInspectorWidth = Math.max(
        INSPECTOR_MIN_WIDTH,
        availableSideWidth - treeWidthRef.current,
      );
      setInspectorWidth(
        clampPaneWidth(
          active.inspectorWidth - delta,
          INSPECTOR_MIN_WIDTH,
          Math.min(INSPECTOR_MAX_WIDTH, maxInspectorWidth),
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
      const availableSideWidth = getAvailableSideWidth(window.innerWidth, {
        inspectorVisible,
        minContentWidth,
      });

      let nextTreeWidth = clampPaneWidth(treeWidthRef.current, TREE_MIN_WIDTH, TREE_MAX_WIDTH);
      let nextInspectorWidth = clampPaneWidth(
        inspectorWidthRef.current,
        INSPECTOR_MIN_WIDTH,
        INSPECTOR_MAX_WIDTH,
      );

      if (inspectorVisible) {
        nextInspectorWidth = Math.min(
          nextInspectorWidth,
          Math.max(INSPECTOR_MIN_WIDTH, availableSideWidth - nextTreeWidth),
        );
        nextTreeWidth = Math.min(
          nextTreeWidth,
          Math.max(TREE_MIN_WIDTH, availableSideWidth - nextInspectorWidth),
        );
      } else {
        nextTreeWidth = Math.min(nextTreeWidth, Math.max(TREE_MIN_WIDTH, availableSideWidth));
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
  const { inspectorVisible, minContentWidth } = args;
  const resizerCount = inspectorVisible ? 2 : 1;
  return Math.max(
    TREE_MIN_WIDTH + (inspectorVisible ? INSPECTOR_MIN_WIDTH : 0),
    viewportWidth - minContentWidth - resizerCount * RESIZER_WIDTH,
  );
}
