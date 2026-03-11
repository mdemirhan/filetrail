// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import type { ActionLogEntry } from "@filetrail/contracts";

import { ActionLogView } from "./ActionLogView";

const ENTRIES: ActionLogEntry[] = [
  {
    id: "entry-1",
    occurredAt: "2026-03-10T10:00:00.000Z",
    action: "rename",
    status: "completed",
    operationId: "write-op-1",
    sourcePaths: ["/Users/demo/a.txt"],
    destinationPaths: ["/Users/demo/b.txt"],
    sourceSummary: "/Users/demo/a.txt",
    destinationSummary: "/Users/demo/b.txt",
    title: "Rename completed",
    message: "Rename /Users/demo/a.txt to /Users/demo/b.txt.",
    durationMs: 12,
    error: null,
    summary: {
      totalItemCount: 1,
      completedItemCount: 1,
      failedItemCount: 0,
      skippedItemCount: 0,
      cancelledItemCount: 0,
    },
    items: [
      {
        sourcePath: "/Users/demo/a.txt",
        destinationPath: "/Users/demo/b.txt",
        status: "completed",
        error: null,
      },
    ],
    initiator: "move_dialog",
    requestedDestinationPath: "/Users/demo",
    runtimeConflicts: [],
    metadata: {},
  },
  {
    id: "entry-2",
    occurredAt: "2026-03-10T09:00:00.000Z",
    action: "open_with",
    status: "failed",
    operationId: null,
    sourcePaths: ["/Users/demo/app.log"],
    destinationPaths: ["/Applications/Zed.app"],
    sourceSummary: "/Users/demo/app.log",
    destinationSummary: "/Applications/Zed.app",
    title: "Open With Zed failed",
    message: "Unable to open 1 item with Zed.",
    durationMs: 9,
    error: "Application not found",
    summary: {
      totalItemCount: 1,
      completedItemCount: 0,
      failedItemCount: 1,
      skippedItemCount: 0,
      cancelledItemCount: 0,
    },
    items: [
      {
        sourcePath: "/Users/demo/app.log",
        destinationPath: "/Applications/Zed.app",
        status: "failed",
        error: "Application not found",
      },
    ],
    initiator: null,
    requestedDestinationPath: null,
    runtimeConflicts: [],
    metadata: {
      applicationName: "Zed",
    },
  },
];

describe("ActionLogView", () => {
  it("renders the page as its own vertical scroll container", () => {
    const { container } = render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="gold"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(container.firstElementChild).toHaveClass("action-log-view");
    expect(container.firstElementChild).toHaveStyle({ overflowY: "auto", height: "100%" });
  });

  it("renders a compact summary strip and aligned filter controls", () => {
    render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="gold"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    const summary = screen.getByLabelText("Action log summary");
    expect(summary).toHaveTextContent("Entries");
    expect(summary).toHaveTextContent("2");
    expect(summary).toHaveTextContent("Visible");
    expect(summary).toHaveTextContent("Failed items");
    expect(summary).toHaveTextContent("1");

    const resetButton = screen.getByRole("button", { name: "Reset Filters" });
    expect(resetButton).toHaveStyle({ minHeight: "40px" });
  });

  it("renders entries and expands details", () => {
    render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="gold"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByText("Action Log")).toBeInTheDocument();
    expect(screen.getByText("File Trail")).toBeInTheDocument();
    expect(screen.queryByText("Action History")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /Review file mutations and launch actions with readable status, source, destination, and full failure detail\./i,
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("/Users/demo/a.txt")).toBeInTheDocument();
    expect(screen.getByText("/Users/demo/app.log")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Action Log" })).toHaveStyle({
      fontSize: "20px",
    });
    expect(screen.getByRole("heading", { name: "Action Log" })).not.toHaveStyle({
      color: "rgb(218, 165, 32)",
    });

    const rowButton = screen.getByText("/Users/demo/a.txt").closest("button");
    if (!(rowButton instanceof HTMLButtonElement)) {
      throw new Error("Missing action log row button.");
    }
    fireEvent.click(rowButton);

    expect(screen.getByText(/write-op-1/)).toBeInTheDocument();
    expect(screen.getAllByText("/Users/demo/b.txt").length).toBeGreaterThan(1);
    expect(screen.getByText(/Initiated via: Move dialog/)).toBeInTheDocument();
    expect(screen.getByText(/Requested destination: \/Users\/demo/)).toBeInTheDocument();
  });

  it("filters entries by result and query", () => {
    render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="gold"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter by result"), {
      target: { value: "failed" },
    });
    fireEvent.change(screen.getByLabelText("Search action log"), {
      target: { value: "zed" },
    });

    expect(screen.getByText("/Users/demo/app.log")).toBeInTheDocument();
    expect(screen.queryByText("/Users/demo/a.txt")).not.toBeInTheDocument();
  });

  it("copies a formatted row snapshot without expanding the row", async () => {
    const handleCopy = vi.fn().mockResolvedValue(undefined);
    render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="gold"
        onCopyEntryText={handleCopy}
        onRefresh={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /copy action log row for rename completed/i }),
    );

    expect(handleCopy).toHaveBeenCalledTimes(1);
    expect(handleCopy.mock.calls[0]?.[0]).toContain("Action Log Entry");
    expect(handleCopy.mock.calls[0]?.[0]).toContain("Title: Rename completed");
    expect(handleCopy.mock.calls[0]?.[0]).toContain("/Users/demo/a.txt");
    expect(handleCopy.mock.calls[0]?.[0]).toContain("Initiated via: Move dialog");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(screen.queryByText(/write-op-1/)).not.toBeInTheDocument();
  });

  it("renders and searches runtime conflict history and skip provenance", () => {
    const entries: ActionLogEntry[] = [
      {
        id: "entry-3",
        occurredAt: "2026-03-10T08:00:00.000Z",
        action: "move_to",
        status: "partial",
        operationId: "write-op-9",
        sourcePaths: ["/Users/demo/source"],
        destinationPaths: ["/Users/demo/target/item"],
        sourceSummary: "/Users/demo/source",
        destinationSummary: "/Users/demo/target/item",
        title: "Move partially completed",
        message: "Move finished: 1 completed, 1 skipped.",
        durationMs: 33,
        error: null,
        summary: {
          totalItemCount: 2,
          completedItemCount: 1,
          failedItemCount: 0,
          skippedItemCount: 1,
          cancelledItemCount: 0,
        },
        items: [
          {
            sourcePath: "/Users/demo/source/a.txt",
            destinationPath: "/Users/demo/target/a.txt",
            status: "completed",
            error: null,
            skipReason: null,
          },
          {
            sourcePath: "/Users/demo/source/b.txt",
            destinationPath: "/Users/demo/target/b.txt",
            status: "skipped",
            error: null,
            skipReason: "runtime_conflict_resolution",
          },
        ],
        initiator: "drag_drop",
        requestedDestinationPath: "/Users/demo/target",
        runtimeConflicts: [
          {
            conflictId: "conflict-1",
            sourcePath: "/Users/demo/source/b.txt",
            destinationPath: "/Users/demo/target/b.txt",
            sourceKind: "file",
            destinationKind: "file",
            conflictClass: "file_conflict",
            reason: "destination_changed",
            resolution: "skip",
          },
        ],
        metadata: {
          transferMode: "cut",
        },
      },
    ];

    render(
      <ActionLogView
        entries={entries}
        loading={false}
        error={null}
        theme="dark"
        accent="gold"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    const rowButton = screen.getByText("/Users/demo/source").closest("button");
    if (!(rowButton instanceof HTMLButtonElement)) {
      throw new Error("Missing move action log row button.");
    }
    fireEvent.click(rowButton);

    expect(screen.getByText("Runtime Conflicts")).toBeInTheDocument();
    expect(screen.getByText(/Initiated via: Drag and drop/)).toBeInTheDocument();
    expect(screen.getByText("Skipped after runtime conflict resolution")).toBeInTheDocument();
    expect(screen.getByText("Destination changed")).toBeInTheDocument();
    expect(screen.getByText("Resolution: Skip")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search action log"), {
      target: { value: "runtime conflict resolution" },
    });

    expect(screen.getAllByText("/Users/demo/source").length).toBeGreaterThan(0);
  });
});
