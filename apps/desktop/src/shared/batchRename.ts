// Renaming several items at once: the settings of the Rename sheet, the new name each item
// gets from them, and the plan that settles clashes with names already taken. The sheet's
// preview and the rename itself are built from the same plan, so what is shown is what is
// done. Pure functions only: the folders' contents and the items' dates are passed in.

import { getItemNameError } from "@filetrail/contracts";

export type BatchRenameMode = "replace" | "add" | "format" | "case";
export type BatchRenameNameFormat = "index" | "counter" | "date";
export type BatchRenameWhere = "after" | "before";
export type BatchRenameDateSource = "created" | "modified" | "taken" | "today";
export type BatchRenameDateFormat =
  | "ymd"
  | "ymd_hm"
  | "ymd_hms"
  | "dmy"
  | "dmyy"
  | "mdy"
  | "yymd"
  | "ym"
  | "custom";
export type BatchRenameCase = "lower" | "upper" | "title";
export type BatchRenameApplyTo = "name" | "extension" | "both";
/** What happens to an item whose new name is taken. */
export type BatchRenameOnConflict = "number" | "skip" | "block";

export type BatchRenameSettings = {
  mode: BatchRenameMode;
  // Replace Text
  find: string;
  replaceWith: string;
  matchCase: boolean;
  useRegex: boolean;
  // Add Text
  addText: string;
  addWhere: BatchRenameWhere;
  // Format
  nameFormat: BatchRenameNameFormat;
  formatWhere: BatchRenameWhere;
  customName: string;
  keepNames: boolean;
  startAt: number;
  step: number;
  /** Counter only: how many digits, or as many as the last number needs. */
  digits: "auto" | 2 | 3 | 4 | 5;
  /** Between the name and its number or date. */
  separator: BatchRenameSeparator;
  dateSource: BatchRenameDateSource;
  dateFormat: BatchRenameDateFormat;
  /** Between the parts of a date. */
  dateSeparator: BatchRenameDateSeparator;
  customDatePattern: string;
  // Change Case
  caseStyle: BatchRenameCase;
  // Every mode but Format, which keeps extensions.
  applyTo: BatchRenameApplyTo;
  onConflict: BatchRenameOnConflict;
};

export const BATCH_RENAME_SEPARATORS = [" ", "-", "_", ""] as const;
export type BatchRenameSeparator = (typeof BATCH_RENAME_SEPARATORS)[number];
export const BATCH_RENAME_DATE_SEPARATORS = ["-", "_", ".", " ", ""] as const;
export type BatchRenameDateSeparator = (typeof BATCH_RENAME_DATE_SEPARATORS)[number];

// The date formats offered, as their parts in order; Custom takes a pattern instead.
export const BATCH_RENAME_DATE_FORMATS: ReadonlyArray<{
  id: Exclude<BatchRenameDateFormat, "custom">;
  tokens: readonly DateToken[];
}> = [
  { id: "ymd", tokens: ["YYYY", "MM", "DD"] },
  { id: "ymd_hm", tokens: ["YYYY", "MM", "DD", "HH", "mm"] },
  { id: "ymd_hms", tokens: ["YYYY", "MM", "DD", "HH", "mm", "ss"] },
  { id: "dmy", tokens: ["DD", "MM", "YYYY"] },
  { id: "dmyy", tokens: ["DD", "MM", "YY"] },
  { id: "mdy", tokens: ["MM", "DD", "YYYY"] },
  { id: "yymd", tokens: ["YY", "MM", "DD"] },
  { id: "ym", tokens: ["YYYY", "MM"] },
];

export const DATE_TOKENS = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss"] as const;
export type DateToken = (typeof DATE_TOKENS)[number];
// Longest first, so "YYYY" is not read as two "YY". The global one replaces; the other only
// asks whether a pattern has any (a global pattern's test() would carry its position over).
const DATE_TOKEN_PATTERN = /YYYY|YY|MM|DD|HH|mm|ss/gu;
const HAS_DATE_TOKEN = /YYYY|YY|MM|DD|HH|mm|ss/u;

// Finder's starting point: Replace Text, and "File 1" for Format.
export const DEFAULT_BATCH_RENAME_SETTINGS: BatchRenameSettings = {
  mode: "replace",
  find: "",
  replaceWith: "",
  matchCase: false,
  useRegex: false,
  addText: "",
  addWhere: "after",
  nameFormat: "index",
  formatWhere: "after",
  customName: "File",
  keepNames: false,
  startAt: 1,
  step: 1,
  digits: 5,
  separator: " ",
  dateSource: "created",
  dateFormat: "ymd",
  dateSeparator: "-",
  customDatePattern: "YYYY-MM-DD at HH.mm",
  caseStyle: "lower",
  applyTo: "name",
  onConflict: "number",
};

export const MAX_BATCH_RENAME_PRESETS = 50;
const MAX_TEXT_SETTING_LENGTH = 255;
const MAX_NUMBER_SETTING = 999_999_999;

export type BatchRenamePreset = { name: string; settings: BatchRenameSettings };

/** A local date and time as the clock of this Mac reads it: "2026-05-14T18:02:11". */
export type LocalDateTime = string;

export type BatchRenameItem = {
  path: string;
  /** The item's name now. */
  name: string;
  /** Folders have no extension; packages (an .app) and files do. */
  isFolder: boolean;
  createdAt: LocalDateTime | null;
  modifiedAt: LocalDateTime | null;
  /** When the photo or video was taken, from its own metadata; null when it has none. */
  takenAt: LocalDateTime | null;
};

// ── Settings as saved ─────────────────────────────────────────────────────────────────────

function pick<T extends string | number>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_SETTING_LENGTH) : fallback;
}

function wholeNumber(value: unknown, fallback: number, least: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_NUMBER_SETTING, Math.max(least, Math.round(value)))
    : fallback;
}

// Saved settings are read leniently: a value that is missing or not one of the choices
// takes its default, so a damaged or older file never stops the sheet from opening.
export function sanitizeBatchRenameSettings(value: unknown): BatchRenameSettings {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const d = DEFAULT_BATCH_RENAME_SETTINGS;
  return {
    mode: pick(record.mode, ["replace", "add", "format", "case"] as const, d.mode),
    find: text(record.find, d.find),
    replaceWith: text(record.replaceWith, d.replaceWith),
    matchCase: typeof record.matchCase === "boolean" ? record.matchCase : d.matchCase,
    useRegex: typeof record.useRegex === "boolean" ? record.useRegex : d.useRegex,
    addText: text(record.addText, d.addText),
    addWhere: pick(record.addWhere, ["after", "before"] as const, d.addWhere),
    nameFormat: pick(record.nameFormat, ["index", "counter", "date"] as const, d.nameFormat),
    formatWhere: pick(record.formatWhere, ["after", "before"] as const, d.formatWhere),
    customName: text(record.customName, d.customName),
    keepNames: typeof record.keepNames === "boolean" ? record.keepNames : d.keepNames,
    startAt: wholeNumber(record.startAt, d.startAt, 0),
    step: wholeNumber(record.step, d.step, 1),
    digits: pick(record.digits, ["auto", 2, 3, 4, 5] as const, d.digits),
    separator: pick(record.separator, BATCH_RENAME_SEPARATORS, d.separator),
    dateSource: pick(
      record.dateSource,
      ["created", "modified", "taken", "today"] as const,
      d.dateSource,
    ),
    dateFormat: pick(
      record.dateFormat,
      [...BATCH_RENAME_DATE_FORMATS.map((format) => format.id), "custom"] as const,
      d.dateFormat,
    ),
    dateSeparator: pick(record.dateSeparator, BATCH_RENAME_DATE_SEPARATORS, d.dateSeparator),
    customDatePattern: text(record.customDatePattern, d.customDatePattern),
    caseStyle: pick(record.caseStyle, ["lower", "upper", "title"] as const, d.caseStyle),
    applyTo: pick(record.applyTo, ["name", "extension", "both"] as const, d.applyTo),
    onConflict: pick(record.onConflict, ["number", "skip", "block"] as const, d.onConflict),
  };
}

// Presets with an empty or repeated name are dropped; the first of a name is kept.
export function sanitizeBatchRenamePresets(value: unknown): BatchRenamePreset[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const presets: BatchRenamePreset[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
    if (name.length === 0 || seen.has(name.toLowerCase())) {
      continue;
    }
    seen.add(name.toLowerCase());
    presets.push({ name, settings: sanitizeBatchRenameSettings(record.settings) });
    if (presets.length === MAX_BATCH_RENAME_PRESETS) {
      break;
    }
  }
  return presets;
}

// ── Names ─────────────────────────────────────────────────────────────────────────────────

/**
 * A name split into what Rename treats as the name and as the extension: the part after the
 * last dot. A folder has none, and neither has a name whose only dot starts it (".env").
 */
export function splitItemName(
  name: string,
  isFolder: boolean,
): { stem: string; extension: string | null } {
  const dot = name.lastIndexOf(".");
  if (isFolder || dot <= 0 || dot === name.length - 1) {
    return { stem: name, extension: null };
  }
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1) };
}

/** A piece of a new name, marked when it is what the rename changed. */
export type NameSegment = { text: string; changed: boolean };

export type ProposedName =
  /** Nothing in the settings applies to this item. */
  | { kind: "unchanged" }
  | {
      kind: "renamed";
      name: string;
      segments: NameSegment[];
      /** The date taken was missing, and the date created was used. */
      usedCreatedForTaken?: boolean;
      /** Nothing is left before the extension: the name would be only ".txt". */
      emptyName?: boolean;
    };

export type ProposedNames = {
  /** What is wrong with the settings themselves (a broken pattern); null when nothing. */
  settingsError: string | null;
  names: ProposedName[];
};

/**
 * The new name of every item, in the order given: that order numbers them. `now` is the
 * moment the sheet opened, for Today. Names are trimmed of spaces at their ends, as the
 * single rename does.
 */
export function proposeNames(
  settings: BatchRenameSettings,
  items: readonly BatchRenameItem[],
  now: LocalDateTime,
): ProposedNames {
  const settingsError = getSettingsError(settings);
  if (settingsError !== null) {
    return { settingsError, names: items.map(() => ({ kind: "unchanged" })) };
  }
  const pattern = settings.mode === "replace" ? buildFindPattern(settings) : null;
  const names = items.map((item, index): ProposedName => {
    const result =
      settings.mode === "format"
        ? formatName(settings, item, index, items.length, now)
        : transformInScope(settings, item, pattern);
    if (!result) {
      return { kind: "unchanged" };
    }
    const trimmed = trimSegments(result.segments);
    const name = trimmed.map((segment) => segment.text).join("");
    if (name === item.name) {
      return { kind: "unchanged" };
    }
    return {
      kind: "renamed",
      name,
      segments: mergeSegments(trimmed),
      ...(result.usedCreatedForTaken ? { usedCreatedForTaken: true } : {}),
      ...(result.emptyName ? { emptyName: true } : {}),
    };
  });
  return { settingsError: null, names };
}

/** What is wrong with the settings as typed, or null. */
export function getSettingsError(settings: BatchRenameSettings): string | null {
  if (settings.mode === "replace" && settings.useRegex && settings.find.length > 0) {
    try {
      buildFindPattern(settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `The pattern isn’t valid: ${message.replace(/^Invalid regular expression: /u, "")}`;
    }
  }
  if (
    settings.mode === "format" &&
    settings.nameFormat === "date" &&
    settings.dateFormat === "custom" &&
    !HAS_DATE_TOKEN.test(settings.customDatePattern)
  ) {
    return "Put at least one of YYYY, YY, MM, DD, HH, mm or ss in the date pattern.";
  }
  return null;
}

function buildFindPattern(settings: BatchRenameSettings): RegExp | null {
  if (settings.find.length === 0) {
    return null;
  }
  const source = settings.useRegex ? settings.find : escapeRegExp(settings.find);
  return new RegExp(source, `g${settings.matchCase ? "" : "i"}u`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

type Transformed = {
  segments: NameSegment[];
  usedCreatedForTaken?: boolean;
  emptyName?: boolean;
} | null;

// Replace Text, Add Text and Change Case work on the part Apply To names; the rest of the
// name stays as it is.
function transformInScope(
  settings: BatchRenameSettings,
  item: BatchRenameItem,
  pattern: RegExp | null,
): Transformed {
  const { stem, extension } = splitItemName(item.name, item.isFolder);
  const transform = (part: string) => transformText(settings, part, pattern);
  if (settings.applyTo === "both") {
    return wrap(transform(item.name));
  }
  if (settings.applyTo === "extension") {
    if (extension === null) {
      return null;
    }
    const changed = transform(extension);
    return changed ? wrap([{ text: `${stem}.`, changed: false }, ...changed]) : null;
  }
  const changed = transform(stem);
  if (!changed) {
    return null;
  }
  // The name's own ends lose their spaces, not just the whole name's: "a copy.txt" without
  // "copy" is "a.txt", not "a .txt".
  const trimmedStem = trimSegments(changed);
  if (extension === null) {
    return wrap(trimmedStem);
  }
  return {
    segments: [...trimmedStem, { text: `.${extension}`, changed: false }],
    ...(trimmedStem.length === 0 ? { emptyName: true } : {}),
  };
}

function wrap(segments: NameSegment[] | null): Transformed {
  return segments ? { segments } : null;
}

// One part of a name changed by Replace Text, Add Text or Change Case; null when it isn't.
function transformText(
  settings: BatchRenameSettings,
  part: string,
  pattern: RegExp | null,
): NameSegment[] | null {
  if (settings.mode === "replace") {
    return pattern ? replaceText(part, pattern, settings) : null;
  }
  if (settings.mode === "add") {
    if (settings.addText.length === 0) {
      return null;
    }
    const added = { text: settings.addText, changed: true };
    const kept = { text: part, changed: false };
    return settings.addWhere === "after" ? [kept, added] : [added, kept];
  }
  const changed = changeCase(part, settings.caseStyle);
  return changed === part ? null : [{ text: changed, changed: true }];
}

// Every match is replaced. With a regular expression, the replacement can name what the
// pattern captured ($1, $<name>, $&); plain text is put in as typed.
function replaceText(
  part: string,
  pattern: RegExp,
  settings: BatchRenameSettings,
): NameSegment[] | null {
  pattern.lastIndex = 0;
  const segments: NameSegment[] = [];
  let position = 0;
  let matched = false;
  for (const match of part.matchAll(pattern)) {
    matched = true;
    const start = match.index ?? 0;
    if (start > position) {
      segments.push({ text: part.slice(position, start), changed: false });
    }
    const replacement = settings.useRegex
      ? expandReplacement(settings.replaceWith, match, part)
      : settings.replaceWith;
    segments.push({ text: replacement, changed: true });
    position = start + match[0].length;
  }
  if (!matched) {
    return null;
  }
  if (position < part.length) {
    segments.push({ text: part.slice(position), changed: false });
  }
  return segments;
}

/**
 * A replacement with what was matched put in, as JavaScript's String.replace does: $$ is a
 * dollar sign, $& the match, $` and $' what is before and after it, $1 to $99 the groups,
 * $<name> a named group. Anything else is kept as typed.
 */
export function expandReplacement(
  template: string,
  match: RegExpMatchArray | RegExpExecArray,
  subject: string,
): string {
  const groupCount = match.length - 1;
  const start = match.index ?? 0;
  let result = "";
  for (let index = 0; index < template.length; index += 1) {
    const character = template[index];
    if (character !== "$" || index === template.length - 1) {
      result += character;
      continue;
    }
    const next = template[index + 1] ?? "";
    if (next === "$") {
      result += "$";
      index += 1;
    } else if (next === "&") {
      result += match[0];
      index += 1;
    } else if (next === "`") {
      result += subject.slice(0, start);
      index += 1;
    } else if (next === "'") {
      result += subject.slice(start + match[0].length);
      index += 1;
    } else if (next === "<" && match.groups) {
      const close = template.indexOf(">", index + 2);
      if (close === -1) {
        result += character;
        continue;
      }
      result += match.groups[template.slice(index + 2, close)] ?? "";
      index = close;
    } else if (/\d/u.test(next)) {
      // Two digits when that group exists ($12), else one ($1 followed by "2").
      const two = template.slice(index + 1, index + 3);
      const twoNumber = /^\d\d$/u.test(two) ? Number(two) : Number.NaN;
      if (twoNumber >= 1 && twoNumber <= groupCount) {
        result += match[twoNumber] ?? "";
        index += 2;
        continue;
      }
      const oneNumber = Number(next);
      if (oneNumber >= 1 && oneNumber <= groupCount) {
        result += match[oneNumber] ?? "";
        index += 1;
        continue;
      }
      result += character;
    } else {
      result += character;
    }
  }
  return result;
}

/** lowercase, UPPERCASE, or Title Case: the first letter of each word up, the rest as is. */
export function changeCase(text: string, style: BatchRenameCase): string {
  if (style === "lower") {
    return text.toLowerCase();
  }
  if (style === "upper") {
    return text.toUpperCase();
  }
  return text.replace(/(^|[\s_\-.([{])(\p{Ll})/gu, (_whole, before: string, letter: string) => {
    return `${before}${letter.toUpperCase()}`;
  });
}

// Format: a new name, or the name kept, with a number or a date after or before it. The
// extension is always kept.
function formatName(
  settings: BatchRenameSettings,
  item: BatchRenameItem,
  index: number,
  count: number,
  now: LocalDateTime,
): Transformed {
  const { stem, extension } = splitItemName(item.name, item.isFolder);
  let tag: string;
  let usedCreatedForTaken = false;
  if (settings.nameFormat === "date") {
    let date: LocalDateTime | null;
    if (settings.dateSource === "taken") {
      date = item.takenAt;
      if (date === null) {
        date = item.createdAt;
        usedCreatedForTaken = true;
      }
    } else {
      date =
        settings.dateSource === "created"
          ? item.createdAt
          : settings.dateSource === "modified"
            ? item.modifiedAt
            : now;
    }
    if (date === null) {
      return null;
    }
    tag = formatDate(date, settings);
  } else {
    tag = formatNumber(settings, index, count);
  }
  const base = settings.keepNames ? stem : settings.customName;
  const baseSegment = { text: base, changed: !settings.keepNames };
  const tagSegment = {
    text:
      settings.formatWhere === "after"
        ? `${settings.separator}${tag}`
        : `${tag}${settings.separator}`,
    changed: true,
  };
  const segments =
    settings.formatWhere === "after" ? [baseSegment, tagSegment] : [tagSegment, baseSegment];
  if (extension !== null) {
    segments.push({ text: `.${extension}`, changed: false });
  }
  return { segments, ...(usedCreatedForTaken ? { usedCreatedForTaken } : {}) };
}

/** The number of the item at `index`: Index as is, Counter padded with zeros. */
export function formatNumber(settings: BatchRenameSettings, index: number, count: number): string {
  const value = settings.startAt + index * settings.step;
  if (settings.nameFormat !== "counter") {
    return String(value);
  }
  const width =
    settings.digits === "auto"
      ? String(settings.startAt + Math.max(0, count - 1) * settings.step).length
      : settings.digits;
  return String(value).padStart(width, "0");
}

/** A date in the chosen format: its parts with the separator between them, or the pattern. */
export function formatDate(date: LocalDateTime, settings: BatchRenameSettings): string {
  const parts = readLocalDateTime(date);
  const value = (token: DateToken): string => {
    switch (token) {
      case "YYYY":
        return String(parts.year).padStart(4, "0");
      case "YY":
        return String(parts.year % 100).padStart(2, "0");
      case "MM":
        return String(parts.month).padStart(2, "0");
      case "DD":
        return String(parts.day).padStart(2, "0");
      case "HH":
        return String(parts.hour).padStart(2, "0");
      case "mm":
        return String(parts.minute).padStart(2, "0");
      default:
        return String(parts.second).padStart(2, "0");
    }
  };
  if (settings.dateFormat === "custom") {
    return settings.customDatePattern.replace(DATE_TOKEN_PATTERN, (token) =>
      value(token as DateToken),
    );
  }
  const format =
    BATCH_RENAME_DATE_FORMATS.find((candidate) => candidate.id === settings.dateFormat) ??
    BATCH_RENAME_DATE_FORMATS[0];
  return (format?.tokens ?? []).map(value).join(settings.dateSeparator);
}

/** How a date format reads with the separator chosen: "YYYY-MM-DD", "DDMMYY". */
export function describeDateFormat(
  format: Exclude<BatchRenameDateFormat, "custom">,
  separator: BatchRenameDateSeparator,
): string {
  const tokens = BATCH_RENAME_DATE_FORMATS.find((candidate) => candidate.id === format)?.tokens;
  return (tokens ?? []).join(separator);
}

export function readLocalDateTime(date: LocalDateTime): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/u.exec(date);
  const number = (index: number) => Number(match?.[index] ?? 0);
  return {
    year: number(1),
    month: number(2),
    day: number(3),
    hour: number(4),
    minute: number(5),
    second: number(6),
  };
}

/** A moment as the clock of this Mac reads it. */
export function toLocalDateTime(date: Date): LocalDateTime {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function trimSegments(segments: NameSegment[]): NameSegment[] {
  const result = segments.map((segment) => ({ ...segment }));
  while (result.length > 0) {
    const first = result[0];
    if (!first) {
      break;
    }
    first.text = first.text.replace(/^\s+/u, "");
    if (first.text.length > 0) {
      break;
    }
    result.shift();
  }
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (!last) {
      break;
    }
    last.text = last.text.replace(/\s+$/u, "");
    if (last.text.length > 0) {
      break;
    }
    result.pop();
  }
  return result;
}

// Neighbours of the same kind become one, and empty ones go (a replacement with nothing).
function mergeSegments(segments: NameSegment[]): NameSegment[] {
  const merged: NameSegment[] = [];
  for (const segment of segments) {
    if (segment.text.length === 0) {
      continue;
    }
    const last = merged[merged.length - 1];
    if (last && last.changed === segment.changed) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

// ── Clashes ───────────────────────────────────────────────────────────────────────────────

/**
 * Two names that the disk treats as one: macOS disks ignore how an accented letter was
 * typed (é as one character or e plus an accent), and, unless the disk is case-sensitive,
 * whether letters are capitals.
 */
export function nameKey(name: string, caseSensitive: boolean): string {
  const normalized = name.normalize("NFD");
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/** What is known of a folder some items are in. */
export type BatchRenameFolder = {
  /** Every name in it, hidden ones included. */
  names: readonly string[];
  caseSensitive: boolean;
};

/** Why an item won't be renamed though it would have changed. */
export type BatchRenameItemProblem =
  /** The new name isn't a valid name (empty, a "/", too long): always fixed first. */
  | { kind: "invalid"; message: string }
  /** The new name is taken, and the setting says not to rename until that is fixed. */
  | { kind: "taken"; byItemInBatch: boolean }
  /** The new name is taken, and the setting says to leave this item as it is. */
  | { kind: "skippedTaken"; byItemInBatch: boolean }
  /** The item can't be renamed at all (locked, or its folder can't be written to). */
  | { kind: "cannotRename"; message: string };

export type BatchRenamePlanItem =
  | { status: "unchanged" }
  | {
      status: "rename";
      name: string;
      segments: NameSegment[];
      /** The number added because the name was taken. */
      addedNumber: number | null;
      usedCreatedForTaken: boolean;
      /** The new name starts with a dot, so the item will be hidden. */
      becomesHidden: boolean;
    }
  | {
      status: "problem";
      proposedName: string;
      segments: NameSegment[];
      problem: BatchRenameItemProblem;
    };

export type BatchRenamePlan = {
  settingsError: string | null;
  items: BatchRenamePlanItem[];
  renameCount: number;
  unchangedCount: number;
  /** Items left as they are on purpose (Skip, or locked): they don't stop the rename. */
  skippedCount: number;
  /** Items that must be fixed before anything is renamed. */
  blockingCount: number;
};

export type BatchRenamePlanInput = {
  settings: BatchRenameSettings;
  items: readonly BatchRenameItem[];
  /** Keyed by folder path. A folder missing here is taken to hold only the items. */
  folders: ReadonlyMap<string, BatchRenameFolder>;
  /** Items that can't be renamed, and why. */
  cannotRename?: ReadonlyMap<string, string>;
  now: LocalDateTime;
};

/**
 * Every item's new name, with clashes settled as the setting says: a number added (" 2",
 * " 3"), the item left as it is, or the rename held until the name is changed. A name is
 * taken when another item in its folder has it, or will have it once the rename is done;
 * an item in the batch that changes its name gives its old one up, so names can be
 * swapped. Items keep their order: the first to ask for a name gets it.
 */
export function planBatchRename(input: BatchRenamePlanInput): BatchRenamePlan {
  const proposed = proposeNames(input.settings, input.items, input.now);
  const plan: BatchRenamePlanItem[] = input.items.map(() => ({ status: "unchanged" }));
  const byFolder = new Map<string, number[]>();
  input.items.forEach((item, index) => {
    const folderPath = parentPathOf(item.path);
    byFolder.set(folderPath, [...(byFolder.get(folderPath) ?? []), index]);
  });

  for (const [folderPath, indexes] of byFolder) {
    const folder = input.folders.get(folderPath);
    const caseSensitive = folder?.caseSensitive ?? false;
    const key = (name: string) => nameKey(name, caseSensitive);
    const batchOldKeys = new Set(indexes.map((index) => key(input.items[index]?.name ?? "")));
    // Items that stay as they are, whatever happens: their names stay taken.
    const leftAsIs = new Set<number>();
    for (const index of indexes) {
      const item = input.items[index];
      const name = proposed.names[index];
      if (!item || !name || name.kind === "unchanged") {
        leftAsIs.add(index);
        continue;
      }
      const invalid = name.emptyName
        ? "The name can’t be only an extension."
        : getItemNameError(name.name);
      const cannotRename = input.cannotRename?.get(item.path);
      if (invalid !== null) {
        plan[index] = {
          status: "problem",
          proposedName: name.name,
          segments: name.segments,
          problem: { kind: "invalid", message: invalid },
        };
        leftAsIs.add(index);
      } else if (cannotRename !== undefined) {
        plan[index] = {
          status: "problem",
          proposedName: name.name,
          segments: name.segments,
          problem: { kind: "cannotRename", message: cannotRename },
        };
        leftAsIs.add(index);
      }
    }
    // An item skipped for a clash keeps its old name, which may take a name another item was
    // given: the folder is settled again until no new item is skipped.
    for (let round = 0; round <= indexes.length; round += 1) {
      const taken = new Set<string>();
      for (const name of folder?.names ?? []) {
        taken.add(key(name));
      }
      for (const index of indexes) {
        if (!leftAsIs.has(index)) {
          taken.delete(key(input.items[index]?.name ?? ""));
        }
      }
      for (const index of leftAsIs) {
        taken.add(key(input.items[index]?.name ?? ""));
      }
      let newlySkipped = false;
      for (const index of indexes) {
        if (leftAsIs.has(index)) {
          continue;
        }
        const item = input.items[index];
        const name = proposed.names[index];
        if (!item || !name || name.kind !== "renamed") {
          continue;
        }
        let finalName = name.name;
        let segments = name.segments;
        let addedNumber: number | null = null;
        if (taken.has(key(finalName))) {
          const byItemInBatch = batchOldKeys.has(key(finalName));
          if (input.settings.onConflict === "number") {
            const numbered = findNumberedName(name, item, input.settings, (candidate) =>
              taken.has(key(candidate)),
            );
            finalName = numbered.name;
            segments = numbered.segments;
            addedNumber = numbered.number;
          } else if (input.settings.onConflict === "skip") {
            plan[index] = {
              status: "problem",
              proposedName: name.name,
              segments: name.segments,
              problem: { kind: "skippedTaken", byItemInBatch },
            };
            leftAsIs.add(index);
            newlySkipped = true;
            continue;
          } else {
            plan[index] = {
              status: "problem",
              proposedName: name.name,
              segments: name.segments,
              problem: { kind: "taken", byItemInBatch },
            };
            continue;
          }
        }
        taken.add(key(finalName));
        plan[index] = {
          status: "rename",
          name: finalName,
          segments,
          addedNumber,
          usedCreatedForTaken: name.usedCreatedForTaken === true,
          becomesHidden: finalName.startsWith(".") && !item.name.startsWith("."),
        };
      }
      if (!newlySkipped) {
        break;
      }
      // Settle the folder again from the start with the skipped items' names taken.
      for (const index of indexes) {
        const current = plan[index];
        if (!leftAsIs.has(index) && current?.status !== "unchanged") {
          plan[index] = { status: "unchanged" };
        }
      }
    }
  }

  let renameCount = 0;
  let unchangedCount = 0;
  let skippedCount = 0;
  let blockingCount = 0;
  for (const item of plan) {
    if (item.status === "rename") {
      renameCount += 1;
    } else if (item.status === "unchanged") {
      unchangedCount += 1;
    } else if (item.problem.kind === "skippedTaken" || item.problem.kind === "cannotRename") {
      skippedCount += 1;
    } else {
      blockingCount += 1;
    }
  }
  return {
    settingsError: proposed.settingsError,
    items: plan,
    renameCount,
    unchangedCount,
    skippedCount,
    blockingCount,
  };
}

// The name with the first free number added before its extension: "Lisbon 2.jpg". Format
// numbers with the separator it uses; other modes with a space, as macOS numbers copies.
function findNumberedName(
  name: Extract<ProposedName, { kind: "renamed" }>,
  item: BatchRenameItem,
  settings: BatchRenameSettings,
  isTaken: (candidate: string) => boolean,
): { name: string; segments: NameSegment[]; number: number } {
  const separator =
    settings.mode === "format" && settings.separator.length > 0 ? settings.separator : " ";
  const { stem, extension } = splitItemName(name.name, item.isFolder);
  const tail = extension === null ? "" : `.${extension}`;
  for (let number = 2; ; number += 1) {
    const candidate = `${stem}${separator}${number}${tail}`;
    if (!isTaken(candidate) || number > 100_000) {
      const stemLength = stem.length;
      const segments = splitSegmentsAt(name.segments, stemLength);
      return {
        name: candidate,
        number,
        segments: mergeSegments([
          ...segments.before,
          { text: `${separator}${number}`, changed: true },
          ...segments.after,
        ]),
      };
    }
  }
}

function splitSegmentsAt(
  segments: NameSegment[],
  offset: number,
): { before: NameSegment[]; after: NameSegment[] } {
  const before: NameSegment[] = [];
  const after: NameSegment[] = [];
  let position = 0;
  for (const segment of segments) {
    const end = position + segment.text.length;
    if (end <= offset) {
      before.push(segment);
    } else if (position >= offset) {
      after.push(segment);
    } else {
      before.push({ text: segment.text.slice(0, offset - position), changed: segment.changed });
      after.push({ text: segment.text.slice(offset - position), changed: segment.changed });
    }
    position = end;
  }
  return { before, after };
}

export function parentPathOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "/" : path.slice(0, slash);
}
