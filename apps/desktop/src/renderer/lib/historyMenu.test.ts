import { HISTORY_MENU_LIMIT, getBackHistoryEntries, getForwardHistoryEntries } from "./historyMenu";

const HOME = "/Users/demo";
const HISTORY = ["/", HOME, "/Users/demo/src", "/Users/demo/src/app", "/Applications"];

describe("history menu", () => {
  it("lists where Back leads, nearest first", () => {
    expect(getBackHistoryEntries(HISTORY, 3, HOME)).toEqual([
      { index: 2, path: "/Users/demo/src", label: "src", detail: "~" },
      { index: 1, path: HOME, label: "Home", detail: "/Users" },
      { index: 0, path: "/", label: "Macintosh HD", detail: "" },
    ]);
    expect(getBackHistoryEntries(HISTORY, 0, HOME)).toEqual([]);
    expect(getBackHistoryEntries([], -1, HOME)).toEqual([]);
  });

  it("lists where Forward leads, nearest first", () => {
    expect(getForwardHistoryEntries(HISTORY, 2, HOME)).toEqual([
      { index: 3, path: "/Users/demo/src/app", label: "app", detail: "~/src" },
      { index: 4, path: "/Applications", label: "Applications", detail: "/" },
    ]);
    expect(getForwardHistoryEntries(HISTORY, 4, HOME)).toEqual([]);
  });

  it("stops at a dozen folders in either direction", () => {
    const long = Array.from({ length: 40 }, (_, index) => `/folders/${index}`);
    const back = getBackHistoryEntries(long, 30, HOME);
    expect(back).toHaveLength(HISTORY_MENU_LIMIT);
    expect(back[0]?.index).toBe(29);
    expect(back.at(-1)?.index).toBe(30 - HISTORY_MENU_LIMIT);
    const forward = getForwardHistoryEntries(long, 5, HOME);
    expect(forward).toHaveLength(HISTORY_MENU_LIMIT);
    expect(forward[0]?.index).toBe(6);
  });
});
