import {
  type CopyPasteChoice,
  type IpcRequest,
  type IpcResponse,
  isChoiceAllowedForConflict,
} from "@filetrail/contracts";

import { formatSize } from "./formatting";

export type CopyPastePolicy = Extract<
  IpcRequest<"copyPaste:start">,
  { analysisId: string }
>["policy"];
export type CopyPasteReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
export type CopyPasteAnalysisNode = CopyPasteReport["nodes"][number];
export type CopyPasteOverrides = Readonly<Record<string, CopyPasteChoice>>;
export type CopyLikeAction = "paste" | "move_to" | "duplicate";

// Pressing the primary button without changing anything never loses data: whatever is
// already at the destination is left alone.
export const SAFE_COPY_PASTE_POLICY: CopyPastePolicy = {
  file: "skip",
  directory: "skip",
  mismatch: "skip",
};

export type ReviewTone = "normal" | "danger" | "muted";

export type ReviewRow = {
  id: string;
  node: CopyPasteAnalysisNode;
  depth: number;
  kind: "file" | "folder";
  name: string;
  /** "photos/raw/IMG_2041.dng": the path below the folder the item is copied from. */
  relativePath: string;
  /** The item's current choice; null for an item that is simply added. */
  choice: CopyPasteChoice | null;
  choices: CopyPasteChoice[];
  /** The name the item gets when kept next to the existing one. */
  keepBothName: string | null;
  detail: string;
  tone: ReviewTone;
  replaceBlockedReason: string | null;
};

export type ReviewSummary = {
  topLevelCount: number;
  conflictTopLevelCount: number;
  newTopLevelCount: number;
  added: number;
  keptBoth: number;
  merged: number;
  replaced: number;
  skipped: number;
};

export const CHOICE_LABELS: Record<CopyPasteChoice, string> = {
  keep_both: "Keep Both",
  overwrite: "Replace",
  skip: "Skip",
  merge: "Merge",
};

export function getActionVerb(action: CopyLikeAction, mode: "copy" | "cut"): string {
  if (mode === "cut" || action === "move_to") {
    return "Move";
  }
  return action === "duplicate" ? "Duplicate" : "Paste";
}

export function choicesForNode(node: CopyPasteAnalysisNode): CopyPasteChoice[] {
  return node.conflictClass === "directory_conflict"
    ? ["merge", "keep_both", "overwrite", "skip"]
    : ["keep_both", "overwrite", "skip"];
}

export function effectiveChoice(
  node: CopyPasteAnalysisNode,
  policy: CopyPastePolicy,
  overrides: CopyPasteOverrides,
): CopyPasteChoice | null {
  if (node.conflictClass === null) {
    return null;
  }
  const override = overrides[node.id];
  const choice =
    override && isChoiceAllowedForConflict(node.conflictClass, override)
      ? override
      : node.conflictClass === "directory_conflict"
        ? policy.directory
        : node.conflictClass === "type_mismatch"
          ? policy.mismatch
          : policy.file;
  // "For all conflicts: Replace" can't replace an item that isn't replaceable (for example
  // the folder that contains what is being pasted); that item gets the safe choice instead.
  if (choice === "overwrite" && node.replaceBlockedReason !== null) {
    return node.conflictClass === "directory_conflict" ? "merge" : "keep_both";
  }
  return choice;
}

export type AllConflictsChoice = "skip" | "add_missing" | "keep_all" | "overwrite";

export const ALL_CONFLICTS_LABELS: Record<AllConflictsChoice, string> = {
  skip: "Skip",
  add_missing: "Add Missing",
  keep_all: "Keep All",
  overwrite: "Replace",
};

// The "For all conflicts" buttons. Add Missing and Keep All merge folders, so what is inside
// gets the same treatment; Skip and Replace apply to the folder as a whole.
export function policyForAllConflicts(choice: AllConflictsChoice): CopyPastePolicy {
  switch (choice) {
    case "skip":
      return { file: "skip", directory: "skip", mismatch: "skip" };
    case "add_missing":
      return { file: "skip", directory: "merge", mismatch: "skip" };
    case "keep_all":
      return { file: "keep_both", directory: "merge", mismatch: "keep_both" };
    case "overwrite":
      return { file: "overwrite", directory: "overwrite", mismatch: "overwrite" };
  }
}

// The buttons offered, in order. Add Missing only differs from Skip when a folder already
// exists, and a move leaves it out: it would move part of a folder and leave the files that
// already exist behind, splitting the folder between both places.
export function allConflictsChoicesFor(report: CopyPasteReport): AllConflictsChoice[] {
  return report.mode === "cut" || report.summary.directoryConflictCount === 0
    ? ["skip", "keep_all", "overwrite"]
    : ["skip", "add_missing", "keep_all", "overwrite"];
}

// What the selected button does, shown under the buttons.
export function describeAllConflictsChoice(
  choice: AllConflictsChoice | null,
  report: CopyPasteReport,
): string {
  const folders = report.summary.directoryConflictCount > 0;
  switch (choice) {
    case null:
      return "Set separately for some items below.";
    case "skip":
      return "Existing items stay as they are.";
    case "add_missing":
      return "Folders merge. Only files that aren’t there yet are added.";
    case "keep_all":
      return folders
        ? "Folders merge. Files that exist are added with a “copy” name."
        : "Files that exist are added with a “copy” name.";
    case "overwrite":
      return "Existing items go to the Trash.";
  }
}

// The "For all conflicts" value, or null when items were set differently. It comes from
// what every listed conflict will actually do, so setting an item back to the common choice
// shows the single value again.
export function currentAllConflictsChoice(
  report: CopyPasteReport,
  policy: CopyPastePolicy,
  overrides: CopyPasteOverrides,
): AllConflictsChoice | null {
  // The buttons' own value comes first when several match (e.g. every item blocks Replace).
  const candidates = allConflictsChoicesFor(report).sort(
    (left, right) =>
      Number(samePolicy(policyForAllConflicts(right), policy)) -
      Number(samePolicy(policyForAllConflicts(left), policy)),
  );
  for (const candidate of candidates) {
    const expected = policyForAllConflicts(candidate);
    if (sameDecisions(report.nodes, policy, overrides, expected)) {
      return candidate;
    }
  }
  return null;
}

function samePolicy(left: CopyPastePolicy, right: CopyPastePolicy): boolean {
  return (
    left.file === right.file &&
    left.directory === right.directory &&
    left.mismatch === right.mismatch
  );
}

// Whether the current choices do the same as `expected` with no per-item choices, looking
// inside merged folders (their conflicts are listed too).
function sameDecisions(
  nodes: CopyPasteAnalysisNode[],
  policy: CopyPastePolicy,
  overrides: CopyPasteOverrides,
  expected: CopyPastePolicy,
): boolean {
  for (const node of nodes) {
    if (node.conflictClass === null) {
      continue;
    }
    const choice = effectiveChoice(node, policy, overrides);
    if (choice !== effectiveChoice(node, expected, {})) {
      return false;
    }
    if (choice === "merge" && !sameDecisions(node.children, policy, overrides, expected)) {
      return false;
    }
  }
  return true;
}

export function buildReviewRows(args: {
  report: CopyPasteReport;
  policy: CopyPastePolicy;
  overrides: CopyPasteOverrides;
  showNewItems: boolean;
  now: number;
}): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const visit = (nodes: CopyPasteAnalysisNode[], depth: number, basePath: string) => {
    for (const node of nodes) {
      const choice = effectiveChoice(node, args.policy, args.overrides);
      if (choice === null && !(args.showNewItems && depth === 0)) {
        continue;
      }
      // Nested paths are shown below the folder the top-level item was copied from.
      const base = depth === 0 ? dirnameOf(node.sourcePath) : basePath;
      rows.push(buildRow(node, depth, choice, args.report.mode, base, args.now));
      if (choice === "merge") {
        visit(node.children, depth + 1, base);
      }
    }
  };
  visit(args.report.nodes, 0, "");
  return rows;
}

export function summarizeReview(args: {
  report: CopyPasteReport;
  policy: CopyPastePolicy;
  overrides: CopyPasteOverrides;
}): ReviewSummary {
  const summary: ReviewSummary = {
    topLevelCount: args.report.nodes.length,
    conflictTopLevelCount: args.report.nodes.filter((node) => node.conflictClass !== null).length,
    newTopLevelCount: args.report.nodes.filter((node) => node.conflictClass === null).length,
    added: 0,
    keptBoth: 0,
    merged: 0,
    replaced: 0,
    skipped: 0,
  };
  const visit = (nodes: CopyPasteAnalysisNode[]) => {
    for (const node of nodes) {
      const choice = effectiveChoice(node, args.policy, args.overrides);
      if (choice === null) {
        summary.added += 1;
      } else if (choice === "keep_both") {
        summary.keptBoth += 1;
      } else if (choice === "overwrite") {
        summary.replaced += 1;
      } else if (choice === "skip") {
        summary.skipped += 1;
      } else {
        summary.merged += 1;
        visit(node.children);
      }
    }
  };
  visit(args.report.nodes);
  return summary;
}

// "Adds 2 · Keeps both for 1 · Merges 1 folder"; a move says "Moves" for what it adds.
export function formatReviewSummary(summary: ReviewSummary, verb = "Paste"): string {
  const parts = [
    summary.added > 0
      ? `${verb === "Move" ? "Moves" : "Adds"} ${formatCount(summary.added)}`
      : null,
    summary.keptBoth > 0 ? `Keeps both for ${formatCount(summary.keptBoth)}` : null,
    summary.merged > 0 ? `Merges ${pluralize(summary.merged, "folder")}` : null,
    summary.replaced > 0 ? `Replaces ${formatCount(summary.replaced)}` : null,
    summary.skipped > 0 ? `Skips ${formatCount(summary.skipped)}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

function buildRow(
  node: CopyPasteAnalysisNode,
  depth: number,
  choice: CopyPasteChoice | null,
  mode: "copy" | "cut",
  basePath: string,
  now: number,
): ReviewRow {
  const detail = describeRow(node, choice, mode, now);
  const relativePath =
    basePath && node.sourcePath.startsWith(`${basePath}/`)
      ? node.sourcePath.slice(basePath.length + 1)
      : basePath === "/" && node.sourcePath.startsWith("/")
        ? node.sourcePath.slice(1)
        : leafName(node.sourcePath);
  return {
    id: node.id,
    node,
    depth,
    kind: node.sourceKind === "directory" ? "folder" : "file",
    name: leafName(node.sourcePath),
    relativePath,
    choice,
    choices: node.conflictClass === null ? [] : choicesForNode(node),
    keepBothName:
      choice === "keep_both" && node.keepBothDestinationPath
        ? leafName(node.keepBothDestinationPath)
        : null,
    detail: detail.text,
    tone: detail.tone,
    replaceBlockedReason: node.replaceBlockedReason,
  };
}

function describeRow(
  node: CopyPasteAnalysisNode,
  choice: CopyPasteChoice | null,
  mode: "copy" | "cut",
  now: number,
): { text: string; tone: ReviewTone } {
  const described = describeChoice(node, choice, mode, now);
  // Say why Replace isn't offered here, not only inside the disabled menu item.
  if (choice !== null && node.replaceBlockedReason !== null) {
    return {
      ...described,
      text: `${described.text} · Can't replace: ${node.replaceBlockedReason}`,
    };
  }
  return described;
}

function describeChoice(
  node: CopyPasteAnalysisNode,
  choice: CopyPasteChoice | null,
  mode: "copy" | "cut",
  now: number,
): { text: string; tone: ReviewTone } {
  const isFolder = node.sourceKind === "directory";
  if (choice === null) {
    return {
      text: isFolder
        ? `New folder · ${pluralize(node.totalNodeCount - 1, "item")}`
        : `New · ${describeSizeAndDate(node.sourceFingerprint, now)}`,
      tone: "normal",
    };
  }
  if (choice === "skip") {
    return {
      text: mode === "cut" ? `Stays in “${leafName(dirnameOf(node.sourcePath))}”` : "Left as is",
      tone: "muted",
    };
  }
  if (choice === "overwrite") {
    return { text: describeReplacement(node, now), tone: "danger" };
  }
  if (choice === "merge") {
    const conflictsInside = Math.max(0, node.conflictNodeCount - 1);
    const addedInside = Math.max(0, node.totalNodeCount - node.conflictNodeCount);
    const parts = ["Folder"];
    if (conflictsInside > 0) {
      parts.push(`${pluralize(conflictsInside, "conflict")} inside`);
    }
    if (addedInside > 0) {
      parts.push(`${pluralize(addedInside, "item")} added`);
    }
    const kept = describeKeptDestinationOnly(node);
    if (kept) {
      parts.push(kept);
    }
    return { text: parts.join(" · "), tone: "normal" };
  }
  // Keep Both
  if (node.conflictClass === "type_mismatch") {
    return { text: describeMismatch(node), tone: "normal" };
  }
  if (isFolder) {
    return {
      text: `Folder · ${pluralize(node.totalNodeCount - 1, "item")} · the existing folder stays`,
      tone: "normal",
    };
  }
  return { text: compareFiles(node, now), tone: "normal" };
}

function describeReplacement(node: CopyPasteAnalysisNode, now: number): string {
  if (node.destinationKind === "directory") {
    const lost = describeDeletedDestinationOnly(node);
    if (lost) {
      return lost;
    }
    if (node.destinationOnly === null) {
      return `Replaces the existing folder “${leafName(node.destinationPath)}” and everything in it`;
    }
    return node.sourceKind === "directory"
      ? "Replaces the existing folder; everything in it is also in yours"
      : `Replaces the existing empty folder “${leafName(node.destinationPath)}”`;
  }
  const existing = node.destinationFingerprint;
  const size = existing.size === null ? "" : ` ${formatSize(existing.size, "ready")}`;
  const date = existing.mtimeMs === null ? "" : ` from ${formatReviewDate(existing.mtimeMs, now)}`;
  const kind = node.destinationKind === "symlink" ? "alias" : "file";
  return `Replaces the existing${size} ${kind}${date}`;
}

// Merging keeps what is only in the existing folder: "keeps “d.jpg” and 2 more".
function describeKeptDestinationOnly(node: CopyPasteAnalysisNode): string | null {
  const only = node.destinationOnly;
  if (!only || only.count === 0) {
    return null;
  }
  const first = only.samplePaths[0];
  if (!first) {
    return `keeps ${pluralize(only.count, "item")} already there`;
  }
  const others = only.count - 1;
  return others > 0 ? `keeps “${first}” and ${formatCount(others)} more` : `keeps “${first}”`;
}

// Replacing deletes what is only in the existing folder, and says so.
function describeDeletedDestinationOnly(node: CopyPasteAnalysisNode): string | null {
  const only = node.destinationOnly;
  if (!only || only.count === 0) {
    return null;
  }
  const verb = only.count === 1 ? "exists" : "exist";
  const first = only.samplePaths[0];
  if (!first) {
    return `Deletes ${pluralize(only.count, "item")} that only ${verb} in the existing folder`;
  }
  const others = only.count - 1;
  const items = others > 0 ? `“${first}” and ${formatCount(others)} more` : `“${first}”`;
  return `Deletes ${items}, which only ${verb} in the existing folder`;
}

function describeMismatch(node: CopyPasteAnalysisNode): string {
  const yours = node.sourceKind === "directory" ? "a folder" : "a file";
  const name = leafName(node.destinationPath);
  if (node.destinationKind === "directory") {
    const count = node.destinationTotalNodeCount;
    const contents = count === null ? "" : ` with ${pluralize(count, "item")}`;
    return `Yours is ${yours} · the existing “${name}” is a folder${contents}`;
  }
  return `Yours is ${yours} · the existing “${name}” is a file`;
}

// Differences of up to a second are the same moment for people (and file systems).
const SAME_TIME_TOLERANCE_MS = 1000;

function compareFiles(node: CopyPasteAnalysisNode, now: number): string {
  const yours = node.sourceFingerprint;
  const existing = node.destinationFingerprint;
  const qualities: string[] = [];
  if (yours.mtimeMs !== null && existing.mtimeMs !== null) {
    const delta = yours.mtimeMs - existing.mtimeMs;
    if (delta > SAME_TIME_TOLERANCE_MS) {
      qualities.push("newer");
    } else if (delta < -SAME_TIME_TOLERANCE_MS) {
      qualities.push("older");
    }
  }
  if (yours.size !== null && existing.size !== null && yours.size !== existing.size) {
    qualities.push(yours.size > existing.size ? "larger" : "smaller");
  }
  if (qualities.length === 0) {
    return `Same size and date · ${describeSizeAndDate(yours, now)}`;
  }
  return `Yours is ${qualities.join(" and ")} · ${describeSizeAndDate(yours, now)} vs ${describeSizeAndDate(existing, now)}`;
}

function describeSizeAndDate(
  fingerprint: CopyPasteAnalysisNode["sourceFingerprint"],
  now: number,
): string {
  const parts: string[] = [];
  if (fingerprint.size !== null) {
    parts.push(formatSize(fingerprint.size, "ready"));
  }
  if (fingerprint.mtimeMs !== null) {
    parts.push(formatReviewDate(fingerprint.mtimeMs, now));
  }
  return parts.join(", ");
}

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const FULL_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// A clock a little ahead of this one is still "today"; further ahead gets the full date.
const FUTURE_TOLERANCE_MS = 60_000;

// "today, 13:59", "yesterday, 09:12", "Jan 1", or "Jan 1, 2025" for another year. A date in
// the future (a wrong clock somewhere) is shown in full rather than as "today".
export function formatReviewDate(ms: number, now: number): string {
  const date = new Date(ms);
  if (ms > now + FUTURE_TOLERANCE_MS) {
    return FULL_FORMAT.format(date);
  }
  const today = new Date(now);
  // Calendar days, not 24-hour steps: days around a daylight saving change are 23 or 25 hours.
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfYesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  ).getTime();
  if (ms >= startOfToday) {
    return `today, ${TIME_FORMAT.format(date)}`;
  }
  if (ms >= startOfYesterday) {
    return `yesterday, ${TIME_FORMAT.format(date)}`;
  }
  return date.getFullYear() === today.getFullYear()
    ? DAY_FORMAT.format(date)
    : DAY_YEAR_FORMAT.format(date);
}

// "1,200": counts are written the way the person's locale writes numbers.
export function formatCount(count: number): string {
  return count.toLocaleString();
}

export function pluralize(count: number, noun: string): string {
  return `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`;
}

export function leafName(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.split("/").filter(Boolean).at(-1) ?? path;
}

export function dirnameOf(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}
