import {
  formatDateTime,
  formatHintSize,
  formatPermissionMode,
  formatRelativeAge,
  formatRelativeDuration,
  formatShortDateTime,
  formatSize,
  formatSizeComparison,
  pathSegments,
  splitDisplayName,
  splitPermissionMode,
} from "./formatting";

describe("formatting helpers", () => {
  it("formats invalid dates defensively", () => {
    expect(formatDateTime("bad-date")).toBe("Not available");
  });

  it("formats bytes and deferred states", () => {
    expect(formatSize(2048, "ready")).toBe("2.0 KB");
    expect(formatSize(null, "deferred")).toBe("Not yet available");
  });

  it("formats Unix permission modes", () => {
    expect(formatPermissionMode(0o755)).toBe("rwxr-xr-x (755)");
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

  describe("formatRelativeAge", () => {
    it("returns null when both are null", () => {
      expect(formatRelativeAge(null, null)).toBeNull();
    });

    it("returns null when source is null", () => {
      expect(formatRelativeAge(null, 1000)).toBeNull();
    });

    it("returns null when destination is null", () => {
      expect(formatRelativeAge(1000, null)).toBeNull();
    });

    it("returns same age when delta is exactly 0", () => {
      expect(formatRelativeAge(5000, 5000)).toBe("same age");
    });

    it("returns 1 ms newer", () => {
      expect(formatRelativeAge(5001, 5000)).toBe("1 ms newer");
    });

    it("returns 500 ms older", () => {
      expect(formatRelativeAge(5000, 5500)).toBe("500 ms older");
    });

    it("returns 999 ms newer", () => {
      expect(formatRelativeAge(5999, 5000)).toBe("999 ms newer");
    });

    it("returns 1 second newer at exactly 1000 ms", () => {
      expect(formatRelativeAge(6000, 5000)).toBe("1 second newer");
    });

    it("returns 2 seconds newer", () => {
      expect(formatRelativeAge(7000, 5000)).toBe("2 seconds newer");
    });

    it("returns 30 seconds older", () => {
      expect(formatRelativeAge(5000, 35000)).toBe("30 seconds older");
    });

    it("returns 59 seconds newer", () => {
      expect(formatRelativeAge(64000, 5000)).toBe("59 seconds newer");
    });

    it("returns 1 min newer at exactly 60 seconds", () => {
      expect(formatRelativeAge(65000, 5000)).toBe("1 min newer");
    });

    it("floors 90 seconds to 1 min newer", () => {
      expect(formatRelativeAge(95000, 5000)).toBe("1 min newer");
    });

    it("returns 45 min newer", () => {
      const delta = 45 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("45 min newer");
    });

    it("returns 1 hour newer", () => {
      const delta = 60 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("1 hour newer");
    });

    it("returns 23 hours older", () => {
      const delta = 23 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000, 5000 + delta)).toBe("23 hours older");
    });

    it("returns 1 day newer", () => {
      const delta = 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("1 day newer");
    });

    it("returns 29 days newer", () => {
      const delta = 29 * 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("29 days newer");
    });

    it("returns 1 month newer at 30 days", () => {
      const delta = 30 * 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("1 month newer");
    });

    it("returns 6 months older", () => {
      const delta = 6 * 30 * 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000, 5000 + delta)).toBe("6 months older");
    });

    it("returns 1 year newer at 365 days", () => {
      const delta = 365 * 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("1 year newer");
    });

    it("returns 2 years older", () => {
      const delta = 730 * 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000, 5000 + delta)).toBe("2 years older");
    });

    it("returns 10 years newer for large delta", () => {
      const delta = 3650 * 24 * 60 * 60 * 1000;
      expect(formatRelativeAge(5000 + delta, 5000)).toBe("10 years newer");
    });
  });

  describe("formatRelativeDuration", () => {
    it("returns ms for sub-second", () => {
      expect(formatRelativeDuration(500)).toBe("500 ms");
    });

    it("returns seconds for 1-59 seconds", () => {
      expect(formatRelativeDuration(2000)).toBe("2 seconds");
      expect(formatRelativeDuration(1000)).toBe("1 second");
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

    it("returns 1.0 KB for 1024", () => {
      expect(formatHintSize(1024)).toBe("1.0 KB");
    });

    it("returns 1.0 MB for 1048576", () => {
      expect(formatHintSize(1048576)).toBe("1.0 MB");
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
      const result = formatSizeComparison(1023, 1024);
      expect(result).toEqual({ src: "1023 B", dest: "1.0 KB", delta: null });
    });

    it("returns delta null when bytes are equal", () => {
      const result = formatSizeComparison(1024, 1024);
      expect(result).toEqual({ src: "1.0 KB", dest: "1.0 KB", delta: null });
    });

    it("returns delta null when both are 0", () => {
      const result = formatSizeComparison(0, 0);
      expect(result).toEqual({ src: "0 B", dest: "0 B", delta: null });
    });

    it("returns delta when same formatted size but different bytes (src larger)", () => {
      // 1100000 and 1101000 both format to "1.0 MB"
      const result = formatSizeComparison(1101000, 1100000);
      expect(result).not.toBeNull();
      expect(result!.src).toBe("1.0 MB");
      expect(result!.dest).toBe("1.0 MB");
      expect(result!.delta).not.toBeNull();
      expect(result!.delta!.startsWith("+")).toBe(true);
    });

    it("returns delta when same formatted size but different bytes (dest larger)", () => {
      const result = formatSizeComparison(1100000, 1101000);
      expect(result).not.toBeNull();
      expect(result!.src).toBe("1.0 MB");
      expect(result!.dest).toBe("1.0 MB");
      expect(result!.delta).not.toBeNull();
      expect(result!.delta!.startsWith("-")).toBe(true);
    });

    it("computes correct delta for ambiguous 1.0 MB values", () => {
      // 1100000 and 1101000 both → "1.0 MB", diff = 1000 → 1000 B
      const result = formatSizeComparison(1101000, 1100000);
      expect(result!.delta).toBe("+1000 B");
    });
  });
});
