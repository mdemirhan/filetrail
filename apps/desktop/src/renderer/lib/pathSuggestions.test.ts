import { getLocalPathSuggestions, mergePathSuggestions } from "./pathSuggestions";

describe("pathSuggestions", () => {
  const treeNodes = {
    "/Users/demo": {
      path: "/Users/demo",
      name: "demo",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: true,
      loading: false,
      loaded: true,
      error: null,
      childPaths: ["/Users/demo/Desktop", "/Users/demo/Documents", "/Users/demo/dotfiles"],
    },
    "/Users/demo/Desktop": {
      path: "/Users/demo/Desktop",
      name: "Desktop",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: false,
      loading: false,
      loaded: false,
      error: null,
      childPaths: [],
    },
    "/Users/demo/Documents": {
      path: "/Users/demo/Documents",
      name: "Documents",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: false,
      loading: false,
      loaded: false,
      error: null,
      childPaths: [],
    },
    "/Users/demo/dotfiles": {
      path: "/Users/demo/dotfiles",
      name: "dotfiles",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: false,
      loading: false,
      loaded: false,
      error: null,
      childPaths: [],
    },
  };

  it("returns all loaded child folders for a trailing-slash path", () => {
    expect(
      getLocalPathSuggestions({
        inputPath: "/Users/demo/",
        includeHidden: false,
        limit: 12,
        treeNodes,
      }),
    ).toEqual({
      inputPath: "/Users/demo/",
      basePath: "/Users/demo",
      suggestions: [
        { path: "/Users/demo/Desktop", name: "Desktop", isDirectory: true },
        { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
        { path: "/Users/demo/dotfiles", name: "dotfiles", isDirectory: true },
      ],
    });
  });

  it("filters by the typed basename when the directory itself is not loaded", () => {
    expect(
      getLocalPathSuggestions({
        inputPath: "/Users/demo/do",
        includeHidden: false,
        limit: 12,
        treeNodes,
      }),
    ).toEqual({
      inputPath: "/Users/demo/do",
      basePath: "/Users/demo",
      suggestions: [
        { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
        { path: "/Users/demo/dotfiles", name: "dotfiles", isDirectory: true },
      ],
    });
  });

  it("merges local and remote suggestions without duplicates", () => {
    expect(
      mergePathSuggestions({
        limit: 12,
        primary: {
          inputPath: "/Users/demo/",
          basePath: "/Users/demo",
          suggestions: [{ path: "/Users/demo/Desktop", name: "Desktop", isDirectory: true }],
        },
        secondary: {
          inputPath: "/Users/demo/",
          basePath: "/Users/demo",
          suggestions: [
            { path: "/Users/demo/Desktop", name: "Desktop", isDirectory: true },
            { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
          ],
        },
      }),
    ).toEqual({
      inputPath: "/Users/demo/",
      basePath: "/Users/demo",
      suggestions: [
        { path: "/Users/demo/Desktop", name: "Desktop", isDirectory: true },
        { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
      ],
    });
  });
});
