// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyPasteProgressCard } from "./CopyPasteProgressCard";

describe("CopyPasteProgressCard", () => {
  it("renders the redesigned progress chrome with trimmed detail content", () => {
    render(
      <CopyPasteProgressCard
        title="Paste In Progress"
        progressPercent={42}
        progressMetaStart="20 of 48 items"
        progressMetaEnd="24 KB of 128 KB"
        detailLabel="Current file"
        detailValue="popup.qml"
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.getByLabelText("42 percent")).toBeInTheDocument();
    expect(screen.getByText("Current file")).toBeInTheDocument();
    expect(screen.getByText("popup.qml")).toBeInTheDocument();
  });

  it("wires the cancel action", () => {
    const onCancel = vi.fn();
    render(
      <CopyPasteProgressCard
        title="Paste In Progress"
        progressPercent={0}
        progressMetaStart="0 of 1 items"
        progressMetaEnd="Preparing write plan"
        detailLabel="Current file"
        detailValue="source.txt"
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
