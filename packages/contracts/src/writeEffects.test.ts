import { isAffectedByChange, pathsChangedByWrite } from "./writeEffects";

describe("pathsChangedByWrite", () => {
  it("lists the folder written into and every item moved, made or removed", () => {
    expect(
      pathsChangedByWrite({
        targetPath: "/Users/demo/Dest",
        items: [
          { sourcePath: "/Users/demo/a.txt", destinationPath: "/Users/demo/Dest/a.txt" },
          { sourcePath: "/Users/demo/Old", destinationPath: null },
        ],
      }).sort(),
    ).toEqual([
      "/Users/demo/Dest",
      "/Users/demo/Dest/a.txt",
      "/Users/demo/Old",
      "/Users/demo/a.txt",
    ]);
  });
});

describe("isAffectedByChange", () => {
  const changed = ["/Users/demo/Projects/app"];

  it("covers the item, what holds it, and what is inside it", () => {
    expect(isAffectedByChange("/Users/demo/Projects/app", changed)).toBe(true);
    expect(isAffectedByChange("/Users/demo/Projects", changed)).toBe(true);
    expect(isAffectedByChange("/", changed)).toBe(true);
    expect(isAffectedByChange("/Users/demo/Projects/app/src", changed)).toBe(true);
  });

  it("leaves folders beside it alone", () => {
    expect(isAffectedByChange("/Users/demo/Projects/application", changed)).toBe(false);
    expect(isAffectedByChange("/Users/demo/Music", changed)).toBe(false);
  });
});
