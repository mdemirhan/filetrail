import {
  type CopyPasteAnalysisNode,
  type CopyPasteReport,
  SAFE_COPY_PASTE_POLICY,
  allConflictsChoicesFor,
  buildReviewRows,
  currentAllConflictsChoice,
  describeAllConflictsChoice,
  formatReviewDate,
  formatReviewSummary,
  policyForAllConflicts,
  summarizeReview,
} from "./copyPasteReview";

const NOW = new Date(2026, 8, 29, 14, 0).getTime();
const JAN_1 = new Date(2026, 0, 1, 1, 1).getTime();

function fingerprint(
  kind: "file" | "directory" | "missing",
  size: number | null = null,
  mtimeMs: number | null = null,
) {
  return {
    exists: kind !== "missing",
    kind,
    size,
    mtimeMs,
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
    sourceFingerprint: fingerprint("file", 1536, NOW - 60_000),
    destinationFingerprint: fingerprint(conflictClass === null ? "missing" : "file", 10, JAN_1),
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

function report(nodes: CopyPasteAnalysisNode[], mode: "copy" | "cut" = "copy"): CopyPasteReport {
  return {
    analysisId: "analysis-1",
    mode,
    sourcePaths: nodes.map((item) => item.sourcePath),
    destinationDirectoryPath: "/dest",
    nodes,
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: nodes.length,
      totalNodeCount: nodes.length,
      totalBytes: null,
      fileConflictCount: nodes.filter((item) => item.conflictClass === "file_conflict").length,
      directoryConflictCount: nodes.filter((item) => item.conflictClass === "directory_conflict")
        .length,
      mismatchConflictCount: nodes.filter((item) => item.conflictClass === "type_mismatch").length,
      blockedCount: 0,
    },
  };
}

const notes = node({
  id: "item-1",
  sourcePath: "/src/notes.txt",
  conflictClass: "file_conflict",
  keepBothDestinationPath: "/dest/notes copy.txt",
});
const photoA = node({
  id: "item-2/a.jpg",
  sourcePath: "/src/photos/a.jpg",
  destinationPath: "/dest/photos/a.jpg",
  conflictClass: "file_conflict",
  sourceFingerprint: fingerprint("file", 90_000, NOW - 5000),
  destinationFingerprint: fingerprint("file", 90_000, NOW - 5500),
  keepBothDestinationPath: "/dest/photos/a copy.jpg",
});
const photoB = node({ id: "item-2/b.jpg", sourcePath: "/src/photos/b.jpg" });
const photos = node({
  id: "item-2",
  sourcePath: "/src/photos",
  sourceKind: "directory",
  destinationKind: "directory",
  conflictClass: "directory_conflict",
  sourceFingerprint: fingerprint("directory"),
  destinationFingerprint: fingerprint("directory"),
  children: [photoA, photoB],
  totalNodeCount: 3,
  conflictNodeCount: 2,
  destinationOnly: { count: 1, samplePaths: ["d.jpg"] },
});
const config = node({
  id: "item-3",
  sourcePath: "/src/config",
  destinationKind: "directory",
  conflictClass: "type_mismatch",
  destinationFingerprint: fingerprint("directory"),
  destinationTotalNodeCount: 1,
  destinationOnly: { count: 1, samplePaths: ["settings.ini"] },
});
const brandNew = node({ id: "item-4", sourcePath: "/src/brand new.txt" });
const KEEP_ALL = policyForAllConflicts("keep_all");

describe("copy/paste review model", () => {
  it("skips every conflict by default, folders included", () => {
    const args = {
      report: report([notes, photos, config, brandNew]),
      policy: SAFE_COPY_PASTE_POLICY,
      overrides: {},
    };
    const rows = buildReviewRows({ ...args, showNewItems: false, now: NOW });

    expect(rows.map((row) => [row.name, row.choice, row.detail])).toEqual([
      ["notes.txt", "skip", "Left as is"],
      ["photos", "skip", "Left as is"],
      ["config", "skip", "Left as is"],
    ]);
    expect(summarizeReview(args)).toMatchObject({ added: 1, skipped: 3, merged: 0 });
    expect(currentAllConflictsChoice(args.report, args.policy, {})).toBe("skip");
  });

  it("merges folders and skips files that exist with Add Missing", () => {
    const args = {
      report: report([notes, photos, config, brandNew]),
      policy: policyForAllConflicts("add_missing"),
      overrides: {},
    };
    const rows = buildReviewRows({ ...args, showNewItems: false, now: NOW });

    expect(rows.map((row) => [row.name, row.choice, row.depth])).toEqual([
      ["notes.txt", "skip", 0],
      ["photos", "merge", 0],
      ["a.jpg", "skip", 1],
      ["config", "skip", 0],
    ]);
    expect(summarizeReview(args)).toMatchObject({ added: 2, skipped: 3, merged: 1 });
    expect(currentAllConflictsChoice(args.report, args.policy, {})).toBe("add_missing");
  });

  it("offers Add Missing only for a copy with a folder that already exists", () => {
    expect(allConflictsChoicesFor(report([notes, photos]))).toEqual([
      "skip",
      "add_missing",
      "keep_all",
      "overwrite",
    ]);
    // Moving only the missing files would split the folder between both places.
    expect(allConflictsChoicesFor(report([notes, photos], "cut"))).toEqual([
      "skip",
      "keep_all",
      "overwrite",
    ]);
    // Without a folder it would do the same as Skip.
    expect(allConflictsChoicesFor(report([notes, config]))).toEqual([
      "skip",
      "keep_all",
      "overwrite",
    ]);
  });

  it("says what the 'For all conflicts' choice does", () => {
    const withFolder = report([notes, photos]);
    expect(describeAllConflictsChoice("skip", withFolder)).toBe("Existing items stay as they are.");
    expect(describeAllConflictsChoice("keep_all", withFolder)).toBe(
      "Folders merge. Files that exist are added with a “copy” name.",
    );
    expect(describeAllConflictsChoice("keep_all", report([notes]))).toBe(
      "Files that exist are added with a “copy” name.",
    );
    expect(describeAllConflictsChoice(null, withFolder)).toBe(
      "Set separately for some items below.",
    );
  });

  it("keeps both files and merges folders with Keep All, listing only conflicts", () => {
    const rows = buildReviewRows({
      report: report([notes, photos, config, brandNew]),
      policy: KEEP_ALL,
      overrides: {},
      showNewItems: false,
      now: NOW,
    });

    expect(rows.map((row) => [row.name, row.choice, row.depth])).toEqual([
      ["notes.txt", "keep_both", 0],
      ["photos", "merge", 0],
      ["a.jpg", "keep_both", 1],
      ["config", "keep_both", 0],
    ]);
    expect(rows[0]?.keepBothName).toBe("notes copy.txt");
    expect(rows[0]?.detail).toBe(
      "Yours is newer and larger · 1.5 KB, today, 1:59 PM vs 10 B, Jan 1",
    );
    expect(rows[1]?.detail).toBe("Folder · 1 conflict inside · 1 item added · keeps “d.jpg”");
    // Half a second apart is the same time for people.
    expect(rows[2]?.detail).toBe("Same size and date · 88 KB, today, 1:59 PM");
    expect(rows[3]?.detail).toBe("Yours is a file · the existing “config” is a folder with 1 item");
  });

  it("spells out what Replace deletes", () => {
    const rows = buildReviewRows({
      report: report([notes, photos, config]),
      policy: policyForAllConflicts("overwrite"),
      overrides: {},
      showNewItems: false,
      now: NOW,
    });

    expect(rows.map((row) => [row.name, row.tone, row.detail])).toEqual([
      ["notes.txt", "danger", "Replaces the existing 10 B file from Jan 1"],
      ["photos", "danger", "Deletes “d.jpg”, which only exists in the existing folder"],
      ["config", "danger", "Deletes “settings.ini”, which only exists in the existing folder"],
    ]);
  });

  it("describes a package as one item, never as a folder to merge", () => {
    const app = node({
      id: "item-app",
      sourcePath: "/src/Foo.app",
      sourceKind: "directory",
      destinationKind: "directory",
      conflictClass: "file_conflict",
      sourceFingerprint: fingerprint("directory", null, NOW - 60_000),
      destinationFingerprint: fingerprint("directory", null, JAN_1),
      keepBothDestinationPath: "/dest/Foo copy.app",
    });
    const rowsFor = (choice: "overwrite" | "keep_all") =>
      buildReviewRows({
        report: report([app]),
        policy: policyForAllConflicts(choice),
        overrides: {},
        showNewItems: false,
        now: NOW,
      });

    expect(rowsFor("overwrite")[0]).toMatchObject({
      choices: ["keep_both", "overwrite", "skip"],
      detail: "Replaces the existing “Foo.app” from Jan 1",
    });
    expect(rowsFor("keep_all")[0]).toMatchObject({
      keepBothName: "Foo copy.app",
      detail: "The existing “Foo.app” stays",
    });
  });

  it("gets singular, plural and unnamed items right in what Replace deletes", () => {
    const describe = (destinationOnly: CopyPasteAnalysisNode["destinationOnly"]) =>
      buildReviewRows({
        report: report([{ ...photos, destinationOnly }]),
        policy: policyForAllConflicts("overwrite"),
        overrides: {},
        showNewItems: false,
        now: NOW,
      })[0]?.detail;

    expect(describe({ count: 3, samplePaths: ["d.jpg", "raw"] })).toBe(
      "Deletes “d.jpg” and 2 more, which only exist in the existing folder",
    );
    expect(describe({ count: 1, samplePaths: [] })).toBe(
      "Deletes 1 item that only exists in the existing folder",
    );
    expect(describe({ count: 1_500, samplePaths: [] })).toBe(
      "Deletes 1,500 items that only exist in the existing folder",
    );
    expect(describe({ count: 1_201, samplePaths: ["d.jpg"] })).toBe(
      "Deletes “d.jpg” and 1,200 more, which only exist in the existing folder",
    );
  });

  it("says what merging keeps, with or without a sample name", () => {
    const describe = (destinationOnly: CopyPasteAnalysisNode["destinationOnly"]) =>
      buildReviewRows({
        report: report([{ ...photos, destinationOnly }]),
        policy: KEEP_ALL,
        overrides: {},
        showNewItems: false,
        now: NOW,
      })[0]?.detail;

    expect(describe({ count: 3, samplePaths: ["d.jpg"] })).toBe(
      "Folder · 1 conflict inside · 1 item added · keeps “d.jpg” and 2 more",
    );
    expect(describe({ count: 2, samplePaths: [] })).toBe(
      "Folder · 1 conflict inside · 1 item added · keeps 2 items already there",
    );
  });

  it("falls back to the safe choice where Replace isn't possible, and says why", () => {
    const blockedFolder = {
      ...photos,
      replaceBlockedReason: "It contains the item being pasted.",
    };
    const blockedFile = {
      ...notes,
      id: "item-5",
      replaceBlockedReason: "It is the item being pasted.",
    };
    const args = {
      report: report([blockedFolder, blockedFile, config]),
      policy: policyForAllConflicts("overwrite"),
      overrides: {},
    };
    const rows = buildReviewRows({ ...args, showNewItems: false, now: NOW });

    expect(rows.map((row) => [row.name, row.choice])).toEqual([
      ["photos", "merge"],
      ["a.jpg", "overwrite"],
      ["notes.txt", "keep_both"],
      ["config", "overwrite"],
    ]);
    expect(rows[0]?.detail).toContain("Can't replace: It contains the item being pasted.");
    expect(rows[2]?.detail).toContain("Can't replace: It is the item being pasted.");
    expect(summarizeReview(args)).toMatchObject({ replaced: 2, merged: 1, keptBoth: 1 });
    // The menu still reads Replace: that is what it does wherever it can.
    expect(currentAllConflictsChoice(args.report, args.policy, {})).toBe("overwrite");
  });

  it("names nested rows by their path below the source folder", () => {
    const rows = buildReviewRows({
      report: report([photos]),
      policy: KEEP_ALL,
      overrides: {},
      showNewItems: false,
      now: NOW,
    });
    expect(rows.map((row) => row.relativePath)).toEqual(["photos", "photos/a.jpg"]);
  });

  it("applies per-item choices and says where skipped moves stay", () => {
    const rows = buildReviewRows({
      report: report([notes, photos], "cut"),
      policy: KEEP_ALL,
      overrides: { "item-1": "skip", "item-2": "keep_both" },
      showNewItems: false,
      now: NOW,
    });

    expect(rows.map((row) => [row.name, row.choice, row.detail])).toEqual([
      ["notes.txt", "skip", "Stays in “src”"],
      ["photos", "keep_both", "Folder · 2 items · the existing folder stays"],
    ]);
  });

  it("says each skipped move stays in its own folder", () => {
    const rows = buildReviewRows({
      report: report([notes, photos], "cut"),
      policy: KEEP_ALL,
      overrides: { "item-2/a.jpg": "skip" },
      showNewItems: false,
      now: NOW,
    });
    expect(rows.find((row) => row.name === "a.jpg")?.detail).toBe("Stays in “photos”");
  });

  it("shows new items on request", () => {
    const rows = buildReviewRows({
      report: report([notes, brandNew]),
      policy: KEEP_ALL,
      overrides: {},
      showNewItems: true,
      now: NOW,
    });
    expect(rows.map((row) => [row.name, row.choice])).toEqual([
      ["notes.txt", "keep_both"],
      ["brand new.txt", null],
    ]);
  });

  it("summarizes what the operation will do", () => {
    const summary = summarizeReview({
      report: report([notes, photos, config, brandNew]),
      policy: KEEP_ALL,
      overrides: { "item-3": "overwrite" },
    });
    expect(summary).toMatchObject({
      topLevelCount: 4,
      conflictTopLevelCount: 3,
      newTopLevelCount: 1,
      added: 2,
      keptBoth: 2,
      merged: 1,
      replaced: 1,
      skipped: 0,
    });
    expect(formatReviewSummary(summary)).toBe(
      "2 items will be added, 2 kept as copies, 1 folder merged, 1 replaced",
    );
    expect(formatReviewSummary(summary, "Move")).toBe(
      "2 items will be moved, 2 kept as copies, 1 folder merged, 1 replaced",
    );
    expect(
      formatReviewSummary({ ...summary, added: 12_000, keptBoth: 0, merged: 0, replaced: 0 }),
    ).toBe("12,000 items will be added");
    expect(
      formatReviewSummary({
        ...summary,
        added: 0,
        keptBoth: 0,
        merged: 0,
        replaced: 0,
        skipped: 1,
      }),
    ).toBe("1 item will be skipped");
  });

  it("reports the 'For all conflicts' choice, or mixed", () => {
    const nodes = report([notes, photos, config]);
    expect(currentAllConflictsChoice(nodes, KEEP_ALL, {})).toBe("keep_all");
    expect(currentAllConflictsChoice(nodes, SAFE_COPY_PASTE_POLICY, {})).toBe("skip");
    // Merging a folder and skipping what is inside is Add Missing.
    expect(currentAllConflictsChoice(nodes, SAFE_COPY_PASTE_POLICY, { "item-2": "merge" })).toBe(
      "add_missing",
    );
    expect(currentAllConflictsChoice(nodes, KEEP_ALL, { "item-1": "skip" })).toBe(null);
    // A nested conflict set differently makes it mixed too.
    expect(currentAllConflictsChoice(nodes, KEEP_ALL, { "item-2/a.jpg": "skip" })).toBeNull();
  });

  it("goes back to a single 'For all conflicts' value when an item is set back", () => {
    const nodes = report([notes, photos]);
    // Choices equal to what "For all conflicts" does are not a difference.
    expect(
      currentAllConflictsChoice(nodes, KEEP_ALL, {
        "item-1": "keep_both",
        "item-2": "merge",
      }),
    ).toBe("keep_all");
    expect(
      currentAllConflictsChoice(nodes, policyForAllConflicts("overwrite"), {
        "item-1": "overwrite",
      }),
    ).toBe("overwrite");
  });

  it("formats dates relative to today", () => {
    expect(formatReviewDate(NOW - 60_000, NOW)).toBe("today, 1:59 PM");
    expect(formatReviewDate(NOW - 86_400_000, NOW)).toBe("yesterday, 2:00 PM");
    expect(formatReviewDate(JAN_1, NOW)).toBe("Jan 1");
    expect(formatReviewDate(new Date(2025, 5, 3).getTime(), NOW)).toBe("Jun 3, 2025");
  });

  // Built from local dates, so they hold in any time zone; in one with daylight saving
  // (e.g. TZ=America/New_York) the days around the change are 23 and 25 hours long.
  it("counts yesterday in calendar days across daylight saving changes", () => {
    const afterFallBack = new Date(2026, 10, 2, 10, 0).getTime();
    expect(formatReviewDate(new Date(2026, 10, 1, 0, 30).getTime(), afterFallBack)).toBe(
      "yesterday, 12:30 AM",
    );
    expect(formatReviewDate(new Date(2026, 9, 31, 23, 30).getTime(), afterFallBack)).toBe("Oct 31");

    const afterSpringForward = new Date(2026, 2, 9, 10, 0).getTime();
    expect(formatReviewDate(new Date(2026, 2, 8, 0, 30).getTime(), afterSpringForward)).toBe(
      "yesterday, 12:30 AM",
    );
    expect(formatReviewDate(new Date(2026, 2, 7, 23, 30).getTime(), afterSpringForward)).toBe(
      "Mar 7",
    );

    const newYear = new Date(2026, 0, 1, 9, 0).getTime();
    expect(formatReviewDate(new Date(2025, 11, 31, 22, 0).getTime(), newYear)).toBe(
      "yesterday, 10:00 PM",
    );
  });

  it("shows a date in the future in full instead of as today", () => {
    expect(formatReviewDate(NOW + 30_000, NOW)).toBe("today, 2:00 PM");
    expect(formatReviewDate(NOW + 2 * 3_600_000, NOW)).toBe("Sep 29, 2026, 4:00 PM");
    expect(formatReviewDate(new Date(2027, 2, 1, 9, 5).getTime(), NOW)).toBe(
      "Mar 1, 2027, 9:05 AM",
    );
  });
});
