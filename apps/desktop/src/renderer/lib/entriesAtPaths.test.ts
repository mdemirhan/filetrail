import { describe, expect, it } from "vitest";

import { findEntryAtPath, resolveEntriesAtPaths } from "./entriesAtPaths";

function file(path: string, name = path.split("/").at(-1) ?? path) {
  return { path, name, extension: "", kind: "file" as const, isHidden: false, isSymlink: false };
}

describe("resolveEntriesAtPaths", () => {
  it("gives the items in the order of the paths, leaving out paths not in the list", () => {
    const entries = [file("/a"), file("/b"), file("/c")];

    expect(resolveEntriesAtPaths(["/c", "/gone", "/a"], entries)).toEqual([entries[2], entries[0]]);
    expect(resolveEntriesAtPaths([], entries)).toEqual([]);
  });

  it("finds the first of two items with one path, as a search from the start would", () => {
    const entries = [file("/a", "first"), file("/a", "second")];

    expect(findEntryAtPath(entries, "/a")?.name).toBe("first");
    expect(resolveEntriesAtPaths(["/a"], entries)[0]?.name).toBe("first");
  });

  it("answers for a new list of items, not the one asked about before", () => {
    const before = [file("/a")];
    const after = [file("/b")];

    expect(findEntryAtPath(before, "/a")).toBe(before[0]);
    expect(findEntryAtPath(after, "/a")).toBeNull();
    expect(findEntryAtPath(after, "/b")).toBe(after[0]);
    expect(findEntryAtPath(after, null)).toBeNull();
    expect(findEntryAtPath(after, undefined)).toBeNull();
  });
});
