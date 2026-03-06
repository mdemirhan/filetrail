import {
  compactPath,
  formatDateTime,
  formatSize,
  pathSegments,
  splitDisplayName,
} from "./formatting";

describe("formatting helpers", () => {
  it("compacts long paths", () => {
    expect(
      compactPath(
        "/a/very/long/path/that/keeps/going/and/going/and/going/for/testing/with/even/more/depth.txt",
      ),
    ).toContain("...");
  });

  it("formats invalid dates defensively", () => {
    expect(formatDateTime("bad-date")).toBe("Not available");
  });

  it("formats bytes and deferred states", () => {
    expect(formatSize(2048, "ready")).toBe("2.0 KB");
    expect(formatSize(null, "deferred")).toBe("Not yet available");
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
});
