// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import {
  type CopyPasteAnalysisNode,
  type CopyPasteOverrides,
  type CopyPastePolicy,
  type CopyPasteReport,
  SAFE_COPY_PASTE_POLICY,
} from "../lib/copyPasteReview";
import { CopyPasteReviewDialog } from "./CopyPasteReviewDialog";

function fingerprint(kind: "file" | "directory" | "missing", size: number | null = null) {
  return {
    exists: kind !== "missing",
    kind,
    size,
    mtimeMs: null,
    mode: null,
    ino: null,
    dev: null,
    symlinkTarget: null,
  };
}

function node(
  overrides: Partial<CopyPasteAnalysisNode> & Pick<CopyPasteAnalysisNode, "id" | "sourcePath">,
): CopyPasteAnalysisNode {
  const name = overrides.sourcePath.split("/").at(-1) ?? "";
  const conflictClass = overrides.conflictClass ?? null;
  return {
    destinationPath: `/dest/${name}`,
    sourceKind: "file",
    destinationKind: conflictClass === null ? "missing" : "file",
    disposition: conflictClass === null ? "new" : "conflict",
    sourceFingerprint: fingerprint("file", 20),
    destinationFingerprint: fingerprint(conflictClass === null ? "missing" : "file", 10),
    children: [],
    issueCode: null,
    issueMessage: null,
    totalNodeCount: 1,
    conflictNodeCount: conflictClass === null ? 0 : 1,
    destinationTotalNodeCount: null,
    keepBothDestinationPath: conflictClass === null ? null : `/dest/${name} copy`,
    destinationOnly: null,
    replaceBlockedReason: null,
    ...overrides,
    conflictClass,
  };
}

function createReport(nodes: CopyPasteAnalysisNode[], mode: "copy" | "cut" = "copy") {
  return {
    analysisId: "analysis-1",
    mode,
    sourcePaths: nodes.map((item) => item.sourcePath),
    destinationDirectoryPath: "/Users/demo/dest",
    nodes,
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: nodes.length,
      totalNodeCount: 1200,
      totalBytes: null,
      fileConflictCount: 1,
      directoryConflictCount: nodes.some((item) => item.conflictClass === "directory_conflict")
        ? 1
        : 0,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  } satisfies CopyPasteReport;
}

const notes = node({ id: "item-1", sourcePath: "/src/notes.txt", conflictClass: "file_conflict" });
const photos = node({
  id: "item-2",
  sourcePath: "/src/photos",
  sourceKind: "directory",
  destinationKind: "directory",
  conflictClass: "directory_conflict",
  sourceFingerprint: fingerprint("directory"),
  destinationFingerprint: fingerprint("directory"),
  destinationOnly: { count: 3, samplePaths: ["d.jpg", "raw"] },
  totalNodeCount: 1,
});
const brandNew = node({ id: "item-3", sourcePath: "/src/brand new.txt" });

function Harness({
  report,
  onStart = vi.fn(),
  onClose = vi.fn(),
  action = "paste",
}: {
  report: CopyPasteReport;
  onStart?: () => void;
  onClose?: () => void;
  action?: "paste" | "move_to" | "duplicate";
}) {
  const [choices, setChoices] = useState<{
    policy: CopyPastePolicy;
    overrides: CopyPasteOverrides;
  }>({ policy: SAFE_COPY_PASTE_POLICY, overrides: {} });
  return (
    <CopyPasteReviewDialog
      action={action}
      report={report}
      policy={choices.policy}
      overrides={choices.overrides}
      onChoicesChange={setChoices}
      onClose={onClose}
      onStart={onStart}
    />
  );
}

describe("CopyPasteReviewDialog", () => {
  it("lists only the conflicts, with safe choices and a plain start button", () => {
    render(<Harness report={createReport([notes, photos, brandNew])} />);

    expect(
      screen.getByRole("heading", { name: "2 of 3 items already exist in “dest”" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing is replaced unless you choose Replace. The other 1 item will be added.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("keep_both");
    expect(screen.getByLabelText("Choice for photos")).toHaveValue("merge");
    expect(screen.getByText("→ notes.txt copy")).toBeInTheDocument();
    expect(screen.queryByText("brand new.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste" })).toHaveClass("primary");
    expect(screen.getByText("Adds 1 · Keeps both 1 · Merges 1 folder")).toBeInTheDocument();
  });

  it("reveals new items on request", () => {
    render(<Harness report={createReport([notes, brandNew])} />);

    fireEvent.click(screen.getByRole("button", { name: "Show 1 new item" }));

    expect(screen.getByText("brand new.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide new items" })).toBeInTheDocument();
  });

  it("makes Replace explicit: red row, what gets deleted, Trash note and a red button", () => {
    const onStart = vi.fn();
    render(<Harness report={createReport([notes, photos])} onStart={onStart} />);

    fireEvent.change(screen.getByLabelText("Choice for photos"), {
      target: { value: "overwrite" },
    });

    const photosRow = screen.getByText("photos").closest("li");
    expect(photosRow).toHaveClass("is-replacing");
    expect(
      within(photosRow as HTMLElement).getByText(
        "Deletes “d.jpg” and 2 more, which only exists here",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("1 existing item will be moved to the Trash")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Replace 1 and Paste" });
    expect(start).toHaveClass("danger");
    expect(screen.getByLabelText("For all conflicts:")).toHaveValue("mixed");

    fireEvent.click(start);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("applies one choice to every conflict from the 'For all conflicts' menu", () => {
    render(<Harness report={createReport([notes, photos])} />);

    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), { target: { value: "skip" } });
    fireEvent.change(screen.getByLabelText("For all conflicts:"), {
      target: { value: "overwrite" },
    });

    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("overwrite");
    expect(screen.getByLabelText("Choice for photos")).toHaveValue("overwrite");
    expect(screen.getByRole("button", { name: "Replace 2 and Paste" })).toBeInTheDocument();
  });

  it("won't offer Replace for an item that contains what is being pasted", () => {
    const outer = node({
      ...photos,
      id: "item-9",
      sourcePath: "/dest/photos/photos",
      replaceBlockedReason: "It contains the item being pasted.",
    });
    render(<Harness report={createReport([outer])} />);

    expect(
      screen.getByRole("option", { name: "Replace (It contains the item being pasted.)" }),
    ).toBeDisabled();
  });

  it("uses move wording for moves", () => {
    render(<Harness report={createReport([notes], "cut")} action="move_to" />);

    expect(
      screen.getByRole("heading", { name: "“notes.txt” already exists in “dest”" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), { target: { value: "skip" } });
    expect(screen.getByText("Stays in “src”")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  it("asks to confirm a large operation without conflicts", () => {
    render(<Harness report={createReport([brandNew])} />);

    expect(screen.getByRole("heading", { name: "Paste 1 item into “dest”?" })).toBeInTheDocument();
    expect(
      screen.getByText("This is a large operation (1,200 items in total)."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("For all conflicts:")).not.toBeInTheDocument();
  });

  it("starts with Return unless something would be replaced", () => {
    const onStart = vi.fn();
    render(<Harness report={createReport([notes])} onStart={onStart} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("does not start with Return when replacing", () => {
    const onStart = vi.fn();
    render(<Harness report={createReport([notes])} onStart={onStart} />);
    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), {
      target: { value: "overwrite" },
    });

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(onStart).not.toHaveBeenCalled();
  });
});
