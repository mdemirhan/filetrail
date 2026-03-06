// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { useExplorerPaneLayout } from "./useExplorerPaneLayout";

function Harness() {
  const panes = useExplorerPaneLayout({
    initialTreeWidth: 280,
    initialInspectorWidth: 320,
  });

  return (
    <div>
      <div data-testid="tree-width">{panes.treeWidth}</div>
      <div data-testid="inspector-width">{panes.inspectorWidth}</div>
      <div data-testid="tree-handle" onPointerDown={panes.beginResize("tree")} />
      <div data-testid="inspector-handle" onPointerDown={panes.beginResize("inspector")} />
    </div>
  );
}

describe("useExplorerPaneLayout", () => {
  it("resizes tree and inspector panes within bounds", () => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }

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
});
