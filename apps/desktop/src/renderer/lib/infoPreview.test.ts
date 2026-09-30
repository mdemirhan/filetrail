import { fallbackKindLabel, resolveInfoItem } from "./infoPreview";

const entry = {
  path: "/Users/demo/notes.txt",
  name: "notes.txt",
  extension: "txt",
  kind: "file" as const,
  isHidden: false,
  isSymlink: false,
};
const metadata = {
  path: entry.path,
  kindLabel: "Plain Text Document",
  modifiedAt: "2026-03-02T10:30:00.000Z",
  sizeBytes: 12,
  sizeStatus: "ready" as const,
  permissionMode: 0o644,
};
const properties = {
  ...entry,
  kindLabel: "Plain Text Document",
  createdAt: "2026-03-01T09:00:00.000Z",
  modifiedAt: "2026-03-02T10:30:00.000Z",
  sizeBytes: 12,
  sizeStatus: "ready" as const,
  permissionMode: 0o644,
};

describe("resolveInfoItem", () => {
  it("uses the item's properties once they match the target", () => {
    expect(
      resolveInfoItem({
        path: entry.path,
        currentPath: "/Users/demo",
        entries: [entry],
        metadataByPath: {},
        properties,
      }),
    ).toEqual({ item: properties, pending: false });
  });

  it("previews a listed item from the listing while its properties load", () => {
    const resolved = resolveInfoItem({
      path: entry.path,
      currentPath: "/Users/demo",
      entries: [entry],
      metadataByPath: { [entry.path]: metadata },
      // Still the previously shown item.
      properties: { ...properties, path: "/Users/demo/other.txt" },
    });
    expect(resolved?.pending).toBe(true);
    expect(resolved?.item).toMatchObject({
      name: "notes.txt",
      kindLabel: "Plain Text Document",
      sizeBytes: 12,
      permissionMode: 0o644,
      createdAt: null,
    });
  });

  it("previews the folder on screen when nothing is selected", () => {
    const resolved = resolveInfoItem({
      path: "/Users/demo/Projects",
      currentPath: "/Users/demo/Projects",
      entries: [],
      metadataByPath: {},
      properties: null,
    });
    expect(resolved?.item).toMatchObject({
      name: "Projects",
      kind: "directory",
      kindLabel: "Folder",
    });
  });

  it("has nothing to show for an unknown path", () => {
    expect(
      resolveInfoItem({
        path: "/elsewhere/file",
        currentPath: "/Users/demo",
        entries: [],
        metadataByPath: {},
        properties: null,
      }),
    ).toBeNull();
  });

  it("labels kinds before the system's description is known", () => {
    expect(fallbackKindLabel({ kind: "bundle", extension: "app" })).toBe("Application");
    expect(fallbackKindLabel({ kind: "file", extension: "md" })).toBe("MD File");
    expect(fallbackKindLabel({ kind: "symlink_directory", extension: "" })).toBe("Alias Folder");
  });
});
