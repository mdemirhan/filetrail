import { getItemNameError } from "./itemName";

describe("getItemNameError", () => {
  it("accepts ordinary names, including ones with dots and colons", () => {
    expect(getItemNameError("report.pdf")).toBeNull();
    expect(getItemNameError(".env")).toBeNull();
    expect(getItemNameError("...")).toBeNull();
    expect(getItemNameError("a:b")).toBeNull();
  });

  it("rejects empty and dot-segment names", () => {
    expect(getItemNameError("   ")).toBe("Enter a name.");
    expect(getItemNameError(".")).toBe('"." is not a valid name.');
    expect(getItemNameError(" .. ")).toBe('".." is not a valid name.');
  });

  it("rejects names containing path separators or NUL", () => {
    expect(getItemNameError("../escape")).not.toBeNull();
    expect(getItemNameError("sub/child")).not.toBeNull();
    expect(getItemNameError("back\\slash")).not.toBeNull();
    expect(getItemNameError("nul\0byte")).not.toBeNull();
  });

  it("limits names to 255 bytes of UTF-8, not 255 characters", () => {
    expect(getItemNameError("a".repeat(255))).toBeNull();
    expect(getItemNameError("a".repeat(256))).toBe("The name is too long.");
    // 128 two-byte characters: 128 characters, 256 bytes.
    expect(getItemNameError("\u00e9".repeat(127))).toBeNull();
    expect(getItemNameError("\u00e9".repeat(128))).toBe("The name is too long.");
    // Three bytes each: 86 of them are 258 bytes.
    expect(getItemNameError("\u65e5".repeat(85))).toBeNull();
    expect(getItemNameError("\u65e5".repeat(86))).toBe("The name is too long.");
    // Surrounding spaces are trimmed before counting.
    expect(getItemNameError(` ${"a".repeat(255)} `)).toBeNull();
  });
});
