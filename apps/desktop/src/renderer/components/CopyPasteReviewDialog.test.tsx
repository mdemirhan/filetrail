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

  it("does not describe warning-only reviews as conflicts", () => {
    render(
      <CopyPasteReviewDialog
        title="Move Requires Review"
        report={createLargeBatchWarningReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(
      screen.getByText(/this operation is large and needs confirmation before writing into/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Conflict policies")).toBeNull();
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

  it("shows filter chips when multiple action types are present", () => {
    render(
      <CopyPasteReviewDialog
        title="Move Requires Review"
        report={createMixedReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    const filterBar = screen.getByRole("toolbar", { name: "Filter by action" });
    expect(filterBar).toBeInTheDocument();
    expect(within(filterBar).getByText("Skip")).toBeInTheDocument();
    expect(within(filterBar).getByText("Add")).toBeInTheDocument();
    expect(within(filterBar).getByText("Merge")).toBeInTheDocument();
  });

  it("filters tree to show only matching items and their ancestors when a chip is active", () => {
    render(
      <CopyPasteReviewDialog
        title="Move Requires Review"
        report={createMixedReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.getByTitle("source/new-file.txt")).toBeInTheDocument();
    expect(screen.getByTitle("source/Folder/conflict.txt")).toBeInTheDocument();

    const filterBar = screen.getByRole("toolbar", { name: "Filter by action" });
    fireEvent.click(within(filterBar).getByText("Skip"));

    expect(screen.getByTitle("source/Folder/conflict.txt")).toBeInTheDocument();
    expect(screen.queryByTitle("source/new-file.txt")).not.toBeInTheDocument();
    // ancestor folder is visible to maintain tree structure
    expect(screen.getByTitle("source/Folder")).toBeInTheDocument();
  });

  it("clears filter when chip is toggled off", () => {
    render(
      <CopyPasteReviewDialog
        title="Move Requires Review"
        report={createMixedReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    const filterBar = screen.getByRole("toolbar", { name: "Filter by action" });
    const skipChip = within(filterBar).getByText("Skip");
    fireEvent.click(skipChip);
    expect(screen.queryByTitle("source/new-file.txt")).not.toBeInTheDocument();

    fireEvent.click(skipChip);
    expect(screen.getByTitle("source/new-file.txt")).toBeInTheDocument();
  });

  it("does not show filter bar when only one action type exists", () => {
    render(
      <CopyPasteReviewDialog
        title="Paste Requires Review"
        report={createLargeBatchWarningReport()}
        policy={{ file: "skip", directory: "merge", mismatch: "skip" }}
        persistedSize={null}
        onPolicyChange={() => undefined}
        onSizeChange={() => undefined}
        onClose={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(screen.queryByRole("toolbar", { name: "Filter by action" })).not.toBeInTheDocument();
  });

  describe("contextual hint lines", () => {
    function renderWithPolicy(
      report: AnalysisReport,
      policy: { file: string; directory: string; mismatch: string },
    ) {
      return render(
        <CopyPasteReviewDialog
          title="Paste Requires Review"
          report={report}
          policy={policy as any}
          persistedSize={null}
          onPolicyChange={() => undefined}
          onSizeChange={() => undefined}
          onClose={() => undefined}
          onStart={() => undefined}
        />,
      );
    }

    function getHintText(container: HTMLElement): string | null {
      const hint = container.querySelector(".copy-paste-review-row-hint");
      return hint?.textContent ?? null;
    }

    function getHintElement(container: HTMLElement): HTMLElement | null {
      return container.querySelector(".copy-paste-review-row-hint") as HTMLElement | null;
    }

    // File conflict hints
    it("shows Size Larger and Modified Newer for file with larger newer source", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 1024,
        srcMtimeMs: 1000 + 2 * 24 * 60 * 60 * 1000,
        destMtimeMs: 1000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Larger");
      expect(hint).toContain("1.0 KB → 2.0 KB");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Newer");
      expect(hint).toContain("2 days");
    });

    it("shows Older when source is older than dest", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 1024,
        srcMtimeMs: 1000,
        destMtimeMs: 1000 + 3 * 60 * 60 * 1000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Larger");
      expect(hint).toContain("1.0 KB → 2.0 KB");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Older");
      expect(hint).toContain("3 hours");
    });

    it("shows size delta when formatted sizes match but bytes differ", () => {
      const report = createFileConflictReport({
        srcSize: 1101000,
        destSize: 1100000,
        srcMtimeMs: 5000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Larger");
      expect(hint).toContain("1.0 MB → 1.0 MB");
      expect(hint).toContain("+1000 B");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Same");
    });

    it("shows Size Same when bytes are equal", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 2048,
        srcMtimeMs: 5000,
        destMtimeMs: 3000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Same");
      expect(hint).toContain("2.0 KB");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Newer");
      expect(hint).toContain("2 seconds");
    });

    it("shows only Size when dest size is null and timestamps are null", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: null,
        srcMtimeMs: null,
        destMtimeMs: null,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toBe("Size: 2.0 KB");
    });

    it("shows no hint when all sizes and timestamps are null", () => {
      const report = createFileConflictReport({
        srcSize: null,
        destSize: null,
        srcMtimeMs: null,
        destMtimeMs: null,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintElement(container);
      expect(hint).toBeNull();
    });

    it("uses same hint format for Skip file policy", () => {
      const report = createFileConflictReport({
        srcSize: 1536,
        destSize: 1024,
        srcMtimeMs: 1000 + 60000,
        destMtimeMs: 1000,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Larger");
      expect(hint).toContain("1.0 KB → 1.5 KB");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Newer");
      expect(hint).toContain("1 min");
    });

    it("uses same hint format for Keep Both file policy", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 1024,
        srcMtimeMs: 1000 + 86400000,
        destMtimeMs: 1000,
      });
      const { container } = renderWithPolicy(report, {
        file: "keep_both",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Larger");
      expect(hint).toContain("1.0 KB → 2.0 KB");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Newer");
      expect(hint).toContain("1 day");
    });

    it("shows size delta for ambiguous sizes with null timestamps", () => {
      const report = createFileConflictReport({
        srcSize: 1101000,
        destSize: 1100000,
        srcMtimeMs: null,
        destMtimeMs: null,
      });
      const { container } = renderWithPolicy(report, {
        file: "keep_both",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Larger");
      expect(hint).toContain("1.0 MB → 1.0 MB");
      expect(hint).toContain("+1000 B");
      expect(hint).not.toContain("Modified");
    });

    it("renders Same labels without any tone class", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 2048,
        srcMtimeMs: 5000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      expect(hintEl.querySelectorAll(".is-ok").length).toBe(0);
      expect(hintEl.querySelectorAll(".is-gain").length).toBe(0);
      expect(hintEl.querySelectorAll(".is-loss").length).toBe(0);
      expect(hintEl.textContent).toContain("Same");
    });

    it("applies is-gain tone to Larger and Newer labels", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 1024,
        srcMtimeMs: 6000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      const gainSpans = hintEl.querySelectorAll(".is-gain");
      expect(gainSpans.length).toBe(2);
      expect(gainSpans[0]!.textContent).toBe("Larger");
      expect(gainSpans[1]!.textContent).toBe("Newer");
    });

    it("applies is-loss tone to Smaller and Older labels", () => {
      const report = createFileConflictReport({
        srcSize: 1024,
        destSize: 2048,
        srcMtimeMs: 5000,
        destMtimeMs: 6000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      const lossSpans = hintEl.querySelectorAll(".is-loss");
      expect(lossSpans.length).toBe(2);
      expect(lossSpans[0]!.textContent).toBe("Smaller");
      expect(lossSpans[1]!.textContent).toBe("Older");
    });

    it("mutes the hint row for Skip file policy", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 1024,
        srcMtimeMs: 6000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      expect(hintEl.classList.contains("is-muted")).toBe(true);
      expect(hintEl.querySelectorAll(".is-gain").length).toBe(0);
      expect(hintEl.querySelectorAll(".is-loss").length).toBe(0);
    });

    it("strips tones for Keep Both file policy", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: 2048,
        srcMtimeMs: 5000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "keep_both",
        directory: "skip",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      expect(hintEl.querySelectorAll(".is-gain").length).toBe(0);
      expect(hintEl.querySelectorAll(".is-loss").length).toBe(0);
      expect(hintEl.textContent).toContain("Same");
    });

    // Folder conflict hints
    it("shows dest count → src count for Replace Folder", () => {
      const report = createFolderConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "overwrite",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      // totalNodeCount is 1 (self), so src count = 0; destinationTotalNodeCount = 3
      expect(hint).toBe("3 items → 0 items");
    });

    it("applies is-danger tone to Replace Folder item counts", () => {
      const report = createFolderConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "overwrite",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      const dangerSpans = hintEl.querySelectorAll(".is-danger");
      expect(dangerSpans.length).toBe(2);
      expect(dangerSpans[0]!.textContent).toBe("3 items → ");
      expect(dangerSpans[1]!.textContent).toBe("0 items");
    });

    it("omits dest part for Replace Folder when destinationTotalNodeCount is null", () => {
      const report = createFolderConflictReportWithDestCount(null, 5);
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "overwrite",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toBe("4 items");
    });

    it("applies is-danger to Replace Folder even when destinationTotalNodeCount is null", () => {
      const report = createFolderConflictReportWithDestCount(null, 5);
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "overwrite",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      const dangerSpans = hintEl.querySelectorAll(".is-danger");
      expect(dangerSpans.length).toBe(1);
      expect(dangerSpans[0]!.textContent).toBe("4 items");
    });

    it("shows new count and conflict count for Merge", () => {
      const report = createNestedFolderConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      // totalNodeCount=2, conflictNodeCount=2: new = 2-2 = 0, conflicts = 2-1 = 1
      expect(hint).toBe("0 new · 1 conflict");
    });

    it("uses singular forms in Merge hint", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 3,
        conflictNodeCount: 2,
        destinationTotalNodeCount: 5,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      // new = 3-2 = 1, conflicts = 2-1 = 1
      expect(hint).toBe("1 new · 1 conflict");
    });

    it("omits conflicts part in Merge when there are 0 conflicts", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 4,
        conflictNodeCount: 1,
        destinationTotalNodeCount: 3,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      // new = 4-1 = 3, conflicts = 1-1 = 0
      expect(hint).toBe("3 new");
    });

    it("applies is-gain to new count and is-danger to conflict count in Merge", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 5,
        conflictNodeCount: 3,
        destinationTotalNodeCount: 4,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      // new = 5-3 = 2, conflicts = 3-1 = 2
      const gainSpans = hintEl.querySelectorAll(".is-gain");
      expect(gainSpans.length).toBe(1);
      expect(gainSpans[0]!.textContent).toBe("2 new");
      const dangerSpans = hintEl.querySelectorAll(".is-danger");
      expect(dangerSpans.length).toBe(1);
      expect(dangerSpans[0]!.textContent).toBe("2 conflicts");
    });

    it("uses regular color for new count when it is 0 in Merge", () => {
      const report = createNestedFolderConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      // totalNodeCount=2, conflictNodeCount=2: new = 0, conflicts = 1
      expect(hintEl.querySelectorAll(".is-gain").length).toBe(0);
      const dangerSpans = hintEl.querySelectorAll(".is-danger");
      expect(dangerSpans.length).toBe(1);
      expect(dangerSpans[0]!.textContent).toBe("1 conflict");
    });

    it("uses regular color for new count and omits conflicts when 0 conflicts in Merge", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 4,
        conflictNodeCount: 1,
        destinationTotalNodeCount: 3,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      });
      const hintEl = getHintElement(container)!;
      // new = 3, conflicts = 0
      const gainSpans = hintEl.querySelectorAll(".is-gain");
      expect(gainSpans.length).toBe(1);
      expect(gainSpans[0]!.textContent).toBe("3 new");
      expect(hintEl.querySelectorAll(".is-danger").length).toBe(0);
    });

    it("shows no hint for Skip Folder", () => {
      const report = createFolderConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintElement(container);
      expect(hint).toBeNull();
    });

    it("shows item count + copy for Keep Both folder", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 4,
        conflictNodeCount: 1,
        destinationTotalNodeCount: 3,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "keep_both",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      // srcCount = 4-1 = 3
      expect(hint).toBe("3 items copy");
    });

    it("shows no hint for Keep Both folder with 0 items", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 1,
        conflictNodeCount: 1,
        destinationTotalNodeCount: 0,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "keep_both",
        mismatch: "skip",
      });
      const hint = getHintElement(container);
      expect(hint).toBeNull();
    });

    // Mismatch hints
    it("shows destKind → srcKind for Replace mismatch", () => {
      const report = createMismatchConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "overwrite",
      });
      const hint = getHintText(container);
      expect(hint).toBe("directory → file");
    });

    it("shows destKind ≠ srcKind for Skip mismatch", () => {
      const report = createMismatchConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toBe("directory ≠ file");
    });

    it("shows destKind ≠ srcKind for Keep Both mismatch", () => {
      const report = createMismatchConflictReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "keep_both",
      });
      const hint = getHintText(container);
      expect(hint).toBe("directory ≠ file");
    });

    // Add items — source-only hint in plain colors
    it("shows source-only hint for new files (Add) without tones", () => {
      const report = createFileConflictReport({
        srcSize: 2048,
        destSize: null,
        srcMtimeMs: 5000,
        destMtimeMs: null,
      });
      // Override to make it an Add item
      report.nodes[0]!.conflictClass = null;
      report.nodes[0]!.disposition = "new" as any;
      report.nodes[0]!.destinationKind = "missing";
      report.nodes[0]!.destinationFingerprint = {
        exists: false,
        kind: "missing",
        size: null,
        mtimeMs: null,
        mode: null,
        ino: null,
        dev: null,
        symlinkTarget: null,
      };
      report.summary.fileConflictCount = 0;
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: 2.0 KB");
      expect(hint).toContain("Modified: ");
      const hintEl = getHintElement(container)!;
      expect(hintEl.querySelectorAll(".is-gain").length).toBe(0);
      expect(hintEl.querySelectorAll(".is-loss").length).toBe(0);
    });

    it("shows no hint for new directories (Add)", () => {
      const report = createLargeBatchWarningReport();
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintElement(container);
      expect(hint).toBeNull();
    });

    // Edge cases
    it("shows Size Same 0 B for zero-byte files", () => {
      const report = createFileConflictReport({
        srcSize: 0,
        destSize: 0,
        srcMtimeMs: 5000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Same");
      expect(hint).toContain("0 B");
      expect(hint).toContain("Modified: ");
    });

    it("shows Modified Same when timestamps are identical", () => {
      const report = createFileConflictReport({
        srcSize: 1024,
        destSize: 2048,
        srcMtimeMs: 5000,
        destMtimeMs: 5000,
      });
      const { container } = renderWithPolicy(report, {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toContain("Size: ");
      expect(hint).toContain("Smaller");
      expect(hint).toContain("Modified: ");
      expect(hint).toContain("Same");
    });

    it("uses singular item for 1 item in folder hint", () => {
      const report = createFolderConflictReportWithCounts({
        totalNodeCount: 2,
        conflictNodeCount: 1,
        destinationTotalNodeCount: 1,
      });
      const { container } = renderWithPolicy(report, {
        file: "skip",
        directory: "overwrite",
        mismatch: "skip",
      });
      const hint = getHintText(container);
      expect(hint).toBe("1 item → 1 item");
    });
  });
});

function createFileConflictReport(opts: {
  srcSize: number | null;
  destSize: number | null;
  srcMtimeMs: number | null;
  destMtimeMs: number | null;
}): AnalysisReport {
  return {
    analysisId: "analysis-file-hint",
    mode: "copy",
    sourcePaths: ["/src/file.txt"],
    destinationDirectoryPath: "/dest",
    nodes: [
      {
        id: "fh-1",
        sourcePath: "/src/file.txt",
        destinationPath: "/dest/file.txt",
        sourceKind: "file",
        destinationKind: "file",
        disposition: "conflict",
        conflictClass: "file_conflict",
        sourceFingerprint: {
          exists: true,
          kind: "file",
          size: opts.srcSize,
          mtimeMs: opts.srcMtimeMs,
          mode: 0o644,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        destinationFingerprint: {
          exists: true,
          kind: "file",
          size: opts.destSize,
          mtimeMs: opts.destMtimeMs,
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
        destinationTotalNodeCount: null,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalNodeCount: 1,
      totalBytes: opts.srcSize,
      fileConflictCount: 1,
      directoryConflictCount: 0,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

function createFolderConflictReportWithDestCount(
  destCount: number | null,
  totalNodeCount: number,
): AnalysisReport {
  return {
    analysisId: "analysis-folder-dest-count",
    mode: "copy",
    sourcePaths: ["/src/Folder"],
    destinationDirectoryPath: "/dest",
    nodes: [
      {
        id: "fdc-1",
        sourcePath: "/src/Folder",
        destinationPath: "/dest/Folder",
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
        totalNodeCount,
        conflictNodeCount: 1,
        destinationTotalNodeCount: destCount,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalNodeCount,
      totalBytes: null,
      fileConflictCount: 0,
      directoryConflictCount: 1,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

function createFolderConflictReportWithCounts(opts: {
  totalNodeCount: number;
  conflictNodeCount: number;
  destinationTotalNodeCount: number;
}): AnalysisReport {
  return {
    analysisId: "analysis-folder-counts",
    mode: "copy",
    sourcePaths: ["/src/Folder"],
    destinationDirectoryPath: "/dest",
    nodes: [
      {
        id: "fcc-1",
        sourcePath: "/src/Folder",
        destinationPath: "/dest/Folder",
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
        totalNodeCount: opts.totalNodeCount,
        conflictNodeCount: opts.conflictNodeCount,
        destinationTotalNodeCount: opts.destinationTotalNodeCount,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalNodeCount: opts.totalNodeCount,
      totalBytes: null,
      fileConflictCount: 0,
      directoryConflictCount: 1,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

function createMixedReport(): AnalysisReport {
  return {
    analysisId: "analysis-mixed",
    mode: "cut",
    sourcePaths: ["/Users/demo/tmp/source/Folder", "/Users/demo/tmp/source/new-file.txt"],
    destinationDirectoryPath: "/Users/demo/tmp/destination",
    nodes: [
      {
        id: "mixed-folder",
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
            id: "mixed-conflict-file",
            sourcePath: "/Users/demo/tmp/source/Folder/conflict.txt",
            destinationPath: "/Users/demo/tmp/destination/Folder/conflict.txt",
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
            destinationTotalNodeCount: null,
          },
        ],
        issueCode: null,
        issueMessage: null,
        totalNodeCount: 2,
        conflictNodeCount: 2,
        destinationTotalNodeCount: 5,
      },
      {
        id: "mixed-new-file",
        sourcePath: "/Users/demo/tmp/source/new-file.txt",
        destinationPath: "/Users/demo/tmp/destination/new-file.txt",
        sourceKind: "file",
        destinationKind: "missing",
        disposition: "new",
        conflictClass: null,
        sourceFingerprint: {
          exists: true,
          kind: "file",
          size: 256,
          mtimeMs: 1,
          mode: 0o644,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        destinationFingerprint: {
          exists: false,
          kind: "missing",
          size: null,
          mtimeMs: null,
          mode: null,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        children: [],
        issueCode: null,
        issueMessage: null,
        totalNodeCount: 1,
        conflictNodeCount: 0,
        destinationTotalNodeCount: null,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 2,
      totalNodeCount: 3,
      totalBytes: 768,
      fileConflictCount: 1,
      directoryConflictCount: 1,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

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
        destinationTotalNodeCount: null,
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
        destinationTotalNodeCount: 3,
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

function createLargeBatchWarningReport(): AnalysisReport {
  return {
    analysisId: "analysis-large-batch",
    mode: "cut",
    sourcePaths: ["/Users/demo/tmp/test2"],
    destinationDirectoryPath: "/Users/demo/tmp/test1",
    nodes: [
      {
        id: "node-large-1",
        sourcePath: "/Users/demo/tmp/test2",
        destinationPath: "/Users/demo/tmp/test1/test2",
        sourceKind: "directory",
        destinationKind: "missing",
        disposition: "new",
        conflictClass: null,
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
          exists: false,
          kind: "missing",
          size: null,
          mtimeMs: null,
          mode: null,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        children: [],
        issueCode: null,
        issueMessage: null,
        totalNodeCount: 120,
        conflictNodeCount: 0,
        destinationTotalNodeCount: null,
      },
    ],
    issues: [],
    warnings: [
      {
        code: "large_batch",
        message: "This operation will write 120 items.",
      },
    ],
    summary: {
      topLevelItemCount: 1,
      totalNodeCount: 120,
      totalBytes: 1024,
      fileConflictCount: 0,
      directoryConflictCount: 0,
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
            destinationTotalNodeCount: null,
          },
        ],
        issueCode: null,
        issueMessage: null,
        totalNodeCount: 2,
        conflictNodeCount: 2,
        destinationTotalNodeCount: 5,
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
        destinationTotalNodeCount: null,
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
