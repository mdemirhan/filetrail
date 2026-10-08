import type { IpcRequest } from "@filetrail/contracts";

import type { WriteJournalEntry } from "@filetrail/core";

import {
  type BatchRenameFs,
  numberedName,
  recoverBatchRename,
  runBatchRename,
} from "./batchRenameExecution";

// An in-memory folder tree that compares names as a disk does (ignoring case unless told
// otherwise, and accent encoding always), refuses to replace with an exclusive rename, and
// fails on demand.
class MemoryDisk implements BatchRenameFs {
  private readonly folders = new Map<string, Map<string, { name: string; ino: number }>>();
  private nextIno = 10;
  readonly calls: string[] = [];
  // "rename:/from->/to" or "renameExclusive:/from->/to", or a path for lstat: the error to fail with.
  readonly failures = new Map<string, NodeJS.ErrnoException>();
  readonly lockedPaths = new Set<string>();

  constructor(
    files: string[],
    private readonly caseSensitive = false,
  ) {
    for (const path of files) {
      this.add(path);
    }
  }

  add(path: string): void {
    const { folder, name } = split(path);
    const entries = this.folders.get(folder) ?? new Map();
    entries.set(this.key(name), { name, ino: this.nextIno++ });
    this.folders.set(folder, entries);
  }

  names(folder = "/trip"): string[] {
    return [...(this.folders.get(folder)?.values() ?? [])].map((entry) => entry.name).sort();
  }

  private key(name: string): string {
    const normalized = name.normalize("NFD");
    return this.caseSensitive ? normalized : normalized.toLowerCase();
  }

  private find(path: string) {
    const { folder, name } = split(path);
    return this.folders.get(folder)?.get(this.key(name)) ?? null;
  }

  lstat = async (path: string) => {
    this.calls.push(`lstat:${path}`);
    const failure = this.failures.get(`lstat:${path}`);
    if (failure) {
      throw failure;
    }
    const entry = this.find(path);
    if (!entry) {
      throw errno("ENOENT");
    }
    return { isDirectory: () => false, dev: 1, ino: entry.ino };
  };

  readdir = async (folder: string) => this.names(folder);

  getFlags = async (path: string) => (this.lockedPaths.has(path) ? 0x2 : 0);

  renameExclusive = async (from: string, to: string) => {
    this.calls.push(`renameExclusive:${from}->${to}`);
    const failure = this.failures.get(`renameExclusive:${from}->${to}`);
    if (failure) {
      throw failure;
    }
    if (!this.find(from)) {
      throw errno("ENOENT");
    }
    if (this.find(to)) {
      throw errno("EEXIST");
    }
    this.move(from, to);
  };

  rename = async (from: string, to: string) => {
    this.calls.push(`rename:${from}->${to}`);
    const failure = this.failures.get(`rename:${from}->${to}`);
    if (failure) {
      throw failure;
    }
    if (!this.find(from)) {
      throw errno("ENOENT");
    }
    this.move(from, to);
  };

  private move(from: string, to: string): void {
    const source = split(from);
    const destination = split(to);
    const entry = this.find(from);
    this.folders.get(source.folder)?.delete(this.key(source.name));
    const entries = this.folders.get(destination.folder) ?? new Map();
    entries.set(this.key(destination.name), { name: destination.name, ino: entry?.ino ?? 0 });
    this.folders.set(destination.folder, entries);
    // A folder takes what is inside it along.
    for (const [path, contents] of [...this.folders]) {
      if (path === from || path.startsWith(`${from}/`)) {
        this.folders.delete(path);
        this.folders.set(`${to}${path.slice(from.length)}`, contents);
      }
    }
  }
}

function split(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf("/");
  return { folder: slash <= 0 ? "/" : path.slice(0, slash), name: path.slice(slash + 1) };
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: test`), { code });
}

function request(
  pairs: Array<[string, string]>,
  options: Partial<Omit<IpcRequest<"writeOperation:batchRename">, "items">> & {
    folders?: string[];
  } = {},
): IpcRequest<"writeOperation:batchRename"> {
  return {
    items: pairs.map(([from, to]) => ({
      sourcePath: `/trip/${from}`,
      destinationName: to,
      isFolder: options.folders?.includes(from) ?? false,
    })),
    onConflict: options.onConflict ?? "number",
    numberSeparator: options.numberSeparator ?? " ",
  };
}

// Temporary names counted up, so tests can name them.
function counter() {
  let next = 0;
  return () => `.tmp-${next++}`;
}

async function run(
  disk: MemoryDisk,
  renameRequest: IpcRequest<"writeOperation:batchRename">,
  extra: {
    signal?: AbortSignal;
    onItemStart?: Parameters<typeof runBatchRename>[0]["onItemStart"];
  } = {},
) {
  return runBatchRename({
    request: renameRequest,
    fs: disk,
    signal: extra.signal ?? new AbortController().signal,
    temporaryName: counter(),
    ...(extra.onItemStart ? { onItemStart: extra.onItemStart } : {}),
  });
}

describe("renaming several items", () => {
  it("renames each item, says as each starts, and reports where each went", async () => {
    const disk = new MemoryDisk(["/trip/a.jpg", "/trip/b.jpg"]);
    const started: Array<[string, number]> = [];
    const result = await run(
      disk,
      request([
        ["a.jpg", "Lisbon 1.jpg"],
        ["b.jpg", "Lisbon 2.jpg"],
      ]),
      {
        onItemStart: (item, done) => started.push([item.sourcePath, done]),
      },
    );
    expect(disk.names()).toEqual(["Lisbon 1.jpg", "Lisbon 2.jpg"]);
    expect(started).toEqual([
      ["/trip/a.jpg", 0],
      ["/trip/b.jpg", 1],
    ]);
    expect(result).toEqual({
      cancelled: false,
      completedItemCount: 2,
      items: [
        {
          sourcePath: "/trip/a.jpg",
          destinationPath: "/trip/Lisbon 1.jpg",
          status: "completed",
          error: null,
          skipReason: null,
        },
        {
          sourcePath: "/trip/b.jpg",
          destinationPath: "/trip/Lisbon 2.jpg",
          status: "completed",
          error: null,
          skipReason: null,
        },
      ],
    });
  });

  it("swaps two names by moving one aside first", async () => {
    const disk = new MemoryDisk(["/trip/a.txt", "/trip/b.txt"]);
    const result = await run(
      disk,
      request([
        ["a.txt", "b.txt"],
        ["b.txt", "a.txt"],
      ]),
    );
    expect(result.completedItemCount).toBe(2);
    expect(disk.names()).toEqual(["a.txt", "b.txt"]);
    // Both wanted each other's name: both waited under a temporary one.
    expect(disk.calls.filter((call) => call.startsWith("renameExclusive"))).toEqual([
      "renameExclusive:/trip/a.txt->/trip/.tmp-0",
      "renameExclusive:/trip/b.txt->/trip/.tmp-1",
      "renameExclusive:/trip/.tmp-0->/trip/b.txt",
      "renameExclusive:/trip/.tmp-1->/trip/a.txt",
    ]);
    // a's contents are now under b: the ino moved with the name.
    const a = await disk.lstat("/trip/a.txt");
    const b = await disk.lstat("/trip/b.txt");
    expect(a.ino).toBe(11);
    expect(b.ino).toBe(10);
  });

  it("passes names along a chain and around a cycle", async () => {
    const chain = new MemoryDisk(["/trip/File 1", "/trip/File 2", "/trip/File 3"]);
    await run(
      chain,
      request([
        ["File 1", "File 2"],
        ["File 2", "File 3"],
        ["File 3", "File 4"],
      ]),
    );
    expect(chain.names()).toEqual(["File 2", "File 3", "File 4"]);

    const cycle = new MemoryDisk(["/trip/x", "/trip/y", "/trip/z"]);
    const result = await run(
      cycle,
      request([
        ["x", "y"],
        ["y", "z"],
        ["z", "x"],
      ]),
    );
    expect(result.completedItemCount).toBe(3);
    expect(cycle.names()).toEqual(["x", "y", "z"]);
    expect(cycle.names().some((name) => name.startsWith(".tmp"))).toBe(false);
  });

  it("changes only the case of a name with a plain rename on a disk that ignores case", async () => {
    const disk = new MemoryDisk(["/trip/notes.txt"]);
    const result = await run(disk, request([["notes.txt", "Notes.txt"]]));
    expect(result.items[0]?.status).toBe("completed");
    expect(disk.names()).toEqual(["Notes.txt"]);
    expect(disk.calls).toContain("rename:/trip/notes.txt->/trip/Notes.txt");
  });

  it("tells two items apart on a disk that minds case, and swaps them", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/A"], true);
    const result = await run(
      disk,
      request([
        ["a", "A"],
        ["A", "a"],
      ]),
    );
    expect(result.completedItemCount).toBe(2);
    expect(disk.names()).toEqual(["A", "a"]);
    expect((await disk.lstat("/trip/A")).ino).toBe(10);
    // On a disk that minds case, "a" to "A" with another "A" there is a clash, not a case change.
    const clash = new MemoryDisk(["/trip/a", "/trip/A"], true);
    const numbered = await run(clash, request([["a", "A"]]));
    expect(numbered.items[0]?.destinationPath).toBe("/trip/A 2");
  });

  describe("a name found taken while renaming", () => {
    it("gets the first free number, before the extension or at the end of a folder's name", async () => {
      const disk = new MemoryDisk([
        "/trip/a.jpg",
        "/trip/Lisbon.jpg",
        "/trip/Lisbon 2.jpg",
        "/trip/folder",
        "/trip/Photos",
      ]);
      const result = await run(
        disk,
        request(
          [
            ["a.jpg", "Lisbon.jpg"],
            ["folder", "Photos"],
          ],
          { folders: ["folder"] },
        ),
      );
      expect(result.items.map((item) => item.destinationPath)).toEqual([
        "/trip/Lisbon 3.jpg",
        "/trip/Photos 2",
      ]);
      const dashed = new MemoryDisk(["/trip/a.jpg", "/trip/Lisbon.jpg"]);
      const withDash = await run(
        dashed,
        request([["a.jpg", "Lisbon.jpg"]], { numberSeparator: "-" }),
      );
      expect(withDash.items[0]?.destinationPath).toBe("/trip/Lisbon-2.jpg");
    });

    it("leaves the item as it is with Skip", async () => {
      const disk = new MemoryDisk(["/trip/a.jpg", "/trip/b.jpg", "/trip/Lisbon.jpg"]);
      const result = await run(
        disk,
        request(
          [
            ["a.jpg", "Lisbon.jpg"],
            ["b.jpg", "Lisbon 1.jpg"],
          ],
          { onConflict: "skip" },
        ),
      );
      expect(result.items.map((item) => item.status)).toEqual(["skipped", "completed"]);
      // A skipped item is still where it was: no new path for the window to follow.
      expect(result.items[0]).toMatchObject({
        destinationPath: null,
        error: "An item named “Lisbon.jpg” already exists.",
        skipReason: "runtime_conflict_resolution",
      });
      expect(disk.names()).toEqual(["Lisbon 1.jpg", "Lisbon.jpg", "a.jpg"]);
    });

    it("fails the item with Don't Rename", async () => {
      const disk = new MemoryDisk(["/trip/a.jpg", "/trip/Lisbon.jpg"]);
      const result = await run(disk, request([["a.jpg", "Lisbon.jpg"]], { onConflict: "block" }));
      expect(result.items[0]).toMatchObject({
        status: "failed",
        error: "An item named “Lisbon.jpg” already exists.",
      });
      expect(disk.names()).toEqual(["Lisbon.jpg", "a.jpg"]);
    });

    it("puts an item moved aside back under its old name when it can't take its new one", async () => {
      // "b" moves aside for "c", finds "c" taken outside the batch, and goes back to "b".
      const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/c"]);
      const result = await run(
        disk,
        request(
          [
            ["b", "c"],
            ["a", "b"],
          ],
          { onConflict: "skip" },
        ),
      );
      expect(result.items.map((item) => item.status)).toEqual(["skipped", "skipped"]);
      expect(disk.names()).toEqual(["a", "b", "c"]);
    });

    it("gives an item its old name with a number when another item took it meanwhile", async () => {
      // "b" moves aside for "a", which takes "b"; then "b" can't become "c" (taken), and
      // its old name is "a"'s now.
      const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/c"]);
      const result = await run(
        disk,
        request(
          [
            ["a", "b"],
            ["b", "c"],
          ],
          { onConflict: "skip" },
        ),
      );
      expect(result.items.map((item) => item.status)).toEqual(["completed", "failed"]);
      expect(result.items[1]).toMatchObject({ destinationPath: "/trip/b 2" });
      expect(result.items[1]?.error).toBe(
        "An item named “c” already exists. Another item has its old name now, so it is named “b 2”.",
      );
      expect(disk.names()).toEqual(["b", "b 2", "c"]);
    });
  });

  it("says where an item is when not even a numbered old name can be given back", async () => {
    // Both move aside; "b" takes "a"; "a" can't take "b" (no permission), and can't go back
    // under "a" ("b" has it) or "a 2" (no permission either): it stays hidden, and says so.
    const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
    disk.failures.set("renameExclusive:/trip/.tmp-1->/trip/b", errno("EACCES"));
    disk.failures.set("renameExclusive:/trip/.tmp-1->/trip/a 2", errno("EACCES"));
    const result = await run(
      disk,
      request([
        ["b", "a"],
        ["a", "b"],
      ]),
    );
    expect(result.items[0]?.status).toBe("completed");
    expect(result.items[1]).toMatchObject({ status: "failed", destinationPath: "/trip/.tmp-1" });
    expect(result.items[1]?.error).toBe(
      "You don't have permission to access this item. Another item has its old name now, so it is named “.tmp-1” (hidden).",
    );
    expect(disk.names()).toEqual([".tmp-1", "a"]);
  });

  it("fails an item that couldn't move aside, and the item wanting its name finds it taken", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
    disk.failures.set("renameExclusive:/trip/b->/trip/.tmp-0", errno("EACCES"));
    const result = await run(
      disk,
      request([
        ["a", "b"],
        ["b", "c"],
      ]),
    );
    expect(result.items[1]).toMatchObject({
      status: "failed",
      error: "You don't have permission to access this item.",
    });
    // "b" stayed, so "a" got the next free name.
    expect(result.items[0]).toMatchObject({ status: "completed", destinationPath: "/trip/b 2" });
    expect(disk.names()).toEqual(["b", "b 2"]);
  });

  it("tries another temporary name when one is taken", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/.tmp-0"]);
    const result = await run(
      disk,
      request([
        ["a", "b"],
        ["b", "a"],
      ]),
    );
    expect(result.completedItemCount).toBe(2);
    expect(disk.names()).toEqual([".tmp-0", "a", "b"]);
  });

  it("puts a waiting item back when its rename fails for another reason", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
    disk.failures.set("renameExclusive:/trip/.tmp-0->/trip/c", errno("EIO"));
    const result = await run(
      disk,
      request([
        ["b", "c"],
        ["a", "b"],
      ]),
    );
    // "b" moved aside, failed to become "c", and is back as "b"; "a" then found "b" taken.
    // Still where it was: no new path.
    expect(result.items[0]).toMatchObject({ status: "failed", destinationPath: null });
    expect(result.items[1]).toMatchObject({ status: "completed", destinationPath: "/trip/b 2" });
    expect(disk.names()).toEqual(["b", "b 2"]);
  });

  it("names a missing item and a locked one", async () => {
    const disk = new MemoryDisk(["/trip/locked.txt"]);
    disk.lockedPaths.add("/trip/locked.txt");
    disk.failures.set("renameExclusive:/trip/locked.txt->/trip/new.txt", errno("EPERM"));
    const result = await run(
      disk,
      request([
        ["gone.txt", "x.txt"],
        ["locked.txt", "new.txt"],
      ]),
    );
    expect(result.items.map((item) => item.error)).toEqual([
      "“gone.txt” no longer exists.",
      "“locked.txt” is locked. Unlock it in Finder's Get Info and try again.",
    ]);
    expect(result.completedItemCount).toBe(0);
  });

  it("reports a failed change of case, and changes the case of a name not there yet", async () => {
    const failing = new MemoryDisk(["/trip/notes.txt"]);
    failing.failures.set("rename:/trip/notes.txt->/trip/Notes.txt", errno("EIO"));
    const result = await run(failing, request([["notes.txt", "Notes.txt"]]));
    expect(result.items[0]).toMatchObject({ status: "failed", destinationPath: null });
    expect(failing.names()).toEqual(["notes.txt"]);
    // A disk that minds case finds no "A" for "a": an ordinary rename.
    const sensitive = new MemoryDisk(["/trip/a"], true);
    await run(sensitive, request([["a", "A"]]));
    expect(sensitive.names()).toEqual(["A"]);
    expect(sensitive.calls).toContain("renameExclusive:/trip/a->/trip/A");
  });

  it("decides a change of case without a folder listing, or with one that can't be read", async () => {
    const noListing = new MemoryDisk(["/trip/notes.txt"]);
    Object.assign(noListing, { readdir: undefined });
    await run(noListing, request([["notes.txt", "NOTES.txt"]]));
    expect(noListing.names()).toEqual(["NOTES.txt"]);
    const unreadable = new MemoryDisk(["/trip/notes.txt"]);
    unreadable.readdir = async () => Promise.reject(errno("EACCES"));
    await run(unreadable, request([["notes.txt", "Notes.txt"]]));
    expect(unreadable.names()).toEqual(["Notes.txt"]);
  });

  it("gives up moving an item aside when every temporary name is taken", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/.taken"]);
    const result = await runBatchRename({
      request: request([
        ["a", "b"],
        ["b", "a"],
      ]),
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: () => ".taken",
    });
    // Neither could move aside, so each failed there, and both keep their names.
    expect(result.items.map((item) => item.status)).toEqual(["failed", "failed"]);
    expect(result.items[0]?.error).toBe("An item named “b” already exists.");
    expect(disk.names()).toEqual([".taken", "a", "b"]);
  });

  it("describes an error without a code as a plain failure", async () => {
    const disk = new MemoryDisk(["/trip/a"]);
    disk.failures.set("renameExclusive:/trip/a->/trip/b", new Error("strange"));
    const result = await run(disk, request([["a", "b"]]));
    expect(result.items[0]).toMatchObject({ status: "failed" });
    expect(result.items[0]?.error).not.toBe("");
  });

  it("gives up numbering after many tries", async () => {
    const files = ["/trip/a", "/trip/b"];
    for (let number = 2; number <= 10_001; number += 1) {
      files.push(`/trip/b ${number}`);
    }
    const disk = new MemoryDisk(files);
    const result = await run(disk, request([["a", "b"]]));
    expect(result.items[0]).toMatchObject({ status: "failed" });
  });

  it("goes on when saying how far it got fails", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
    const result = await run(
      disk,
      request([
        ["a", "b"],
        ["b", "a"],
      ]),
      {
        onItemStart: () => {
          throw new Error("The window is gone.");
        },
      },
    );
    expect(result.completedItemCount).toBe(2);
    expect(disk.names()).toEqual(["a", "b"]);
  });

  describe("a folder and items inside it", () => {
    it("renames the items inside first, and says where they are under the folder's new name", async () => {
      const disk = new MemoryDisk(["/trip/sub", "/trip/sub/x.jpg", "/trip/sub/deeper/z.jpg"]);
      const started: string[] = [];
      const result = await run(
        disk,
        request(
          [
            ["sub", "Day 1"],
            ["sub/x.jpg", "y.jpg"],
            ["sub/deeper/z.jpg", "w.jpg"],
          ],
          { folders: ["sub"] },
        ),
        { onItemStart: (item) => started.push(item.sourcePath) },
      );
      expect(started).toEqual(["/trip/sub/deeper/z.jpg", "/trip/sub/x.jpg", "/trip/sub"]);
      expect(disk.names()).toEqual(["Day 1"]);
      expect(disk.names("/trip/Day 1")).toEqual(["y.jpg"]);
      expect(disk.names("/trip/Day 1/deeper")).toEqual(["w.jpg"]);
      // Results stay in the order asked for.
      expect(result.items.map((item) => [item.sourcePath, item.destinationPath])).toEqual([
        ["/trip/sub", "/trip/Day 1"],
        ["/trip/sub/x.jpg", "/trip/Day 1/y.jpg"],
        ["/trip/sub/deeper/z.jpg", "/trip/Day 1/deeper/w.jpg"],
      ]);
      expect(result.completedItemCount).toBe(3);
    });

    it("still renames the folder when an item inside it fails, and says where that item is", async () => {
      const disk = new MemoryDisk(["/trip/sub", "/trip/sub/x.jpg"]);
      disk.failures.set("renameExclusive:/trip/sub/x.jpg->/trip/sub/y.jpg", errno("EACCES"));
      const result = await run(
        disk,
        request(
          [
            ["sub", "Day 1"],
            ["sub/x.jpg", "y.jpg"],
          ],
          { folders: ["sub"] },
        ),
      );
      expect(result.items.map((item) => [item.status, item.destinationPath])).toEqual([
        ["completed", "/trip/Day 1"],
        // Not renamed, but in the folder's new name.
        ["failed", "/trip/Day 1/x.jpg"],
      ]);
      expect(disk.names("/trip/Day 1")).toEqual(["x.jpg"]);
    });

    it("leaves the folder alone when stopped while the item inside is renamed", async () => {
      const disk = new MemoryDisk(["/trip/sub", "/trip/sub/x.jpg"]);
      const controller = new AbortController();
      const result = await run(
        disk,
        request(
          [
            ["sub", "Day 1"],
            ["sub/x.jpg", "y.jpg"],
          ],
          { folders: ["sub"] },
        ),
        { signal: controller.signal, onItemStart: () => controller.abort() },
      );
      expect(result.cancelled).toBe(true);
      expect(result.items.map((item) => [item.status, item.destinationPath])).toEqual([
        ["cancelled", null],
        ["completed", "/trip/sub/y.jpg"],
      ]);
      expect(disk.names()).toEqual(["sub"]);
    });

    it("swaps names inside a folder that is renamed too", async () => {
      const disk = new MemoryDisk(["/trip/sub", "/trip/sub/a", "/trip/sub/b"]);
      const result = await run(
        disk,
        request(
          [
            ["sub", "Day 1"],
            ["sub/a", "b"],
            ["sub/b", "a"],
          ],
          { folders: ["sub"] },
        ),
      );
      expect(result.completedItemCount).toBe(3);
      expect(disk.names("/trip/Day 1")).toEqual(["a", "b"]);
      expect(result.items.map((item) => item.destinationPath)).toEqual([
        "/trip/Day 1",
        "/trip/Day 1/b",
        "/trip/Day 1/a",
      ]);
    });
  });

  describe("stopping", () => {
    it("renames nothing when stopped before it starts", async () => {
      const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
      const controller = new AbortController();
      controller.abort();
      const result = await run(
        disk,
        request([
          ["a", "b"],
          ["b", "a"],
        ]),
        { signal: controller.signal },
      );
      expect(result.cancelled).toBe(true);
      expect(result.items.map((item) => item.status)).toEqual(["cancelled", "cancelled"]);
      expect(disk.names()).toEqual(["a", "b"]);
    });

    it("stops after the item under way and puts the waiting ones back", async () => {
      const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/c"]);
      const controller = new AbortController();
      const result = await run(
        disk,
        request([
          ["a", "b"],
          ["b", "x"],
          ["c", "y"],
        ]),
        {
          signal: controller.signal,
          onItemStart: (_item, done) => {
            if (done === 0) {
              controller.abort();
            }
          },
        },
      );
      // "b" was moved aside for "a"; the stop came as "a" started, so "a" still went, and
      // "b", whose name "a" took, finishes its swap. "c" never starts.
      expect(result.items.map((item) => item.status)).toEqual([
        "completed",
        "completed",
        "cancelled",
      ]);
      expect(disk.names()).toEqual(["b", "c", "x"]);
      expect(result.cancelled).toBe(true);
      expect(result.completedItemCount).toBe(2);
    });

    it("isn't stopped by a stop that comes as the last item finishes", async () => {
      const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
      const controller = new AbortController();
      const original = disk.renameExclusive;
      disk.renameExclusive = async (from, to) => {
        await original(from, to);
        if (to === "/trip/y") {
          controller.abort();
        }
      };
      const result = await run(
        disk,
        request([
          ["a", "x"],
          ["b", "y"],
        ]),
        { signal: controller.signal },
      );
      expect(result.cancelled).toBe(false);
      expect(result.completedItemCount).toBe(2);
      expect(disk.names()).toEqual(["x", "y"]);
    });

    // A deeper folder's item was renamed already; at this depth the stop comes after "a1"
    // moved aside but before "b1" did. "a1" can't finish its swap: "b1" still has the name.
    it("puts a depth back as it was when stopped before all its items moved aside", async () => {
      const disk = new MemoryDisk(["/trip/A/x", "/trip/a1", "/trip/b1"]);
      const controller = new AbortController();
      const original = disk.renameExclusive;
      disk.renameExclusive = async (from, to) => {
        await original(from, to);
        if (from === "/trip/a1") {
          controller.abort();
        }
      };
      const result = await run(
        disk,
        request([
          ["A/x", "y"],
          ["a1", "b1"],
          ["b1", "a1"],
        ]),
        { signal: controller.signal },
      );
      expect(disk.names("/trip/A")).toEqual(["y"]);
      expect(disk.names()).toEqual(["a1", "b1"]);
      expect(result.items.map((item) => item.status)).toEqual([
        "completed",
        "cancelled",
        "cancelled",
      ]);
    });

    // "b" couldn't be moved aside for "a": a stop after "z" was renamed doesn't let "a"
    // finish into a name "b" still has.
    it("puts a depth back when one of its items couldn't be moved aside", async () => {
      const disk = new MemoryDisk(["/trip/z", "/trip/a", "/trip/b"]);
      const controller = new AbortController();
      const original = disk.renameExclusive;
      disk.renameExclusive = async (from, to) => {
        if (from === "/trip/b" && to.startsWith("/trip/.tmp-")) {
          throw errno("EACCES");
        }
        await original(from, to);
        if (to === "/trip/zz") {
          controller.abort();
        }
      };
      const result = await run(
        disk,
        request([
          ["z", "zz"],
          ["a", "b"],
          ["b", "a"],
        ]),
        { signal: controller.signal },
      );
      expect(disk.names()).toEqual(["a", "b", "zz"]);
      expect(result.cancelled).toBe(true);
    });

    it("puts back what was moved aside when stopped while moving items aside", async () => {
      const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
      const controller = new AbortController();
      const original = disk.renameExclusive;
      disk.renameExclusive = async (from, to) => {
        await original(from, to);
        controller.abort();
      };
      const result = await run(
        disk,
        request([
          ["a", "b"],
          ["b", "a"],
        ]),
        { signal: controller.signal },
      );
      expect(result.cancelled).toBe(true);
      expect(result.completedItemCount).toBe(0);
      expect(disk.names()).toEqual(["a", "b"]);
    });
  });
});

describe("writing down the items moved aside", () => {
  it("writes them down before any moves, once for each folder depth, and lets go after", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/c"]);
    const added: WriteJournalEntry[] = [];
    const live = new Map<string, WriteJournalEntry>();
    const journal = {
      add: async (entry: WriteJournalEntry) => {
        added.push(structuredClone(entry));
        // Written down before the first item moves aside.
        expect(disk.names()).toEqual(["a", "b", "c"]);
        live.set(entry.id, entry);
      },
      remove: async (id: string) => {
        live.delete(id);
      },
    };

    await runBatchRename({
      request: request([
        ["a", "b"],
        ["b", "a"],
        ["c", "d"],
      ]),
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: counter(),
      journal,
    });

    expect(added).toEqual([
      {
        kind: "batch_rename",
        id: expect.any(String),
        items: [
          { temporaryPath: "/trip/.tmp-0", originalPath: "/trip/a", newPath: "/trip/b" },
          { temporaryPath: "/trip/.tmp-1", originalPath: "/trip/b", newPath: "/trip/a" },
        ],
      },
    ]);
    expect(live.size).toBe(0);
    expect(disk.names()).toEqual(["a", "b", "d"]);
  });

  it("writes down another hidden name before moving there when the first is taken", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b", "/trip/.tmp-0"]);
    const added: WriteJournalEntry[] = [];
    await runBatchRename({
      request: request([
        ["a", "b"],
        ["b", "a"],
      ]),
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: counter(),
      journal: {
        add: async (entry) => {
          added.push(structuredClone(entry));
        },
        remove: async () => undefined,
      },
    });
    expect(
      added.map((entry) =>
        entry.kind === "batch_rename" ? entry.items.map((item) => item.temporaryPath) : [],
      ),
    ).toEqual([
      ["/trip/.tmp-0", "/trip/.tmp-1"],
      ["/trip/.tmp-2", "/trip/.tmp-1"],
    ]);
    expect(disk.names()).toEqual([".tmp-0", "a", "b"]);
  });

  // An item that could go back nowhere stays under its hidden name: it stays written down.
  it("keeps written down an item left under its hidden name", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
    disk.failures.set("renameExclusive:/trip/.tmp-0->/trip/b", errno("EACCES"));
    disk.failures.set("renameExclusive:/trip/.tmp-0->/trip/a", errno("EACCES"));
    const live = new Map<string, WriteJournalEntry>();
    await runBatchRename({
      request: request([
        ["a", "b"],
        ["b", "a"],
      ]),
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: counter(),
      journal: {
        add: async (entry) => {
          live.set(entry.id, structuredClone(entry));
        },
        remove: async (id) => {
          live.delete(id);
        },
      },
    });
    expect([...live.values()]).toEqual([
      {
        kind: "batch_rename",
        id: expect.any(String),
        items: [{ temporaryPath: "/trip/.tmp-0", originalPath: "/trip/a", newPath: "/trip/b" }],
      },
    ]);
  });

  // "a" is stuck under its hidden name in "P": "P" isn't renamed, so the next start finds
  // it where it is written down.
  it("doesn't rename the folder of an item left hidden", async () => {
    const disk = new MemoryDisk(["/trip/P", "/trip/P/a", "/trip/P/b"]);
    disk.failures.set("renameExclusive:/trip/P/.tmp-0->/trip/P/b", errno("EACCES"));
    disk.failures.set("renameExclusive:/trip/P/.tmp-0->/trip/P/a", errno("EACCES"));
    const live = new Map<string, WriteJournalEntry>();
    const result = await runBatchRename({
      request: request(
        [
          ["P/a", "b"],
          ["P/b", "a"],
          ["P", "Q"],
        ],
        { folders: ["P"] },
      ),
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: counter(),
      journal: {
        add: async (entry) => {
          live.set(entry.id, structuredClone(entry));
        },
        remove: async (id) => {
          live.delete(id);
        },
      },
    });
    expect(disk.names("/trip")).toEqual(["P"]);
    expect(result.items[2]?.error).toBe(
      "“P” wasn't renamed because an item in it is still under a hidden name.",
    );
    expect([...live.values()]).toEqual([
      {
        kind: "batch_rename",
        id: expect.any(String),
        items: [
          { temporaryPath: "/trip/P/.tmp-0", originalPath: "/trip/P/a", newPath: "/trip/P/b" },
        ],
      },
    ]);
  });

  it("renames nothing of a depth whose items can't be written down", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/b"]);
    const result = await runBatchRename({
      request: request([
        ["a", "b"],
        ["b", "a"],
      ]),
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: counter(),
      journal: {
        add: async () => {
          throw errno("ENOSPC");
        },
        remove: async () => undefined,
      },
    });
    expect(disk.names()).toEqual(["a", "b"]);
    expect(result.items.map((item) => item.status)).toEqual(["failed", "failed"]);
    expect(result.items[0]?.error).toMatch(
      /^It wasn't renamed, as File Trail couldn't write down what it was about to do\./u,
    );
  });
});

describe("putting back what a crash left under hidden names", () => {
  const hidden = (name: string) => `/trip/.filetrail-rename-${name.repeat(12).slice(0, 12)}`;

  it("puts each item under its old name, else its new one, else its old one numbered", async () => {
    const disk = new MemoryDisk([
      hidden("a"),
      hidden("b"),
      hidden("c"),
      "/trip/x.txt",
      "/trip/y.txt",
      "/trip/z.txt",
      "/trip/w.txt",
    ]);
    const recovery = await recoverBatchRename(
      {
        kind: "batch_rename",
        id: "1",
        items: [
          // Free: back under its old name.
          { temporaryPath: hidden("a"), originalPath: "/trip/p.txt", newPath: "/trip/x.txt" },
          // Old name taken: its new one.
          { temporaryPath: hidden("b"), originalPath: "/trip/x.txt", newPath: "/trip/q.txt" },
          // Both taken: its old name numbered.
          { temporaryPath: hidden("c"), originalPath: "/trip/y.txt", newPath: "/trip/z.txt" },
          // Took its name before the crash.
          { temporaryPath: hidden("d"), originalPath: "/trip/v.txt", newPath: "/trip/w.txt" },
          // Not a name this app gives: left alone.
          { temporaryPath: "/trip/x.txt", originalPath: "/trip/r.txt", newPath: "/trip/s.txt" },
        ],
      },
      { ...disk, lstat: withFolders(disk, ["/trip"]) },
    );
    expect(recovery).toEqual({
      restored: [
        { originalPath: "/trip/p.txt", path: "/trip/p.txt" },
        { originalPath: "/trip/x.txt", path: "/trip/q.txt" },
        { originalPath: "/trip/y.txt", path: "/trip/y 2.txt" },
      ],
      remaining: [],
    });
    expect(disk.names()).toEqual(["p.txt", "q.txt", "w.txt", "x.txt", "y 2.txt", "y.txt", "z.txt"]);
  });

  it("keeps written down what can't be reached or moved", async () => {
    const disk = new MemoryDisk([hidden("a")]);
    disk.failures.set(`renameExclusive:${hidden("a")}->/trip/p.txt`, errno("EACCES"));
    const away = {
      temporaryPath: "/gone/.filetrail-rename-bbbbbbbbbbbb",
      originalPath: "/gone/q",
      newPath: "/gone/r",
    };
    const stuck = {
      temporaryPath: hidden("a"),
      originalPath: "/trip/p.txt",
      newPath: "/trip/o.txt",
    };
    const recovery = await recoverBatchRename(
      { kind: "batch_rename", id: "1", items: [stuck, away] },
      { ...disk, lstat: withFolders(disk, ["/trip"]) },
    );
    expect(recovery).toEqual({ restored: [], remaining: [stuck, away] });
  });
});

// The disk's lstat, which also finds `folders` (as folders).
function withFolders(disk: MemoryDisk, folders: string[]): MemoryDisk["lstat"] {
  return async (path) =>
    folders.includes(path) ? { isDirectory: () => true, dev: 1, ino: 1 } : disk.lstat(path);
}

describe("numbered names", () => {
  it("puts the number before the extension, and at the end of a folder's name", () => {
    expect(numberedName("Lisbon.jpg", false, " ", 2)).toBe("Lisbon 2.jpg");
    expect(numberedName("archive.tar.gz", false, "_", 3)).toBe("archive.tar_3.gz");
    expect(numberedName("photos.2026", true, " ", 2)).toBe("photos.2026 2");
    expect(numberedName(".env", false, "-", 2)).toBe(".env-2");
  });

  it("shortens a name the number would make too long, never cutting a letter from its accent", () => {
    const long = `${"a".repeat(251)}.jpg`;
    expect(numberedName(long, false, " ", 2)).toBe(`${"a".repeat(249)} 2.jpg`);
    // "é" written as "e" and an accent is three bytes; it goes whole or not at all.
    const accented = `${"a".repeat(248)}e\u0301.jpg`;
    expect(numberedName(accented, false, " ", 2)).toBe(`${"a".repeat(248)} 2.jpg`);
    // Spaces left at the cut go too.
    expect(numberedName(`${"a".repeat(246)}  b.jpg`, false, " ", 12)).toBe(
      `${"a".repeat(246)} 12.jpg`,
    );
  });

  it("numbers a name taken at the last moment within the length a name can have", async () => {
    const long = `${"a".repeat(251)}.jpg`;
    const disk = new MemoryDisk(["/trip/x.jpg"]);
    // Taken after the sheet checked, so the main process numbers it.
    disk.add(`/trip/${long}`);
    const result = await run(disk, request([["x.jpg", long]]));
    expect(result.items[0]).toMatchObject({
      status: "completed",
      destinationPath: `/trip/${"a".repeat(249)} 2.jpg`,
    });
  });
});
