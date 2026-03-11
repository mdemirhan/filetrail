// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import type { IpcResponse } from "@filetrail/contracts";

import { CopyPasteReviewDialog } from "./CopyPasteReviewDialog";

type AnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;

describe("CopyPasteReviewDialog", () => {
  it("trims the shared ancestor from row paths and exposes the trimmed path as a tooltip", () => {
    render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    const rowPath = screen.getByTitle("source/Folder/nested/file.txt");
    expect(rowPath).toBeInTheDocument();
    expect(screen.getByText("source/Folder/nested/")).toHaveClass("copy-paste-review-row-prefix");
    expect(screen.getByText("file.txt")).toHaveClass("copy-paste-review-row-basename");
    expect(screen.queryByTitle("/Users/demo/tmp/source/Folder/nested/file.txt")).not.toBeInTheDocument();
  });

  it("uses the persisted fixed bounds and keeps cancel to the left of continue", () => {
    const { container } = render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={{ width: 800, height: 560 }}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Paste Requires Review" });
    expect(dialog).toHaveStyle({
      width: "800px",
      height: "560px",
    });

    const actionButtons = Array.from(
      container.querySelectorAll(".copy-paste-review-action-buttons > button"),
    ).map((button) => button.textContent);
    expect(actionButtons).toEqual(["Cancel", "Continue Paste"]);
    expect(
      container.querySelector(".copy-paste-review-search .copy-paste-review-search-icon"),
    ).not.toBeNull();
  });

  it("keeps the dragged position when the same persisted size is synced back in", () => {
    const { rerender } = render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={{ width: 800, height: 560 }}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Paste Requires Review" });
    const dragHandle = screen.getByTestId("copy-paste-review-drag-handle");

    expect(dialog).toHaveStyle({ left: "112px", top: "104px" });

    fireEvent.pointerDown(dragHandle, { button: 0, clientX: 200, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 240, clientY: 170 });
    fireEvent.pointerUp(window);

    expect(dialog).toHaveStyle({ left: "152px", top: "154px" });

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={{ width: 800, height: 560 }}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(dialog).toHaveStyle({ left: "152px", top: "154px" });
  });
});

function createReport(): AnalysisReport {
  return {
    analysisId: "analysis-1",
    mode: "copy",
    sourcePaths: ["/Users/demo/tmp/source/Folder/nested/file.txt"],
    destinationDirectoryPath: "/Users/demo/tmp/destination",
    nodes: [
      {
        id: "node-1",
        sourcePath: "/Users/demo/tmp/source/Folder/nested/file.txt",
        destinationPath: "/Users/demo/tmp/destination/file.txt",
        sourceKind: "file",
        destinationKind: "file",
        disposition: "conflict",
        conflictClass: "file_conflict",
        sourceFingerprint: {
          exists: true,
          kind: "file",
          size: 1024,
          mtimeMs: 1,
          mode: 0o644,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        destinationFingerprint: {
          exists: true,
          kind: "file",
          size: 2048,
          mtimeMs: 2,
          mode: 0o644,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        children: [],
        issueCode: null,
        issueMessage: null,
        totalNodeCount: 1,
        conflictNodeCount: 1,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalNodeCount: 1,
      totalBytes: 1024,
      fileConflictCount: 1,
      directoryConflictCount: 0,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}
