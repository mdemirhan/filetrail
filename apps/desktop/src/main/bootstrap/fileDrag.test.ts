vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
}));

import { decodeImageDataUrl, findDraggedAway, startFileDrag } from "./fileDrag";

// The window is zoomed to 150%.
const sender = { getZoomFactor: () => 1.5 } as unknown as Parameters<
  typeof startFileDrag
>[1]["sender"];
const handle = Buffer.from("handle");
const window = { getNativeWindowHandle: () => handle };

describe("startFileDrag", () => {
  it("drags from the sender's window, with each item where it shows, and answers with what the drop did", async () => {
    let end: ((operation: "move") => void) | undefined;
    const startNativeFileDrag = vi.fn((_view, _paths, _image, onEnded) => {
      end = onEnded;
      return true;
    });
    const answer = startFileDrag(
      {
        paths: ["/Users/demo/a.txt", "/Users/demo/b.txt"],
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
    end?.("move");
    await expect(answer).resolves.toEqual({ started: true, operation: "move" });
  });

  it("answers at once when the drag couldn't start", async () => {
    await expect(
      startFileDrag(
        { paths: ["/Users/demo/a.txt"], images: [] },
        { sender },
        { windowFor: () => window, startNativeFileDrag: () => false },
      ),
    ).resolves.toEqual({ started: false, operation: "none" });
    await expect(
      startFileDrag(
        { paths: ["/Users/demo/a.txt"], images: [] },
        { sender },
        { windowFor: () => null, startNativeFileDrag: vi.fn() },
      ),
    ).resolves.toEqual({ started: false, operation: "none" });
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

  it("leaves the caches alone when everything is still there", async () => {
    const clearCaches = vi.fn();
    await expect(
      findDraggedAway({ paths: ["/Users/demo/a.txt"] }, { lstatFn: async () => ({}), clearCaches }),
    ).resolves.toEqual({ gone: [] });
    expect(clearCaches).not.toHaveBeenCalled();
  });
});
