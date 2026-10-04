import type { IpcResponse } from "@filetrail/contracts";

import {
  appendSearchResults,
  buildSearchHighlightPattern,
  formatSearchResultFolder,
  sortSearchResults,
} from "./searchResults";

type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];

function createSearchResult(path: string): SearchResultItem {
  const name = path.split("/").at(-1) ?? path;
  const parentPath = path.slice(0, Math.max(0, path.lastIndexOf("/"))) || "/";

  return {
    path,
    name,
    extension: name.includes(".") ? (name.split(".").at(-1) ?? "") : "",
    kind: "file",
    isHidden: name.startsWith("."),
    isSymlink: false,
    parentPath,
    relativeParentPath: parentPath,
  };
}

describe("search result ordering", () => {
  it("appends incremental batches without reordering the existing list", () => {
    const current = [
      createSearchResult("/Users/demo/project/z-dir/alpha.ts"),
      createSearchResult("/Users/demo/project/a-dir/zeta.ts"),
    ];
    const next = [
      createSearchResult("/Users/demo/project/b-dir/beta.ts"),
      createSearchResult("/Users/demo/project/a-dir/gamma.ts"),
    ];

    expect(appendSearchResults(current, next).map((item) => item.path)).toEqual([
      "/Users/demo/project/z-dir/alpha.ts",
      "/Users/demo/project/a-dir/zeta.ts",
      "/Users/demo/project/b-dir/beta.ts",
      "/Users/demo/project/a-dir/gamma.ts",
    ]);
  });

  it("sorts by path when requested", () => {
    const items = [
      createSearchResult("/Users/demo/project/z-dir/alpha.ts"),
      createSearchResult("/Users/demo/project/a-dir/zeta.ts"),
    ];

    expect(sortSearchResults(items, "path", "asc").map((item) => item.path)).toEqual([
      "/Users/demo/project/a-dir/zeta.ts",
      "/Users/demo/project/z-dir/alpha.ts",
    ]);
  });

  it("sorts by name in descending order when requested", () => {
    const items = [
      createSearchResult("/Users/demo/project/z-dir/alpha.ts"),
      createSearchResult("/Users/demo/project/a-dir/zeta.ts"),
      createSearchResult("/Users/demo/project/b-dir/beta.ts"),
    ];

    expect(sortSearchResults(items, "name", "desc").map((item) => item.name)).toEqual([
      "zeta.ts",
      "beta.ts",
      "alpha.ts",
    ]);
  });
});

describe("search result helpers", () => {
  it("marks the matched part of names for plain text and regex name searches", () => {
    const pattern = buildSearchHighlightPattern;
    expect(pattern("app", "regex", "name")?.exec("MyApp.tsx")?.[0]).toBe("App");
    expect(pattern("App", "regex", "name")?.exec("MyApp.tsx")?.[0]).toBe("App");
    expect(pattern("App", "regex", "name")?.exec("myapp.tsx")).toBeNull();
    expect(pattern("*.ts", "glob", "name")).toBeNull();
    expect(pattern("src/app", "regex", "path")).toBeNull();
    expect(pattern("(", "regex", "name")).toBeNull();
    // Plain text is found as typed, with the same smart case.
    expect(pattern("(1).pdf", "text", "name")?.exec("report (1).pdf")?.[0]).toBe("(1).pdf");
    expect(pattern("c++", "text", "name")?.exec("My C++ notes")?.[0]).toBe("C++");
    expect(pattern("C++", "text", "name")?.exec("my c++ notes")).toBeNull();
    expect(pattern("a.c", "text", "name")?.exec("abc")).toBeNull();
  });

  it("says which folder a result is in, from where the search started", () => {
    expect(formatSearchResultFolder("/Users/demo/app/src/main.ts", "/Users/demo/app")).toBe("src");
    expect(formatSearchResultFolder("/Users/demo/app/src/lib/a.ts", "/Users/demo/app/")).toBe(
      "src › lib",
    );
    // Right in the folder searched: that folder's name.
    expect(formatSearchResultFolder("/Users/demo/app/README.md", "/Users/demo/app")).toBe("app");
    expect(formatSearchResultFolder("/etc/hosts", "/")).toBe("etc");
    expect(formatSearchResultFolder("/notes.txt", "/")).toBe("Macintosh HD");
  });
});
