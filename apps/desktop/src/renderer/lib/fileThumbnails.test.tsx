// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";

import { FileThumbnail, resetFileThumbnailCache } from "./fileThumbnails";
import { type FiletrailClient, FiletrailClientProvider } from "./filetrailClient";

type ThumbnailResponse = { version: string | null; unchanged: boolean; dataUrl: string | null };

const PREVIEW = "data:image/jpeg;base64,AAAA";

function file(name: string, kind: "file" | "symlink_file" | "directory" | "bundle" = "file") {
  return {
    path: `/Users/demo/${name}`,
    name,
    extension: name.includes(".") ? (name.split(".").at(-1) ?? "") : "",
    kind,
    isHidden: false,
    isSymlink: kind === "symlink_file",
  };
}

// A client that answers preview requests with `respond` and has no icons to give.
function createClient(respond: (payload: { path: string }) => Promise<ThumbnailResponse>) {
  const thumbnailRequests: Array<Record<string, unknown>> = [];
  const invoke = vi.fn(async (channel: string, payload: { path: string }) => {
    if (channel === "system:getFileThumbnail") {
      thumbnailRequests.push(payload);
      return respond(payload);
    }
    return { pngBase64: null };
  });
  const client = { invoke } as unknown as FiletrailClient;
  const wrap = (children: ReactNode) => (
    <FiletrailClientProvider value={client}>{children}</FiletrailClientProvider>
  );
  return { thumbnailRequests, wrap };
}

const settle = () => act(async () => undefined);

describe("FileThumbnail", () => {
  beforeEach(() => {
    resetFileThumbnailCache();
  });

  it("shows the file's icon until its preview arrives, then the preview", async () => {
    let deliver: (response: ThumbnailResponse) => void = () => undefined;
    const { thumbnailRequests, wrap } = createClient(
      () =>
        new Promise<ThumbnailResponse>((resolve) => {
          deliver = resolve;
        }),
    );
    const { container } = render(wrap(<FileThumbnail entry={file("photo.jpeg")} listing={{}} />));
    await settle();

    expect(thumbnailRequests).toEqual([{ path: "/Users/demo/photo.jpeg", size: 128 }]);
    expect(container.querySelector(".file-thumbnail")).toBeNull();
    expect(container.querySelector(".file-icon")).not.toBeNull();

    await act(async () => {
      deliver({ version: "10:20", unchanged: false, dataUrl: PREVIEW });
    });
    expect(container.querySelector(".file-thumbnail img")).toHaveAttribute("src", PREVIEW);
  });

  it("keeps the icon for a file Quick Look has no preview for", async () => {
    const { wrap } = createClient(async () => ({
      version: "10:20",
      unchanged: false,
      dataUrl: null,
    }));
    const { container } = render(wrap(<FileThumbnail entry={file("archive.zip")} listing={{}} />));
    await settle();

    expect(container.querySelector(".file-thumbnail")).toBeNull();
    expect(container.querySelector(".file-icon")).not.toBeNull();
  });

  it("outlines a photo, but not a picture that brings its own outline or has none", async () => {
    const { wrap } = createClient(async ({ path }) => ({
      version: "1:1",
      unchanged: false,
      dataUrl: path.endsWith(".jpeg") ? PREVIEW : "data:image/png;base64,CCCC",
    }));
    const { container } = render(
      wrap(
        <>
          <FileThumbnail entry={file("photo.jpeg")} listing={{}} />
          <FileThumbnail entry={file("notes.txt")} listing={{}} />
        </>,
      ),
    );
    await settle();

    const [photo, page] = Array.from(container.querySelectorAll(".file-thumbnail-img"));
    expect(photo).toHaveClass("framed");
    expect(page).not.toHaveClass("framed");
  });

  it("asks for previews of files only", async () => {
    const { thumbnailRequests, wrap } = createClient(async () => ({
      version: "1:1",
      unchanged: false,
      dataUrl: PREVIEW,
    }));
    render(
      wrap(
        <>
          <FileThumbnail entry={file("Folder", "directory")} listing={{}} />
          <FileThumbnail entry={file("Tool.app", "bundle")} listing={{}} />
          <FileThumbnail entry={file("link.png", "symlink_file")} listing={{}} />
        </>,
      ),
    );
    await settle();

    expect(thumbnailRequests.map((request) => request.path)).toEqual(["/Users/demo/link.png"]);
  });

  it("shows a cached preview at once and does not ask again for the same listing", async () => {
    const { thumbnailRequests, wrap } = createClient(async () => ({
      version: "10:20",
      unchanged: false,
      dataUrl: PREVIEW,
    }));
    const listing = {};
    const first = render(wrap(<FileThumbnail entry={file("photo.jpeg")} listing={listing} />));
    await settle();
    first.unmount();

    // Scrolled away and back: the item is mounted again while the folder is the same.
    const second = render(wrap(<FileThumbnail entry={file("photo.jpeg")} listing={listing} />));
    expect(second.container.querySelector(".file-thumbnail img")).toHaveAttribute("src", PREVIEW);
    await settle();
    expect(thumbnailRequests).toHaveLength(1);
  });

  it("checks a cached preview against the file when the folder is read again", async () => {
    const responses: ThumbnailResponse[] = [
      { version: "10:20", unchanged: false, dataUrl: PREVIEW },
      { version: "10:20", unchanged: true, dataUrl: null },
      { version: "11:25", unchanged: false, dataUrl: "data:image/jpeg;base64,BBBB" },
    ];
    const { thumbnailRequests, wrap } = createClient(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected preview request.");
      }
      return response;
    });
    const entry = file("photo.jpeg");
    const { container, rerender } = render(wrap(<FileThumbnail entry={entry} listing={{}} />));
    await settle();

    // Unchanged: the version held is sent along, and the preview stays.
    rerender(wrap(<FileThumbnail entry={entry} listing={{}} />));
    await settle();
    expect(thumbnailRequests[1]).toEqual({
      path: "/Users/demo/photo.jpeg",
      size: 128,
      knownVersion: "10:20",
    });
    expect(container.querySelector(".file-thumbnail img")).toHaveAttribute("src", PREVIEW);

    // Changed since: the new preview replaces the old one.
    rerender(wrap(<FileThumbnail entry={entry} listing={{}} />));
    await settle();
    expect(container.querySelector(".file-thumbnail img")).toHaveAttribute(
      "src",
      "data:image/jpeg;base64,BBBB",
    );
  });

  it("loads a few previews at a time and drops queued ones that are no longer shown", async () => {
    const pending: Array<(response: ThumbnailResponse) => void> = [];
    const { thumbnailRequests, wrap } = createClient(
      () =>
        new Promise<ThumbnailResponse>((resolve) => {
          pending.push(resolve);
        }),
    );
    const listing = {};
    const names = Array.from({ length: 6 }, (_, index) => `photo-${index}.jpeg`);
    const { rerender } = render(
      wrap(names.map((name) => <FileThumbnail key={name} entry={file(name)} listing={listing} />)),
    );
    await settle();
    expect(thumbnailRequests).toHaveLength(4);

    // The last item scrolls away before its turn; the fifth takes the next free slot.
    rerender(
      wrap(
        names
          .slice(0, 5)
          .map((name) => <FileThumbnail key={name} entry={file(name)} listing={listing} />),
      ),
    );
    await act(async () => {
      for (const resolve of pending.splice(0)) {
        resolve({ version: "1:1", unchanged: false, dataUrl: PREVIEW });
      }
    });
    await settle();
    expect(thumbnailRequests.map((request) => request.path)).toEqual(
      names.slice(0, 5).map((name) => `/Users/demo/${name}`),
    );
    await act(async () => {
      for (const resolve of pending.splice(0)) {
        resolve({ version: "1:1", unchanged: false, dataUrl: PREVIEW });
      }
    });
  });
});
