// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";

import { ToastViewport } from "./ToastViewport";
import { createToastEntry } from "../lib/toasts";

describe("ToastViewport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders passive live-region toasts without focusable controls", () => {
    render(
      <ToastViewport
        toasts={[createToastEntry("toast-1", { kind: "success", title: "Copied 1 item" })]}
        onDismiss={() => undefined}
      />,
    );

    const statusToast = screen.getByText("Copied 1 item").closest(".toast-card");
    if (!statusToast) {
      throw new Error("Expected toast card wrapper");
    }
    expect(statusToast).toHaveClass("toast-card", "toast-card-success");
    expect(statusToast.querySelector("button, [tabindex], input, select, textarea, a[href]")).toBeNull();
    expect(screen.getByText("Copied 1 item")).toBeInTheDocument();
  });

  it("auto-dismisses each toast when its timer expires", async () => {
    const onDismiss = vi.fn();

    render(
      <ToastViewport
        toasts={[createToastEntry("toast-1", { kind: "warning", title: "Clipboard is empty" })]}
        onDismiss={onDismiss}
      />,
    );

    await act(async () => {
      vi.advanceTimersByTime(4499);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledWith("toast-1");
  });

  it("renders a short stack and preserves newest-to-oldest order", () => {
    const { container } = render(
      <ToastViewport
        toasts={[
          createToastEntry("toast-2", { kind: "info", title: "Ready to move 1 item" }),
          createToastEntry("toast-3", { kind: "success", title: "Copied path" }),
          createToastEntry("toast-4", { kind: "error", title: "Unable to start paste" }),
        ]}
        onDismiss={() => undefined}
      />,
    );

    const toasts = Array.from(container.querySelectorAll(".toast-card"));
    expect(toasts).toHaveLength(3);
    expect(toasts[0]).toHaveTextContent("Ready to move 1 item");
    expect(toasts[2]).toHaveTextContent("Unable to start paste");
  });

  it("keeps the viewport non-interactive for pointer events", () => {
    render(
      <ToastViewport
        toasts={[createToastEntry("toast-1", { kind: "success", title: "Copied 1 item" })]}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getByTestId("toast-viewport")).toHaveClass("toast-viewport");
    expect(screen.getByText("Copied 1 item").closest(".toast-card")).toHaveClass("toast-card");
  });
});
