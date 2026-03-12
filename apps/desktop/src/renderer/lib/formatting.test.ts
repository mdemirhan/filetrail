import {
  formatDateTime,
  formatHintSize,
  formatPermissionMode,
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
