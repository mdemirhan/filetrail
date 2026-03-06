import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { createExplorerFixture } from "../testing/createExplorerFixture";
import {
  getDirectoryMetadataBatch,
  getItemProperties,
  listDirectorySnapshot,
  listTreeChildren,
} from "./explorerService";

describe("explorerService integration fixtures", () => {
  it("lists visible children and recognizes symlink folders on the real filesystem", async () => {
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
      }),
      expect.objectContaining({
        path: join(resolvedRootPath, "Folder"),
        sizeBytes: null,
        sizeStatus: "deferred",
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
});
