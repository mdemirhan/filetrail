import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IpcRequest, WriteOperationProgressEvent } from "@filetrail/contracts";
import type { WriteService } from "@filetrail/core";
import { canMountDiskImages, mountTestDiskImage } from "@filetrail/core/fs/testDiskImage";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { type WriteOperationFs, createWriteOperationCoordinator } from "./writeOperations";

// Renaming several items through the write coordinator: what it checks before starting,
// what it reports, and what happens on a real disk.

function createWriteServiceStub(): WriteService {
  return {
    subscribe: vi.fn(() => () => undefined),
    cancelOperation: vi.fn(() => ({ ok: true })),
  } as unknown as WriteService;
}

function realFs(overrides: Partial<WriteOperationFs> = {}): WriteOperationFs {
  return { ...createOriginalWriteOperationFs(vi.fn(async () => undefined)), ...overrides };
}

function createSender() {
  return { send: vi.fn<(channel: string, payload: unknown) => void>() };
}

function events(sender: ReturnType<typeof createSender>): WriteOperationProgressEvent[] {
  return sender.send.mock.calls.map(([, payload]) => payload as WriteOperationProgressEvent);
}

async function waitForTerminalEvent(
  sender: ReturnType<typeof createSender>,
  operationId: string,
): Promise<WriteOperationProgressEvent> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const terminal = events(sender).find(
      (event) =>
        event.operationId === operationId &&
        ["completed", "failed", "cancelled", "partial"].includes(event.status),
    );
    if (terminal) {
      return terminal;
    }
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the end of the operation.");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
}

function makeFolder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "filetrail-batch-rename-"));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, name), contents);
  }
  return root;
}

function request(
  root: string,
  pairs: Array<[string, string]>,
  options: Partial<Omit<IpcRequest<"writeOperation:batchRename">, "items">> = {},
): IpcRequest<"writeOperation:batchRename"> {
  return {
    items: pairs.map(([from, to]) => ({
      sourcePath: join(root, from),
      destinationName: to,
      isFolder: false,
    })),
    onConflict: options.onConflict ?? "number",
    numberSeparator: options.numberSeparator ?? " ",
  };
}

// Whether the temporary folders' disk ignores case, as a Mac's startup disk does unless set
// up otherwise.
const tmpIgnoresCase = (() => {
  const folder = mkdtempSync(join(tmpdir(), "filetrail-case-"));
  try {
    writeFileSync(join(folder, "a"), "");
    return existsSync(join(folder, "A"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
})();

function visibleNames(root: string): string[] {
  return readdirSync(root)
    .filter((name) => !name.startsWith("."))
    .sort();
}

async function rename(
  root: string,
  pairs: Array<[string, string]>,
  options: Partial<Omit<IpcRequest<"writeOperation:batchRename">, "items">> = {},
  fs: WriteOperationFs = realFs(),
) {
  const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
    homePath: "/Users/nobody-batch-rename",
  });
  const sender = createSender();
  try {
    const started = await coordinator.handlers["writeOperation:batchRename"](
      request(root, pairs, options),
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, started.operationId);
    return { terminal, sender };
  } finally {
    coordinator.shutdown();
  }
}

describe("renaming several items on a real disk", () => {
  it("renames them, reporting each and where it went", async () => {
    const root = makeFolder({ "IMG_1.jpg": "one", "IMG_2.jpg": "two", "notes.txt": "n" });
    const { terminal, sender } = await rename(root, [
      ["IMG_1.jpg", "Lisbon 1.jpg"],
      ["IMG_2.jpg", "Lisbon 2.jpg"],
    ]);
    expect(visibleNames(root)).toEqual(["Lisbon 1.jpg", "Lisbon 2.jpg", "notes.txt"]);
    expect(readFileSync(join(root, "Lisbon 2.jpg"), "utf8")).toBe("two");
    expect(terminal).toMatchObject({
      action: "batch_rename",
      status: "completed",
      completedItemCount: 2,
      totalItemCount: 2,
      result: {
        action: "batch_rename",
        targetPath: root,
        error: null,
        summary: { completedItemCount: 2, failedItemCount: 0, topLevelItemCount: 2 },
      },
    });
    expect(terminal.result?.items.map((item) => item.destinationPath)).toEqual([
      join(root, "Lisbon 1.jpg"),
      join(root, "Lisbon 2.jpg"),
    ]);
    // Queued at once; the progress in between is sent at most every 100 ms, so a quick
    // rename may finish before any is.
    expect(events(sender)[0]).toMatchObject({ status: "queued", action: "batch_rename" });
  });

  it("swaps names and passes them around a cycle, keeping each file's contents", async () => {
    const root = makeFolder({ a: "A", b: "B", c: "C" });
    const { terminal } = await rename(root, [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ]);
    expect(terminal.status).toBe("completed");
    expect(readdirSync(root).sort()).toEqual(["a", "b", "c"]);
    expect(["a", "b", "c"].map((name) => readFileSync(join(root, name), "utf8"))).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("renames a folder and items inside it together, as search results can ask", async () => {
    const root = makeFolder({});
    mkdirSync(join(root, "day/inner"), { recursive: true });
    writeFileSync(join(root, "day/x.jpg"), "X");
    writeFileSync(join(root, "day/inner/z.jpg"), "Z");
    const { terminal } = await rename(root, [
      ["day", "Lisbon"],
      ["day/x.jpg", "Lisbon 1.jpg"],
      ["day/inner/z.jpg", "Lisbon 2.jpg"],
    ]);
    expect(terminal.status).toBe("completed");
    expect(visibleNames(root)).toEqual(["Lisbon"]);
    expect(readFileSync(join(root, "Lisbon/Lisbon 1.jpg"), "utf8")).toBe("X");
    expect(readFileSync(join(root, "Lisbon/inner/Lisbon 2.jpg"), "utf8")).toBe("Z");
    expect(terminal.result?.items.map((item) => item.destinationPath)).toEqual([
      join(root, "Lisbon"),
      join(root, "Lisbon/Lisbon 1.jpg"),
      join(root, "Lisbon/inner/Lisbon 2.jpg"),
    ]);
  });

  // On a disk that minds case, "Notes.txt" is simply another name: a test below covers it.
  it.runIf(tmpIgnoresCase)(
    "changes only the case of names, and how an accented letter is written",
    async () => {
      const decomposed = "cafe\u0301.txt";
      const composed = "caf\u00e9.txt";
      const root = makeFolder({ "notes.txt": "n", [decomposed]: "c" });
      const { terminal } = await rename(root, [
        ["notes.txt", "Notes.txt"],
        [decomposed, composed],
      ]);
      expect(terminal.status).toBe("completed");
      // Spelled exactly as asked: APFS keeps the form a name is written in.
      expect(readdirSync(root).sort()).toEqual(["Notes.txt", composed]);
      expect(readFileSync(join(root, composed), "utf8")).toBe("c");
    },
  );

  it("finishes a swap under way when the app quits, leaving nothing under a hidden name", async () => {
    const root = makeFolder({ a: "A", b: "B" });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    let heldOnce = false;
    const fs = realFs({
      // The first rename to a new name waits, with both items under hidden names.
      renameExclusive: async (from, to) => {
        if (!heldOnce && !to.includes(".filetrail-rename-")) {
          heldOnce = true;
          await held;
        }
        return realFs().renameExclusive(from, to);
      },
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/nobody-batch-rename",
    });
    const sender = createSender();
    const started = await coordinator.handlers["writeOperation:batchRename"](
      request(root, [
        ["a", "b"],
        ["b", "a"],
      ]),
      { sender },
    );
    while (!heldOnce) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1));
    }
    const quitting = coordinator.shutdown();
    release();
    await quitting;
    const terminal = await waitForTerminalEvent(sender, started.operationId);
    expect(terminal.result?.items.map((item) => item.status)).toEqual(["completed", "completed"]);
    expect(readdirSync(root).sort()).toEqual(["a", "b"]);
    expect(readFileSync(join(root, "a"), "utf8")).toBe("B");
  });

  it("handles a name taken since the sheet checked it as the setting says", async () => {
    const numbered = makeFolder({ "a.txt": "a", "taken.txt": "t" });
    const first = await rename(numbered, [["a.txt", "taken.txt"]]);
    expect(first.terminal.result?.items[0]?.destinationPath).toBe(join(numbered, "taken 2.txt"));
    expect(readFileSync(join(numbered, "taken.txt"), "utf8")).toBe("t");

    const skipped = makeFolder({ "a.txt": "a", "taken.txt": "t" });
    const second = await rename(skipped, [["a.txt", "taken.txt"]], { onConflict: "skip" });
    expect(second.terminal.result?.items[0]?.status).toBe("skipped");
    expect(visibleNames(skipped)).toEqual(["a.txt", "taken.txt"]);

    const held = makeFolder({ "a.txt": "a", "taken.txt": "t" });
    const third = await rename(held, [["a.txt", "taken.txt"]], { onConflict: "block" });
    expect(third.terminal).toMatchObject({
      status: "failed",
      result: { error: "An item named “taken.txt” already exists." },
    });
  });

  it("goes on past a locked item and says it is locked", async () => {
    const root = makeFolder({ "locked.txt": "l", "free.txt": "f" });
    execFileSync("/usr/bin/chflags", ["uchg", join(root, "locked.txt")]);
    try {
      const { terminal } = await rename(root, [
        ["locked.txt", "a.txt"],
        ["free.txt", "b.txt"],
      ]);
      expect(terminal.status).toBe("partial");
      expect(terminal.result?.items.map((item) => item.status)).toEqual(["failed", "completed"]);
      expect(terminal.result?.items[0]?.error).toBe(
        "“locked.txt” is locked. Unlock it in Finder's Get Info and try again.",
      );
      expect(visibleNames(root)).toEqual(["b.txt", "locked.txt"]);
    } finally {
      execFileSync("/usr/bin/chflags", ["nouchg", join(root, "locked.txt")]);
    }
  });

  it("fails what can't be renamed in a folder that can't be written to", async () => {
    const root = makeFolder({});
    const folder = join(root, "read-only");
    mkdirSync(folder);
    writeFileSync(join(folder, "a.txt"), "a");
    chmodSync(folder, 0o555);
    try {
      const { terminal } = await rename(folder, [["a.txt", "b.txt"]]);
      expect(terminal.status).toBe("failed");
      expect(terminal.result?.items[0]?.error).toBe(
        "You don't have permission to access this item.",
      );
      expect(readdirSync(folder)).toEqual(["a.txt"]);
    } finally {
      chmodSync(folder, 0o755);
    }
  });

  it.runIf(canMountDiskImages)(
    "swaps two items whose names differ only in case on a disk that minds case",
    async () => {
      const volume = mountTestDiskImage({ caseSensitive: true, name: "FTBatchCase" });
      try {
        writeFileSync(join(volume.mountPath, "a"), "lower");
        writeFileSync(join(volume.mountPath, "A"), "upper");
        const { terminal } = await rename(volume.mountPath, [
          ["a", "A"],
          ["A", "a"],
        ]);
        expect(terminal.status).toBe("completed");
        expect(readFileSync(join(volume.mountPath, "A"), "utf8")).toBe("lower");
        expect(readFileSync(join(volume.mountPath, "a"), "utf8")).toBe("upper");
        expect(visibleNames(volume.mountPath)).toEqual(["A", "a"]);
      } finally {
        volume.detach();
      }
    },
    60_000,
  );

  it.runIf(canMountDiskImages)(
    "numbers a name another link to the same file has, on a disk that minds case",
    async () => {
      const volume = mountTestDiskImage({ caseSensitive: true, name: "FTBatchLink" });
      try {
        writeFileSync(join(volume.mountPath, "h"), "one file");
        linkSync(join(volume.mountPath, "h"), join(volume.mountPath, "H"));
        const { terminal } = await rename(volume.mountPath, [["h", "H"]]);
        expect(terminal.status).toBe("completed");
        // "H" is the same file under another name, not "h" itself: it is kept.
        expect(visibleNames(volume.mountPath)).toEqual(["H", "H 2"]);
      } finally {
        volume.detach();
      }
    },
    60_000,
  );

  for (const format of ["MS-DOS FAT32", "ExFAT"] as const) {
    it.runIf(canMountDiskImages)(
      `swaps, chains and changes case on ${format}`,
      async () => {
        const volume = mountTestDiskImage({ format, name: "FTBATCH" });
        try {
          const at = (name: string) => join(volume.mountPath, name);
          for (const [name, contents] of [
            ["a.txt", "A"],
            ["b.txt", "B"],
            ["notes.txt", "N"],
            ["1.txt", "1"],
            ["2.txt", "2"],
          ] as const) {
            writeFileSync(at(name), contents);
          }
          const { terminal } = await rename(volume.mountPath, [
            ["a.txt", "b.txt"],
            ["b.txt", "a.txt"],
            ["notes.txt", "Notes.txt"],
            ["1.txt", "2.txt"],
            ["2.txt", "3.txt"],
          ]);
          expect(terminal.status).toBe("completed");
          expect(readFileSync(at("a.txt"), "utf8")).toBe("B");
          expect(readFileSync(at("b.txt"), "utf8")).toBe("A");
          expect(readFileSync(at("3.txt"), "utf8")).toBe("2");
          expect(visibleNames(volume.mountPath)).toEqual([
            "2.txt",
            "3.txt",
            "Notes.txt",
            "a.txt",
            "b.txt",
          ]);
          expect(readdirSync(volume.mountPath).some((name) => name.includes("filetrail"))).toBe(
            false,
          );
        } finally {
          volume.detach();
        }
      },
      60_000,
    );
  }
});

describe("what a rename of several items checks first", () => {
  async function refusal(
    payload: IpcRequest<"writeOperation:batchRename">,
    home = "/Users/nobody-batch-rename",
  ): Promise<string> {
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), realFs(), {
      homePath: home,
    });
    try {
      await coordinator.handlers["writeOperation:batchRename"](payload, { sender: createSender() });
      return "started";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      coordinator.shutdown();
    }
  }

  it("leaves out items that would keep their name, and refuses when none is left", async () => {
    const root = makeFolder({ "a.txt": "a" });
    expect(await refusal(request(root, [["a.txt", "a.txt"]]))).toBe("Nothing would be renamed.");
  });

  it("refuses an item listed twice", async () => {
    const root = makeFolder({ "a.txt": "a" });
    expect(
      await refusal(
        request(root, [
          ["a.txt", "b.txt"],
          ["a.txt", "c.txt"],
        ]),
      ),
    ).toBe("“a.txt” is in the list twice.");
  });

  it("refuses the Trash, the startup disk's folders and the home folder", async () => {
    const home = mkdtempSync(join(tmpdir(), "filetrail-batch-home-"));
    mkdirSync(join(home, ".Trash"));
    mkdirSync(join(home, "Documents"));
    expect(
      await refusal(
        {
          items: [{ sourcePath: join(home, ".Trash"), destinationName: "x", isFolder: true }],
          onConflict: "number",
          numberSeparator: " ",
        },
        home,
      ),
    ).toBe("The Trash folder is a protected system directory and cannot be modified.");
    expect(
      await refusal(
        {
          items: [{ sourcePath: join(home, "Documents"), destinationName: "x", isFolder: true }],
          onConflict: "number",
          numberSeparator: " ",
        },
        home,
      ),
    ).toBe("“Documents” can't be renamed.");
    expect(
      await refusal({
        items: [{ sourcePath: "/Applications", destinationName: "Apps", isFolder: true }],
        onConflict: "number",
        numberSeparator: " ",
      }),
    ).toBe("“Applications” can't be renamed.");
  });

  it("waits for no other write, and reports the kind of change while it runs", async () => {
    const root = makeFolder({ "a.txt": "a" });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    const fs = realFs({
      renameExclusive: async (from, to) => {
        await held;
        return realFs().renameExclusive(from, to);
      },
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/nobody-batch-rename",
    });
    const sender = createSender();
    try {
      const started = await coordinator.handlers["writeOperation:batchRename"](
        request(root, [["a.txt", "b.txt"]]),
        { sender },
      );
      expect(coordinator.getActiveOperation()).toMatchObject({ kind: "rename" });
      await expect(
        coordinator.handlers["writeOperation:batchRename"](request(root, [["a.txt", "c.txt"]]), {
          sender,
        }),
      ).rejects.toThrow("Another write operation is already running.");
      release();
      const terminal = await waitForTerminalEvent(sender, started.operationId);
      expect(terminal.status).toBe("completed");
    } finally {
      release();
      coordinator.shutdown();
    }
  });

  it("still ends, failing every item, when something unexpected goes wrong", async () => {
    const root = makeFolder({ "notes.txt": "n" });
    const { terminal } = await rename(
      root,
      [["notes.txt", "Notes.txt"]],
      {},
      realFs({
        lstat: (() => {
          throw new Error("Disk gone.");
        }) as WriteOperationFs["lstat"],
      }),
    );
    expect(terminal.status).toBe("failed");
    expect(terminal.result?.items[0]).toMatchObject({
      status: "failed",
      error: "The rename stopped unexpectedly: Disk gone.",
    });
  });

  it("stops when asked, leaving the rest as they were", async () => {
    const root = makeFolder({ "a.txt": "a", "b.txt": "b", "c.txt": "c" });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    const fs = realFs({
      renameExclusive: async (from, to) => {
        await held;
        return realFs().renameExclusive(from, to);
      },
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/nobody-batch-rename",
    });
    const sender = createSender();
    try {
      const started = await coordinator.handlers["writeOperation:batchRename"](
        request(root, [
          ["a.txt", "x.txt"],
          ["b.txt", "y.txt"],
          ["c.txt", "z.txt"],
        ]),
        { sender },
      );
      expect(
        coordinator.handlers["writeOperation:cancel"](
          { operationId: started.operationId },
          { sender },
        ),
      ).toEqual({ ok: true });
      release();
      const terminal = await waitForTerminalEvent(sender, started.operationId);
      expect(terminal.status).toBe("partial");
      expect(terminal.result?.error).toBe("Stopped after 1 item was renamed.");
      expect(visibleNames(root)).toEqual(["b.txt", "c.txt", "x.txt"]);
    } finally {
      release();
      coordinator.shutdown();
    }
  });
});
