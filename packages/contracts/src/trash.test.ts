import { isInsideTrash, isTrashFolder } from "./trash";

describe("isInsideTrash", () => {
  it("knows the home folder's Trash and what is in it", () => {
    expect(isInsideTrash("/Users/demo/.Trash", "/Users/demo")).toBe(true);
    expect(isInsideTrash("/Users/demo/.Trash/old/a.txt", "/Users/demo")).toBe(true);
    expect(isInsideTrash("/Users/demo/.Trash", "/Users/demo/")).toBe(true);
  });

  it("knows another disk's Trash", () => {
    expect(isInsideTrash("/Volumes/USB/.Trashes", "/Users/demo")).toBe(true);
    expect(isInsideTrash("/Volumes/USB/.Trashes/501/a.txt", "/Users/demo")).toBe(true);
  });

  // The disk ignores case, so "/users/demo/.trash" is the Trash too.
  it("ignores letter case, as the disk does", () => {
    expect(isInsideTrash("/users/DEMO/.trash/a.txt", "/Users/demo")).toBe(true);
  });

  it("isn't fooled by names that only begin like the Trash", () => {
    expect(isInsideTrash("/Users/demo/.Trash2", "/Users/demo")).toBe(false);
    expect(isInsideTrash("/Users/demo/Documents/.Trash", "/Users/demo")).toBe(false);
    expect(isInsideTrash("/Volumes/USB/.TrashesBackup", "/Users/demo")).toBe(false);
    expect(isInsideTrash("/Volumes/USB/Stuff/.Trashes", "/Users/demo")).toBe(false);
    expect(isInsideTrash("/Users/demo/.Trash", "")).toBe(false);
  });
});

describe("isTrashFolder", () => {
  it("knows the home folder's Trash, and another disk's, and each user's Trash in that", () => {
    expect(isTrashFolder("/Users/demo/.Trash", "/Users/demo")).toBe(true);
    expect(isTrashFolder("/users/DEMO/.trash/", "/Users/demo/")).toBe(true);
    expect(isTrashFolder("/Volumes/USB/.Trashes", "/Users/demo")).toBe(true);
    expect(isTrashFolder("/Volumes/USB/.Trashes/501", "/Users/demo")).toBe(true);
    expect(isTrashFolder("/volumes/usb/.TRASHES/501/", "/Users/demo")).toBe(true);
  });

  it("leaves what is in a Trash to be deleted", () => {
    expect(isTrashFolder("/Users/demo/.Trash/a.txt", "/Users/demo")).toBe(false);
    expect(isTrashFolder("/Volumes/USB/.Trashes/501/a.txt", "/Users/demo")).toBe(false);
    expect(isTrashFolder("/Volumes/USB/.Trashes2", "/Users/demo")).toBe(false);
    expect(isTrashFolder("/Volumes/USB/Stuff/.Trashes", "/Users/demo")).toBe(false);
    expect(isTrashFolder("/Users/demo/.Trash", "")).toBe(false);
    expect(isTrashFolder("/", "/Users/demo")).toBe(false);
  });
});
