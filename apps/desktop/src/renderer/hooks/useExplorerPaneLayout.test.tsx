// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { useExplorerPaneLayout } from "./useExplorerPaneLayout";

function Harness({
  initialTreeWidth = 280,
  initialInspectorWidth = 320,
  inspectorVisible = true,
}: {
  initialTreeWidth?: number;
  initialInspectorWidth?: number;
  inspectorVisible?: boolean;
}) {
  const panes = useExplorerPaneLayout({
    initialTreeWidth,
    initialInspectorWidth,
    inspectorVisible,
    minContentWidth: EXPLORER_LAYOUT.minContentWidth,
  });

  return (
    <div>
      <div data-testid="tree-width">{panes.treeWidth}</div>
      <div data-testid="inspector-width">{panes.inspectorWidth}</div>
      <div data-testid="saved-tree-width">{panes.preferredTreeWidth}</div>
      <button type="button" onClick={() => panes.nudgeWidth("tree", 16)}>
        Widen tree
      </button>
      <div data-testid="tree-handle" onPointerDown={panes.beginResize("tree")} />
      <div data-testid="inspector-handle" onPointerDown={panes.beginResize("inspector")} />
    </div>
  );
}

describe("useExplorerPaneLayout", () => {
  beforeEach(() => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }
    Object.defineProperty(window, "innerWidth", {
      value: 1440,
      writable: true,
      configurable: true,
    });
  });

  it("resizes tree and inspector panes within bounds", () => {
    render(<Harness />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("tree-handle"), { clientX: 100 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 180 }));
    });
    expect(screen.getByTestId("tree-width").textContent).toBe("360");

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
      fireEvent.pointerDown(screen.getByTestId("inspector-handle"), { clientX: 400 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 330 }));
    });
    expect(screen.getByTestId("inspector-width").textContent).toBe("390");
  });

  it("shrinks side panes to preserve center content when the viewport narrows", () => {
    render(<Harness initialTreeWidth={520} initialInspectorWidth={480} />);

    act(() => {
      window.innerWidth = 1080;
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("tree-width").textContent).toBe("384");
    expect(screen.getByTestId("inspector-width").textContent).toBe("260");
  });

  it("clamps the tree pane against the viewport when the inspector is hidden", () => {
    render(<Harness initialTreeWidth={520} inspectorVisible={false} />);

    act(() => {
      window.innerWidth = 760;
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.getByTestId("tree-width").textContent).toBe("332");
  });

  it("gives a pane back its width when the window is widened again", () => {
    render(<Harness initialTreeWidth={300} inspectorVisible={false} />);

    act(() => {
      window.innerWidth = 640;
      window.dispatchEvent(new Event("resize"));
    });
    expect(Number(screen.getByTestId("tree-width").textContent)).toBeLessThan(300);
    // What is saved is the width chosen, not the squeezed one.
    expect(screen.getByTestId("saved-tree-width").textContent).toBe("300");

    act(() => {
      window.innerWidth = 1440;
      window.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByTestId("tree-width").textContent).toBe("300");
  });

  it("widens a pane from the keyboard, and keeps that width", () => {
    render(<Harness initialTreeWidth={300} />);

    fireEvent.click(screen.getByRole("button", { name: "Widen tree" }));

    expect(screen.getByTestId("tree-width").textContent).toBe("316");
    expect(screen.getByTestId("saved-tree-width").textContent).toBe("316");
  });
});
