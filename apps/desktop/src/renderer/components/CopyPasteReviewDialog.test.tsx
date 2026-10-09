// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import {
  type CopyPasteAnalysisNode,
  type CopyPasteOverrides,
  type CopyPastePolicy,
  type CopyPasteReport,
  SAFE_COPY_PASTE_POLICY,
  policyForAllConflicts,
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
// A second conflict: with two the sheet shows, with one a plain alert.
const memo = node({ id: "item-4", sourcePath: "/src/memo.txt", conflictClass: "file_conflict" });

function chooseForAll(label: string) {
  fireEvent.click(screen.getByRole("radio", { name: label }));
}

function checkedForAll(): string | null {
  const group = screen.getByRole("radiogroup", { name: "For all conflicts:" });
  const checked = within(group)
    .getAllByRole("radio")
    .find((radio) => (radio as HTMLInputElement).checked);
  return checked ? (checked.closest("label")?.textContent ?? null) : null;
}

function Harness({
  report,
  onStart = vi.fn(),
  onClose = vi.fn(),
  action = "paste",
  policy = SAFE_COPY_PASTE_POLICY,
}: {
  report: CopyPasteReport;
  policy?: CopyPastePolicy;
  onStart?: (choices?: {
    policy: CopyPastePolicy;
    overrides: CopyPasteOverrides;
  }) => Promise<boolean>;
  onClose?: () => void;
  action?: "paste" | "move_to" | "duplicate";
}) {
  const [choices, setChoices] = useState<{
    policy: CopyPastePolicy;
    overrides: CopyPasteOverrides;
  }>({ policy, overrides: {} });
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
  it("lists only the conflicts, skipped by default, with a plain start button", () => {
    render(<Harness report={createReport([notes, photos, brandNew])} />);

    expect(
      screen.getByRole("heading", { name: "2 of 3 items already exist in “dest”" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing is replaced unless you choose Replace. The other item will be added.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("skip");
    expect(screen.getByLabelText("Choice for photos")).toHaveValue("skip");
    expect(checkedForAll()).toBe("Skip");
    expect(screen.getByText("Existing items stay as they are.")).toBeInTheDocument();
    expect(screen.queryByText("brand new.txt")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste" })).toHaveClass("is-default");
    expect(screen.getByText("1 item will be added, 2 skipped")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Nothing is replaced unless you choose Replace. The other item will be added.",
    );
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
        "Deletes “d.jpg” and 2 more, which only exist in the existing folder",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("1 existing item will be moved to the Trash")).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Replace 1 and Paste" });
    expect(start).toHaveClass("is-destructive");
    expect(checkedForAll()).toBeNull();
    expect(screen.getByText("Set separately for some items below.")).toBeInTheDocument();

    fireEvent.click(start);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("applies one choice to every conflict from the 'For all conflicts' buttons", () => {
    render(<Harness report={createReport([notes, photos])} />);

    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), {
      target: { value: "keep_both" },
    });
    chooseForAll("Replace");

    expect(checkedForAll()).toBe("Replace");
    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("overwrite");
    expect(screen.getByLabelText("Choice for photos")).toHaveValue("overwrite");
    expect(screen.getByText("Existing items go to the Trash.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace 2 and Paste" })).toBeInTheDocument();

    chooseForAll("Keep All");
    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("keep_both");
    expect(screen.getByLabelText("Choice for photos")).toHaveValue("merge");
    expect(screen.getByText("→ notes.txt copy")).toBeInTheDocument();
    expect(
      screen.getByText("Folders merge. Files that exist are added with a “copy” name."),
    ).toBeInTheDocument();
    // Keep All merges the folder too, which can't be undone.
    expect(
      screen.getByText("1 item will be kept as a copy, 1 folder merged. Merging can’t be undone"),
    ).toBeInTheDocument();

    chooseForAll("Add Missing");
    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("skip");
    expect(screen.getByLabelText("Choice for photos")).toHaveValue("merge");
    expect(
      screen.getByText("Folders merge. Only files that aren’t there yet are added."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Merging can’t be undone$/)).toBeInTheDocument();

    // Nothing merges: nothing is said about Undo.
    chooseForAll("Skip");
    expect(screen.queryByText(/can’t be undone/)).not.toBeInTheDocument();
  });

  it("leaves Add Missing out of a move, and when no folder already exists", () => {
    const { unmount } = render(
      <Harness report={createReport([notes, photos], "cut")} action="move_to" />,
    );
    expect(
      screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent),
    ).toEqual(["Skip", "Keep All", "Replace"]);
    unmount();

    render(<Harness report={createReport([notes])} />);
    expect(screen.queryByRole("radio", { name: "Add Missing" })).not.toBeInTheDocument();
  });

  it("won't offer Replace for an item that contains what is being pasted", () => {
    const outer = node({
      ...photos,
      id: "item-9",
      sourcePath: "/dest/photos/photos",
      replaceBlockedReason: "It contains the item being pasted.",
    });
    const { unmount } = render(<Harness report={createReport([outer, notes])} />);

    expect(
      screen.getByRole("option", { name: "Replace (It contains the item being pasted.)" }),
    ).toBeDisabled();
    unmount();

    // On its own, in the alert (a file over the folder it is in): no Replace button at all.
    const fileOverFolder = node({
      id: "item-10",
      sourcePath: "/dest/photos/photos",
      destinationKind: "directory",
      conflictClass: "type_mismatch",
      replaceBlockedReason: "It contains the item being pasted.",
    });
    render(<Harness report={createReport([fileOverFolder])} />);
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep Both" })).toBeInTheDocument();
  });

  it("asks about one item that already exists in a plain alert, as Finder does", () => {
    const onStart = vi.fn(() => Promise.resolve(true));
    const onClose = vi.fn();
    const { unmount } = render(
      <Harness report={createReport([notes])} onStart={onStart} onClose={onClose} />,
    );

    expect(
      screen.getByRole("heading", { name: "“notes.txt” already exists in “dest”" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Cancel",
      "Replace",
      "Keep Both",
    ]);
    // Keep Both is the default: Return chooses it.
    expect(screen.getByRole("button", { name: "Keep Both" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(onStart).toHaveBeenLastCalledWith({
      policy: SAFE_COPY_PASTE_POLICY,
      overrides: { "item-1": "keep_both" },
    });
    unmount();

    render(<Harness report={createReport([notes])} onStart={onStart} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(onStart).toHaveBeenLastCalledWith({
      policy: SAFE_COPY_PASTE_POLICY,
      overrides: { "item-1": "overwrite" },
    });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("asks about one folder that already exists in the sheet, to show what is inside", () => {
    render(<Harness report={createReport([photos])} />);

    expect(
      screen.getByRole("heading", { name: "“photos” already exists in “dest”" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "For all conflicts:" })).toBeInTheDocument();
    expect(screen.getByLabelText("Choice for photos")).toBeInTheDocument();
  });

  it("uses move wording for moves", () => {
    render(<Harness report={createReport([notes, memo], "cut")} action="move_to" />);

    expect(
      screen.getByRole("heading", { name: "2 of 2 items already exist in “dest”" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), { target: { value: "skip" } });
    expect(screen.getAllByText("Stays in “src”")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
  });

  it("asks to confirm a large operation without conflicts", () => {
    render(<Harness report={createReport([brandNew])} />);

    expect(screen.getByRole("heading", { name: "Paste 1 item into “dest”?" })).toBeInTheDocument();
    expect(
      screen.getByText("This is a large operation (1,200 items in total)."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("starts with Return on the focused start button", () => {
    const onStart = vi.fn();
    render(<Harness report={createReport([notes, memo])} onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Paste" });
    expect(start).toHaveFocus();

    fireEvent.keyDown(start, { key: "Enter" });
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("starts with Return from a non-control inside the sheet, but not from other buttons", () => {
    const onStart = vi.fn();
    const onClose = vi.fn();
    render(<Harness report={createReport([notes, memo])} onStart={onStart} onClose={onClose} />);

    fireEvent.keyDown(screen.getByText("notes.txt"), { key: "Enter" });
    expect(onStart).toHaveBeenCalledTimes(1);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const event = fireEvent.keyDown(cancel, { key: "Enter" });
    // Left to the Cancel button itself.
    expect(event).toBe(true);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("does not start with Return when replacing, even on the focused red button", () => {
    const onStart = vi.fn();
    render(<Harness report={createReport([notes, memo])} onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Paste" });
    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), {
      target: { value: "overwrite" },
    });
    start.focus();
    expect(start).toHaveAccessibleName("Replace 1 and Paste");

    // Default prevented, so the browser doesn't click the focused button either.
    expect(fireEvent.keyDown(start, { key: "Enter" })).toBe(false);
    fireEvent.keyDown(screen.getByText("notes.txt"), { key: "Enter" });
    expect(onStart).not.toHaveBeenCalled();

    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("lets the start button work again when starting fails", async () => {
    let finish: (started: boolean) => void = () => {};
    const onStart = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness report={createReport([notes, memo])} onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Paste" });

    fireEvent.click(start);
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);

    await act(async () => finish(false));
    expect(start).toBeEnabled();
    expect(start).toHaveFocus();

    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("lets the start button work again when starting throws", async () => {
    const onStart = vi.fn(() => Promise.reject(new Error("IPC failed")));
    render(<Harness report={createReport([notes, memo])} onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Paste" });

    await act(async () => fireEvent.click(start));
    expect(start).toBeEnabled();
  });

  it("stays busy once the operation has started", async () => {
    const onStart = vi.fn(() => Promise.resolve(true));
    render(<Harness report={createReport([notes, memo])} onStart={onStart} />);
    const start = screen.getByRole("button", { name: "Paste" });

    await act(async () => fireEvent.click(start));
    expect(start).toBeDisabled();
  });

  it("keeps Tab inside the sheet and gives focus back when it closes", () => {
    const opener = document.createElement("button");
    opener.textContent = "Paste here";
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<Harness report={createReport([notes, brandNew])} />);
    const start = screen.getByRole("button", { name: "Paste" });
    // The buttons are one stop, on the selected one.
    const firstControl = screen.getByRole("radio", { name: "Skip" });
    expect(start).toHaveFocus();

    fireEvent.keyDown(start, { key: "Tab" });
    expect(firstControl).toHaveFocus();
    fireEvent.keyDown(firstControl, { key: "Tab", shiftKey: true });
    expect(start).toHaveFocus();

    // Focus that fell out of the sheet comes back in.
    opener.focus();
    fireEvent.keyDown(opener, { key: "Tab" });
    expect(firstControl).toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("switches back to a single 'For all conflicts' value when a row is set back", () => {
    render(<Harness report={createReport([notes, photos])} />);
    const notesChoice = screen.getByLabelText("Choice for notes.txt");

    fireEvent.change(notesChoice, { target: { value: "keep_both" } });
    expect(checkedForAll()).toBeNull();
    fireEvent.change(notesChoice, { target: { value: "skip" } });
    expect(checkedForAll()).toBe("Skip");
  });

  it("doesn't replace rows that can't be replaced when Replace is chosen for all", () => {
    const blocked = node({
      ...photos,
      id: "item-9",
      sourcePath: "/dest/photos/photos",
      replaceBlockedReason: "It contains the item being pasted.",
    });
    render(<Harness report={createReport([notes, blocked])} />);

    chooseForAll("Replace");

    expect(screen.getByLabelText("Choice for photos")).toHaveValue("merge");
    expect(
      screen.getByText(/Can't replace: It contains the item being pasted\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace 1 and Paste" })).toBeInTheDocument();
    // The folder that can't be replaced is merged instead, which can't be undone.
    expect(
      screen.getByText("1 existing item will be moved to the Trash. Merging can’t be undone"),
    ).toBeInTheDocument();
  });

  it("keeps a choice made for a row Replace can't take, though 'For all' shows the same", () => {
    const blocked = node({
      ...notes,
      id: "item-9",
      sourcePath: "/x/notes.txt",
      replaceBlockedReason: "It is another item being pasted.",
    });
    const onChoicesChange = vi.fn();
    render(
      <CopyPasteReviewDialog
        action="paste"
        report={createReport([blocked, memo])}
        policy={policyForAllConflicts("overwrite")}
        overrides={{}}
        onChoicesChange={onChoicesChange}
        onClose={vi.fn()}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Choice for notes.txt")).toHaveValue("keep_both");

    fireEvent.change(screen.getByLabelText("Choice for notes.txt"), {
      target: { value: "keep_both" },
    });

    // Sent as the item's own choice, so the paste keeps both whatever "For all" says.
    expect(onChoicesChange).toHaveBeenCalledWith({
      policy: policyForAllConflicts("overwrite"),
      overrides: { "item-9": "keep_both" },
    });
  });

  it("uses singular and plural wording and local number formats", () => {
    const many = Array.from({ length: 1_200 }, (_, index) =>
      node({
        id: `c-${index}`,
        sourcePath: `/src/file ${index}.txt`,
        conflictClass: "file_conflict",
      }),
    );
    const { unmount } = render(<Harness report={createReport([notes, brandNew, photos])} />);
    expect(
      screen.getByRole("heading", { name: "2 of 3 items already exist in “dest”" }),
    ).toBeInTheDocument();
    unmount();

    const others = [
      node({ id: "n-1", sourcePath: "/src/a.txt" }),
      node({ id: "n-2", sourcePath: "/src/b.txt" }),
    ];
    const second = render(
      <Harness report={createReport([notes, ...others], "cut")} action="move_to" />,
    );
    expect(
      screen.getByRole("heading", { name: "1 of 3 items already exists in “dest”" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Nothing is replaced unless you choose Replace. The other 2 items will be moved.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("2 items will be moved, 1 skipped")).toBeInTheDocument();
    second.unmount();

    render(<Harness report={createReport(many)} />);
    chooseForAll("Replace");
    expect(
      screen.getByRole("heading", { name: "1,200 of 1,200 items already exist in “dest”" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace 1,200 and Paste" })).toBeInTheDocument();
    expect(screen.getByText("1,200 existing items will be moved to the Trash")).toBeInTheDocument();
  });

  it("renders the first rows of a long list and the rest on request", () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      node({
        id: `c-${index}`,
        sourcePath: `/src/file ${index}.txt`,
        conflictClass: "file_conflict",
      }),
    );
    render(<Harness report={createReport(many)} />);

    // Counted by tag: a role query over hundreds of rows is slow enough in jsdom to time out
    // when the whole suite runs at once.
    const list = screen.getByRole("list", { name: "Items" });
    expect(list.querySelectorAll("select")).toHaveLength(300);
    fireEvent.click(screen.getByRole("button", { name: "Show all 400" }));
    expect(list.querySelectorAll("select")).toHaveLength(400);
  });

  it("caps the list of a large operation without conflicts", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      node({ id: `n-${index}`, sourcePath: `/src/new ${index}.txt` }),
    );
    render(<Harness report={createReport(many)} />);

    expect(
      screen.getByRole("heading", { name: "Paste 500 items into “dest”?" }),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Items" })).getAllByText("Adds")).toHaveLength(
      300,
    );
    expect(screen.getByRole("button", { name: "Show all 500" })).toBeInTheDocument();
  });

  it("labels nested rows by path, shows full names on hover and stops indenting deep rows", () => {
    let child = node({
      id: "deep",
      sourcePath: "/src/a/b/c/d/e/f/g/h/IMG.jpg",
      conflictClass: "file_conflict",
    });
    const segments = ["h", "g", "f", "e", "d", "c", "b", "a"];
    for (const [index, name] of segments.entries()) {
      const path = `/src/${segments.slice(index).reverse().join("/")}`;
      child = node({
        id: `dir-${name}`,
        sourcePath: path,
        sourceKind: "directory",
        destinationKind: "directory",
        conflictClass: "directory_conflict",
        sourceFingerprint: fingerprint("directory"),
        destinationFingerprint: fingerprint("directory"),
        children: [child],
        totalNodeCount: 2 + index,
        conflictNodeCount: 2 + index,
      });
    }
    render(
      <Harness report={createReport([child, notes])} policy={policyForAllConflicts("keep_all")} />,
    );

    const deep = screen.getByLabelText("Choice for a/b/c/d/e/f/g/h/IMG.jpg");
    const row = deep.closest("li") as HTMLElement;
    expect(row.style.paddingLeft).toBe(`${24 + 6 * 20}px`);
    expect(within(row).getByText("in a/b/c/d/e/f/g/h")).toBeInTheDocument();
    expect(within(row).getByTitle("a/b/c/d/e/f/g/h/IMG.jpg")).toHaveTextContent("IMG.jpg");
    expect(screen.getByLabelText("Choice for a/b")).toBeInTheDocument();
  });
});
