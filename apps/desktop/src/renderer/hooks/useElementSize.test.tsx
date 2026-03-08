// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

import { useElementSize } from "./useElementSize";

describe("useElementSize", () => {
  it("keeps the window resize fallback active across rerenders", () => {
    let rect = { width: 100, height: 50 };
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    const cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);

    function Harness() {
      const ref = useRef<HTMLDivElement | null>(null);
      const size = useElementSize(ref);
      const [tick, setTick] = useState(0);

      useEffect(() => {
        if (!ref.current) {
          return;
        }
        Object.defineProperty(ref.current, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            width: rect.width,
            height: rect.height,
            top: 0,
            left: 0,
            right: rect.width,
            bottom: rect.height,
            x: 0,
            y: 0,
            toJSON: () => undefined,
          }),
        });
      });

      return (
        <>
          <div ref={ref} data-testid="box" />
          <button type="button" onClick={() => setTick((value) => value + 1)}>
            rerender
          </button>
          <output>{`${size.width}x${size.height}:${tick}`}</output>
        </>
      );
    }

    render(<Harness />);

    fireEvent(window, new Event("resize"));
    expect(screen.getByText("100x50:0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "rerender" }));
    rect = { width: 240, height: 120 };
    fireEvent(window, new Event("resize"));

    expect(screen.getByText("240x120:1")).toBeInTheDocument();

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });
});
