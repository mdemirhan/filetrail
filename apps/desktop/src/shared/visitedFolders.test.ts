import {
  MAX_VISITED_FOLDERS,
  forgetVisitedFolder,
  recordFolderVisit,
  sanitizeVisitedFolders,
  visitScore,
} from "./visitedFolders";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

describe("visited folders", () => {
  it("counts visits and keeps the latest time", () => {
    const once = recordFolderVisit([], "/Users/demo/work", NOW - DAY);
    expect(once).toEqual([{ path: "/Users/demo/work", visitCount: 1, lastVisitedAt: NOW - DAY }]);

    const twice = recordFolderVisit(once, "/Users/demo/work", NOW);
    expect(twice).toEqual([{ path: "/Users/demo/work", visitCount: 2, lastVisitedAt: NOW }]);

    const other = recordFolderVisit(twice, "/Users/demo/music", NOW);
    expect(other.map((folder) => folder.path)).toEqual(["/Users/demo/music", "/Users/demo/work"]);
    expect(recordFolderVisit(other, "", NOW)).toEqual(other);
  });

  it("weighs recent visits above old ones", () => {
    const visit = (visitCount: number, age: number) => ({
      path: "/x",
      visitCount,
      lastVisitedAt: NOW - age,
    });
    expect(visitScore(visit(3, 10 * 60 * 1000), NOW)).toBe(12);
    expect(visitScore(visit(3, 5 * HOUR), NOW)).toBe(6);
    expect(visitScore(visit(3, 3 * DAY), NOW)).toBe(1.5);
    expect(visitScore(visit(3, 60 * DAY), NOW)).toBe(0.75);
    // Three visits today outrank ten from months ago.
    expect(visitScore(visit(3, 5 * HOUR), NOW)).toBeGreaterThan(
      visitScore(visit(10, 90 * DAY), NOW),
    );
    // A clock set back does not produce a negative age.
    expect(visitScore(visit(1, -DAY), NOW)).toBe(4);
  });

  it("forgets the least used folders past the limit, never the one just opened", () => {
    let folders = Array.from({ length: MAX_VISITED_FOLDERS }, (_, index) => ({
      path: `/folders/${index}`,
      // Folder 0 is the least used and the oldest.
      visitCount: index + 1,
      lastVisitedAt: NOW - (MAX_VISITED_FOLDERS - index) * DAY,
    }));
    folders = recordFolderVisit(folders, "/new", NOW);

    expect(folders).toHaveLength(MAX_VISITED_FOLDERS);
    expect(folders[0]).toEqual({ path: "/new", visitCount: 1, lastVisitedAt: NOW });
    expect(folders.some((folder) => folder.path === "/folders/0")).toBe(false);
    expect(folders.some((folder) => folder.path === `/folders/${MAX_VISITED_FOLDERS - 1}`)).toBe(
      true,
    );
  });

  it("forgets a folder on request", () => {
    const folders = recordFolderVisit(recordFolderVisit([], "/a", NOW), "/b", NOW);
    expect(forgetVisitedFolder(folders, "/a").map((folder) => folder.path)).toEqual(["/b"]);
    expect(forgetVisitedFolder(folders, "/missing")).toEqual(folders);
  });

  it("reads saved visits leniently", () => {
    expect(sanitizeVisitedFolders(undefined)).toEqual([]);
    expect(sanitizeVisitedFolders("nope")).toEqual([]);
    expect(
      sanitizeVisitedFolders([
        { path: "/ok", visitCount: 2.9, lastVisitedAt: NOW },
        { path: "/ok", visitCount: 5, lastVisitedAt: NOW },
        { path: "relative", visitCount: 1, lastVisitedAt: NOW },
        { path: "/no-count", lastVisitedAt: NOW },
        { path: "/zero", visitCount: 0, lastVisitedAt: NOW },
        { path: "/bad-time", visitCount: 1, lastVisitedAt: "yesterday" },
        null,
        42,
      ]),
    ).toEqual([{ path: "/ok", visitCount: 2, lastVisitedAt: NOW }]);
  });
});
