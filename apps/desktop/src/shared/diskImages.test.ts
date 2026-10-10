import { describeDiskImageFailure, isDiskImagePath } from "./diskImages";

describe("describeDiskImageFailure", () => {
  it("names the image and gives hdiutil's reason as a sentence", () => {
    expect(describeDiskImageFailure("/Users/demo/Broken.dmg", "no mountable file systems")).toEqual(
      {
        title: "The disk image “Broken.dmg” couldn’t be opened.",
        message: "No mountable file systems.",
      },
    );
  });

  it("says an unexpected error occurred without a reason", () => {
    expect(describeDiskImageFailure("/Users/demo/Broken.dmg", null).message).toBe(
      "An unexpected error occurred.",
    );
  });
});

describe("isDiskImagePath", () => {
  it("knows disk images by the extensions DiskImageMounter opens, in any case", () => {
    expect(isDiskImagePath("/Users/demo/Install.dmg")).toBe(true);
    expect(isDiskImagePath("/Users/demo/Backup.SPARSEBUNDLE")).toBe(true);
    expect(isDiskImagePath("/Users/demo/ubuntu.iso")).toBe(true);
    expect(isDiskImagePath("/Users/demo/notes.txt")).toBe(false);
    expect(isDiskImagePath("/Users/demo/.dmg")).toBe(false);
    expect(isDiskImagePath("/Users/demo/dmg")).toBe(false);
  });
});
