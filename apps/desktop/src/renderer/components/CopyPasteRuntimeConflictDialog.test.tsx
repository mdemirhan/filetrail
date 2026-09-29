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
    expect(screen.getByText("91 KB")).toBeInTheDocument();
    expect(screen.getByText("Your copy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Both" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Replace" })).toHaveClass("danger-text");

    fireEvent.click(screen.getByLabelText(/Do the same for any other changes during this paste/));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onResolve).toHaveBeenCalledWith("overwrite", true);
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

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onResolve).toHaveBeenCalledWith("merge", false);
    expect(screen.getByRole("button", { name: "Stop Moving" })).toBeInTheDocument();
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
