// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import { CopyPasteResultDialog } from "./CopyPasteResultDialog";

type Items = NonNullable<WriteOperationProgressEvent["result"]>["items"];

function event(
  action: "paste" | "copy_to" | "move_to" | "batch_rename" | "undo" | "redo",
  items: Items,
): WriteOperationProgressEvent {
  // An Undo's items go back where they each came from: it has no one folder.
  const targetPath = action === "undo" || action === "redo" ? null : "/Users/demo/dest";
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
      targetPath,
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
          { ...item("/src/photos", "failed"), childFailureCount: 1 },
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

    // "photos" was pasted without one item inside; that item is counted once.
    expect(
      screen.getByRole("heading", { name: "Pasted 2 of 5 items into “dest”" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "1 item couldn’t be copied. 1 item inside “photos” couldn’t be copied. 1 item wasn't started because the operation was stopped. 1 item was skipped.",
    );
    const failed = screen.getByRole("region", { name: "Couldn’t copy" });
    expect(within(failed).getByText("1 item inside couldn’t be copied")).toBeInTheDocument();
    expect(within(failed).queryByText("Unknown error.")).not.toBeInTheDocument();
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

  it("names the operation that failed when nothing could be done", () => {
    for (const [action, title] of [
      ["paste", "Paste failed"],
      ["copy_to", "Copy failed"],
      ["move_to", "Move failed"],
    ] as const) {
      const { unmount } = render(
        <CopyPasteResultDialog
          event={event(action, [])}
          canRetry={false}
          onRetry={() => {}}
          onClose={() => {}}
        />,
      );
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      unmount();
    }
  });

  it("says a copy made by dragging was copied, not pasted", () => {
    render(
      <CopyPasteResultDialog
        event={event("copy_to", [
          item("/src/a.txt", "completed"),
          item("/src/b.txt", "failed", "You don't have permission to access this item."),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Copied 1 of 2 items into “dest”" })).toBeVisible();
    expect(screen.getByText(/1 item couldn’t be copied\./)).toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "Couldn’t move" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });

  it("describes a folder with failures inside without counting it twice", () => {
    render(
      <CopyPasteResultDialog
        event={event("move_to", [
          { ...item("/src/photos", "failed"), childFailureCount: 2 },
          item("/src/photos/a.jpg", "completed"),
          item("/src/photos/b.jpg", "failed", "The item is in use."),
          item("/src/photos/raw/c.dng", "failed", "The item is in use."),
        ])}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Moved 1 of 1 item into “dest”" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 items inside “photos” couldn’t be moved. Items that weren't moved are still in their original folder.",
      ),
    ).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "Couldn’t move" });
    expect(within(failed).getByText("2 items inside couldn’t be moved")).toBeInTheDocument();
    expect(within(failed).getByText("photos/raw/c.dng")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 1 Item" })).toBeInTheDocument();
  });

  it("uses a folder's own count when the items inside aren't listed", () => {
    render(
      <CopyPasteResultDialog
        event={event("paste", [
          { ...item("/src/photos", "failed"), childFailureCount: 3 },
          item("/src/notes.txt", "completed"),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Pasted 2 of 2 items into “dest”" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 items inside “photos” couldn’t be copied.")).toBeInTheDocument();
  });

  it("stays quick with a very large result and lists only the first rows", () => {
    const items: Items = [{ ...item("/src/big", "failed"), childFailureCount: 15_000 }];
    for (let index = 0; index < 15_000; index += 1) {
      items.push(item(`/src/big/sub ${index % 50}/file ${index}.txt`, "failed", "Disk full."));
    }
    for (let index = 0; index < 15_000; index += 1) {
      items.push(item(`/src/done ${index}.txt`, "completed"));
    }
    const startedAt = performance.now();
    render(
      <CopyPasteResultDialog
        event={event("paste", items)}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Quadratic path matching took tens of seconds here.
    expect(performance.now() - startedAt).toBeLessThan(5_000);

    expect(
      screen.getByRole("heading", { name: "Pasted 15,001 of 15,001 items into “dest”" }),
    ).toBeInTheDocument();
    expect(screen.getByText("15,000 items inside “big” couldn’t be copied.")).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "Couldn’t copy" });
    expect(within(failed).getAllByRole("listitem")).toHaveLength(201);
    expect(within(failed).getByText("and 14,801 more")).toBeInTheDocument();
    expect(within(failed).getByText("big/sub 1/file 1.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry 1 Item" })).toBeInTheDocument();
  });

  it("keeps Tab inside the sheet and gives focus back when it closes", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <CopyPasteResultDialog
        event={event("paste", [item("/src/a.txt", "failed", "Disk full.")])}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const done = screen.getByRole("button", { name: "Done" });
    const retry = screen.getByRole("button", { name: "Retry 1 Item" });
    expect(done).toHaveFocus();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");

    fireEvent.keyDown(done, { key: "Tab" });
    expect(retry).toHaveFocus();
    fireEvent.keyDown(retry, { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  // Stopped part way through a folder: some of it is at the destination already, so the
  // folder isn't one that "wasn't started".
  it("tells a folder stopped part way from one that wasn't started", () => {
    render(
      <CopyPasteResultDialog
        event={event("paste", [
          item("/src/photos", "cancelled", "Operation cancelled."),
          item("/src/photos/1.jpg", "completed"),
          item("/src/photos/2.jpg", "cancelled", "Operation cancelled."),
          item("/src/notes.txt", "cancelled", "Not started because the operation was stopped."),
        ])}
        canRetry
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(
      "“photos” was stopped part way: some of what is inside was copied into “dest”, the rest wasn't.",
    );
    expect(within(dialog).getByText("Stopped part way")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 items weren't started because the operation was stopped.");
  });
});

describe("CopyPasteResultDialog for renaming several items", () => {
  it("says why a rename was skipped, and offers Try Again when only skipped items are left", () => {
    const onRetry = vi.fn();
    const { unmount } = render(
      <CopyPasteResultDialog
        event={event("batch_rename", [
          item(
            "/Users/demo/dest/a.txt",
            "skipped",
            "An item named “a-old.txt” already exists.",
            "runtime_conflict_resolution",
          ),
          // No reason given: the sheet had settled every name, so it was taken since.
          item("/Users/demo/dest/b.txt", "skipped", null, "runtime_conflict_resolution"),
        ])}
        canRetry
        onRetry={onRetry}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Renamed 0 of 2 items in “dest”" })).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("2 items were skipped.");
    const skipped = screen.getByRole("region", { name: "Skipped" });
    expect(within(skipped).getByText("a.txt")).toBeInTheDocument();
    expect(
      within(skipped).getByText("An item named “a-old.txt” already exists."),
    ).toBeInTheDocument();
    expect(within(skipped).getByText("b.txt")).toBeInTheDocument();
    expect(within(skipped).getByText("Its new name was taken")).toBeInTheDocument();
    // Not the words a skipped copy has.
    expect(screen.queryByText("Already existed · you chose Skip")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try Again…" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <CopyPasteResultDialog
        event={event("batch_rename", [
          item("/Users/demo/dest/a.txt", "skipped", null, "runtime_conflict_resolution"),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Try Again…" })).not.toBeInTheDocument();
  });

  it("says which renames weren't started when the rename was stopped", () => {
    render(
      <CopyPasteResultDialog
        event={event("batch_rename", [
          item("/Users/demo/dest/a.txt", "completed"),
          item(
            "/Users/demo/dest/b.txt",
            "cancelled",
            "Not started because the operation was stopped.",
          ),
          item(
            "/Users/demo/dest/c.txt",
            "cancelled",
            "Not started because the operation was stopped.",
          ),
        ])}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Renamed 1 of 3 items in “dest”" })).toBeVisible();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "2 items weren't started because the operation was stopped.",
    );
    const notStarted = screen.getByRole("region", { name: "Not started" });
    expect(within(notStarted).getByText("b.txt")).toBeInTheDocument();
    expect(within(notStarted).getByText("c.txt")).toBeInTheDocument();
    expect(within(notStarted).getAllByText("The operation was stopped first.")).toHaveLength(2);
    expect(screen.queryByRole("region", { name: "Stopped part way" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again…" })).toBeInTheDocument();
  });

  it("says the name an item that couldn't be renamed was put back under", () => {
    render(
      <CopyPasteResultDialog
        event={event("batch_rename", [
          {
            ...item(
              "/Users/demo/dest/b.txt",
              "failed",
              "“b.txt” is locked. Another item has its old name now, so it is named “b 2.txt”.",
            ),
            destinationPath: "/Users/demo/dest/b 2.txt",
          },
          {
            ...item(
              "/Users/demo/dest/c.txt",
              "failed",
              "“c.txt” is locked. Another item has its old name now, so it is named “.filetrail-rename-abc123” (hidden).",
            ),
            destinationPath: "/Users/demo/dest/.filetrail-rename-abc123",
          },
        ])}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Each row is named as it was, and says where it is now.
    expect(
      screen.getByRole("heading", { name: "Renamed 0 of 2 items in “dest”" }),
    ).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "Couldn’t rename" });
    expect(within(failed).getByText("b.txt")).toBeInTheDocument();
    expect(
      within(failed).getByText(
        "“b.txt” is locked. Another item has its old name now, so it is named “b 2.txt”.",
      ),
    ).toBeInTheDocument();
    expect(within(failed).getByText("c.txt")).toBeInTheDocument();
    expect(
      within(failed).getByText(
        "“c.txt” is locked. Another item has its old name now, so it is named “.filetrail-rename-abc123” (hidden).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("2 items couldn’t be renamed.");
    expect(screen.getByRole("button", { name: "Try Again…" })).toBeInTheDocument();
  });

  // A stopped item put back under another name ("b 2.txt", when its old name was taken while
  // it waited under a hidden one) says so, rather than only that it wasn't started.
  it("says the name a stopped item was put back under", () => {
    render(
      <CopyPasteResultDialog
        event={event("batch_rename", [
          item("/Users/demo/dest/a.txt", "completed"),
          {
            ...item(
              "/Users/demo/dest/b.txt",
              "cancelled",
              "Not started because the operation was stopped. Another item has its old name now, so it is named “b 2.txt”.",
            ),
            destinationPath: "/Users/demo/dest/b 2.txt",
          },
        ])}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveTextContent("b 2.txt");
  });

  // Unlike a copy's, a rename's items inside a folder are items of their own: search results
  // reach into folders, and the folder and an item inside may both be renamed.
  it("counts a folder and an item inside it renamed together as two items", () => {
    const folderAndInside = event("batch_rename", [
      item("/Users/demo/Folder", "failed", "“Folder” is locked."),
      item("/Users/demo/Folder/deep.txt", "completed"),
    ]);
    render(
      <CopyPasteResultDialog
        event={{
          ...folderAndInside,
          result: folderAndInside.result ? { ...folderAndInside.result, targetPath: null } : null,
        }}
        canRetry
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Renamed 1 of 2 items" })).toBeInTheDocument();
  });

  it("says after a Redo, too, that what was done can be taken back", () => {
    render(
      <CopyPasteResultDialog
        event={event("redo", [
          { ...item("/T/a.txt", "completed"), destinationPath: "/Docs/a.txt" },
          {
            ...item("/T/b.txt", "skipped", "“b.txt” is no longer in “T”."),
            destinationPath: "/Docs/b.txt",
          },
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Redid 1 of 2 items" });
    expect(
      within(dialog).getByText("1 item was left as it is. ⌘Z undoes what was redone."),
    ).toBeInTheDocument();
    // Named by where it would have gone back to.
    expect(within(dialog).getByText("b.txt")).toBeInTheDocument();
  });

  it("says that Undo tries again what failed, and Redo what failed to be redone", () => {
    const { unmount } = render(
      <CopyPasteResultDialog
        event={event("undo", [
          item("/Docs/a.txt", "completed"),
          item("/Docs/b.txt", "failed", "You don't have permission to access this item."),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "1 item was left as it is. ⇧⌘Z redoes what was undone. ⌘Z tries again what couldn’t be undone.",
      ),
    ).toBeInTheDocument();
    unmount();

    render(
      <CopyPasteResultDialog
        event={event("redo", [
          item("/Docs/b.txt", "failed", "You don't have permission to access this item."),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("1 item was left as it is. ⇧⌘Z tries again what couldn’t be redone."),
    ).toBeInTheDocument();
  });

  it("doesn't mention Redo when nothing was undone", () => {
    render(
      <CopyPasteResultDialog
        event={event("undo", [
          item("/Docs/a.txt", "skipped", "“a.txt” is no longer in “Docs”."),
          item("/Docs/b.txt", "skipped", "“b.txt” is no longer in “Docs”."),
        ])}
        canRetry={false}
        onRetry={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Couldn’t Undo" });
    expect(within(dialog).getByText("2 items were left as they are.")).toBeInTheDocument();
  });
});
