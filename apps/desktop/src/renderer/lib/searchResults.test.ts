import type { IpcResponse } from "@filetrail/contracts";

import { appendSearchResults, filterSearchResults, sortSearchResults } from "./searchResults";

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

  it("filters by name using case-insensitive contains matching", () => {
    const items = [
      createSearchResult("/Users/demo/project/src/App.tsx"),
      createSearchResult("/Users/demo/project/src/main.tsx"),
    ];

    expect(filterSearchResults(items, "app", "name").map((item) => item.name)).toEqual(["App.tsx"]);
  });

  it("filters by path using case-insensitive contains matching", () => {
    const items = [
      createSearchResult("/Users/demo/project/src/App.tsx"),
      createSearchResult("/Users/demo/project/tests/App.test.tsx"),
    ];

    expect(filterSearchResults(items, "tests", "path").map((item) => item.path)).toEqual([
      "/Users/demo/project/tests/App.test.tsx",
    ]);
  });
});
