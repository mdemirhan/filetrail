import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getDirectoryMetadataBatch,
  getItemProperties,
  getPathSuggestions,
  listDirectorySnapshot,
  listTreeChildren,
  resolvePathTarget,
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
      true,
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
    expect(response.item.permissionMode).not.toBeNull();
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
      true,
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
      true,
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
      true,
      fakeFileSystem,
    );
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["large.txt", "small.txt"]);
  });

  it("combines folders and files when folders-first sorting is disabled", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("zeta", { directory: true }),
        fakeDirent("alpha.txt", { file: true }),
      ]),
      stat: vi.fn(async (path: string) =>
        fakeStats(path === "/workspace" || path.endsWith("zeta"), path.endsWith("alpha.txt"), 12),
      ),
      lstat: vi.fn(async () => fakeStats(false, true, 12, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const snapshot = await listDirectorySnapshot(
      "/workspace",
      false,
      "name",
      "asc",
      false,
      fakeFileSystem,
    );

    expect(snapshot.entries.map((entry) => entry.name)).toEqual(["alpha.txt", "zeta"]);
  });

  it("includes symlinked directories in tree children and marks them as aliases", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [fakeDirent("Alias", { symbolicLink: true })]),
      stat: vi.fn(async () => fakeStats(true, false, 0)),
      lstat: vi.fn(async () => fakeStats(false, false, 0, true)),
      realpath: vi.fn(async (path: string) => path),
    };

    const tree = await listTreeChildren("/workspace", true, fakeFileSystem);
    expect(tree.children).toEqual([
      {
        path: "/workspace/Alias",
        name: "Alias",
        kind: "symlink_directory",
        isHidden: false,
        isSymlink: true,
      },
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

  it("returns all immediate child directories for an existing trailing-slash path", async () => {
    const fakeFileSystem = createSuggestionFileSystem({
      "/Users/demo": ["Applications", "Desktop", "Pictures"],
    });

    const response = await getPathSuggestions("/Users/demo/", false, 12, fakeFileSystem);

    expect(response.basePath).toBe("/Users/demo");
    expect(response.suggestions.map((item) => item.path)).toEqual([
      "/Users/demo/Applications",
      "/Users/demo/Desktop",
      "/Users/demo/Pictures",
    ]);
  });

  it("returns an exact directory suggestion when the full directory path exists without a trailing slash", async () => {
    const fakeFileSystem = createSuggestionFileSystem({
      "/Users/demo": ["Desktop", "Pictures"],
      "/Users/demo/Pictures": ["Photos Library.photoslibrary", "Screenshots"],
    });

    const response = await getPathSuggestions(
      "/Users/demo/Pictures/Photos Library.photoslibrary",
      false,
      12,
      fakeFileSystem,
    );

    expect(response.basePath).toBe("/Users/demo/Pictures");
    expect(response.suggestions.map((item) => item.path)).toEqual([
      "/Users/demo/Pictures/Photos Library.photoslibrary",
    ]);
  });

  it("filters against immediate children of the nearest existing parent when the final segment is partial", async () => {
    const fakeFileSystem = createSuggestionFileSystem({
      "/Users/demo/src/pythonproj": ["cch", "dux", "lotus123", "OutlookMcp_AppleScript"],
    });

    const response = await getPathSuggestions(
      "/Users/demo/src/pythonproj/lotu",
      false,
      12,
      fakeFileSystem,
    );

    expect(response.basePath).toBe("/Users/demo/src/pythonproj");
    expect(response.suggestions.map((item) => item.path)).toEqual([
      "/Users/demo/src/pythonproj/lotus123",
    ]);
  });

  it("falls back to the nearest existing parent instead of a broader loaded ancestor", async () => {
    const fakeFileSystem = createSuggestionFileSystem({
      "/Users/demo": ["Applications", "Desktop", "src"],
      "/Users/demo/src": ["dotnet", "pythonproj", "tsproj"],
    });

    const response = await getPathSuggestions("/Users/demo/src/", false, 12, fakeFileSystem);

    expect(response.basePath).toBe("/Users/demo/src");
    expect(response.suggestions.map((item) => item.path)).toEqual([
      "/Users/demo/src/dotnet",
      "/Users/demo/src/pythonproj",
      "/Users/demo/src/tsproj",
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

  it("uses the nearest existing parent for path suggestions", async () => {
    const fakeFileSystem = createSuggestionFileSystem({
      "/Users/demo": ["Documents", "dotfiles"],
      "/Users/demo/dotfiles": ["scripts", "shell"],
    });

    const parentMatches = await getPathSuggestions(
      "/Users/demo/dotfiles",
      false,
      12,
      fakeFileSystem,
    );
    expect(parentMatches.basePath).toBe("/Users/demo");
    expect(parentMatches.suggestions.map((item) => item.path)).toEqual(["/Users/demo/dotfiles"]);

    const childMatches = await getPathSuggestions(
      "/Users/demo/dotfiles/",
      false,
      12,
      fakeFileSystem,
    );
    expect(childMatches.basePath).toBe("/Users/demo/dotfiles");
    expect(childMatches.suggestions.map((item) => item.path)).toEqual([
      "/Users/demo/dotfiles/scripts",
      "/Users/demo/dotfiles/shell",
    ]);
  });

  it("resolves symlink targets for activation", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(),
      stat: vi.fn(),
      lstat: vi.fn(),
      realpath: vi.fn(async () => "/resolved/path"),
    };

    await expect(resolvePathTarget("/input/path", fakeFileSystem)).resolves.toEqual({
      inputPath: "/input/path",
      resolvedPath: "/resolved/path",
    });
  });

  it("falls back to the resolved input path when path activation cannot resolve aliases", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(),
      stat: vi.fn(),
      lstat: vi.fn(),
      realpath: vi.fn(async () => {
        throw new Error("missing target");
      }),
    };

    await expect(resolvePathTarget("/input/path", fakeFileSystem)).resolves.toEqual({
      inputPath: "/input/path",
      resolvedPath: null,
    });
  });

  it("falls back to the original directory path when realpath normalization fails", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [fakeDirent("Desktop", { directory: true })]),
      stat: vi.fn(async (path: string) =>
        fakeStats(path === "/Users/demo" || path.endsWith("Desktop"), false, 0),
      ),
      lstat: vi.fn(async () => fakeStats(false, false, 0, false)),
      realpath: vi.fn(async () => {
        throw new Error("realpath unavailable");
      }),
    };

    const snapshot = await listDirectorySnapshot(
      "/Users/demo",
      false,
      "name",
      "asc",
      true,
      fakeFileSystem,
    );

    expect(snapshot.path).toBe("/Users/demo");
    expect(snapshot.parentPath).toBe("/Users");
    expect(snapshot.entries.map((entry) => entry.path)).toEqual(["/Users/demo/Desktop"]);
  });

  it("reports symlink directory properties and drops invalid dates to null", async () => {
    const invalidDate = new Date("invalid");
    const fakeFileSystem = {
      readdir: vi.fn(),
      stat: vi.fn(async () => ({
        ...fakeStats(true, false, 0),
        birthtime: invalidDate,
        mtime: invalidDate,
      })),
      lstat: vi.fn(async () => fakeStats(false, false, 0, true)),
      realpath: vi.fn(async (path: string) => path),
    };

    const response = await getItemProperties("/Users/demo/Alias", fakeFileSystem);

    expect(response.item).toEqual({
      path: "/Users/demo/Alias",
      name: "Alias",
      extension: "",
      kind: "symlink_directory",
      kindLabel: "Alias Folder",
      isHidden: false,
      isSymlink: true,
      createdAt: null,
      modifiedAt: null,
      sizeBytes: null,
      sizeStatus: "deferred",
      permissionMode: 0o755,
    });
  });

  it("skips broken and non-directory suggestion entries while applying the result limit", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(async () => [
        fakeDirent("Desktop", { directory: true }),
        fakeDirent("Documents", { directory: true }),
        fakeDirent("notes.txt", { file: true }),
        fakeDirent("Downloads Alias", { symbolicLink: true }),
      ]),
      stat: vi.fn(async (path: string) => {
        if (path === "/Users/demo") {
          return fakeStats(true, false, 0);
        }
        if (path.endsWith("Desktop") || path.endsWith("Documents")) {
          return fakeStats(true, false, 0);
        }
        if (path.endsWith("notes.txt")) {
          return fakeStats(false, true, 0);
        }
        throw new Error("broken alias");
      }),
      lstat: vi.fn(async () => fakeStats(false, false, 0, false)),
      realpath: vi.fn(async (path: string) => path),
    };

    const response = await getPathSuggestions("/Users/demo/D", false, 1, fakeFileSystem);

    expect(response.basePath).toBe("/Users/demo");
    expect(response.suggestions.map((item) => item.path)).toEqual(["/Users/demo/Desktop"]);
  });

  it("preserves request order for metadata batches even when lstat is unavailable", async () => {
    const fakeFileSystem = {
      readdir: vi.fn(),
      stat: vi.fn(async (path: string) => {
        if (path === "/workspace") {
          return fakeStats(true, false, 0);
        }
        return fakeStats(false, true, path.endsWith("beta.txt") ? 4 : 2);
      }),
      lstat: vi.fn(async () => {
        throw new Error("lstat unavailable");
      }),
      realpath: vi.fn(async (path: string) => path),
    };

    const response = await getDirectoryMetadataBatch(
      "/workspace",
      ["/workspace/beta.txt", "/workspace/alpha.txt"],
      fakeFileSystem,
    );

    expect(response.items).toEqual([
      expect.objectContaining({
        path: "/workspace/beta.txt",
        kindLabel: "TXT File",
        sizeBytes: 4,
        sizeStatus: "ready",
      }),
      expect.objectContaining({
        path: "/workspace/alpha.txt",
        kindLabel: "TXT File",
        sizeBytes: 2,
        sizeStatus: "ready",
      }),
    ]);
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
    mode: directory ? 0o755 : 0o644,
  };
}

function createSuggestionFileSystem(tree: Record<string, string[]>) {
  const directories = new Set<string>(["/"]);
  for (const [directoryPath, childNames] of Object.entries(tree)) {
    directories.add(directoryPath);
    for (const childName of childNames) {
      directories.add(join(directoryPath, childName));
    }
  }

  return {
    readdir: vi.fn(async (path: string) =>
      (tree[path] ?? []).map((name) => fakeDirent(name, { directory: true })),
    ),
    stat: vi.fn(async (path: string) => fakeStats(directories.has(path), false, 0)),
    lstat: vi.fn(async () => fakeStats(false, false, 0, false)),
    realpath: vi.fn(async (path: string) => path),
  };
}
