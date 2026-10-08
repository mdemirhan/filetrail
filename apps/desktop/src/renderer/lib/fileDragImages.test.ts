// @vitest-environment jsdom

import { measureFileDragImages } from "./fileDragImages";

// The page lays nothing out in tests: each element is given the place it would have.
function place(element: Element, x: number, y: number, width: number, height: number) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
}

function listItem(path: string, top: number, iconClass = "file-icon"): HTMLElement {
  const item = document.createElement("button");
  item.dataset.dragPath = path;
  const icon = document.createElement("span");
  icon.className = iconClass;
  const name = document.createElement("span");
  name.className = "details-name-label";
  name.style.fontSize = "13px";
  item.append(icon, name);
  place(item, 0, top, 400, 24);
  place(icon, 8, top + 4, 16, 16);
  place(name, 30, top + 3, 200, 18);
  return item;
}

function scrollingList(...items: HTMLElement[]): HTMLElement {
  const list = document.createElement("div");
  list.style.overflowY = "auto";
  place(list, 0, 100, 400, 200);
  list.append(...items);
  document.body.append(list);
  return list;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("measureFileDragImages", () => {
  it("finds each dragged item where it shows, its icon and its name", () => {
    scrollingList(listItem("/demo/a.txt", 100), listItem("/demo/b.txt", 124));

    expect(measureFileDragImages(["/demo/a.txt", "/demo/b.txt"], () => null)).toEqual([
      {
        index: 0,
        iconRect: { x: 8, y: 104, width: 16, height: 16 },
        nameRect: { x: 30, y: 103, width: 200, height: 18 },
        nameFontSize: 13,
        nameCentered: false,
        thumbnail: null,
      },
      expect.objectContaining({ index: 1, iconRect: { x: 8, y: 128, width: 16, height: 16 } }),
    ]);
  });

  it("leaves out items scrolled out of sight, or not on the page", () => {
    scrollingList(listItem("/demo/seen.txt", 120), listItem("/demo/below.txt", 320));

    const images = measureFileDragImages(
      ["/demo/below.txt", "/demo/seen.txt", "/demo/far away.txt"],
      () => null,
    );

    expect(images.map((image) => image.index)).toEqual([1]);
  });

  it("centers names in Icon view, and sends the picture shown for an icon", () => {
    const item = listItem("/demo/photo.jpg", 120, "file-icon file-thumbnail");
    item.querySelector(".details-name-label")?.setAttribute("class", "icon-item-label");
    scrollingList(item, listItem("/demo/notes.txt", 150));
    const thumbnails: Record<string, string> = {
      "/demo/photo.jpg": "data:image/jpeg;base64,/9j/",
      "/demo/notes.txt": "data:image/png;base64,iVBO",
    };

    const images = measureFileDragImages(
      ["/demo/photo.jpg", "/demo/notes.txt"],
      (path) => thumbnails[path] ?? null,
    );

    expect(images[0]).toMatchObject({
      nameCentered: true,
      thumbnail: thumbnails["/demo/photo.jpg"],
    });
    // Its icon is shown, not a picture: a stale one left from Icon view isn't sent.
    expect(images[1]).toMatchObject({ nameCentered: false, thumbnail: null });
  });

  it("looks through the page once, however many items are dragged", () => {
    scrollingList(listItem("/demo/a.txt", 100), listItem("/demo/b.txt", 124));
    const paths = Array.from({ length: 5000 }, (_, index) => `/demo/far/${index}.txt`);
    const querySelector = vi.spyOn(document, "querySelector");
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");

    const images = measureFileDragImages([...paths, "/demo/b.txt"], () => null);

    expect(images.map((image) => image.index)).toEqual([5000]);
    expect(querySelector).not.toHaveBeenCalled();
    expect(querySelectorAll).toHaveBeenCalledTimes(1);
    querySelector.mockRestore();
    querySelectorAll.mockRestore();
  });
});
