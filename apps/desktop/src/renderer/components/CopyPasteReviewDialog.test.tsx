// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import type { IpcResponse } from "@filetrail/contracts";

import { CopyPasteReviewDialog } from "./CopyPasteReviewDialog";

type AnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;

describe("CopyPasteReviewDialog", () => {
  it("renders a single destination tree with basename-only rows and trimmed path tooltips", () => {
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

    expect(screen.getByRole("tree", { name: "Destination plan" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTitle("source/Folder/nested/file.txt")).toHaveTextContent("file.txt");
    expect(screen.queryByText("source/Folder/nested/")).not.toBeInTheDocument();
    expect(
      screen.queryByTitle("/Users/demo/tmp/source/Folder/nested/file.txt"),
    ).not.toBeInTheDocument();
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

  it("shows Replace Folder as a folder policy option", () => {
    render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createFolderConflictReport()}
        policy={{ file: "skip", directory: "overwrite", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Replace Folder" })).toBeInTheDocument();
    expect(screen.queryByText(/destination folder/i)).toBeNull();
  });

  it("shows effective file actions without subtitle rows", () => {
    const { rerender } = render(
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

    expect(
      within(screen.getByRole("tree", { name: "Destination plan" })).getByText("Skip"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Destination file stays unchanged")).not.toBeInTheDocument();

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createReport()}
        policy={{ file: "keep_both", directory: "skip", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getAllByText("Keep Both").length).toBeGreaterThan(1);
    expect(screen.queryByText("Duplicate file will be created")).not.toBeInTheDocument();
  });

  it("shows folder-only and mismatch-only plans in the same tree view", () => {
    const { rerender } = render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createFolderConflictReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("Skip Folder")).toBeInTheDocument();
    expect(screen.getByTitle("source/Folder")).toHaveTextContent("Folder");

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createMismatchConflictReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getByRole("tree", { name: "Destination plan" })).toBeInTheDocument();
    expect(screen.getByTitle("source/file.txt")).toHaveTextContent("file.txt");
    expect(
      within(screen.getByRole("tree", { name: "Destination plan" })).getByText("Skip"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Destination item stays unchanged")).not.toBeInTheDocument();
  });

  it("supports expanding and collapsing merged folders like a real tree", () => {
    render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    const folderToggle = screen.getByRole("button", { name: "Collapse Folder" });
    expect(screen.getByTitle("source/Folder/nested/file.txt")).toBeInTheDocument();

    fireEvent.click(folderToggle);

    expect(screen.getByRole("button", { name: "Expand Folder" })).toBeInTheDocument();
    expect(screen.queryByTitle("source/Folder/nested/file.txt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand Folder" }));

    expect(screen.getByRole("button", { name: "Collapse Folder" })).toBeInTheDocument();
    expect(screen.getByTitle("source/Folder/nested/file.txt")).toBeInTheDocument();
  });

  it("keeps non-merge folder actions as terminal rows without nested children", () => {
    const { rerender } = render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(
      within(screen.getByRole("tree", { name: "Destination plan" })).getByText("Merge"),
    ).toBeInTheDocument();
    expect(screen.getByTitle("source/Folder/nested/file.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse Folder" })).toBeInTheDocument();

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "overwrite", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.queryByTitle("source/Folder/nested/file.txt")).not.toBeInTheDocument();
    expect(screen.getAllByText("Replace Folder").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /Expand Folder|Collapse Folder/ })).toBeNull();
    expect(screen.queryByText("Destination-only items inside are deleted")).not.toBeInTheDocument();

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "skip", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.queryByTitle("source/Folder/nested/file.txt")).not.toBeInTheDocument();
    expect(screen.getByText("Skip Folder")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Expand Folder|Collapse Folder/ })).toBeNull();
    expect(screen.queryByText("Nothing inside will change")).not.toBeInTheDocument();

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "keep_both", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.queryByTitle("source/Folder/nested/file.txt")).not.toBeInTheDocument();
    expect(screen.getAllByText("Keep Both").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /Expand Folder|Collapse Folder/ })).toBeNull();
    expect(screen.queryByText("Copied as a duplicate folder")).not.toBeInTheDocument();
  });

  it("updates the visible tree when the plan changes", () => {
    const { rerender } = render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Collapse Folder" })).toBeInTheDocument();
    expect(screen.getByTitle("source/Folder/nested/file.txt")).toBeInTheDocument();

    rerender(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createNestedFolderConflictReport()}
        policy={{ file: "skip", directory: "overwrite", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: /Expand Folder|Collapse Folder/ })).toBeNull();
    expect(screen.queryByTitle("source/Folder/nested/file.txt")).not.toBeInTheDocument();
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

function createFolderConflictReport(): AnalysisReport {
  return {
    analysisId: "analysis-2",
    mode: "copy",
    sourcePaths: ["/Users/demo/tmp/source/Folder"],
    destinationDirectoryPath: "/Users/demo/tmp/destination",
    nodes: [
      {
        id: "folder-1",
        sourcePath: "/Users/demo/tmp/source/Folder",
        destinationPath: "/Users/demo/tmp/destination/Folder",
        sourceKind: "directory",
        destinationKind: "directory",
        disposition: "conflict",
        conflictClass: "directory_conflict",
        sourceFingerprint: {
          exists: true,
          kind: "directory",
          size: null,
          mtimeMs: 1,
          mode: 0o755,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        destinationFingerprint: {
          exists: true,
          kind: "directory",
          size: null,
          mtimeMs: 2,
          mode: 0o755,
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
      totalBytes: null,
      fileConflictCount: 0,
      directoryConflictCount: 1,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

function createNestedFolderConflictReport(): AnalysisReport {
  return {
    analysisId: "analysis-3",
    mode: "copy",
    sourcePaths: ["/Users/demo/tmp/source/Folder"],
    destinationDirectoryPath: "/Users/demo/tmp/destination",
    nodes: [
      {
        id: "folder-root",
        sourcePath: "/Users/demo/tmp/source/Folder",
        destinationPath: "/Users/demo/tmp/destination/Folder",
        sourceKind: "directory",
        destinationKind: "directory",
        disposition: "conflict",
        conflictClass: "directory_conflict",
        sourceFingerprint: {
          exists: true,
          kind: "directory",
          size: null,
          mtimeMs: 1,
          mode: 0o755,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        destinationFingerprint: {
          exists: true,
          kind: "directory",
          size: null,
          mtimeMs: 2,
          mode: 0o755,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        children: [
          {
            id: "nested-file",
            sourcePath: "/Users/demo/tmp/source/Folder/nested/file.txt",
            destinationPath: "/Users/demo/tmp/destination/Folder/nested/file.txt",
            sourceKind: "file",
            destinationKind: "file",
            disposition: "conflict",
            conflictClass: "file_conflict",
            sourceFingerprint: {
              exists: true,
              kind: "file",
              size: 512,
              mtimeMs: 1,
              mode: 0o644,
              ino: null,
              dev: null,
              symlinkTarget: null,
            },
            destinationFingerprint: {
              exists: true,
              kind: "file",
              size: 1024,
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
        issueCode: null,
        issueMessage: null,
        totalNodeCount: 2,
        conflictNodeCount: 2,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalNodeCount: 2,
      totalBytes: 512,
      fileConflictCount: 1,
      directoryConflictCount: 1,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

function createMismatchConflictReport(): AnalysisReport {
  return {
    analysisId: "analysis-4",
    mode: "copy",
    sourcePaths: ["/Users/demo/tmp/source/file.txt"],
    destinationDirectoryPath: "/Users/demo/tmp/destination",
    nodes: [
      {
        id: "mismatch-1",
        sourcePath: "/Users/demo/tmp/source/file.txt",
        destinationPath: "/Users/demo/tmp/destination/file.txt",
        sourceKind: "file",
        destinationKind: "directory",
        disposition: "conflict",
        conflictClass: "type_mismatch",
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
          kind: "directory",
          size: null,
          mtimeMs: 2,
          mode: 0o755,
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
      fileConflictCount: 0,
      directoryConflictCount: 0,
      mismatchConflictCount: 1,
      blockedCount: 0,
    },
  };
}
