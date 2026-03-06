import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getDirectoryMetadataBatch,
  getItemProperties,
  getPathSuggestions,
  listDirectorySnapshot,
  listTreeChildren,
} from "./explorerService";

describe("explorerService", () => {
  it("sorts folders before files and hides dotfiles by default using a fake filesystem", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("zeta.txt", { file: true }),
        fakeDirent(".secrets", { directory: true }),
        fakeDirent("Alpha", { directory: true }),
        fakeDirent("beta", { file: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(
          path === "/workspace" || path.endsWith("Alpha"),
          path.endsWith("beta") || path.endsWith("zeta.txt"),
          12,
        ),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 12, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const snapshot = await listDirectorySnapshot(
      "/workspace",
      false,
      "name",
      "asc",
      fakeFileSystem,
    );
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["Alpha", "beta", "zeta.txt"]);

    const tree = await listTreeChildren("/workspace", false, fakeFileSystem);
    expect(tree.children.map((entry) => entry.name)).toEqual(["Alpha"]);
  });

  it("reads real file properties from the filesystem", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-core-"));
    const filePath = join(root, "notes.txt");
    await mkdir(root, { recursive: true });
    await writeFile(filePath, "hello world", "utf8");

    const response = await getItemProperties(filePath);
    expect(response.item.kind).toBe("file");
    expect(response.item.sizeBytes).toBe(11);
    expect(response.item.kindLabel).toBe("TXT File");
  });

  it("sorts files by modified time when requested", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("newer.txt", { file: true }),
        fakeDirent("older.txt", { file: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(
          path === "/workspace",
          path !== "/workspace",
          path.endsWith("newer.txt") ? 10 : 5,
          false,
          path.endsWith("newer.txt")
            ? new Date("2024-02-02T00:00:00.000Z")
            : new Date("2024-01-01T00:00:00.000Z"),
        ),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 12, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const snapshot = await listDirectorySnapshot(
      "/workspace",
      false,
      "modified",
      "desc",
      fakeFileSystem,
    );

    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["newer.txt", "older.txt"]);
  });

  it("sorts by kind label and keeps folders ahead of files", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("archive.zip", { file: true }),
        fakeDirent("Folder", { directory: true }),
        fakeDirent("script.ts", { file: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(
          path === "/workspace" || path.endsWith("Folder"),
          path !== "/workspace" && !path.endsWith("Folder"),
          12,
        ),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 12, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const snapshot = await listDirectorySnapshot(
      "/workspace",
      false,
      "kind",
      "asc",
      fakeFileSystem,
    );
    expect(snapshot.entries.map((entry) => entry.name)).toEqual([
      "Folder",
      "script.ts",
      "archive.zip",
    ]);
  });

  it("sorts by size descending for files", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("small.txt", { file: true }),
        fakeDirent("large.txt", { file: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(
          path === "/workspace",
          path !== "/workspace",
          path.endsWith("large.txt") ? 100 : 10,
        ),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 12, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const snapshot = await listDirectorySnapshot(
      "/workspace",
      false,
      "size",
      "desc",
      fakeFileSystem,
    );
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["large.txt", "small.txt"]);
  });

  it("returns alias kind metadata for symlinked directories", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [fakeDirent("Alias", { symbolicLink: true })]),
      stat: vi.fn(async () => fakeStats(true, false, 0)),
      lstat: vi.fn(async () => fakeStats(false, false, 0, true)),
      realpath: vi.fn(async (path: string) => path),
    };

    const tree = await listTreeChildren("/workspace", true, fakeFileSystem);
    expect(tree.children).toEqual([
      expect.objectContaining({
        name: "Alias",
        kind: "symlink_directory",
        isSymlink: true,
      }),
    ]);
  });

  it("rejects metadata requests for paths outside the requested directory", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(),
      stat: vi.fn(async () => fakeStats(true, false, 0)),
      lstat: vi.fn(async () => fakeStats(false, true, 12, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    await expect(
      getDirectoryMetadataBatch("/workspace", ["/other/file.txt"], fakeFileSystem),
    ).rejects.toThrow("outside /workspace");
  });

  it("returns directory path suggestions for the active parent folder", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("Documents", { directory: true }),
        fakeDirent("Downloads", { directory: true }),
        fakeDirent(".dotfiles", { directory: true }),
        fakeDirent("notes.txt", { file: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(path === "/Users/demo", path !== "/Users/demo", 0),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 0, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const response = await getPathSuggestions("/Users/demo/Do", false, 12, fakeFileSystem);

    expect(response.basePath).toBe("/Users/demo");
    expect(response.suggestions.map((item) => item.path)).toEqual([
      "/Users/demo/Documents",
      "/Users/demo/Downloads",
    ]);
  });

  it("filters hidden directory suggestions unless hidden items are enabled", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent(".config", { directory: true }),
        fakeDirent("Desktop", { directory: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(path === "/Users/demo", path !== "/Users/demo", 0),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 0, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const hiddenOff = await getPathSuggestions("/Users/demo/", false, 12, fakeFileSystem);
    const hiddenOn = await getPathSuggestions("/Users/demo/", true, 12, fakeFileSystem);

    expect(hiddenOff.suggestions.map((item) => item.name)).toEqual(["Desktop"]);
    expect(hiddenOn.suggestions.map((item) => item.name)).toEqual([".config", "Desktop"]);
  });
});

function fakeDirent(
  name: string,
  options: { directory?: boolean; file?: boolean; symbolicLink?: boolean },
) {
  return {
    name,
    isDirectory: () => options.directory === true,
    isFile: () => options.file === true,
    isSymbolicLink: () => options.symbolicLink === true,
  };
}

function fakeStats(
  directory: boolean,
  file: boolean,
  size: number,
  symbolicLink = false,
  mtime = new Date("2024-01-02T00:00:00.000Z"),
) {
  return {
    isDirectory: () => directory,
    isFile: () => file,
    isSymbolicLink: () => symbolicLink,
    birthtime: new Date("2024-01-01T00:00:00.000Z"),
    mtime,
    size,
  };
}
