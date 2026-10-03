import { describeCopyPasteError } from "./copyPasteErrors";

describe("describeCopyPasteError", () => {
  it("gives a reason without the path for a known error code", () => {
    const error = Object.assign(new Error("ENOSPC: no space left on device, write '/x/y'"), {
      code: "ENOSPC",
    });
    expect(describeCopyPasteError(error)).toBe(
      "There isn't enough free space on the destination disk.",
    );
  });

  // Node's fs.rm says "Path is a directory: rm returned EISDIR (is a directory) /var/…".
  it("reads Node's own code for a folder removed as a file", () => {
    const error = Object.assign(new Error("Path is a directory: rm returned EISDIR /var/x"), {
      code: "ERR_FS_EISDIR",
    });
    expect(describeCopyPasteError(error)).toBe("A folder is in the way where a file was expected.");
  });

  it("falls back to the error's own message", () => {
    expect(describeCopyPasteError(new Error("Something else"))).toBe("Something else");
    expect(describeCopyPasteError("plain")).toBe("plain");
  });
});
