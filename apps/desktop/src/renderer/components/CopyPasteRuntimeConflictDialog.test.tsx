// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import { CopyPasteRuntimeConflictDialog } from "./CopyPasteRuntimeConflictDialog";

type RuntimeConflict = NonNullable<WriteOperationProgressEvent["runtimeConflict"]>;

function fingerprint(exists: boolean, kind: "file" | "directory" | "missing", size: number | null) {
  return {
    exists,
    kind,
    size,
    mtimeMs: null,
    mode: null,
    ino: null,
    dev: null,
    symlinkTarget: null,
  };
}

function conflict(overrides: Partial<RuntimeConflict> = {}): RuntimeConflict {
  return {
    conflictId: "runtime-item-1-destination",
    analysisId: "analysis-1",
    sourcePath: "/src/photos/a.jpg",
    destinationPath: "/dest/photos/a.jpg",
    sourceKind: "file",
    destinationKind: "file",
    conflictClass: "file_conflict",
    reason: "destination_created",
    sourceFingerprint: fingerprint(true, "file", 90_000),
    destinationFingerprint: fingerprint(false, "missing", null),
    currentSourceFingerprint: fingerprint(true, "file", 90_000),
    currentDestinationFingerprint: fingerprint(true, "file", 93_000),
    ...overrides,
  };
}

describe("CopyPasteRuntimeConflictDialog", () => {
  it("explains what appeared and offers Keep Both first, Replace in red", () => {
    const onResolve = vi.fn();
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Paste"
        conflict={conflict()}
        onResolve={onResolve}
        onStop={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "“a.jpg” appeared in “photos” while pasting" }),
    ).toBeInTheDocument();
    expect(screen.getByText("In “photos” now")).toBeInTheDocument();
    expect(screen.getByText("93 KB")).toBeInTheDocument();
    expect(screen.getByText("Being pasted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Both" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Replace" })).toHaveClass("is-destructive");

    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "“a.jpg” appeared in “photos” while pasting",
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");

    fireEvent.click(screen.getByLabelText("Do the same for similar changes while pasting"));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onResolve).toHaveBeenCalledWith("overwrite", true);
  });

  it("sends one answer, however often it is clicked", () => {
    const onResolve = vi.fn();
    const onStop = vi.fn();
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Duplicate"
        conflict={conflict()}
        onResolve={onResolve}
        onStop={onStop}
      />,
    );

    const keepBoth = screen.getByRole("button", { name: "Keep Both" });
    fireEvent.click(keepBoth);
    fireEvent.click(keepBoth);
    fireEvent.click(screen.getByRole("button", { name: "Stop Duplicating" }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
    expect(keepBoth).toBeDisabled();
    expect(
      screen.getByLabelText("Do the same for similar changes while duplicating"),
    ).toBeInTheDocument();
  });

  it("offers going ahead or skipping when a folder at the destination was removed", () => {
    const onResolve = vi.fn();
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Move"
        conflict={conflict({
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          reason: "destination_deleted",
          sourceFingerprint: fingerprint(true, "directory", null),
          destinationFingerprint: fingerprint(true, "directory", null),
          currentSourceFingerprint: fingerprint(true, "directory", null),
          currentDestinationFingerprint: fingerprint(false, "missing", null),
        })}
        onResolve={onResolve}
        onStop={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "“a.jpg” is no longer in “photos”" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Not there anymore")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep Both" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    const moveAnyway = screen.getByRole("button", { name: "Move Anyway" });
    expect(moveAnyway).toHaveFocus();
    expect(moveAnyway).not.toHaveClass("is-destructive");
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();

    fireEvent.click(moveAnyway);
    expect(onResolve).toHaveBeenCalledWith("overwrite", false);
  });

  it("asks before deleting permanently when the Trash can't be used", () => {
    const onResolve = vi.fn();
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Paste"
        conflict={conflict({ reason: "trash_unavailable" })}
        onResolve={onResolve}
        onStop={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Couldn’t move “a.jpg” to the Trash" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "“photos” is on a volume without a Trash, so replacing the existing item means deleting it permanently. This can’t be undone.",
    );
    const skip = screen.getByRole("button", { name: "Skip" });
    expect(skip).toHaveFocus();
    expect(skip).toHaveClass("is-default");
    const deleteButton = screen.getByRole("button", { name: "Delete Permanently" });
    expect(deleteButton).toHaveClass("is-destructive");
    expect(deleteButton).not.toHaveClass("is-default");
    expect(screen.queryByRole("button", { name: "Keep Both" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Pasting" })).toBeInTheDocument();

    fireEvent.click(
      screen.getByLabelText(
        "Do the same for other items that can’t be moved to the Trash while pasting",
      ),
    );
    fireEvent.click(deleteButton);
    expect(onResolve).toHaveBeenCalledWith("overwrite", true);
  });

  it("keeps Tab inside the alert", () => {
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Paste"
        conflict={conflict()}
        onResolve={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    const keepBoth = screen.getByRole("button", { name: "Keep Both" });
    const checkbox = screen.getByRole("checkbox");

    fireEvent.keyDown(keepBoth, { key: "Tab" });
    expect(checkbox).toHaveFocus();
    fireEvent.keyDown(checkbox, { key: "Tab", shiftKey: true });
    expect(keepBoth).toHaveFocus();
  });

  it("offers Merge for a folder that appeared", () => {
    const onResolve = vi.fn();
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Move"
        conflict={conflict({
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          currentDestinationFingerprint: fingerprint(true, "directory", null),
        })}
        onResolve={onResolve}
        onStop={vi.fn()}
      />,
    );

    // Said before Merge is chosen: it can't be undone.
    expect(screen.getByText(/Merging can’t be undone\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onResolve).toHaveBeenCalledWith("merge", false);
    expect(screen.getByRole("button", { name: "Stop Moving" })).toBeInTheDocument();
  });

  it("says nothing about Undo where Merge isn't an answer", () => {
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Copy"
        conflict={conflict({})}
        onResolve={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Merging can’t be undone/)).not.toBeInTheDocument();
  });

  it("can only skip an item that disappeared", () => {
    const onStop = vi.fn();
    render(
      <CopyPasteRuntimeConflictDialog
        verb="Paste"
        conflict={conflict({
          reason: "source_deleted",
          currentSourceFingerprint: fingerprint(false, "missing", null),
          currentDestinationFingerprint: fingerprint(false, "missing", null),
        })}
        onResolve={vi.fn()}
        onStop={onStop}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "“a.jpg” is no longer available" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep Both" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop Pasting" }));
    expect(onStop).toHaveBeenCalled();
  });
});
