// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

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
        sourceKind: "file",
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
        sourceKind: null,
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
        accent="#daa520"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(container.firstElementChild).toHaveClass("action-log-view");
    expect(container.firstElementChild).toHaveStyle({ overflowY: "auto", height: "100%" });
  });

  it("shows one filter strip with a plain-text summary, and Reset only while filtering", () => {
    render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="#daa520"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    const filters = screen.getByRole("toolbar", { name: "Action log filters" });
    expect(within(filters).getByLabelText("Search action log")).toBeInTheDocument();
    expect(within(filters).getByLabelText("Filter by action")).toBeInTheDocument();
    expect(within(filters).getByLabelText("Filter by result")).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByLabelText("Action log summary")).toHaveTextContent(
      "2 entries · 1 failed item",
    );
    expect(screen.queryByRole("button", { name: "Reset Filters" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter by result"), { target: { value: "failed" } });
    expect(screen.getByLabelText("Action log summary")).toHaveTextContent(
      "1 of 2 entries · 1 failed item",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset Filters" }));
    expect(screen.getByLabelText("Filter by result")).toHaveValue("all");
    expect(screen.getByLabelText("Action log summary")).toHaveTextContent(
      "2 entries · 1 failed item",
    );
  });

  it("is a plain table: column headers, no page title of its own, no cards", () => {
    const { container } = render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="light"
        accent="#daa520"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    // The window toolbar already says "Action Log"; the view does not repeat it.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText("File Trail")).toBeNull();
    const entries = screen.getByRole("region", { name: "Action log entries" });
    for (const header of ["Time", "Action", "Item", "Result"]) {
      expect(within(entries).getByText(header)).toBeInTheDocument();
    }
    // Rows are flat: nothing in the view is drawn as a shadowed or rounded card.
    for (const element of Array.from(container.querySelectorAll<HTMLElement>("section, article"))) {
      expect(element.style.boxShadow).toBe("");
      expect(element.style.borderRadius).toBe("");
    }
  });

  it("explains an empty log, and filters that match nothing, in the table area", () => {
    const { rerender } = render(
      <ActionLogView
        entries={[]}
        loading={false}
        error={null}
        theme="light"
        accent="#daa520"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Action log entries" })).toBeNull();

    rerender(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="light"
        accent="#daa520"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search action log"), {
      target: { value: "nothing-matches-this" },
    });
    expect(screen.getByText("No matching actions")).toBeInTheDocument();
  });

  it("renders entries and expands details", () => {
    render(
      <ActionLogView
        entries={ENTRIES}
        loading={false}
        error={null}
        theme="dark"
        accent="#daa520"
        onCopyEntryText={() => undefined}
        onRefresh={() => undefined}
      />,
    );

    expect(screen.getByText("/Users/demo/a.txt")).toBeInTheDocument();
    expect(screen.getByText("/Users/demo/app.log")).toBeInTheDocument();

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
        accent="#daa520"
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
        accent="#daa520"
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
            sourceKind: "file",
            status: "completed",
            error: null,
            skipReason: null,
          },
          {
            sourcePath: "/Users/demo/source/b.txt",
            destinationPath: "/Users/demo/target/b.txt",
            sourceKind: "file",
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
        accent="#daa520"
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
    // Skipped section is collapsed by default — expand it to see item details
    const skippedSectionButton = screen.getByText(/Skipped \(1\)/);
    fireEvent.click(skippedSectionButton);
    expect(screen.getAllByText("/Users/demo/source/b.txt").length).toBeGreaterThan(0);
    expect(screen.getByText("Destination changed")).toBeInTheDocument();
    expect(screen.getByText("Resolution: Skip")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search action log"), {
      target: { value: "runtime conflict resolution" },
    });

    expect(screen.getAllByText("/Users/demo/source").length).toBeGreaterThan(0);
  });

  it("labels a replacement that had to skip the Trash and folders with failures inside", () => {
    const entries: ActionLogEntry[] = [
      {
        id: "entry-4",
        occurredAt: "2026-03-10T07:00:00.000Z",
        action: "paste",
        status: "partial",
        operationId: "write-op-10",
        sourcePaths: ["/Users/demo/photos"],
        destinationPaths: ["/Volumes/NAS/photos"],
        sourceSummary: "/Users/demo/photos",
        destinationSummary: "/Volumes/NAS/photos",
        title: "Paste partially completed",
        message: "Paste finished with problems.",
        durationMs: 40,
        error: null,
        summary: {
          totalItemCount: 2,
          completedItemCount: 0,
          failedItemCount: 2,
          skippedItemCount: 0,
          cancelledItemCount: 0,
        },
        items: [
          {
            sourcePath: "/Users/demo/photos",
            destinationPath: "/Volumes/NAS/photos",
            sourceKind: "directory",
            status: "failed",
            error: null,
            childFailureCount: 1,
          },
          {
            sourcePath: "/Users/demo/photos/a.jpg",
            destinationPath: "/Volumes/NAS/photos/a.jpg",
            sourceKind: "file",
            status: "failed",
            error: "The item is in use.",
          },
        ],
        initiator: "clipboard",
        requestedDestinationPath: "/Volumes/NAS",
        runtimeConflicts: [
          {
            conflictId: "conflict-2",
            sourcePath: "/Users/demo/photos/b.jpg",
            destinationPath: "/Volumes/NAS/photos/b.jpg",
            sourceKind: "file",
            destinationKind: "file",
            conflictClass: "file_conflict",
            reason: "trash_unavailable",
            resolution: "overwrite",
          },
        ],
        metadata: {},
      },
    ];
    const onCopyEntryText = vi.fn();

    render(
      <ActionLogView
        entries={entries}
        loading={false}
        error={null}
        theme="light"
        accent="#daa520"
        onCopyEntryText={onCopyEntryText}
        onRefresh={() => undefined}
      />,
    );

    const rowButton = screen.getByText("/Users/demo/photos").closest("button");
    if (!(rowButton instanceof HTMLButtonElement)) {
      throw new Error("Missing paste action log row button.");
    }
    fireEvent.click(rowButton);

    expect(screen.getByText("Trash unavailable")).toBeInTheDocument();
    expect(screen.getByText("Resolution: Deleted permanently")).toBeInTheDocument();
    expect(screen.getAllByText("1 item inside failed").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Search action log"), {
      target: { value: "deleted permanently" },
    });
    expect(screen.getAllByText("/Users/demo/photos").length).toBeGreaterThan(0);
  });
});
