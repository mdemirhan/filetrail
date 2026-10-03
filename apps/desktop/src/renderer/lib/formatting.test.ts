import {
  formatDateTime,
  formatExactDateTime,
  formatFolderSizeDetail,
  formatHintSize,
  formatPermissionMode,
  formatRelativeDateTime,
  formatRelativeDuration,
  formatShortDateTime,
  formatSize,
  formatSizeComparison,
  pathSegments,
  splitDisplayName,
  splitPermissionMode,
} from "./formatting";

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error("Expected value to be defined.");
  }
  return value;
}

describe("formatting helpers", () => {
  it("formats invalid dates defensively", () => {
    expect(formatDateTime("bad-date")).toBe("Not available");
  });

  describe("formatRelativeDateTime", () => {
    // A Thursday afternoon. Built from local dates, so the cases hold in any time zone.
    const NOW = new Date(2026, 9, 1, 14, 45).getTime();
    const at = (...parts: [number, number, number, number, number]) =>
      formatRelativeDateTime(new Date(...parts).getTime(), NOW);

    it("counts in minutes within the hour", () => {
      expect(formatRelativeDateTime(NOW - 20_000, NOW)).toBe("Just now");
      expect(formatRelativeDateTime(NOW - 60_000, NOW)).toBe("1 min ago");
      expect(at(2026, 9, 1, 14, 21)).toBe("24 min ago");
      expect(formatRelativeDateTime(NOW - 59 * 60_000 - 59_000, NOW)).toBe("59 min ago");
      expect(formatRelativeDateTime(NOW - 60 * 60_000, NOW)).toBe("Today, 1:45 PM");
    });

    it("keeps counting minutes across midnight", () => {
      const justAfterMidnight = new Date(2026, 9, 2, 0, 10).getTime();
      expect(
        formatRelativeDateTime(new Date(2026, 9, 1, 23, 50).getTime(), justAfterMidnight),
      ).toBe("20 min ago");
    });

    it("names today, yesterday and the weekdays before them", () => {
      expect(at(2026, 9, 1, 9, 12)).toBe("Today, 9:12 AM");
      expect(at(2026, 9, 1, 0, 0)).toBe("Today, 12:00 AM");
      expect(at(2026, 8, 30, 18, 3)).toBe("Yesterday, 6:03 PM");
      expect(at(2026, 8, 28, 16, 5)).toBe("Mon, 4:05 PM");
      // Six days back is the last with a weekday; a week back would name today's own.
      expect(at(2026, 8, 25, 0, 0)).toBe("Fri, 12:00 AM");
      expect(at(2026, 8, 24, 23, 59)).toBe("Sep 24, 11:59 PM");
    });

    it("drops the year for this year and the time for older ones", () => {
      expect(at(2026, 5, 12, 8, 30)).toBe("Jun 12, 8:30 AM");
      expect(at(2025, 11, 31, 22, 0)).toBe("Dec 31, 2025");
      expect(at(2024, 2, 3, 11, 15)).toBe("Mar 3, 2024");
    });

    it("counts days on the calendar across daylight saving changes", () => {
      const afterFallBack = new Date(2026, 10, 2, 10, 0).getTime();
      expect(formatRelativeDateTime(new Date(2026, 10, 1, 0, 30).getTime(), afterFallBack)).toBe(
        "Yesterday, 12:30 AM",
      );
      expect(formatRelativeDateTime(new Date(2026, 9, 31, 23, 30).getTime(), afterFallBack)).toBe(
        "Sat, 11:30 PM",
      );
    });

    it("shows a date in the future in full, allowing for a clock a little ahead", () => {
      expect(formatRelativeDateTime(NOW + 30_000, NOW)).toBe("Just now");
      expect(formatRelativeDateTime(NOW + 2 * 3_600_000, NOW)).toBe("Oct 1, 2026, 4:45 PM");
    });

    it("gives the whole date for the tooltip", () => {
      expect(formatExactDateTime(new Date(2026, 9, 1, 14, 44, 7).getTime())).toBe(
        "Thursday, October 1, 2026 at 2:44:07 PM",
      );
    });
  });

  it("formats bytes and deferred states", () => {
    expect(formatSize(2048, "ready")).toBe("2.0 KB");
    expect(formatSize(null, "deferred")).toBe("Not yet available");
  });

  it("counts sizes in steps of 1,000, as Finder does", () => {
    expect(formatSize(999, "ready")).toBe("999 B");
    expect(formatSize(1000, "ready")).toBe("1.0 KB");
    expect(formatSize(1_500_000, "ready")).toBe("1.5 MB");
    // The folders Finder showed as 99.43 GB and 226.59 GB.
    expect(formatSize(99_433_647_655, "ready")).toBe("99 GB");
    expect(formatSize(226_587_120_929, "ready")).toBe("227 GB");
    expect(formatSize(2_000_000_000_000, "ready")).toBe("2.0 TB");
  });

  it("steps up a unit instead of showing 1000 of one", () => {
    expect(formatSize(999_700, "ready")).toBe("1.0 MB");
    expect(formatSize(9_960, "ready")).toBe("10 KB");
  });

  it("formats Unix permission modes", () => {
    expect(formatPermissionMode(0o755)).toBe("755");
    expect(formatPermissionMode(0o7)).toBe("007");
    expect(formatPermissionMode(null)).toBe("Unavailable");
  });

  it("splits Unix permission modes into symbolic and octal parts", () => {
    expect(splitPermissionMode(0o644)).toEqual({
      symbolic: "rw-r--r--",
      octal: "644",
    });
    expect(splitPermissionMode(null)).toBeNull();
  });

  it("splits path segments including root", () => {
    expect(pathSegments("/Users/demo/Documents")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "demo", path: "/Users/demo" },
      { label: "Documents", path: "/Users/demo/Documents" },
    ]);
  });

  it("preserves the extension separately for display truncation", () => {
    expect(splitDisplayName("long filename.txt", "txt")).toEqual({
      stem: "long filename",
      extensionSuffix: ".txt",
    });
  });

  describe("formatRelativeDuration", () => {
    it("returns ms for sub-second", () => {
      expect(formatRelativeDuration(500)).toBe("500 ms");
      // File timestamps carry sub-millisecond precision.
      expect(formatRelativeDuration(9.737548828125)).toBe("10 ms");
    });

    it("returns seconds for 1-59 seconds", () => {
      expect(formatRelativeDuration(2000)).toBe("2 seconds");
      expect(formatRelativeDuration(1000)).toBe("1 second");
      // Sub-millisecond precision must not round up to "1000 ms".
      expect(formatRelativeDuration(999.6)).toBe("1 second");
      expect(formatRelativeDuration(999.4)).toBe("999 ms");
    });

    it("returns minutes for 1-59 min", () => {
      expect(formatRelativeDuration(90000)).toBe("1 min");
      expect(formatRelativeDuration(45 * 60 * 1000)).toBe("45 min");
    });

    it("returns hours for 1-23 hours", () => {
      expect(formatRelativeDuration(3600000)).toBe("1 hour");
      expect(formatRelativeDuration(5 * 3600000)).toBe("5 hours");
    });

    it("returns days for 1-29 days", () => {
      expect(formatRelativeDuration(86400000)).toBe("1 day");
      expect(formatRelativeDuration(7 * 86400000)).toBe("7 days");
    });

    it("returns months for 30+ days", () => {
      expect(formatRelativeDuration(30 * 86400000)).toBe("1 month");
    });

    it("returns years for 365+ days", () => {
      expect(formatRelativeDuration(365 * 86400000)).toBe("1 year");
      expect(formatRelativeDuration(730 * 86400000)).toBe("2 years");
    });

    it("handles negative values", () => {
      expect(formatRelativeDuration(-5000)).toBe("5 seconds");
    });
  });

  describe("formatShortDateTime", () => {
    it("formats a timestamp to a short readable date", () => {
      // Just check it returns a non-empty string — exact format is locale-dependent
      const result = formatShortDateTime(1709913600000);
      expect(result.length).toBeGreaterThan(0);
      expect(typeof result).toBe("string");
    });
  });

  describe("formatHintSize", () => {
    it("returns null for null", () => {
      expect(formatHintSize(null)).toBeNull();
    });

    it("returns 0 B for zero", () => {
      expect(formatHintSize(0)).toBe("0 B");
    });

    it("returns 512 B", () => {
      expect(formatHintSize(512)).toBe("512 B");
    });

    it("returns 1.0 KB for 1000", () => {
      expect(formatHintSize(1000)).toBe("1.0 KB");
    });

    it("returns 1.0 MB for 1000000", () => {
      expect(formatHintSize(1_000_000)).toBe("1.0 MB");
    });
  });

  describe("formatSizeComparison", () => {
    it("returns null when src is null", () => {
      expect(formatSizeComparison(null, 1024)).toBeNull();
    });

    it("returns null when dest is null", () => {
      expect(formatSizeComparison(1024, null)).toBeNull();
    });

    it("returns null when both are null", () => {
      expect(formatSizeComparison(null, null)).toBeNull();
    });

    it("returns delta null when formatted sizes differ", () => {
      const result = formatSizeComparison(999, 1000);
      expect(result).toEqual({ src: "999 B", dest: "1.0 KB", delta: null });
    });

    it("returns delta null when bytes are equal", () => {
      const result = formatSizeComparison(1000, 1000);
      expect(result).toEqual({ src: "1.0 KB", dest: "1.0 KB", delta: null });
    });

    it("returns delta null when both are 0", () => {
      const result = formatSizeComparison(0, 0);
      expect(result).toEqual({ src: "0 B", dest: "0 B", delta: null });
    });

    it("returns delta when same formatted size but different bytes (src larger)", () => {
      // 1010000 and 1011000 both format to "1.0 MB"
      const result = formatSizeComparison(1011000, 1010000);
      const value = expectDefined(result);
      expect(value.src).toBe("1.0 MB");
      expect(value.dest).toBe("1.0 MB");
      expect(value.delta).not.toBeNull();
      expect(expectDefined(value.delta).startsWith("+")).toBe(true);
    });

    it("returns delta when same formatted size but different bytes (dest larger)", () => {
      const result = formatSizeComparison(1010000, 1011000);
      const value = expectDefined(result);
      expect(value.src).toBe("1.0 MB");
      expect(value.dest).toBe("1.0 MB");
      expect(value.delta).not.toBeNull();
      expect(expectDefined(value.delta).startsWith("-")).toBe(true);
    });

    it("computes correct delta for ambiguous 1.0 MB values", () => {
      // 1010000 and 1011000 both → "1.0 MB", diff = 1000 → 1.0 KB
      const result = formatSizeComparison(1011000, 1010000);
      expect(expectDefined(result).delta).toBe("+1.0 KB");
    });
  });

  describe("formatFolderSizeDetail", () => {
    it("returns disk info when logical and disk sizes differ", () => {
      const result = formatFolderSizeDetail(1_000_000, 1_500_000, 500, 20);
      expect(result.size).toBe("1.0 MB");
      expect(result.disk).toBe("1.5 MB on disk");
    });

    it("returns null disk when logical and disk sizes format the same", () => {
      const result = formatFolderSizeDetail(1_000_000, 1_000_000, 100, 0);
      expect(result.size).toBe("1.0 MB");
      expect(result.disk).toBeNull();
    });

    it("names files, then folders, with thousands separators", () => {
      const result = formatFolderSizeDetail(1, 1, 48611, 2765);
      expect(result.items).toBe(
        `${(48611).toLocaleString()} files, ${(2765).toLocaleString()} folders`,
      );
    });

    it("leaves out a kind the folder doesn't hold", () => {
      expect(formatFolderSizeDetail(1, 1, 153, 0).items).toBe("153 files");
      expect(formatFolderSizeDetail(0, 0, 0, 4).items).toBe("4 folders");
    });

    it("says one file and one folder in the singular", () => {
      expect(formatFolderSizeDetail(1, 1, 1, 1).items).toBe("1 file, 1 folder");
    });

    it("says Empty for a folder with nothing in it", () => {
      const result = formatFolderSizeDetail(0, 0, 0, 0);
      expect(result.size).toBe("0 B");
      expect(result.disk).toBeNull();
      expect(result.items).toBe("Empty");
    });
  });
});
