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

// Pressing the primary button without changing anything never loses data.
export const SAFE_COPY_PASTE_POLICY: CopyPastePolicy = {
  file: "keep_both",
  directory: "merge",
  mismatch: "keep_both",
};

export type ReviewTone = "normal" | "danger" | "muted";

export type ReviewRow = {
  id: string;
  node: CopyPasteAnalysisNode;
  depth: number;
  kind: "file" | "folder";
  name: string;
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
  if (override && isChoiceAllowedForConflict(node.conflictClass, override)) {
    return override;
  }
  if (node.conflictClass === "directory_conflict") {
    return policy.directory;
  }
  return node.conflictClass === "type_mismatch" ? policy.mismatch : policy.file;
}

// The "For all conflicts" menu: Keep Both merges folders, the others apply to every kind.
export function policyForAllConflicts(choice: "keep_both" | "overwrite" | "skip"): CopyPastePolicy {
  return {
    file: choice,
    mismatch: choice,
    directory: choice === "keep_both" ? "merge" : choice,
  };
}

// The "For all conflicts" value, or null when items were set differently.
export function currentAllConflictsChoice(
  policy: CopyPastePolicy,
  overrides: CopyPasteOverrides,
): "keep_both" | "overwrite" | "skip" | null {
  if (Object.keys(overrides).length > 0 || policy.file !== policy.mismatch) {
    return null;
  }
  const expected = policyForAllConflicts(policy.file);
  return expected.directory === policy.directory ? policy.file : null;
}

export function buildReviewRows(args: {
  report: CopyPasteReport;
  policy: CopyPastePolicy;
  overrides: CopyPasteOverrides;
  showNewItems: boolean;
  now: number;
}): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const sourceFolderName = leafName(dirnameOf(args.report.sourcePaths[0] ?? ""));
  const visit = (nodes: CopyPasteAnalysisNode[], depth: number) => {
    for (const node of nodes) {
      const choice = effectiveChoice(node, args.policy, args.overrides);
      if (choice === null && !(args.showNewItems && depth === 0)) {
        continue;
      }
      rows.push(buildRow(node, depth, choice, args.report.mode, sourceFolderName, args.now));
      if (choice === "merge") {
        visit(node.children, depth + 1);
      }
    }
  };
  visit(args.report.nodes, 0);
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

export function formatReviewSummary(summary: ReviewSummary): string {
  const parts = [
    summary.added > 0 ? `Adds ${summary.added}` : null,
    summary.keptBoth > 0 ? `Keeps both ${summary.keptBoth}` : null,
    summary.merged > 0 ? `Merges ${pluralize(summary.merged, "folder")}` : null,
    summary.replaced > 0 ? `Replaces ${summary.replaced}` : null,
    summary.skipped > 0 ? `Skips ${summary.skipped}` : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" · ");
}

function buildRow(
  node: CopyPasteAnalysisNode,
  depth: number,
  choice: CopyPasteChoice | null,
  mode: "copy" | "cut",
  sourceFolderName: string,
  now: number,
): ReviewRow {
  const detail = describeRow(node, choice, mode, sourceFolderName, now);
  return {
    id: node.id,
    node,
    depth,
    kind: node.sourceKind === "directory" ? "folder" : "file",
    name: leafName(node.sourcePath),
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
  sourceFolderName: string,
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
      text: mode === "cut" ? `Stays in “${sourceFolderName}”` : "Left as is",
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
    const kept = describeDestinationOnly(node, "keeps");
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
    const lost = describeDestinationOnly(node, "deletes");
    if (lost) {
      return `${capitalize(lost)}, which only exists here`;
    }
    if (node.destinationOnly === null) {
      return `Replaces the existing folder “${leafName(node.destinationPath)}” and everything in it`;
    }
    return node.sourceKind === "directory"
      ? "Replaces the existing folder; nothing only exists there"
      : `Replaces the existing empty folder “${leafName(node.destinationPath)}”`;
  }
  const existing = node.destinationFingerprint;
  const size = existing.size === null ? "" : ` ${formatSize(existing.size, "ready")}`;
  const date = existing.mtimeMs === null ? "" : ` from ${formatReviewDate(existing.mtimeMs, now)}`;
  const kind = node.destinationKind === "symlink" ? "alias" : "file";
  return `Replaces the existing${size} ${kind}${date}`;
}

function describeDestinationOnly(
  node: CopyPasteAnalysisNode,
  verb: "keeps" | "deletes",
): string | null {
  const only = node.destinationOnly;
  if (!only || only.count === 0) {
    return null;
  }
  const first = only.samplePaths[0];
  if (!first) {
    return `${verb} ${pluralize(only.count, "item")} that only exist there`;
  }
  const others = only.count - 1;
  return others > 0 ? `${verb} “${first}” and ${others} more` : `${verb} “${first}”`;
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
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

// "today, 13:59", "yesterday, 09:12", "Jan 1", or "Jan 1, 2025" for another year.
export function formatReviewDate(ms: number, now: number): string {
  const date = new Date(ms);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (ms >= startOfToday) {
    return `today, ${TIME_FORMAT.format(date)}`;
  }
  if (ms >= startOfToday - 86_400_000) {
    return `yesterday, ${TIME_FORMAT.format(date)}`;
  }
  return date.getFullYear() === today.getFullYear()
    ? DAY_FORMAT.format(date)
    : DAY_YEAR_FORMAT.format(date);
}

export function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

export function leafName(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.split("/").filter(Boolean).at(-1) ?? path;
}

function dirnameOf(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}
