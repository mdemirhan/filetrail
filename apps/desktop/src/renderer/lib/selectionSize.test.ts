import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import { summarizeSelectionSize } from "./selectionSize";

const file = (path: string) => ({ path, kind: "file" as const });
const folder = (path: string) => ({ path, kind: "directory" as const });
const folderLink = (path: string) => ({ path, kind: "symlink_directory" as const });
const ready = (sizeBytes: number, diskBytes = sizeBytes): FolderSizeEntry => ({
  status: "ready",
  sizeBytes,
  diskBytes,
  fileCount: 10,
  folderCount: 2,
});

function summarize(
  entries: Array<{ path: string; kind: "file" | "directory" | "symlink_directory" }>,
  fileSizes: Record<string, number | null>,
  folderSizes: Record<string, FolderSizeEntry>,
) {
  return summarizeSelectionSize(
    entries,
    (path) => fileSizes[path] ?? null,
    (path) => folderSizes[path] ?? { status: "idle" },
  );
}

describe("selection size", () => {
  it("adds up files whose sizes the list has, with nothing to calculate", () => {
    expect(summarize([file("/a"), file("/b")], { "/a": 1_000, "/b": 500 }, {})).toEqual({
      totalBytes: 1_500,
      folderPaths: [],
      folderSizeEntry: null,
    });
    // A file not measured yet: no total yet.
    expect(summarize([file("/a"), file("/b")], { "/a": 1_000 }, {}).totalBytes).toBeNull();
  });

  it("offers Calculate while any folder's size is unknown, and no total", () => {
    const size = summarize(
      [folder("/x"), folder("/y"), file("/a")],
      { "/a": 1 },
      {
        "/x": ready(100),
      },
    );
    expect(size.totalBytes).toBeNull();
    expect(size.folderPaths).toEqual(["/x", "/y"]);
    expect(size.folderSizeEntry).toEqual({ status: "idle" });
    // A failed folder can be tried again the same way.
    expect(
      summarize(
        [folder("/x"), folder("/y")],
        {},
        {
          "/x": ready(100),
          "/y": { status: "error", message: "denied" },
        },
      ).folderSizeEntry,
    ).toEqual({ status: "idle" });
  });

  it("shows calculating while any folder is", () => {
    expect(
      summarize(
        [folder("/x"), folder("/y")],
        {},
        {
          "/x": { status: "calculating", jobId: "1" },
        },
      ).folderSizeEntry?.status,
    ).toBe("calculating");
  });

  it("sums everything up once every size is known", () => {
    const size = summarize(
      [folder("/x"), folder("/y"), file("/a")],
      { "/a": 50 },
      {
        "/x": ready(100, 120),
        "/y": ready(200, 220),
      },
    );
    expect(size.totalBytes).toBe(350);
    // The selected items and everything inside them; files have no size on disk listed,
    // so a selection with files shows the size alone.
    expect(size.folderSizeEntry).toEqual({
      status: "ready",
      sizeBytes: 350,
      diskBytes: 350,
      fileCount: 21,
      folderCount: 6,
    });
    // Folders alone: their size on disk too.
    expect(
      summarize([folder("/x"), folder("/y")], {}, { "/x": ready(100, 120), "/y": ready(200, 220) })
        .folderSizeEntry,
    ).toMatchObject({ sizeBytes: 300, diskBytes: 340 });
  });

  it("counts a link to a folder as the link itself, not the folder it points to", () => {
    // As measuring the folder they are in counts it, so its size is never waited for, and
    // the folder it points to is not counted twice when it is selected too.
    const size = summarize(
      [folder("/home/dotfiles"), folderLink("/home/scripts"), file("/home/.zshrc")],
      { "/home/scripts": 16, "/home/.zshrc": 10 },
      { "/home/dotfiles": ready(1_000) },
    );
    expect(size.totalBytes).toBe(1_026);
    expect(size.folderPaths).toEqual(["/home/dotfiles"]);
    expect(size.folderSizeEntry).toMatchObject({ status: "ready", sizeBytes: 1_026 });
  });

  it("waits for a file's size before showing the total of known folders", () => {
    const size = summarize([folder("/x"), file("/a")], {}, { "/x": ready(100) });
    expect(size.totalBytes).toBeNull();
    expect(size.folderSizeEntry).toBeNull();
  });
});
