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
});
