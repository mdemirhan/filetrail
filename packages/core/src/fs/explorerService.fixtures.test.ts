import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { createExplorerFixture } from "../testing/createExplorerFixture";
import {
  getDirectoryMetadataBatch,
  getItemProperties,
  getPathSuggestions,
  listDirectorySnapshot,
  listTreeChildren,
} from "./explorerService";

describe("explorerService integration fixtures", () => {
  it("lists real directories and directory symlinks in tree children on the real filesystem", async () => {
    const fixture = await createExplorerFixture({
      Documents: {
        type: "directory",
        children: {
          "notes.txt": { type: "file", text: "notes" },
        },
      },
      ".secret": {
        type: "directory",
        children: {},
      },
      "Documents Alias": {
        type: "symlink",
        target: "Documents",
      },
    });

    const tree = await listTreeChildren(fixture.rootPath, false);
    expect(tree.children.map((child) => [child.name, child.kind])).toEqual([
      ["Documents", "directory"],
      ["Documents Alias", "symlink_directory"],
    ]);
  });

  it("sorts by file size and returns metadata for directory entries", async () => {
    const fixture = await createExplorerFixture({
      alpha: { type: "file", text: "a" },
      beta: { type: "file", text: "bbbb" },
      Folder: { type: "directory", children: {} },
    });

    const snapshot = await listDirectorySnapshot(fixture.rootPath, false, "size", "desc");
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["Folder", "beta", "alpha"]);

    const resolvedRootPath = await realpath(fixture.rootPath);
    const metadata = await getDirectoryMetadataBatch(fixture.rootPath, [
      join(resolvedRootPath, "alpha"),
      join(resolvedRootPath, "Folder"),
    ]);
    expect(metadata.items).toEqual([
      expect.objectContaining({
        path: join(resolvedRootPath, "alpha"),
        sizeBytes: 1,
        sizeStatus: "ready",
        permissionMode: expect.any(Number),
      }),
      expect.objectContaining({
        path: join(resolvedRootPath, "Folder"),
        sizeBytes: null,
        sizeStatus: "deferred",
        permissionMode: expect.any(Number),
      }),
    ]);
  });

  it("reads deferred folder properties and ready file properties", async () => {
    const fixture = await createExplorerFixture({
      Folder: { type: "directory", children: {} },
      "notes.txt": { type: "file", text: "hello world" },
    });

    const folderProps = await getItemProperties(join(fixture.rootPath, "Folder"));
    const fileProps = await getItemProperties(join(fixture.rootPath, "notes.txt"));

    expect(folderProps.item.sizeStatus).toBe("deferred");
    expect(fileProps.item.sizeStatus).toBe("ready");
    expect(fileProps.item.sizeBytes).toBe(11);
  });

  it("returns immediate child directory suggestions for existing and partial paths on the real filesystem", async () => {
    const fixture = await createExplorerFixture({
      lotus123: {
        type: "directory",
        children: {
          screenshots: { type: "directory", children: {} },
          specs: { type: "directory", children: {} },
          "main.py": { type: "file", text: "print('hi')" },
        },
      },
      dux: { type: "directory", children: {} },
      tmp: { type: "directory", children: {} },
    });
    const resolvedRootPath = await realpath(fixture.rootPath);

    const trailingSlash = await getPathSuggestions(`${fixture.rootPath}/`, false, 12);
    expect(trailingSlash.suggestions.map((item) => item.path)).toEqual([
      join(resolvedRootPath, "dux"),
      join(resolvedRootPath, "lotus123"),
      join(resolvedRootPath, "tmp"),
    ]);

    const partialChild = await getPathSuggestions(`${fixture.rootPath}/lotu`, false, 12);
    expect(partialChild.suggestions.map((item) => item.path)).toEqual([
      join(resolvedRootPath, "lotus123"),
    ]);

    const nestedTrailingSlash = await getPathSuggestions(
      `${join(fixture.rootPath, "lotus123")}/`,
      false,
      12,
    );
    expect(nestedTrailingSlash.suggestions.map((item) => item.path)).toEqual([
      join(resolvedRootPath, "lotus123", "screenshots"),
      join(resolvedRootPath, "lotus123", "specs"),
    ]);
  });
});
