import { getItemNameError } from "@filetrail/contracts";
import {
  type BatchRenameFolder,
  type BatchRenameItem,
  type BatchRenamePlanInput,
  type BatchRenamePlanItem,
  type BatchRenameSettings,
  DEFAULT_BATCH_RENAME_SETTINGS,
  MAX_BATCH_RENAME_PRESETS,
  changeCase,
  describeDateFormat,
  expandReplacement,
  formatDate,
  formatNumber,
  nameKey,
  planBatchRename,
  proposeNames,
  sanitizeBatchRenamePresets,
  sanitizeBatchRenameSettings,
  splitItemName,
  toLocalDateTime,
} from "./batchRename";

const NOW = "2026-10-04T11:32:10";

function settings(overrides: Partial<BatchRenameSettings>): BatchRenameSettings {
  return { ...DEFAULT_BATCH_RENAME_SETTINGS, ...overrides };
}

function item(name: string, overrides: Partial<BatchRenameItem> = {}): BatchRenameItem {
  return {
    path: `/trip/${name}`,
    name,
    isFolder: false,
    createdAt: "2026-09-30T10:12:40",
    modifiedAt: "2026-10-01T08:30:15",
    takenAt: null,
    ...overrides,
  };
}

// The new names, or null for an item left as it is.
function names(options: Partial<BatchRenameSettings>, itemNames: string[]): Array<string | null> {
  return proposeNames(
    settings(options),
    itemNames.map((name) => item(name)),
    NOW,
  ).names.map((proposed) => (proposed.kind === "renamed" ? proposed.name : null));
}

describe("splitting a name", () => {
  it("takes what follows the last dot as the extension", () => {
    expect(splitItemName("photo.jpg", false)).toEqual({ stem: "photo", extension: "jpg" });
    expect(splitItemName("archive.tar.gz", false)).toEqual({
      stem: "archive.tar",
      extension: "gz",
    });
    expect(splitItemName("Tool.app", false)).toEqual({ stem: "Tool", extension: "app" });
  });

  it("finds no extension in a folder, a dotfile, a name ending in a dot or without one", () => {
    expect(splitItemName("photos.2026", true)).toEqual({ stem: "photos.2026", extension: null });
    expect(splitItemName(".env", false)).toEqual({ stem: ".env", extension: null });
    expect(splitItemName("draft.", false)).toEqual({ stem: "draft.", extension: null });
    expect(splitItemName("README", false)).toEqual({ stem: "README", extension: null });
    expect(splitItemName(".config.json", false)).toEqual({ stem: ".config", extension: "json" });
  });
});

describe("Replace Text", () => {
  it("finds accented letters however they are written, and leaves an unmatched name as it is", () => {
    const decomposed = "Café menu.pdf";
    expect(names({ find: "Café", replaceWith: "Bistro" }, [decomposed])).toEqual([
      "Bistro menu.pdf",
    ]);
    // Typed as "e" and an accent, it finds the name written with "é".
    expect(names({ find: "Café", replaceWith: "Bistro" }, ["Café.pdf"])).toEqual(["Bistro.pdf"]);
    // No match: the name keeps the way its accents are written.
    expect(names({ find: "tea", replaceWith: "x" }, [decomposed])).toEqual([null]);
    // A change that only writes the accent another way is no change.
    expect(names({ find: "é", replaceWith: "é" }, [decomposed])).toEqual([null]);
  });

  it("replaces every match in the name, ignoring case unless asked not to", () => {
    expect(names({ find: "img_", replaceWith: "Lisbon " }, ["IMG_2041.jpg"])).toEqual([
      "Lisbon 2041.jpg",
    ]);
    expect(names({ find: "img_", replaceWith: "x", matchCase: true }, ["IMG_2041.jpg"])).toEqual([
      null,
    ]);
    expect(names({ find: "a", replaceWith: "o" }, ["banana.txt"])).toEqual(["bonono.txt"]);
  });

  it("leaves an item without a match, and every item with nothing to find", () => {
    expect(names({ find: "copy", replaceWith: "" }, ["a copy.txt", "b.txt"])).toEqual([
      "a.txt",
      null,
    ]);
    expect(names({ find: "", replaceWith: "x" }, ["a.txt"])).toEqual([null]);
  });

  it("takes plain text as typed: dots, dollars and brackets are just characters", () => {
    expect(names({ find: ".", replaceWith: "$1" }, ["a.b.c.txt"])).toEqual(["a$1b$1c.txt"]);
    expect(names({ find: "(1)", replaceWith: "[one]" }, ["report (1).pdf"])).toEqual([
      "report [one].pdf",
    ]);
  });

  it("works in a name, an extension, or both, as Apply To says", () => {
    expect(names({ find: "jpg", replaceWith: "png" }, ["jpg photo.jpg"])).toEqual([
      "png photo.jpg",
    ]);
    expect(
      names({ find: "jpeg", replaceWith: "jpg", applyTo: "extension" }, ["jpeg.jpeg", "a.png"]),
    ).toEqual(["jpeg.jpg", null]);
    expect(names({ find: ".", replaceWith: "_", applyTo: "both" }, ["a.b.txt"])).toEqual([
      "a_b_txt",
    ]);
    // An extension replaced with nothing takes its dot with it.
    expect(
      names({ find: "bak", replaceWith: "", applyTo: "extension" }, ["notes.bak", "x.bak"]),
    ).toEqual(["notes", "x"]);
  });

  it("uses a regular expression's groups in the replacement", () => {
    const regex = { useRegex: true };
    expect(
      names({ ...regex, find: "^IMG_(\\d+)$", replaceWith: "Lisbon $1" }, ["IMG_2041.HEIC"]),
    ).toEqual(["Lisbon 2041.HEIC"]);
    expect(
      names({ ...regex, find: "(\\d{4})-(\\d{2})-(\\d{2})", replaceWith: "$3.$2.$1" }, [
        "2026-10-04 notes.txt",
      ]),
    ).toEqual(["04.10.2026 notes.txt"]);
    expect(
      names({ ...regex, find: "(?<word>\\w+)_(?<n>\\d+)", replaceWith: "$<n> $<word>" }, [
        "lisbon_12.jpg",
      ]),
    ).toEqual(["12 lisbon.jpg"]);
    expect(names({ ...regex, find: "\\d+", replaceWith: "[$&]" }, ["a1b22.txt"])).toEqual([
      "a[1]b[22].txt",
    ]);
    expect(names({ ...regex, find: "^", replaceWith: "2026 " }, ["notes.txt"])).toEqual([
      "2026 notes.txt",
    ]);
  });

  it("matches case only when asked, with a regular expression too", () => {
    expect(names({ useRegex: true, find: "^a", replaceWith: "x" }, ["Apple.txt"])).toEqual([
      "xpple.txt",
    ]);
    expect(
      names({ useRegex: true, find: "^a", replaceWith: "x", matchCase: true }, ["Apple.txt"]),
    ).toEqual([null]);
  });

  it("says when a pattern is broken, and changes nothing", () => {
    const result = proposeNames(
      settings({ useRegex: true, find: "(unclosed", replaceWith: "x" }),
      [item("a.txt")],
      NOW,
    );
    expect(result.settingsError).toMatch(/^The pattern isn’t valid: /u);
    expect(result.names).toEqual([{ kind: "unchanged" }]);
  });

  it("marks the replaced parts for the preview", () => {
    const result = proposeNames(
      settings({ find: "IMG_", replaceWith: "Lisbon " }),
      [item("IMG_2041.jpg")],
      NOW,
    );
    expect(result.names[0]).toEqual({
      kind: "renamed",
      name: "Lisbon 2041.jpg",
      segments: [
        { text: "Lisbon ", changed: true },
        { text: "2041.jpg", changed: false },
      ],
    });
  });
});

describe("the replacement of a regular expression", () => {
  const match = (pattern: RegExp, subject: string) => {
    const found = pattern.exec(subject);
    if (!found) {
      throw new Error("no match");
    }
    return found;
  };

  it("expands groups, the match, and what is around it", () => {
    const found = match(/(b)(c)/u, "abcd");
    expect(expandReplacement("$2$1", found, "abcd")).toBe("cb");
    expect(expandReplacement("[$&]", found, "abcd")).toBe("[bc]");
    expect(expandReplacement("$`|$'", found, "abcd")).toBe("a|d");
    expect(expandReplacement("$$1", found, "abcd")).toBe("$1");
  });

  it("keeps what names no group as typed", () => {
    const found = match(/(b)/u, "abc");
    expect(expandReplacement("$3", found, "abc")).toBe("$3");
    expect(expandReplacement("$<x>", found, "abc")).toBe("$<x>");
    expect(expandReplacement("cost $", found, "abc")).toBe("cost $");
    expect(expandReplacement("$x", found, "abc")).toBe("$x");
  });

  it("puts nothing for a group that matched nothing or a name that isn't a group", () => {
    const either = match(/(a)|(b)/u, "b");
    expect(expandReplacement("[$1][$2]", either, "b")).toBe("[][b]");
    const named = match(/(?<word>\w+)/u, "hi");
    expect(expandReplacement("$<other>|$<word>", named, "hi")).toBe("|hi");
    expect(expandReplacement("$<word", named, "hi")).toBe("$<word");
  });

  it("reads two digits only when there are that many groups", () => {
    const eleven = match(/(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)/u, "abcdefghijk");
    expect(expandReplacement("$11", eleven, "abcdefghijk")).toBe("k");
    const one = match(/(a)/u, "a");
    expect(expandReplacement("$10", one, "a")).toBe("a0");
  });
});

describe("Add Text", () => {
  it("adds before or after the name, or the extension", () => {
    expect(names({ mode: "add", addText: " (edited)" }, ["a.txt"])).toEqual(["a (edited).txt"]);
    expect(names({ mode: "add", addText: "old-", addWhere: "before" }, ["a.txt"])).toEqual([
      "old-a.txt",
    ]);
    expect(names({ mode: "add", addText: ".bak", applyTo: "both" }, ["a.txt"])).toEqual([
      "a.txt.bak",
    ]);
    expect(names({ mode: "add", addText: "x", applyTo: "extension" }, ["a.txt", "README"])).toEqual(
      ["a.txtx", null],
    );
  });

  it("drops spaces it would leave at either end, and changes nothing with no text", () => {
    expect(names({ mode: "add", addText: " draft", addWhere: "before" }, ["a.txt"])).toEqual([
      "drafta.txt",
    ]);
    expect(names({ mode: "add", addText: "   " }, ["a.txt"])).toEqual([null]);
    expect(names({ mode: "add", addText: "" }, ["a.txt"])).toEqual([null]);
  });

  it("treats a folder's whole name as its name", () => {
    const result = proposeNames(
      settings({ mode: "add", addText: " old" }),
      [item("photos.2026", { isFolder: true })],
      NOW,
    );
    expect(result.names[0]).toMatchObject({ name: "photos.2026 old" });
  });
});

describe("Change Case", () => {
  it("changes the case of the name, the extension, or both", () => {
    expect(names({ mode: "case", caseStyle: "lower" }, ["My Photo.JPG"])).toEqual(["my photo.JPG"]);
    expect(names({ mode: "case", caseStyle: "upper", applyTo: "both" }, ["a.txt"])).toEqual([
      "A.TXT",
    ]);
    expect(names({ mode: "case", caseStyle: "lower", applyTo: "extension" }, ["A.JPG"])).toEqual([
      "A.jpg",
    ]);
  });

  it("leaves names already in that case", () => {
    expect(names({ mode: "case", caseStyle: "lower" }, ["done.txt"])).toEqual([null]);
  });

  it("raises the first letter of each word for Title Case and leaves the rest", () => {
    expect(changeCase("readMe file", "title")).toBe("ReadMe File");
    expect(changeCase("my-project_notes (draft)", "title")).toBe("My-Project_Notes (Draft)");
    expect(changeCase("élan vital", "title")).toBe("Élan Vital");
    expect(changeCase("2026 trip", "title")).toBe("2026 Trip");
    // A word after a dot is a word: the extension, too, when Apply To takes it in.
    expect(names({ mode: "case", caseStyle: "title", applyTo: "both" }, ["my photo.jpg"])).toEqual([
      "My Photo.Jpg",
    ]);
    expect(names({ mode: "case", caseStyle: "title" }, ["archive.tar.gz"])).toEqual([
      "Archive.Tar.gz",
    ]);
  });
});

describe("Format", () => {
  const format = (overrides: Partial<BatchRenameSettings>) =>
    ({ mode: "format", ...overrides }) as const;

  it("numbers items as Finder does: File 1, File 2, keeping each extension", () => {
    expect(names(format({}), ["a.jpg", "b.png", "c"])).toEqual([
      "File 1.jpg",
      "File 2.png",
      "File 3",
    ]);
  });

  it("starts, steps, and puts the number before the name when asked", () => {
    expect(
      names(format({ startAt: 10, step: 5, formatWhere: "before", customName: "Trip" }), [
        "a.jpg",
        "b.jpg",
      ]),
    ).toEqual(["10 Trip.jpg", "15 Trip.jpg"]);
  });

  it("pads a counter to its digits, or to the last number's", () => {
    expect(names(format({ nameFormat: "counter" }), ["a", "b"])).toEqual([
      "File 00001",
      "File 00002",
    ]);
    expect(names(format({ nameFormat: "counter", digits: 2 }), ["a"])).toEqual(["File 01"]);
    const twelve = Array.from({ length: 12 }, (_, index) => `f${index}`);
    expect(names(format({ nameFormat: "counter", digits: "auto" }), twelve)[0]).toBe("File 01");
    expect(names(format({ nameFormat: "counter", digits: "auto" }), ["a", "b"])[1]).toBe("File 2");
  });

  it("joins with the separator chosen, or none", () => {
    expect(names(format({ separator: "_" }), ["a.jpg"])).toEqual(["File_1.jpg"]);
    expect(names(format({ separator: "" }), ["a.jpg"])).toEqual(["File1.jpg"]);
    expect(names(format({ separator: "-", formatWhere: "before" }), ["a.jpg"])).toEqual([
      "1-File.jpg",
    ]);
  });

  it("keeps each item's own name and adds the number to it", () => {
    expect(names(format({ keepNames: true }), ["IMG_2041.jpg", "notes.txt"])).toEqual([
      "IMG_2041 1.jpg",
      "notes 2.txt",
    ]);
  });

  it("puts in the date chosen, in the format chosen", () => {
    const photo = item("IMG_2041.HEIC", { takenAt: "2026-05-14T18:02:11" });
    const date = (overrides: Partial<BatchRenameSettings>) =>
      proposeNames(
        settings(format({ nameFormat: "date", customName: "Lisbon", ...overrides })),
        [photo],
        NOW,
      ).names[0];
    expect(date({})).toMatchObject({ name: "Lisbon 2026-09-30.HEIC" });
    expect(date({ dateSource: "modified" })).toMatchObject({ name: "Lisbon 2026-10-01.HEIC" });
    expect(date({ dateSource: "taken" })).toMatchObject({ name: "Lisbon 2026-05-14.HEIC" });
    expect(date({ dateSource: "today" })).toMatchObject({ name: "Lisbon 2026-10-04.HEIC" });
    expect(date({ dateSource: "taken", dateFormat: "ymd_hms", dateSeparator: "" })).toMatchObject({
      name: "Lisbon 20260514180211.HEIC",
    });
    expect(date({ dateSource: "taken", dateFormat: "dmyy", dateSeparator: "_" })).toMatchObject({
      name: "Lisbon 14_05_26.HEIC",
    });
  });

  it("uses the date created for an item with no date taken, and says so", () => {
    const result = proposeNames(
      settings(format({ nameFormat: "date", dateSource: "taken" })),
      [item("notes.txt")],
      NOW,
    );
    expect(result.names[0]).toMatchObject({
      name: "File 2026-09-30.txt",
      usedCreatedForTaken: true,
    });
  });

  it("follows a custom date pattern, keeping what isn't a token", () => {
    expect(
      names(
        format({
          nameFormat: "date",
          dateSource: "modified",
          dateFormat: "custom",
          customDatePattern: "YYYY-DD-MM at HH.mm.ss",
        }),
        ["a.jpg"],
      ),
    ).toEqual(["File 2026-01-10 at 08.30.15.jpg"]);
  });

  it("keeps text in square brackets as typed, even letters that are tokens", () => {
    const pattern = (customDatePattern: string) =>
      names(
        format({
          nameFormat: "date",
          dateSource: "modified",
          dateFormat: "custom",
          customDatePattern,
        }),
        ["a.jpg"],
      );
    expect(pattern("[Mission] YYYY")).toEqual(["File Mission 2026.jpg"]);
    expect(pattern("Mission YYYY")).toEqual(["File Mi15ion 2026.jpg"]);
    // An unclosed bracket is only a bracket.
    expect(pattern("[YYYY")).toEqual(["File [2026.jpg"]);
    // Bracketed tokens don't count as the token the pattern needs.
    expect(
      proposeNames(
        settings(format({ nameFormat: "date", dateFormat: "custom", customDatePattern: "[YYYY]" })),
        [item("a.jpg")],
        NOW,
      ).settingsError,
    ).toMatch(/at least one of YYYY/u);
  });

  it("asks for a token in a custom date pattern that has none", () => {
    const result = proposeNames(
      settings(format({ nameFormat: "date", dateFormat: "custom", customDatePattern: "today" })),
      [item("a.jpg")],
      NOW,
    );
    expect(result.settingsError).toMatch(/at least one of YYYY/u);
    // The same check twice: a pattern's own position must not carry over between checks.
    expect(
      proposeNames(
        settings(format({ nameFormat: "date", dateFormat: "custom", customDatePattern: "YYYY" })),
        [item("a.jpg")],
        NOW,
      ).settingsError,
    ).toBeNull();
    expect(
      proposeNames(
        settings(format({ nameFormat: "date", dateFormat: "custom", customDatePattern: "YYYY" })),
        [item("a.jpg")],
        NOW,
      ).settingsError,
    ).toBeNull();
  });

  it("leaves an item without the date asked for as it is", () => {
    const result = proposeNames(
      settings(format({ nameFormat: "date", dateSource: "modified" })),
      [item("a.jpg", { modifiedAt: null })],
      NOW,
    );
    expect(result.names).toEqual([{ kind: "unchanged" }]);
  });

  it("ignores Apply To: the extension is always kept", () => {
    expect(names(format({ applyTo: "both" }), ["a.jpg"])).toEqual(["File 1.jpg"]);
  });
});

describe("dates and numbers", () => {
  const dated = (overrides: Partial<BatchRenameSettings>) => settings(overrides);

  it("writes every offered format with every separator", () => {
    const date = "2026-05-04T08:09:07";
    expect(formatDate(date, dated({ dateFormat: "ymd" }))).toBe("2026-05-04");
    expect(formatDate(date, dated({ dateFormat: "ymd_hm", dateSeparator: "." }))).toBe(
      "2026.05.04.08.09",
    );
    expect(formatDate(date, dated({ dateFormat: "ymd_hms", dateSeparator: " " }))).toBe(
      "2026 05 04 08 09 07",
    );
    expect(formatDate(date, dated({ dateFormat: "dmy", dateSeparator: "_" }))).toBe("04_05_2026");
    expect(formatDate(date, dated({ dateFormat: "dmyy", dateSeparator: "" }))).toBe("040526");
    expect(formatDate(date, dated({ dateFormat: "mdy" }))).toBe("05-04-2026");
    expect(formatDate(date, dated({ dateFormat: "yymd" }))).toBe("26-05-04");
    expect(formatDate(date, dated({ dateFormat: "ym" }))).toBe("2026-05");
    expect(formatDate("2009-01-02T00:00:00", dated({ dateFormat: "dmyy" }))).toBe("02-01-09");
  });

  it("describes a format with its separator", () => {
    expect(describeDateFormat("ymd", "-")).toBe("YYYY-MM-DD");
    expect(describeDateFormat("dmyy", "")).toBe("DDMMYY");
    expect(describeDateFormat("ymd_hm", " ")).toBe("YYYY MM DD HH mm");
  });

  it("numbers by start and step", () => {
    expect(formatNumber(settings({ startAt: 0, step: 10 }), 3, 4)).toBe("30");
    expect(formatNumber(settings({ nameFormat: "counter", digits: 3 }), 0, 1)).toBe("001");
    expect(formatNumber(settings({ nameFormat: "counter", digits: 2 }), 199, 200)).toBe("200");
  });

  it("reads a date it can't make sense of as all zeros rather than failing", () => {
    expect(formatDate("not a date", dated({ dateFormat: "ymd" }))).toBe("0000-00-00");
  });

  it("reads a moment on this Mac's clock", () => {
    expect(toLocalDateTime(new Date(2026, 4, 14, 18, 2, 11))).toBe("2026-05-14T18:02:11");
  });
});

describe("saved settings and presets", () => {
  it("keeps what is valid and puts the default in place of anything else", () => {
    expect(sanitizeBatchRenameSettings(undefined)).toEqual(DEFAULT_BATCH_RENAME_SETTINGS);
    const read = sanitizeBatchRenameSettings({
      mode: "format",
      nameFormat: "date",
      dateSource: "taken",
      dateFormat: "dmyy",
      dateSeparator: "",
      separator: "_",
      digits: 3,
      startAt: 7.6,
      step: -2,
      find: 42,
      useRegex: "yes",
      onConflict: "skip",
      applyTo: "sideways",
    });
    expect(read).toMatchObject({
      mode: "format",
      nameFormat: "date",
      dateSource: "taken",
      dateFormat: "dmyy",
      dateSeparator: "",
      separator: "_",
      digits: 3,
      startAt: 8,
      step: 1,
      find: "",
      useRegex: false,
      onConflict: "skip",
      applyTo: "name",
    });
  });

  it("takes the default for numbers that aren't numbers, and keeps long text short", () => {
    const read = sanitizeBatchRenameSettings({
      startAt: Number.POSITIVE_INFINITY,
      step: "3",
      customName: "x".repeat(400),
      matchCase: "true",
      keepNames: 1,
      mode: null,
    });
    expect(read).toMatchObject({
      startAt: DEFAULT_BATCH_RENAME_SETTINGS.startAt,
      step: DEFAULT_BATCH_RENAME_SETTINGS.step,
      matchCase: false,
      keepNames: false,
      mode: "replace",
    });
    expect(read.customName).toHaveLength(255);
    expect(sanitizeBatchRenameSettings({ startAt: 2e12 }).startAt).toBe(999_999_999);
  });

  it("drops presets without a name or with one already used, and keeps at most the limit", () => {
    const presets = sanitizeBatchRenamePresets([
      { name: " Photos ", settings: { mode: "format" } },
      { name: "photos", settings: {} },
      { name: "", settings: {} },
      null,
      { settings: {} },
    ]);
    expect(presets).toEqual([
      { name: "Photos", settings: { ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "format" } },
    ]);
    expect(sanitizeBatchRenamePresets("x")).toEqual([]);
    const many = Array.from({ length: MAX_BATCH_RENAME_PRESETS + 5 }, (_, index) => ({
      name: `p${index}`,
      settings: {},
    }));
    expect(sanitizeBatchRenamePresets(many)).toHaveLength(MAX_BATCH_RENAME_PRESETS);
  });
});

// ── The plan ────────────────────────────────────────────────────────────────────────────

function plan(
  options: Partial<BatchRenameSettings>,
  itemNames: string[],
  folderNames: string[] = itemNames,
  extra: { caseSensitive?: boolean; cannotRename?: Map<string, string> } = {},
) {
  const folders = new Map<string, BatchRenameFolder>([
    ["/trip", { names: folderNames, caseSensitive: extra.caseSensitive ?? false }],
  ]);
  return planBatchRename({
    settings: settings(options),
    items: itemNames.map((name) => item(name)),
    folders,
    now: NOW,
    ...(extra.cannotRename ? { cannotRename: extra.cannotRename } : {}),
  });
}

function outcome(planItem: BatchRenamePlanItem | undefined): string {
  if (!planItem) {
    return "missing";
  }
  if (planItem.status === "unchanged") {
    return "unchanged";
  }
  if (planItem.status === "rename") {
    return planItem.name;
  }
  return `${planItem.problem.kind}:${planItem.proposedName}`;
}

describe("the plan", () => {
  it("renames what changes and counts what doesn't", () => {
    const result = plan({ find: "IMG_", replaceWith: "Lisbon " }, ["IMG_1.jpg", "notes.txt"]);
    expect(result.items.map(outcome)).toEqual(["Lisbon 1.jpg", "unchanged"]);
    expect(result).toMatchObject({
      renameCount: 1,
      unchangedCount: 1,
      skippedCount: 0,
      blockingCount: 0,
    });
  });

  it("numbers a name taken by something else in the folder, and the next free number", () => {
    const result = plan(
      { find: "IMG_", replaceWith: "Lisbon " },
      ["IMG_1.jpg"],
      ["IMG_1.jpg", "Lisbon 1.jpg", "Lisbon 1 2.jpg", ".hidden"],
    );
    expect(result.items.map(outcome)).toEqual(["Lisbon 1 3.jpg"]);
    expect(result.items[0]).toMatchObject({
      addedNumber: 3,
      segments: [
        { text: "Lisbon ", changed: true },
        { text: "1", changed: false },
        { text: " 3", changed: true },
        { text: ".jpg", changed: false },
      ],
    });
  });

  it("numbers repeats inside the batch in order, with Format's separator", () => {
    const result = plan(
      {
        mode: "format",
        nameFormat: "date",
        dateSource: "created",
        separator: "_",
        customName: "Trip",
      },
      ["a.jpg", "b.jpg", "c.png"],
    );
    expect(result.items.map(outcome)).toEqual([
      "Trip_2026-09-30.jpg",
      "Trip_2026-09-30_2.jpg",
      "Trip_2026-09-30.png",
    ]);
  });

  it("numbers thousands of items wanting one name without looking from 2 for each", () => {
    const itemNames = Array.from({ length: 20_000 }, (_, index) => `IMG_${index}.jpg`);
    // A taken number in the middle is still passed over.
    const started = performance.now();
    const result = plan({ useRegex: true, find: "IMG_\\d+", replaceWith: "Lisbon" }, itemNames, [
      ...itemNames,
      "Lisbon 500.jpg",
    ]);
    expect(performance.now() - started).toBeLessThan(2_000);
    const given = result.items.map(outcome);
    expect(given.slice(0, 3)).toEqual(["Lisbon.jpg", "Lisbon 2.jpg", "Lisbon 3.jpg"]);
    expect(given[498]).toBe("Lisbon 499.jpg");
    expect(given[499]).toBe("Lisbon 501.jpg");
    expect(new Set(given).size).toBe(20_000);
  });

  it("counts names as the disk does: case and accents, unless the disk tells case apart", () => {
    const upper = plan({ find: "x", replaceWith: "" }, ["Ax.txt"], ["Ax.txt", "a.TXT"]);
    expect(upper.items.map(outcome)).toEqual(["A 2.txt"]);
    const sensitive = plan({ find: "x", replaceWith: "" }, ["Ax.txt"], ["Ax.txt", "a.TXT"], {
      caseSensitive: true,
    });
    expect(sensitive.items.map(outcome)).toEqual(["A.txt"]);
    // "é" typed as one character, and as "e" with an accent after it.
    const accent = plan({ find: "x", replaceWith: "" }, ["cafxé.txt"], ["cafxé.txt", "café.txt"]);
    expect(accent.items.map(outcome)).toEqual(["café 2.txt"]);
    expect(nameKey("Café", false)).toBe(nameKey("café", false));
  });

  it("lets items swap names and change only the case of their own", () => {
    // On a disk that minds case, "A" is free for "a" while "A.TXT" stays as it is.
    const minded = plan(
      { mode: "case", caseStyle: "upper", applyTo: "both" },
      ["a", "A.TXT"],
      ["a", "A.TXT"],
      {
        caseSensitive: true,
      },
    );
    expect(minded.items.map(outcome)).toEqual(["A", "unchanged"]);
    const ownCase = plan({ mode: "case", caseStyle: "upper" }, ["photo.jpg"]);
    expect(ownCase.items.map(outcome)).toEqual(["PHOTO.jpg"]);
    // File 1 and File 2 numbered the other way round: each takes the other's name.
    const reorder = planBatchRename({
      settings: settings({ mode: "format" }),
      items: [item("File 2"), item("File 1")],
      folders: new Map([["/trip", { names: ["File 1", "File 2"], caseSensitive: false }]]),
      now: NOW,
    });
    expect(reorder.items.map(outcome)).toEqual(["File 1", "File 2"]);
  });

  it("leaves a clashing item as it is with Skip, and settles the rest around its name", () => {
    // "b" can't take "c" (taken outside the batch), so it stays "b"; "a" wanted "b" and
    // now finds it taken too.
    const result = plan(
      { mode: "replace", useRegex: true, find: "^(a|b)$", replaceWith: "$1x", onConflict: "skip" },
      ["a", "b"],
      ["a", "b", "ax", "bx"],
    );
    expect(result.items.map(outcome)).toEqual(["skippedTaken:ax", "skippedTaken:bx"]);
    const chain = planBatchRename({
      settings: settings({
        useRegex: true,
        find: "^(.)$",
        replaceWith: "$1$1",
        onConflict: "skip",
      }),
      items: [item("a"), item("b")],
      folders: new Map([["/trip", { names: ["a", "b", "bb"], caseSensitive: false }]]),
      now: NOW,
    });
    expect(chain.items.map(outcome)).toEqual(["aa", "skippedTaken:bb"]);
    expect(chain).toMatchObject({ renameCount: 1, skippedCount: 1, blockingCount: 0 });
    // "File 1" can't become "File 2" (another item outside the batch has it), so it stays
    // "File 1", and the first item, which was to become "File 1", is skipped too.
    const cascade = planBatchRename({
      settings: settings({ mode: "format", onConflict: "skip" }),
      items: [item("x.txt"), item("File 1.txt")],
      folders: new Map([
        ["/trip", { names: ["x.txt", "File 1.txt", "File 2.txt"], caseSensitive: false }],
      ]),
      now: NOW,
    });
    expect(cascade.items.map(outcome)).toEqual([
      "skippedTaken:File 1.txt",
      "skippedTaken:File 2.txt",
    ]);
    // "File 1.txt" keeps its name, so it is in the folder: no other item is getting it.
    expect(cascade.items[0]).toMatchObject({ problem: { byItemInBatch: false } });
    expect(cascade).toMatchObject({ renameCount: 0, skippedCount: 2 });
  });

  it("skips a whole batch whose names each wait on the next one's, at once", () => {
    // "File 1" … "File 10000" numbered from 2: the last can't take the unselected
    // "File 10001", so it keeps its name, which the one before it wanted, and so on back.
    const folderNames = Array.from({ length: 10_001 }, (_, index) => `File ${index + 1}.txt`);
    const started = performance.now();
    const result = plan(
      { mode: "format", startAt: 2, onConflict: "skip" },
      folderNames.slice(0, 10_000),
      folderNames,
    );
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({ renameCount: 0, skippedCount: 10_000 });
    expect(result.items[0]).toMatchObject({
      proposedName: "File 2.txt",
      problem: { kind: "skippedTaken", byItemInBatch: false },
    });
  });

  it("settles clashes as settling the folder again until nothing more is skipped would", () => {
    const rng = seededRandom(8_053);
    for (let round = 0; round < 3_000; round += 1) {
      const input = randomClashCase(rng);
      const label = JSON.stringify({
        settings: input.settings,
        items: input.items.map((each) => each.name),
        folders: [...input.folders.values()],
        cannotRename: [...(input.cannotRename?.keys() ?? [])],
      });
      expect(planBatchRename(input).items.map(outcomeWithClash), label).toEqual(
        settleByRescanning(input),
      );
    }
  });

  it("holds the rename with Don't Rename until the clash is fixed", () => {
    const result = plan(
      { find: "IMG_", replaceWith: "Lisbon ", onConflict: "block" },
      ["IMG_1.jpg", "IMG_2.jpg"],
      ["IMG_1.jpg", "IMG_2.jpg", "Lisbon 1.jpg"],
    );
    expect(result.items.map(outcome)).toEqual(["taken:Lisbon 1.jpg", "Lisbon 2.jpg"]);
    expect(result.items[0]).toMatchObject({ problem: { kind: "taken", byItemInBatch: false } });
    expect(result.blockingCount).toBe(1);
    const inBatch = plan({ mode: "format", nameFormat: "date", onConflict: "block" }, [
      "a.jpg",
      "b.jpg",
    ]);
    expect(inBatch.items.map(outcome)).toEqual([
      "File 2026-09-30.jpg",
      "taken:File 2026-09-30.jpg",
    ]);
    expect(inBatch.items[1]).toMatchObject({ problem: { kind: "taken", byItemInBatch: true } });
  });

  it("never renames to an invalid name, whatever the setting", () => {
    const slash = plan({ find: "-", replaceWith: "/" }, ["a-b.txt"]);
    expect(slash.items.map(outcome)).toEqual(["invalid:a/b.txt"]);
    expect(slash.blockingCount).toBe(1);
    const long = plan({ mode: "add", addText: "x".repeat(260) }, ["a.txt"]);
    expect(long.items[0]).toMatchObject({
      problem: { kind: "invalid", message: "The name is too long." },
    });
    const dots = plan({ find: "a", replaceWith: ".", applyTo: "both" }, ["a"]);
    expect(dots.items.map(outcome)).toEqual(["invalid:."]);
    // Nothing left before the extension: not a hidden ".txt".
    const onlyExtension = plan({ find: "notes", replaceWith: "" }, ["notes.txt"]);
    expect(onlyExtension.items[0]).toMatchObject({
      problem: { kind: "invalid", message: "The name can’t be only an extension." },
    });
  });

  it("skips an item that can't be renamed and keeps its name taken", () => {
    const result = plan(
      { mode: "format", nameFormat: "index", customName: "x", startAt: 1 },
      ["locked.txt", "b.txt"],
      ["locked.txt", "b.txt"],
      { cannotRename: new Map([["/trip/locked.txt", "The item is locked."]]) },
    );
    expect(result.items.map(outcome)).toEqual(["cannotRename:x 1.txt", "x 2.txt"]);
    expect(result).toMatchObject({ skippedCount: 1, blockingCount: 0, renameCount: 1 });
    // Another item asking for the locked item's name finds it taken.
    const wanted = plan(
      { find: "draft", replaceWith: "locked" },
      ["locked.txt", "draft.txt"],
      ["locked.txt", "draft.txt"],
      { cannotRename: new Map([["/trip/locked.txt", "The item is locked."]]) },
    );
    expect(wanted.items.map(outcome)).toEqual(["unchanged", "locked 2.txt"]);
  });

  it("shortens a name that a number makes too long, and holds one that can't be", () => {
    const long = `${"a".repeat(251)}.txt`;
    const shortened = plan({ find: "x", replaceWith: "a".repeat(251) }, ["x.txt"], ["x.txt", long]);
    expect(shortened.items.map(outcome)).toEqual([`${"a".repeat(249)} 2.txt`]);
    expect(shortened.items[0]).toMatchObject({
      segments: [
        { text: `${"a".repeat(249)} 2`, changed: true },
        { text: ".txt", changed: false },
      ],
    });
    // Only the extension is long: nothing before it can give way.
    const extension = "e".repeat(252);
    const held = plan(
      { find: "x", replaceWith: "y" },
      [`x.${extension}`],
      [`x.${extension}`, `y.${extension}`],
    );
    expect(held.items.map(outcome)).toEqual([`invalid:y 2.${extension}`]);
    expect(held.blockingCount).toBe(1);
  });

  it("warns when a new name starts with a dot", () => {
    const result = plan({ mode: "add", addText: ".", addWhere: "before" }, ["config"]);
    expect(result.items[0]).toMatchObject({
      status: "rename",
      name: ".config",
      becomesHidden: true,
    });
  });

  it("settles each folder on its own: search results may share names across folders", () => {
    const result = planBatchRename({
      settings: settings({ find: "draft ", replaceWith: "" }),
      items: [
        item("draft notes.txt", { path: "/a/draft notes.txt" }),
        item("draft notes.txt", { path: "/b/draft notes.txt" }),
      ],
      folders: new Map([
        ["/a", { names: ["draft notes.txt"], caseSensitive: false }],
        ["/b", { names: ["draft notes.txt", "notes.txt"], caseSensitive: false }],
      ]),
      now: NOW,
    });
    expect(result.items.map(outcome)).toEqual(["notes.txt", "notes 2.txt"]);
  });

  it("takes a folder it knows nothing of to hold only the items being renamed", () => {
    const result = planBatchRename({
      settings: settings({ mode: "format", nameFormat: "date", dateSource: "created" }),
      items: [
        item("a.jpg", { path: "/elsewhere/a.jpg" }),
        item("b.jpg", { path: "/elsewhere/b.jpg" }),
      ],
      folders: new Map(),
      now: NOW,
    });
    expect(result.items.map(outcome)).toEqual(["File 2026-09-30.jpg", "File 2026-09-30 2.jpg"]);
  });

  it("holds nothing back when the settings themselves are broken: nothing is renamed", () => {
    const result = plan({ useRegex: true, find: "[", replaceWith: "" }, ["a.txt"]);
    expect(result.settingsError).not.toBeNull();
    expect(result.renameCount).toBe(0);
  });
});

// ── Checking the plan against the simplest way to settle clashes ─────────────────────────

function outcomeWithClash(planItem: BatchRenamePlanItem | undefined): string {
  if (planItem?.status === "problem" && "byItemInBatch" in planItem.problem) {
    return `${outcome(planItem)}:${planItem.problem.byItemInBatch ? "batch" : "folder"}`;
  }
  return outcome(planItem);
}

// The plan with Skip or Don't Rename, worked out the slow way: each item skipped keeps its
// old name, so the folder is settled again from the start until no new item is skipped.
function settleByRescanning(input: BatchRenamePlanInput): string[] {
  const proposed = proposeNames(input.settings, input.items, input.now).names;
  const folder = input.folders.get("/trip");
  const key = (name: string) => nameKey(name, folder?.caseSensitive ?? false);
  const result = input.items.map(() => "unchanged");
  const leftAsIs = new Set<number>();
  proposed.forEach((name, index) => {
    if (name.kind === "unchanged") {
      leftAsIs.add(index);
      return;
    }
    const invalid = name.emptyName || getItemNameError(name.name) !== null;
    if (invalid || input.cannotRename?.has(input.items[index]?.path ?? "")) {
      result[index] = `${invalid ? "invalid" : "cannotRename"}:${name.name}`;
      leftAsIs.add(index);
    }
  });
  for (let newlySkipped = true; newlySkipped; ) {
    newlySkipped = false;
    const taken = new Set((folder?.names ?? []).map(key));
    const given = new Set<string>();
    input.items.forEach((each, index) => {
      if (leftAsIs.has(index)) {
        taken.add(key(each.name));
      } else {
        taken.delete(key(each.name));
      }
    });
    proposed.forEach((name, index) => {
      if (leftAsIs.has(index) || name.kind !== "renamed") {
        return;
      }
      if (!taken.has(key(name.name))) {
        taken.add(key(name.name));
        given.add(key(name.name));
        result[index] = name.name;
        return;
      }
      const skip = input.settings.onConflict === "skip";
      const by = given.has(key(name.name)) ? "batch" : "folder";
      result[index] = `${skip ? "skippedTaken" : "taken"}:${name.name}:${by}`;
      if (skip) {
        leftAsIs.add(index);
        newlySkipped = true;
      }
    });
  }
  return result;
}

// A few numbered files, some of them selected in any order, renamed so that their new names
// often are each other's old ones or the unselected files'.
function randomClashCase(rng: () => number): BatchRenamePlanInput {
  const integer = (least: number, most: number) => least + Math.floor(rng() * (most - least + 1));
  const folderNames: string[] = [];
  for (let number = 1; number <= 8; number += 1) {
    if (rng() < 0.7) {
      folderNames.push(`${rng() < 0.8 ? "File" : "file"} ${number}.txt`);
    }
  }
  const selected = folderNames
    .filter(() => rng() < 0.6)
    .map((name) => ({ name, order: rng() }))
    .sort((a, b) => a.order - b.order)
    .map(({ name }) => name);
  const kind = integer(0, 2);
  const options: Partial<BatchRenameSettings> =
    kind === 0
      ? { mode: "format", startAt: integer(1, 4), step: integer(1, 2) }
      : kind === 1
        ? { mode: "replace", find: String(integer(1, 8)), replaceWith: String(integer(1, 9)) }
        : { mode: "case", caseStyle: rng() < 0.5 ? "lower" : "title" };
  const locked = selected.find(() => rng() < 0.1);
  return {
    settings: settings({ ...options, onConflict: rng() < 0.8 ? "skip" : "block" }),
    items: selected.map((name) => item(name)),
    folders: new Map([["/trip", { names: folderNames, caseSensitive: rng() < 0.3 }]]),
    ...(locked ? { cannotRename: new Map([[`/trip/${locked}`, "The item is locked."]]) } : {}),
    now: NOW,
  };
}

// mulberry32: the same numbers for the same seed, so a failure can be run again.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
