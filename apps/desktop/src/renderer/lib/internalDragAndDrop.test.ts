import {
  buildInternalDragSession,
  isRealDirectoryEntry,
  validateInternalDrop,
} from "./internalDragAndDrop";

describe("internalDragAndDrop", () => {
  it("builds a drag session from the current selection when the dragged row is selected", () => {
    const session = buildInternalDragSession({
      sourceSurface: "content",
      draggedPath: "/Users/demo/source.txt",
      selectedPathsInViewOrder: ["/Users/demo/source.txt", "/Users/demo/Folder"],
      entriesByPath: new Map([
        [
          "/Users/demo/source.txt",
          {
            path: "/Users/demo/source.txt",
            name: "source.txt",
            extension: "txt",
            kind: "file",
            isHidden: false,
            isSymlink: false,
          },
        ],
        [
          "/Users/demo/Folder",
          {
            path: "/Users/demo/Folder",
            name: "Folder",
            extension: "",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
          },
        ],
      ]),
    });

    expect(session).toEqual({
      sourceSurface: "content",
      sourceItems: [
        { path: "/Users/demo/source.txt", kind: "file" },
        { path: "/Users/demo/Folder", kind: "directory" },
      ],
      leadPath: "/Users/demo/source.txt",
      leadKind: "file",
    });
  });

  it("recognizes real directory entries only", () => {
    expect(isRealDirectoryEntry({ kind: "directory", isSymlink: false })).toBe(true);
    expect(isRealDirectoryEntry({ kind: "symlink_directory", isSymlink: true })).toBe(false);
    expect(isRealDirectoryEntry({ kind: "file", isSymlink: false })).toBe(false);
  });

  it("rejects dropping search results onto content rows", () => {
    expect(
      validateInternalDrop({
        session: {
          sourceSurface: "search",
          sourceItems: [{ path: "/Users/demo/source.txt", kind: "file" }],
          leadPath: "/Users/demo/source.txt",
          leadKind: "file",
        },
        blocked: false,
        targetSurface: "content",
        targetPath: "/Users/demo/Folder",
        targetSupportsMove: true,
      }),
    ).toEqual({ ok: false, code: "unsupported_target" });
  });

  it("rejects drops onto the selected target row", () => {
    expect(
      validateInternalDrop({
        session: {
          sourceSurface: "content",
          sourceItems: [{ path: "/Users/demo/source.txt", kind: "file" }],
          leadPath: "/Users/demo/source.txt",
          leadKind: "file",
        },
        blocked: false,
        targetSurface: "content",
        targetPath: "/Users/demo/Folder",
        targetSupportsMove: true,
        targetIsSelected: true,
      }),
    ).toEqual({ ok: false, code: "target_selected" });
  });

  it("rejects drops onto the same path", () => {
    expect(
      validateInternalDrop({
        session: {
          sourceSurface: "content",
          sourceItems: [{ path: "/Users/demo/Folder", kind: "directory" }],
          leadPath: "/Users/demo/Folder",
          leadKind: "directory",
        },
        blocked: false,
        targetSurface: "tree",
        targetPath: "/Users/demo/Folder",
        targetSupportsMove: true,
      }),
    ).toEqual({ ok: false, code: "same_path" });
  });

  it("rejects no-op drops into the same parent directory", () => {
    expect(
      validateInternalDrop({
        session: {
          sourceSurface: "content",
          sourceItems: [{ path: "/Users/demo/source.txt", kind: "file" }],
          leadPath: "/Users/demo/source.txt",
          leadKind: "file",
        },
        blocked: false,
        targetSurface: "tree",
        targetPath: "/Users/demo",
        targetSupportsMove: true,
      }),
    ).toEqual({ ok: false, code: "already_in_target" });
  });

  it("rejects dropping a folder into its own descendant", () => {
    expect(
      validateInternalDrop({
        session: {
          sourceSurface: "content",
          sourceItems: [{ path: "/Users/demo/Folder", kind: "directory" }],
          leadPath: "/Users/demo/Folder",
          leadKind: "directory",
        },
        blocked: false,
        targetSurface: "tree",
        targetPath: "/Users/demo/Folder/Subfolder",
        targetSupportsMove: true,
      }),
    ).toEqual({ ok: false, code: "parent_into_child" });
  });

  it("rejects blocked drags before checking the target", () => {
    expect(
      validateInternalDrop({
        session: {
          sourceSurface: "content",
          sourceItems: [{ path: "/Users/demo/source.txt", kind: "file" }],
          leadPath: "/Users/demo/source.txt",
          leadKind: "file",
        },
        blocked: true,
        targetSurface: "tree",
        targetPath: "/Users/demo/Folder",
        targetSupportsMove: true,
      }),
    ).toEqual({ ok: false, code: "blocked" });
  });
});
