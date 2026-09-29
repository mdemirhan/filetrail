// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import { CopyPasteResultDialog } from "./CopyPasteResultDialog";

type Items = NonNullable<WriteOperationProgressEvent["result"]>["items"];

function event(action: "paste" | "move_to", items: Items): WriteOperationProgressEvent {
  return {
    operationId: "copy-op-1",
    action,
    status: "partial",
    completedItemCount: 0,
    totalItemCount: items.length,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: {
      operationId: "copy-op-1",
      action,
      status: "partial",
      targetPath: "/Users/demo/dest",
      startedAt: "2026-09-29T00:00:00.000Z",
      finishedAt: "2026-09-29T00:00:01.000Z",
      summary: {
        topLevelItemCount: items.length,
        totalItemCount: items.length,
        completedItemCount: 0,
        failedItemCount: 0,
        skippedItemCount: 0,
        cancelledItemCount: 0,
        completedByteCount: 0,
        totalBytes: null,
      },
      items,
      error: null,
    },
  };
}

const item = (
  sourcePath: string,
  status: Items[number]["status"],
  error: string | null = null,
  skipReason: Items[number]["skipReason"] = null,
): Items[number] => ({ sourcePath, destinationPath: null, status, error, skipReason });

describe("CopyPasteResultDialog", () => {
  it("lists every problem with its reason and retries what can be retried", () => {
    const onRetry = vi.fn();
    render(
      <CopyPasteResultDialog
        event={event("paste", [
          item("/src/a.txt", "completed"),
          item("/src/photos", "failed"),
          item(
            "/src/photos/raw/IMG_2041.dng",
            "failed",
            "There isn't enough free space on the destination disk.",
          ),
          item("/src/secrets.env", "failed", "You don't have permission to access this item."),
          item("/src/archive.tar.gz", "skipped", null, "planned_conflict_policy"),
          item("/src/later.txt", "cancelled", "Not started because the operation was stopped."),
        ])}
        canRetry
        onRetry={onRetry}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Pasted 1 of 5 items into “dest”" }),
    ).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "Couldn't copy" });
    expect(within(failed).getByText("photos/raw/IMG_2041.dng")).toBeInTheDocument();
    expect(
      within(failed).getByText("There isn't enough free space on the destination disk."),
    ).toBeInTheDocument();
    expect(within(failed).getByText("secrets.env")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Skipped" })).getByText(
        "Already existed · you chose Skip",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Not started" })).getByText("later.txt"),
    ).toBeInTheDocument();

    // photos (not its nested file), secrets.env and later.txt.
    fireEvent.click(screen.getByRole("button", { name: "Retry 3 Items" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  });

  it("reminds that unmoved items are still where they were", () => {
    render(
      <CopyPasteResultDialog
        event={event("move_to", [
          item("/src/a.txt", "completed"),
          item("/src/b.txt", "failed", "The item is in use."),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Moved 1 of 2 items into “dest”" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Items that weren't moved are still in their original folder\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Couldn't move" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });
});
