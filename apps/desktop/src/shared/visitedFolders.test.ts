import {
  type FolderVisit,
  MAX_VISITED_FOLDERS,
  MAX_VISITS_PER_FOLDER,
  type VisitedFolder,
  forgetVisitedFolder,
  recordFolderVisit,
  sanitizeVisitedFolders,
  serializeVisitedFolders,
  visitScore,
} from "./visitedFolders";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

function folderWith(visits: Array<[age: number, kind: FolderVisit["kind"]]>): VisitedFolder {
  return { path: "/x", visits: visits.map(([age, kind]) => ({ at: NOW - age, kind })) };
}

describe("visited folders", () => {
  it("keeps each visit, newest first, and moves the folder to the front", () => {
    const once = recordFolderVisit([], "/Users/demo/work", "stay", NOW - DAY);
    expect(once).toEqual([{ path: "/Users/demo/work", visits: [{ at: NOW - DAY, kind: "stay" }] }]);

    const twice = recordFolderVisit(once, "/Users/demo/work", "goTo", NOW);
    expect(twice).toEqual([
      {
        path: "/Users/demo/work",
        visits: [
          { at: NOW, kind: "goTo" },
          { at: NOW - DAY, kind: "stay" },
        ],
      },
    ]);

    const other = recordFolderVisit(twice, "/Users/demo/music", "stay", NOW);
    expect(other.map((folder) => folder.path)).toEqual(["/Users/demo/music", "/Users/demo/work"]);
    expect(recordFolderVisit(other, "", "stay", NOW)).toBe(other);
  });

  it("keeps only the latest visits of a folder", () => {
    let folders: VisitedFolder[] = [];
    for (let index = 0; index < MAX_VISITS_PER_FOLDER + 5; index += 1) {
      folders = recordFolderVisit(folders, "/a", "stay", NOW + index);
    }
    const visits = folders[0]?.visits ?? [];
    expect(visits).toHaveLength(MAX_VISITS_PER_FOLDER);
    expect(visits[0]?.at).toBe(NOW + MAX_VISITS_PER_FOLDER + 4);
    expect(visits.at(-1)?.at).toBe(NOW + 5);
  });

  it("only makes a folder passed through known, without a visit", () => {
    const known = recordFolderVisit([], "/a", "passThrough", NOW);
    expect(known).toEqual([{ path: "/a", visits: [] }]);

    // A folder already known is left as it is, in its place.
    const folders = recordFolderVisit(recordFolderVisit([], "/b", "stay", NOW), "/c", "stay", NOW);
    expect(recordFolderVisit(folders, "/b", "passThrough", NOW)).toBe(folders);
  });

  it("weighs each visit by how it was made and how long ago", () => {
    expect(visitScore(folderWith([[HOUR, "stay"]]), NOW)).toBe(1);
    expect(visitScore(folderWith([[HOUR, "goTo"]]), NOW)).toBe(3);
    expect(visitScore(folderWith([[10 * DAY, "stay"]]), NOW)).toBeCloseTo(0.7);
    expect(visitScore(folderWith([[20 * DAY, "stay"]]), NOW)).toBeCloseTo(0.5);
    expect(visitScore(folderWith([[60 * DAY, "stay"]]), NOW)).toBeCloseTo(0.3);
    expect(visitScore(folderWith([[200 * DAY, "stay"]]), NOW)).toBeCloseTo(0.1);
    expect(visitScore({ path: "/x", visits: [] }, NOW)).toBe(0);
    // A clock set back does not produce a negative age.
    expect(visitScore(folderWith([[-DAY, "stay"]]), NOW)).toBe(1);

    // Opened daily this week outranks opened constantly months ago, as only the latest
    // visits are kept.
    const thisWeek = folderWith(
      Array.from({ length: 5 }, (_, day) => [day * DAY, "stay"] as [number, "stay"]),
    );
    const lastSpring = folderWith(
      Array.from({ length: MAX_VISITS_PER_FOLDER }, () => [150 * DAY, "stay"] as [number, "stay"]),
    );
    expect(visitScore(thisWeek, NOW)).toBeGreaterThan(visitScore(lastSpring, NOW));
  });

  it("forgets the least used folders past the limit, never the one just opened", () => {
    let folders: VisitedFolder[] = Array.from({ length: MAX_VISITED_FOLDERS }, (_, index) => ({
      path: `/folders/${index}`,
      // Folder 0 has the fewest visits.
      visits: Array.from({ length: Math.min(index, MAX_VISITS_PER_FOLDER) }, () => ({
        at: NOW - DAY,
        kind: "stay" as const,
      })),
    }));
    folders = recordFolderVisit(folders, "/new", "passThrough", NOW);

    expect(folders).toHaveLength(MAX_VISITED_FOLDERS);
    expect(folders[0]).toEqual({ path: "/new", visits: [] });
    expect(folders.some((folder) => folder.path === "/folders/0")).toBe(false);
    expect(folders.some((folder) => folder.path === `/folders/${MAX_VISITED_FOLDERS - 1}`)).toBe(
      true,
    );
  });

  it("forgets a folder on request", () => {
    const folders = recordFolderVisit(recordFolderVisit([], "/a", "stay", NOW), "/b", "stay", NOW);
    expect(forgetVisitedFolder(folders, "/a").map((folder) => folder.path)).toEqual(["/b"]);
    expect(forgetVisitedFolder(folders, "/missing")).toEqual(folders);
  });

  it("writes one folder per line and reads it back", () => {
    const folders: VisitedFolder[] = [
      {
        path: "/a",
        visits: [
          { at: NOW, kind: "goTo" },
          { at: NOW - DAY, kind: "stay" },
        ],
      },
      { path: "/b", visits: [] },
    ];
    const text = serializeVisitedFolders(folders);
    expect(text).toBe(
      `{"folders":[\n{"path":"/a","visits":[[${NOW},"goTo"],[${NOW - DAY},"stay"]]},\n{"path":"/b","visits":[]}\n]}\n`,
    );
    expect(sanitizeVisitedFolders(JSON.parse(text).folders)).toEqual(folders);
    expect(serializeVisitedFolders([])).toBe('{"folders":[]}\n');
  });

  it("reads saved visits leniently", () => {
    expect(sanitizeVisitedFolders(undefined)).toEqual([]);
    expect(sanitizeVisitedFolders("nope")).toEqual([]);
    expect(
      sanitizeVisitedFolders([
        {
          path: "/ok",
          visits: [[NOW - DAY, "stay"], [NOW, "goTo"], [NOW, "fly"], ["today", "stay"], null],
        },
        { path: "/ok", visits: [] },
        { path: "relative", visits: [] },
        { path: "/no-visits" },
        null,
        42,
      ]),
    ).toEqual([
      {
        path: "/ok",
        visits: [
          { at: NOW, kind: "goTo" },
          { at: NOW - DAY, kind: "stay" },
        ],
      },
    ]);
  });

  it("reads the list kept before visits were stored one by one", () => {
    expect(
      sanitizeVisitedFolders([
        { path: "/few", visitCount: 2.9, lastVisitedAt: NOW },
        { path: "/many", visitCount: 40, lastVisitedAt: NOW - DAY },
        { path: "/zero", visitCount: 0, lastVisitedAt: NOW },
        { path: "/bad-time", visitCount: 1, lastVisitedAt: "yesterday" },
      ]),
    ).toEqual([
      {
        path: "/few",
        visits: [
          { at: NOW, kind: "stay" },
          { at: NOW, kind: "stay" },
        ],
      },
      {
        path: "/many",
        visits: Array.from({ length: MAX_VISITS_PER_FOLDER }, () => ({
          at: NOW - DAY,
          kind: "stay",
        })),
      },
    ]);
  });
});
