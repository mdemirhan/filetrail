import { ExplorerWindowList, NEW_WINDOW_OFFSET, placeNewWindow } from "./explorerWindows";

function entry(id: string, webContentsId: number) {
  return { id, window: { id }, webContentsId, launchFolderPath: null, restoreTabs: false };
}

describe("ExplorerWindowList", () => {
  it("keeps the windows front to back, the one focused last in front", () => {
    const list = new ExplorerWindowList<{ id: string }>();
    const a = entry("a", 1);
    const b = entry("b", 2);
    const c = entry("c", 3);
    list.add(a, "back");
    list.add(b, "back");
    list.add(c);

    expect(list.all().map((window) => window.id)).toEqual(["c", "a", "b"]);
    expect(list.moveToFront("b")).toBe(true);
    expect(list.moveToFront("b")).toBe(false);
    expect(list.front()?.id).toBe("b");
    list.remove("b");
    expect(list.front()?.id).toBe("c");
    expect(list.count).toBe(2);
  });

  it("finds a window by its id, its web contents and itself", () => {
    const list = new ExplorerWindowList<{ id: string }>();
    const a = entry("a", 7);
    list.add(a);

    expect(list.byId("a")).toBe(a);
    expect(list.byWebContentsId(7)).toBe(a);
    expect(list.byWebContentsId(8)).toBeNull();
    expect(list.byWebContentsId(null)).toBeNull();
    expect(list.byWindow(a.window)).toBe(a);
    expect(list.byWindow({ id: "a" })).toBeNull();
  });
});

describe("placeNewWindow", () => {
  const screen = { x: 0, y: 25, width: 1440, height: 875 };

  it("puts a new window a step down and to the right, the same size", () => {
    expect(placeNewWindow({ x: 100, y: 120, width: 900, height: 600 }, screen)).toEqual({
      x: 100 + NEW_WINDOW_OFFSET,
      y: 120 + NEW_WINDOW_OFFSET,
      width: 900,
      height: 600,
    });
  });

  it("starts again at the top left when the step would leave the screen", () => {
    expect(placeNewWindow({ x: 530, y: 290, width: 900, height: 600 }, screen)).toEqual({
      x: 0,
      y: 25,
      width: 900,
      height: 600,
    });
  });

  it("is never bigger than the screen", () => {
    expect(placeNewWindow({ x: 0, y: 25, width: 3000, height: 2000 }, screen)).toEqual({
      x: 0,
      y: 25,
      width: 1440,
      height: 875,
    });
  });
});
