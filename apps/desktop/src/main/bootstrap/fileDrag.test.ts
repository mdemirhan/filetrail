vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
}));

import { MAX_PATHS_PER_REQUEST } from "@filetrail/contracts";

import {
  bringWindowToFront,
  decodeImageDataUrl,
  findDraggedAway,
  readDragChangeCount,
  readDraggedIn,
  startFileDrag,
} from "./fileDrag";

// The window is zoomed to 150%.
const sender = { getZoomFactor: () => 1.5 } as unknown as Parameters<
  typeof startFileDrag
>[1]["sender"];
const handle = Buffer.from("handle");
const window = { getNativeWindowHandle: () => handle };

describe("startFileDrag", () => {
  it("drags from the sender's window, with each item where it shows, and answers with what the drop did", async () => {
    let end: ((operation: "move", endedOver: "another_window") => void) | undefined;
    const startNativeFileDrag = vi.fn((_view, _paths, _directories, _images, onEnded) => {
      end = onEnded;
      return true;
    });
    const answer = startFileDrag(
      {
        paths: ["/Users/demo/a.txt", "/Users/demo/b.txt"],
        directories: [false, true],
        images: [
          {
            index: 1,
            iconRect: { x: 10, y: 20, width: 16, height: 16 },
            nameRect: { x: 30, y: 20, width: 100, height: 18 },
            nameFontSize: 13,
            nameCentered: false,
            thumbnail: "data:image/png;base64,iVBORw0KGgo=",
          },
        ],
      },
      { sender },
      { windowFor: () => window, startNativeFileDrag },
    );

    // In points on screen: the page's pixels times the zoom.
    expect(startNativeFileDrag).toHaveBeenCalledWith(
      handle,
      ["/Users/demo/a.txt", "/Users/demo/b.txt"],
      [false, true],
      [
        {
          index: 1,
          iconRect: { x: 15, y: 30, width: 24, height: 24 },
          nameRect: { x: 45, y: 30, width: 150, height: 27 },
          nameFontSize: 19.5,
          nameCentered: false,
          thumbnail: Buffer.from("iVBORw0KGgo=", "base64"),
        },
      ],
      expect.any(Function),
    );
    // Dropped on another window of the app, which takes the drop itself.
    end?.("move", "another_window");
    await expect(answer).resolves.toEqual({
      started: true,
      operation: "move",
      endedOver: "another_window",
    });
  });

  it("answers at once when the drag couldn't start", async () => {
    const notStarted = { started: false, operation: "none", endedOver: "elsewhere" };
    await expect(
      startFileDrag(
        { paths: ["/Users/demo/a.txt"], directories: [false], images: [] },
        { sender },
        { windowFor: () => window, startNativeFileDrag: () => false },
      ),
    ).resolves.toEqual(notStarted);
    await expect(
      startFileDrag(
        { paths: ["/Users/demo/a.txt"], directories: [false], images: [] },
        { sender },
        { windowFor: () => null, startNativeFileDrag: vi.fn() },
      ),
    ).resolves.toEqual(notStarted);
  });
});

describe("decodeImageDataUrl", () => {
  it("takes the image out of a base64 data URL, and nothing else", () => {
    expect(decodeImageDataUrl("data:image/jpeg;base64,/9j/4A==")).toEqual(
      Buffer.from("/9j/4A==", "base64"),
    );
    expect(decodeImageDataUrl(null)).toBeNull();
    expect(decodeImageDataUrl("data:image/png,raw")).toBeNull();
    expect(decodeImageDataUrl("data:image/png;base64,")).toBeNull();
  });
});

describe("findDraggedAway", () => {
  function missing(): Error {
    return Object.assign(new Error("gone"), { code: "ENOENT" });
  }

  it("finds the items no longer there, and has what they left read again", async () => {
    const clearCaches = vi.fn();
    const answer = await findDraggedAway(
      { paths: ["/Users/demo/moved.txt", "/Users/demo/stayed.txt", "/Volumes/Asleep/a.txt"] },
      {
        lstatFn: async (path) => {
          if (path === "/Users/demo/moved.txt") throw missing();
          if (path === "/Volumes/Asleep/a.txt") {
            throw Object.assign(new Error("busy"), { code: "EIO" });
          }
          return {};
        },
        clearCaches,
      },
    );

    // A disk that can't answer doesn't make its items gone.
    expect(answer).toEqual({ gone: ["/Users/demo/moved.txt"] });
    expect(clearCaches).toHaveBeenCalledWith(["/Users/demo/moved.txt"]);
  });

  it("has the Trash measured again when the Dock's Trash took them, and tells the other windows", async () => {
    const clearCaches = vi.fn();
    const tellOtherWindows = vi.fn();
    await findDraggedAway(
      { paths: ["/Users/demo/old.zip"], intoTrash: true },
      {
        lstatFn: async () => Promise.reject(missing()),
        clearCaches,
        homePath: "/Users/demo",
        tellOtherWindows,
      },
    );

    expect(clearCaches).toHaveBeenCalledWith(["/Users/demo/old.zip", "/Users/demo/.Trash"]);
    expect(tellOtherWindows).toHaveBeenCalledWith({
      gone: ["/Users/demo/old.zip"],
      intoTrash: true,
    });
  });

  it("leaves the caches alone when everything is still there", async () => {
    const clearCaches = vi.fn();
    await expect(
      findDraggedAway({ paths: ["/Users/demo/a.txt"] }, { lstatFn: async () => ({}), clearCaches }),
    ).resolves.toEqual({ gone: [] });
    expect(clearCaches).not.toHaveBeenCalled();
  });
});

describe("readDraggedIn", () => {
  function stats(kind: "file" | "directory" | "link") {
    return {
      isDirectory: () => kind === "directory",
      isSymbolicLink: () => kind === "link",
    };
  }

  it("gives each dragged item's kind as it is on disk, and leaves out what isn't there", async () => {
    const onDisk: Record<string, ReturnType<typeof stats>> = {
      "/Users/demo/a.txt": stats("file"),
      "/Users/demo/Folder": stats("directory"),
      "/Users/demo/to-folder": stats("link"),
      "/Users/demo/to-file": stats("link"),
      "/Users/demo/broken": stats("link"),
    };
    const targets: Record<string, ReturnType<typeof stats>> = {
      "/Users/demo/to-folder": stats("directory"),
      "/Users/demo/to-file": stats("file"),
    };
    const lookUp = (table: Record<string, ReturnType<typeof stats>>) => async (path: string) => {
      const found = table[path];
      if (!found) {
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      }
      return found;
    };

    const answer = await readDraggedIn({
      readDragPasteboard: () => ({
        changeCount: 7,
        paths: [...Object.keys(onDisk), "/Users/demo/gone.txt", "relative/path"],
      }),
      lstatFn: lookUp(onDisk),
      statFn: lookUp(targets),
    });

    expect(answer).toEqual({
      changeCount: 7,
      items: [
        { path: "/Users/demo/a.txt", kind: "file" },
        { path: "/Users/demo/Folder", kind: "directory" },
        { path: "/Users/demo/to-folder", kind: "symlink_directory" },
        { path: "/Users/demo/to-file", kind: "symlink_file" },
        { path: "/Users/demo/broken", kind: "symlink_file" },
      ],
    });
  });

  it("has nothing for a drag without files", async () => {
    await expect(
      readDraggedIn({ readDragPasteboard: () => ({ changeCount: 3, paths: [] }) }),
    ).resolves.toEqual({ changeCount: 3, items: [] });
  });

  it("refuses more items than one copy takes, rather than dropping some", async () => {
    const lstatFn = vi.fn();
    const paths = Array.from({ length: MAX_PATHS_PER_REQUEST + 1 }, (_, i) => `/f/${i}`);

    await expect(
      readDraggedIn({
        readDragPasteboard: () => ({ changeCount: 1, paths }),
        lstatFn,
      }),
    ).resolves.toEqual({ changeCount: 1, items: [] });
    expect(lstatFn).not.toHaveBeenCalled();
  });
});

describe("readDragChangeCount", () => {
  it("tells which drag is going on, without reading what it carries", () => {
    expect(readDragChangeCount({ readDragChangeCount: () => 12 })).toEqual({ changeCount: 12 });
  });
});

describe("bringWindowToFront", () => {
  function fakeWindow(focusedAfter: boolean) {
    return {
      show: vi.fn(),
      focus: vi.fn(),
      isFocused: vi.fn(() => focusedAfter),
      isDestroyed: vi.fn(() => false),
    };
  }

  it("brings the app and the window forward", async () => {
    const window = fakeWindow(true);
    const focusApp = vi.fn();
    const bounceDockIcon = vi.fn();

    await expect(
      bringWindowToFront(
        { sender },
        { windowFor: () => window, focusApp, bounceDockIcon, waitMs: 0 },
      ),
    ).resolves.toEqual({ focused: true });
    expect(focusApp).toHaveBeenCalled();
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(bounceDockIcon).not.toHaveBeenCalled();
  });

  it("bounces the Dock icon when macOS keeps another app in front", async () => {
    const window = fakeWindow(false);
    const bounceDockIcon = vi.fn();

    await expect(
      bringWindowToFront(
        { sender },
        { windowFor: () => window, focusApp: vi.fn(), bounceDockIcon, waitMs: 0 },
      ),
    ).resolves.toEqual({ focused: false });
    expect(bounceDockIcon).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a window, or once it has closed", async () => {
    await expect(bringWindowToFront({ sender }, { windowFor: () => null })).resolves.toEqual({
      focused: false,
    });
    const closed = { ...fakeWindow(false), isDestroyed: vi.fn(() => true) };
    const bounceDockIcon = vi.fn();
    await expect(
      bringWindowToFront(
        { sender },
        { windowFor: () => closed, focusApp: vi.fn(), bounceDockIcon, waitMs: 0 },
      ),
    ).resolves.toEqual({ focused: false });
    expect(bounceDockIcon).not.toHaveBeenCalled();
  });
});
