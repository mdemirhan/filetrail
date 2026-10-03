import {
  abbreviatePlacePath,
  buildPlaces,
  describePlaceLocation,
  isPathQuery,
  rankPlaces,
} from "./places";

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const HOME = "/Users/demo";

function places(currentPath = "/somewhere/else") {
  return buildPlaces({
    visitedFolders: [
      { path: "/Users/demo/src/filetrail/apps/desktop", visitCount: 1, lastVisitedAt: NOW - HOUR },
      { path: "/Users/demo/src/filetrail", visitCount: 9, lastVisitedAt: NOW - HOUR },
      { path: "/Users/demo/Downloads", visitCount: 4, lastVisitedAt: NOW - HOUR },
      { path: "/Users/demo/Music/Old Downloads", visitCount: 30, lastVisitedAt: NOW - HOUR },
      { path: "/Users/demo/src/render-farm", visitCount: 2, lastVisitedAt: NOW - HOUR },
    ],
    favoritePaths: [HOME, "/Users/demo/Desktop", "/Users/demo/Downloads", "/Users/demo/.Trash"],
    currentPath,
    homePath: HOME,
    now: NOW,
  });
}
const names = (query: string, currentPath?: string) =>
  rankPlaces(places(currentPath), query).map((match) => match.place.name);

describe("places", () => {
  it("lists opened folders and favorites once each, named as the sidebar names them", () => {
    const all = places();
    expect(all.map((place) => place.path)).toEqual([
      "/Users/demo/src/filetrail/apps/desktop",
      "/Users/demo/src/filetrail",
      "/Users/demo/Downloads",
      "/Users/demo/Music/Old Downloads",
      "/Users/demo/src/render-farm",
      HOME,
      "/Users/demo/Desktop",
      "/Users/demo/.Trash",
    ]);
    const byPath = (path: string) => all.find((place) => place.path === path);
    expect(byPath(HOME)).toMatchObject({ name: "Home", isFavorite: true, isVisited: false });
    expect(byPath("/Users/demo/.Trash")?.name).toBe("Trash");
    expect(byPath("/Users/demo/Downloads")).toMatchObject({ isFavorite: true, isVisited: true });
    // The folder on screen is not somewhere to go.
    expect(places("/Users/demo/Downloads").some((place) => place.path.endsWith("/Downloads"))).toBe(
      false,
    );
  });

  it("lists the most used places first when nothing is typed", () => {
    expect(names("").slice(0, 3)).toEqual(["Old Downloads", "filetrail", "Downloads"]);
    // Favorites never opened come last, in their own order.
    expect(names("").slice(-3)).toEqual(["Home", "Desktop", "Trash"]);
  });

  it("ranks by how the text matches first, and by use second", () => {
    // Both start with "desk"; the one that has been opened comes first.
    expect(names("desk")).toEqual(["desktop", "Desktop"]);
    // A name starting with the text beats one that only contains it, however much used.
    expect(names("down")).toEqual(["Downloads", "Old Downloads"]);
    // Letters in order with others between them still find a name that starts with them.
    expect(names("dwn")).toEqual(["Downloads"]);
    expect(names("ownloads")).toEqual(["Old Downloads", "Downloads"]);
    expect(names("zzz")).toEqual([]);
  });

  it("matches every word typed, in the name or in the path", () => {
    // "apps" is only in the path of one "desktop".
    expect(names("apps desk")).toEqual(["desktop"]);
    expect(names("render")).toEqual(["render-farm"]);
    // A word found only in the path ranks below a name match.
    expect(names("src")).toEqual(["filetrail", "render-farm", "desktop"]);
    expect(names("farm")).toEqual(["render-farm"]);
  });

  it("reports which letters of the name matched", () => {
    const match = (query: string) => rankPlaces(places(), query)[0];
    expect(match("down")?.nameRanges).toEqual([[0, 4]]);
    // Neighbouring letters are reported as one range.
    expect(match("dwn")?.nameRanges).toEqual([
      [0, 1],
      [2, 4],
    ]);
    expect(match("farm")?.nameRanges).toEqual([[7, 11]]);
    expect(match("apps desk")?.nameRanges).toEqual([[0, 4]]);
  });

  it("says where a place is: its folder, or its own path when it is named otherwise", () => {
    expect(describePlaceLocation({ name: "filetrail", displayPath: "~/src/filetrail" })).toBe(
      "~/src",
    );
    expect(describePlaceLocation({ name: "Desktop", displayPath: "~/Desktop" })).toBe("~");
    expect(describePlaceLocation({ name: "Volumes", displayPath: "/Volumes" })).toBe("/");
    expect(describePlaceLocation({ name: "Home", displayPath: "~" })).toBe("~");
    expect(describePlaceLocation({ name: "Trash", displayPath: "~/.Trash" })).toBe("~/.Trash");
  });

  it("tells a path from a name, and shortens the home folder", () => {
    expect(isPathQuery("/usr")).toBe(true);
    expect(isPathQuery("~/Doc")).toBe(true);
    expect(isPathQuery(" ~")).toBe(true);
    expect(isPathQuery("docs")).toBe(false);
    expect(isPathQuery("")).toBe(false);
    expect(abbreviatePlacePath("/Users/demo/src", HOME)).toBe("~/src");
    expect(abbreviatePlacePath(HOME, HOME)).toBe("~");
    expect(abbreviatePlacePath("/Users/demolition", HOME)).toBe("/Users/demolition");
    expect(abbreviatePlacePath("/Applications", HOME)).toBe("/Applications");
  });
});
