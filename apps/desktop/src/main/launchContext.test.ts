import { resolveStartupFolderPath } from "./launchContext";

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
