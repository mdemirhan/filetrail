import { describeOpenedPath, resolveStartupFolderPath } from "./launchContext";

describe("launchContext", () => {
  it("reads an explicit --folder path", () => {
    expect(
      resolveStartupFolderPath(["filetrail", "--folder", "/Users/demo/project"], "/tmp", {
        fileSystem: {
          statSync: () => ({ isDirectory: () => true }),
        },
      }),
    ).toBe("/Users/demo/project");
  });

  it("reads an inline --folder= path", () => {
    expect(
      resolveStartupFolderPath(["filetrail", "--folder=projects/filetrail"], "/Users/demo", {
        fileSystem: {
          statSync: () => ({ isDirectory: () => true }),
        },
      }),
    ).toBe("/Users/demo/projects/filetrail");
  });

  it("uses a positional folder argument when --folder is not provided", () => {
    expect(
      resolveStartupFolderPath(["filetrail", "/Users/demo/src"], "/tmp", {
        fileSystem: {
          statSync: () => ({ isDirectory: () => true }),
        },
      }),
    ).toBe("/Users/demo/src");
  });

  it("ignores the Electron app-path positional argument in dev launches", () => {
    expect(
      resolveStartupFolderPath(
        ["electron", ".", "/Users/demo/src"],
        "/Users/demo/filetrail/apps/desktop",
        {
          appPath: "/Users/demo/filetrail/apps/desktop",
          fileSystem: {
            statSync: () => ({ isDirectory: () => true }),
          },
        },
      ),
    ).toBe("/Users/demo/src");
  });

  it("does not treat the Electron app path itself as a startup folder", () => {
    expect(
      resolveStartupFolderPath(["electron", "."], "/Users/demo/filetrail/apps/desktop", {
        appPath: "/Users/demo/filetrail/apps/desktop",
        fileSystem: {
          statSync: () => ({ isDirectory: () => true }),
        },
      }),
    ).toBeNull();
  });

  it("expands tilde-prefixed folder arguments", () => {
    expect(
      resolveStartupFolderPath(["filetrail", "~/src"], "/tmp", {
        homePath: "/Users/demo",
        fileSystem: {
          statSync: () => ({ isDirectory: () => true }),
        },
      }),
    ).toBe("/Users/demo/src");
  });

  it("prefers --folder over a positional folder argument", () => {
    expect(
      resolveStartupFolderPath(
        ["filetrail", "/Users/demo/ignored", "--folder", "/Users/demo/project"],
        "/tmp",
        {
          fileSystem: {
            statSync: (path) => ({ isDirectory: () => path === "/Users/demo/project" }),
          },
        },
      ),
    ).toBe("/Users/demo/project");
  });

  it("ignores electron app-path arguments when argvOffset is provided", () => {
    expect(
      resolveStartupFolderPath(
        ["electron", "/Users/demo/filetrail", "/Users/demo/project"],
        "/tmp",
        {
          argvOffset: 2,
          fileSystem: {
            statSync: () => ({ isDirectory: () => true }),
          },
        },
      ),
    ).toBe("/Users/demo/project");
  });

  it("ignores non-directory targets", () => {
    expect(
      resolveStartupFolderPath(["filetrail", "--folder", "/Users/demo/file.txt"], "/tmp", {
        fileSystem: {
          statSync: () => ({ isDirectory: () => false }),
        },
      }),
    ).toBeNull();
  });

  it("ignores missing folder targets", () => {
    expect(
      resolveStartupFolderPath(["filetrail", "--folder", "/Users/demo/missing"], "/tmp", {
        fileSystem: {
          statSync: () => {
            throw new Error("ENOENT");
          },
        },
      }),
    ).toBeNull();
  });
});

describe("describeOpenedPath", () => {
  const folders = new Set(["/Users/demo/src", "/Users/demo/Backup.sparsebundle"]);
  const fileSystem = {
    statSync: (path: string) => {
      if (path === "/Users/demo/gone.txt") {
        throw new Error("ENOENT");
      }
      return { isDirectory: () => folders.has(path) };
    },
  };

  it("shows a folder, and shows any other item in its folder", () => {
    expect(describeOpenedPath("/Users/demo/src", fileSystem)).toEqual({
      path: "/Users/demo/src",
      kind: "folder",
    });
    expect(describeOpenedPath("/Users/demo/notes.txt", fileSystem)).toEqual({
      path: "/Users/demo/notes.txt",
      kind: "reveal",
    });
  });

  it("opens a disk image, a sparse bundle (a folder) too", () => {
    expect(describeOpenedPath("/Users/demo/Install.dmg", fileSystem)?.kind).toBe("diskImage");
    expect(describeOpenedPath("/Users/demo/Backup.sparsebundle", fileSystem)?.kind).toBe(
      "diskImage",
    );
  });

  it("leaves out an item that isn't there", () => {
    expect(describeOpenedPath("/Users/demo/gone.txt", fileSystem)).toBeNull();
  });
});
