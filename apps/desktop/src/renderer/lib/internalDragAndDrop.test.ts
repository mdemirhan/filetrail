import {
  buildInternalDragSession,
  isRealDirectoryEntry,
  resolveInternalDropOperation,
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
  describe("what a drop does, as Finder decides it", () => {
    const resolve = (
      sourcePaths: string[],
      targetPath: string,
      modifiers: { altKey?: boolean; metaKey?: boolean } = {},
    ) =>
      resolveInternalDropOperation({
        sourcePaths,
        targetPath,
        altKey: modifiers.altKey ?? false,
        metaKey: modifiers.metaKey ?? false,
      });

    it("moves to a folder on the same volume and copies to another volume", () => {
      expect(resolve(["/Users/demo/a.txt"], "/Users/demo/Folder")).toBe("move");
      expect(resolve(["/Volumes/Backup/a.txt"], "/Volumes/Backup/Old")).toBe("move");
      expect(resolve(["/Users/demo/a.txt"], "/Volumes/Backup")).toBe("copy");
      expect(resolve(["/Volumes/Backup/a.txt"], "/Users/demo")).toBe("copy");
      expect(resolve(["/Volumes/Backup/a.txt"], "/Volumes/Other")).toBe("copy");
    });

    it("copies with Option and moves with Command, whatever the volumes", () => {
      expect(resolve(["/Users/demo/a.txt"], "/Users/demo/Folder", { altKey: true })).toBe("copy");
      expect(resolve(["/Users/demo/a.txt"], "/Volumes/Backup", { altKey: true })).toBe("copy");
      expect(resolve(["/Users/demo/a.txt"], "/Volumes/Backup", { metaKey: true })).toBe("move");
      expect(resolve(["/Users/demo/a.txt"], "/Users/demo/Folder", { metaKey: true })).toBe("move");
      // Option-Command makes an alias in Finder; here it copies.
      expect(
        resolve(["/Users/demo/a.txt"], "/Users/demo/Folder", { altKey: true, metaKey: true }),
      ).toBe("copy");
    });

    it("copies items from several volumes unless all are on the target's", () => {
      expect(resolve(["/Users/demo/a.txt", "/Volumes/Backup/b.txt"], "/Users/demo/Folder")).toBe(
        "copy",
      );
      expect(resolve(["/Users/demo/a.txt", "/Users/other/b.txt"], "/Users/demo/Folder")).toBe(
        "move",
      );
    });
  });

  it("lets a copy go into the folder the items are in, to duplicate them", () => {
    const session = {
      sourceSurface: "content" as const,
      sourceItems: [{ path: "/Users/demo/source.txt", kind: "file" as const }],
      leadPath: "/Users/demo/source.txt",
      leadKind: "file" as const,
    };
    const drop = (operation: "move" | "copy") =>
      validateInternalDrop({
        session,
        blocked: false,
        targetSurface: "tree",
        targetPath: "/Users/demo",
        targetSupportsMove: true,
        operation,
      });

    expect(drop("move")).toEqual({ ok: false, code: "already_in_target" });
    expect(drop("copy")).toEqual({ ok: true });
  });

  it("still refuses to copy a folder onto itself or into its own descendant", () => {
    const session = {
      sourceSurface: "content" as const,
      sourceItems: [{ path: "/Users/demo/Folder", kind: "directory" as const }],
      leadPath: "/Users/demo/Folder",
      leadKind: "directory" as const,
    };
    const drop = (targetPath: string) =>
      validateInternalDrop({
        session,
        blocked: false,
        targetSurface: "tree",
        targetPath,
        targetSupportsMove: true,
        operation: "copy",
      });

    expect(drop("/Users/demo/Folder")).toEqual({ ok: false, code: "same_path" });
    expect(drop("/Users/demo/Folder/Inner")).toEqual({ ok: false, code: "parent_into_child" });
  });
});
