import {
  type CopyPasteAnalysisNode,
  type CopyPasteReport,
  SAFE_COPY_PASTE_POLICY,
  buildReviewRows,
  currentAllConflictsChoice,
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

describe("copy/paste review model", () => {
  it("keeps both files and merges folders by default, listing only conflicts", () => {
    const rows = buildReviewRows({
      report: report([notes, photos, config, brandNew]),
      policy: SAFE_COPY_PASTE_POLICY,
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
      ["photos", "danger", "Deletes “d.jpg”, which only exists here"],
      ["config", "danger", "Deletes “settings.ini”, which only exists here"],
    ]);
  });

  it("applies per-item choices and says where skipped moves stay", () => {
    const rows = buildReviewRows({
      report: report([notes, photos], "cut"),
      policy: SAFE_COPY_PASTE_POLICY,
      overrides: { "item-1": "skip", "item-2": "keep_both" },
      showNewItems: false,
      now: NOW,
    });

    expect(rows.map((row) => [row.name, row.choice, row.detail])).toEqual([
      ["notes.txt", "skip", "Stays in “src”"],
      ["photos", "keep_both", "Folder · 2 items · the existing folder stays"],
    ]);
  });

  it("shows new items on request", () => {
    const rows = buildReviewRows({
      report: report([notes, brandNew]),
      policy: SAFE_COPY_PASTE_POLICY,
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
      policy: SAFE_COPY_PASTE_POLICY,
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
      "Adds 2 · Keeps both 2 · Merges 1 folder · Replaces 1",
    );
  });

  it("reports the 'For all conflicts' choice, or mixed", () => {
    expect(currentAllConflictsChoice(SAFE_COPY_PASTE_POLICY, {})).toBe("keep_both");
    expect(currentAllConflictsChoice(policyForAllConflicts("skip"), {})).toBe("skip");
    expect(currentAllConflictsChoice(SAFE_COPY_PASTE_POLICY, { "item-1": "skip" })).toBeNull();
  });

  it("formats dates relative to today", () => {
    expect(formatReviewDate(NOW - 60_000, NOW)).toBe("today, 1:59 PM");
    expect(formatReviewDate(NOW - 86_400_000, NOW)).toBe("yesterday, 2:00 PM");
    expect(formatReviewDate(JAN_1, NOW)).toBe("Jan 1");
    expect(formatReviewDate(new Date(2025, 5, 3).getTime(), NOW)).toBe("Jun 3, 2025");
  });
});
