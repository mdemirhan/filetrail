import {
  type ApplicationMenuState,
  INITIAL_APPLICATION_MENU_STATE,
} from "../shared/applicationMenuState";
import { ApplicationMenuSync } from "./applicationMenuSync";
import { ExplorerWindowList } from "./explorerWindows";

type FakeWindow = {
  name: string;
  webContents: { send: ReturnType<typeof vi.fn> };
  isDestroyed: () => boolean;
};

function fakeWindow(name: string): FakeWindow {
  return { name, webContents: { send: vi.fn() }, isDestroyed: () => false };
}

type FakeItem = { enabled: boolean; visible: boolean; checked: boolean; type: string };

// A menu holding an item for every id asked for, all on to start with.
function fakeMenu() {
  const items = new Map<string, FakeItem>();
  return {
    items,
    getMenuItemById: (id: string) => {
      let item = items.get(id);
      if (!item) {
        item = { enabled: true, visible: true, checked: false, type: "normal" };
        items.set(id, item);
      }
      return item as never;
    },
  };
}

function setUp() {
  const list = new ExplorerWindowList<FakeWindow>();
  const menu = fakeMenu();
  let focused: unknown = null;
  let built = 0;
  const sync: ApplicationMenuSync<FakeWindow> = new ApplicationMenuSync<FakeWindow>({
    windows: list,
    focusedWindow: () => focused,
    menu: () => menu,
    build: () => {
      built += 1;
      sync.menuBuilt();
    },
  });
  sync.menuBuilt();
  const open = (name: string, webContentsId: number) => {
    const window = fakeWindow(name);
    list.add({ id: name, window, webContentsId, launchFolderPath: null, restoreTabs: false });
    return window;
  };
  return {
    list,
    menu,
    sync,
    open,
    focus: (window: unknown) => {
      focused = window;
    },
    builds: () => built,
    enabled: (id: string) => menu.getMenuItemById(id) as unknown as FakeItem,
  };
}

const oneTab: ApplicationMenuState = {
  ...INITIAL_APPLICATION_MENU_STATE,
  disabledCommands: ["moveTabToNewWindow"],
};

describe("ApplicationMenuSync", () => {
  it("shows the state of the focused explorer window, following the focus", () => {
    const { sync, open, focus, enabled } = setUp();
    const a = open("a", 1);
    const b = open("b", 2);
    sync.setWindowState(1, oneTab);
    sync.setWindowState(2, INITIAL_APPLICATION_MENU_STATE);

    focus(a);
    sync.sync();
    expect(enabled("moveTabToNewWindow").enabled).toBe(false);
    focus(b);
    sync.sync();
    expect(enabled("moveTabToNewWindow").enabled).toBe(true);
    expect(enabled("mergeAllWindows").enabled).toBe(true);
  });

  it("doesn't hear windows that aren't explorer windows", () => {
    const { sync, open, focus, enabled } = setUp();
    const a = open("a", 1);
    focus(a);
    sync.setWindowState(1, INITIAL_APPLICATION_MENU_STATE);
    sync.setWindowState(99, oneTab);
    sync.setWindowState(null, oneTab);
    expect(enabled("moveTabToNewWindow").enabled).toBe(true);
  });

  it("offers New Window and the Go menu's places with only Settings open", () => {
    const { sync, focus, enabled } = setUp();
    focus(fakeWindow("settings"));

    sync.sync();

    expect(enabled("newWindow").enabled).toBe(true);
    expect(enabled("goDesktop").enabled).toBe(true);
    expect(enabled("goBack").enabled).toBe(false);
    expect(enabled("emptyTrash").enabled).toBe(false);
  });

  it("sends commands to the focused explorer window, or the front one from another window", () => {
    const { sync, open } = setUp();
    expect(sync.explorerFor(null)).toBeNull();
    const a = open("a", 1);
    const b = open("b", 2);

    expect(sync.explorerFor(a)).toEqual({ contents: a.webContents, focused: true });
    expect(sync.explorerFor(fakeWindow("settings"))).toEqual({
      contents: b.webContents,
      focused: false,
    });
    expect(sync.explorerFor(undefined)).toEqual({ contents: b.webContents, focused: true });
  });

  it("builds the menu again only when Undo or Redo should say something else", () => {
    const { sync, open, focus, builds } = setUp();
    focus(open("a", 1));

    sync.setUndoHistory({ undo: "Move of “a.txt”", redo: null, cantUndo: false });
    expect(builds()).toBe(1);
    expect(sync.undoLabels().undo).toBe("Undo Move of “a.txt”");
    sync.setUndoHistory({ undo: "Move of “a.txt”", redo: null, cantUndo: false });
    expect(builds()).toBe(1);
  });

  it("switches to a text field's own Undo without building the menu again", () => {
    const { sync, open, focus, builds, enabled } = setUp();
    focus(open("a", 1));
    sync.setUndoHistory({ undo: "Move of “a.txt”", redo: "Rename", cantUndo: false });
    const built = builds();

    sync.setWindowState(1, { ...INITIAL_APPLICATION_MENU_STATE, textEditing: true });
    expect(enabled("undo").visible).toBe(false);
    expect(enabled("undo:text").visible).toBe(true);
    expect(enabled("redo:text").visible).toBe(true);
    sync.setWindowState(1, INITIAL_APPLICATION_MENU_STATE);
    expect(enabled("undo").visible).toBe(true);
    expect(enabled("undo:text").visible).toBe(false);

    expect(builds()).toBe(built);
  });

  it("uses the text field's own Undo while Settings has the keyboard and no explorer window is open", () => {
    const { sync, focus, enabled } = setUp();
    sync.setUndoHistory({ undo: "Move of “a.txt”", redo: null, cantUndo: false });
    focus(fakeWindow("settings"));

    sync.sync();

    expect(enabled("undo").visible).toBe(false);
    expect(enabled("undo:text")).toMatchObject({ visible: true, enabled: true });
    expect(enabled("newWindow").enabled).toBe(true);
  });

  it("stops naming the last operation in Undo once the last window has closed", () => {
    const { sync, open, list, focus, builds, enabled } = setUp();
    const a = open("a", 1);
    focus(a);
    sync.setUndoHistory({ undo: "Move of “a.txt”", redo: null, cantUndo: false });
    expect(builds()).toBe(1);

    list.remove("a");
    focus(null);
    sync.windowsChanged();

    expect(enabled("undo").visible).toBe(false);
    expect(enabled("undo:text")).toMatchObject({ visible: true, enabled: false });
    expect(enabled("redo:text")).toMatchObject({ visible: true, enabled: false });
  });

  it("lets go of a closed window's state", () => {
    const { sync, open, list, focus, enabled } = setUp();
    const a = open("a", 1);
    focus(a);
    sync.setWindowState(1, oneTab);
    list.remove("a");
    sync.windowsChanged();
    list.add({ id: "a", window: a, webContentsId: 1, launchFolderPath: null, restoreTabs: false });
    sync.sync();
    expect(enabled("moveTabToNewWindow").enabled).toBe(true);
  });

  it("does nothing before the menu is built", () => {
    const sync = new ApplicationMenuSync<FakeWindow>({
      windows: new ExplorerWindowList<FakeWindow>(),
      focusedWindow: () => null,
      menu: () => null,
      build: () => {
        throw new Error("Not built yet.");
      },
    });
    sync.setUndoHistory({ undo: "Rename", redo: null, cantUndo: false });
    sync.sync();
    expect(sync.undoLabels().undo).toBe("Undo Rename");
  });
});
