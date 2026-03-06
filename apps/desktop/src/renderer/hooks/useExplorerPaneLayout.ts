import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clampPaneWidth } from "../lib/uiState";

type Pane = "tree" | "inspector";

export function useExplorerPaneLayout(args: {
  initialTreeWidth: number;
  initialInspectorWidth: number;
}) {
  const { initialTreeWidth, initialInspectorWidth } = args;
  const [treeWidth, setTreeWidth] = useState(initialTreeWidth);
  const [inspectorWidth, setInspectorWidth] = useState(initialInspectorWidth);
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
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeState.current;
      if (!active) {
        return;
      }
      const delta = event.clientX - active.startX;
      if (active.pane === "tree") {
        setTreeWidth(clampPaneWidth(active.treeWidth + delta, 220, 520));
        return;
      }
      setInspectorWidth(clampPaneWidth(active.inspectorWidth - delta, 260, 480));
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
  }, []);

  return {
    treeWidth,
    setTreeWidth,
    inspectorWidth,
    setInspectorWidth,
    beginResize,
  };
}
