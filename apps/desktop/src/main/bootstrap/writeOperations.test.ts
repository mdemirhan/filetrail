import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  type WriteOperationProgressEvent,
  writeOperationProgressEventSchema,
} from "@filetrail/contracts";
import { NO_TRASH_ERROR_CODE, type WriteService, createWriteService } from "@filetrail/core";

import { canMountDiskImages, mountTestDiskImage } from "@filetrail/core/fs/testDiskImage";
import {
  createOriginalWriteOperationFs,
  originalRename,
  originalRenameExclusive,
} from "../originalFileSystem";
import {
  createFolderSizeHandlers,
  getCachedResponse,
  getResponseCacheSizes,
  resetResponseCacheState,
} from "./responseCache";
import {
  PROGRESS_UPDATE_INTERVAL_MS,
  assertNotSystemLocation,
  createWriteOperationCoordinator,
} from "./writeOperations";

describe("createWriteOperationCoordinator", () => {
  it("renames a local item and emits progress", async () => {
    const sender = createSender();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await expect(
      coordinator.handlers["writeOperation:rename"](
        {
          sourcePath: "/Users/demo/source.txt",
          destinationName: "renamed.txt",
        },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(fs.renameExclusive).toHaveBeenCalledWith(
      "/Users/demo/source.txt",
      "/Users/demo/renamed.txt",
    );
    expect(fs.rename).not.toHaveBeenCalled();
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "rename",
        status: "completed",
        completedItemCount: 1,
        currentDestinationPath: "/Users/demo/renamed.txt",
      }),
    );
    coordinator.shutdown();
  });

  it("creates a folder only when the parent exists and the target is unused", async () => {
    const sender = createSender();
    const fs = createWriteOperationFs({
      stat: vi.fn(async () => createStats(true)),
      lstat: vi.fn(async () => {
        throw new Error("missing");
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        {
          parentDirectoryPath: "/Users/demo",
          folderName: "Projects",
        },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(fs.stat).toHaveBeenCalledWith("/Users/demo");
    expect(fs.mkdir).toHaveBeenCalledWith("/Users/demo/Projects");
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "new_folder",
        status: "completed",
        currentDestinationPath: "/Users/demo/Projects",
      }),
    );

    coordinator.shutdown();
  });

  it("moves items to the Trash, going on past an item that can't be moved", async () => {
    const trash = vi.fn(async (path: string) => {
      if (path.endsWith("b.txt")) {
        // What createTrashItem reports on a disk that may have no Trash.
        throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
      }
      return inTrash(path);
    });
    const sender = createSender();
    const fs = createWriteOperationFs({ trash });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await expect(
      coordinator.handlers["writeOperation:trash"](
        {
          paths: ["/Users/demo/a.txt", "/Users/demo/b.txt", "/Users/demo/c.txt"],
        },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    // c.txt still goes to the Trash after b.txt failed (it used to be marked as stopped).
    expect(trash.mock.calls.map(([path]) => path)).toEqual([
      "/Users/demo/a.txt",
      "/Users/demo/b.txt",
      "/Users/demo/c.txt",
    ]);
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "trash",
        status: "partial",
        completedItemCount: 2,
        result: expect.objectContaining({
          error: "“b.txt” couldn’t be moved to the Trash because its disk has no Trash.",
          items: [
            expect.objectContaining({ sourcePath: "/Users/demo/a.txt", status: "completed" }),
            expect.objectContaining({ sourcePath: "/Users/demo/b.txt", status: "failed" }),
            expect.objectContaining({ sourcePath: "/Users/demo/c.txt", status: "completed" }),
          ],
        }),
      }),
    );

    coordinator.shutdown();
  });

  it("takes what went to the Trash off measured folders, and forgets those it can't tell", async () => {
    const folderSizes = createFolderSizeHandlers({
      getFolderSize: vi.fn(async (path: string) =>
        JSON.stringify({
          total: path.endsWith("Project") ? 1_000 : 500,
          diskTotal: 2_000,
          fileCount: 10,
          folderCount: 0,
          dev: 16,
          dirs: {},
        }),
      ),
      cancelFolderSize: vi.fn(),
      homePath: "/Users/demo",
    });
    for (const path of ["/Users/demo/Project", "/Users/demo/Music"]) {
      folderSizes.start({ path });
      await new Promise((r) => setTimeout(r, 0));
    }
    const itemSize = vi.fn(async (path: string) => {
      if (path.endsWith("b.bin")) {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }
      return path === "/Users/demo"
        ? { kind: "folder" as const, sizeBytes: 0, diskBytes: 0, dev: 16 }
        : { kind: "file" as const, sizeBytes: 200, diskBytes: 400, dev: 16 };
    });
    const sender = createSender();
    const fs = createWriteOperationFs({ itemSize });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });

    await coordinator.handlers["writeOperation:trash"](
      { paths: ["/Users/demo/Project/a.bin", "/Users/demo/Music/b.bin"] },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    // Read just before it went, so the size known for Project is still exact.
    expect(folderSizes.getCachedSize("/Users/demo/Project")).toBe(800);
    // What b.bin added to Music couldn't be read: Music is measured again when asked for.
    expect(folderSizes.getCachedSize("/Users/demo/Music")).toBeUndefined();
    coordinator.shutdown();
  });

  it("delete-immediately reports partial completion while continuing after failed items", async () => {
    const sender = createSender();
    const fs = createWriteOperationFs({
      rm: vi.fn(async (path: string) => {
        if (path.endsWith("b.txt")) {
          throw new Error("delete denied");
        }
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });

    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        {
          paths: [
            "/Users/demo/.Trash/a.txt",
            "/Users/demo/.Trash/b.txt",
            "/Users/demo/.Trash/c.txt",
          ],
        },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(fs.rm).toHaveBeenCalledTimes(3);
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "delete_immediately",
        status: "partial",
        completedItemCount: 2,
        result: expect.objectContaining({
          error: "delete denied",
        }),
      }),
    );

    coordinator.shutdown();
  });

  it("rejects protected top-level Trash mutations before queuing local writes", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );
    const trashPath = resolve(homedir(), ".Trash");

    await expect(
      coordinator.handlers["writeOperation:rename"](
        {
          sourcePath: trashPath,
          destinationName: "Renamed Trash",
        },
        { sender: createSender() },
      ),
    ).rejects.toThrow("protected system directory");
    await expect(
      coordinator.handlers["writeOperation:trash"](
        { paths: [trashPath] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("protected system directory");
    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: [trashPath] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("protected system directory");

    coordinator.shutdown();
  });

  it("holds the busy lock while local write operations are in flight and releases it on terminal events", async () => {
    let finishRename: (() => void) | null = null;
    const sender = createSender();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
      renameExclusive: vi.fn(
        () =>
          new Promise<void>((resolveRename) => {
            finishRename = resolveRename;
          }),
      ),
      stat: vi.fn(async () => createStats(true)),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await coordinator.handlers["writeOperation:rename"](
      {
        sourcePath: "/Users/demo/source.txt",
        destinationName: "renamed.txt",
      },
      { sender },
    );
    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        {
          parentDirectoryPath: "/Users/demo",
          folderName: "Blocked",
        },
        { sender: createSender() },
      ),
    ).rejects.toThrow("Another write operation is already running.");

    (finishRename as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");
    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        {
          parentDirectoryPath: "/Users/demo",
          folderName: "Allowed",
        },
        { sender: createSender() },
      ),
    ).resolves.toEqual({ operationId: "write-op-2", status: "queued" });

    coordinator.shutdown();
  });

  it("routes local and delegated cancellation requests to the correct operation owner", async () => {
    let finishRename: (() => void) | null = null;
    const sender = createSender();
    const writeService = createWriteServiceStub();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
      renameExclusive: vi.fn(
        () =>
          new Promise<void>((resolveRename) => {
            finishRename = resolveRename;
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(writeService, fs);

    await coordinator.handlers["writeOperation:rename"](
      {
        sourcePath: "/Users/demo/source.txt",
        destinationName: "renamed.txt",
      },
      { sender },
    );

    expect(
      coordinator.handlers["writeOperation:cancel"]({ operationId: "write-op-1" }, { sender }),
    ).toEqual({
      ok: true,
    });
    expect(writeService.cancelOperation).not.toHaveBeenCalledWith("write-op-1");

    (finishRename as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");

    analyze(coordinator, sender);
    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );
    expect(
      coordinator.handlers["writeOperation:cancel"]({ operationId: "copy-op-1" }, { sender }),
    ).toEqual({
      ok: true,
    });
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    coordinator.shutdown();
  });

  it("cancels a paste whose window crashed or closed, so writes don't stay locked", () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = Object.assign(new EventEmitter(), { send: vi.fn() });

    analyze(coordinator, sender);
    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );
    sender.emit("render-process-gone");

    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    coordinator.shutdown();
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  describe("with several windows", () => {
    it("tells every other window how the operation is doing", () => {
      const { writeService, emit } = createSubscribingWriteService();
      const broadcastProgress = vi.fn();
      const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs(), {
        broadcastProgress,
      });
      const sender = createSender();
      startPaste(coordinator, sender);

      emit(createCopyPasteTerminalEvent("copy-op-1", "running"));
      emit(createCopyPasteTerminalEvent("copy-op-1", "completed"));

      expect(
        broadcastProgress.mock.calls.map(([event, owner]) => [
          (event as WriteOperationProgressEvent).status,
          owner,
        ]),
      ).toEqual([
        ["running", sender],
        ["completed", sender],
      ]);
      coordinator.shutdown();
    });

    it("hands a running operation to another window when its own closes", () => {
      const { writeService, emit } = createSubscribingWriteService();
      const successor = createLifecycleSender();
      const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs(), {
        successorOf: () => successor,
      });
      const sender = createLifecycleSender();
      startPaste(coordinator, sender);
      emit({
        ...createCopyPasteTerminalEvent("copy-op-1", "awaiting_resolution"),
        result: null,
        runtimeConflict: createRuntimeConflict("conflict-1"),
      });

      sender.destroyed = true;
      sender.emit("destroyed");

      expect(writeService.cancelOperation).not.toHaveBeenCalled();
      // The window taking over hears where the operation is, its question included.
      expect(successor.send).toHaveBeenCalledWith(
        "filetrail:writeOperationAdopted",
        expect.objectContaining({
          operationId: "copy-op-1",
          event: expect.objectContaining({
            status: "awaiting_resolution",
            runtimeConflict: expect.objectContaining({ conflictId: "conflict-1" }),
          }),
        }),
      );
      expect(countLifecycleListeners(sender)).toBe(0);
      // It answers and stops it now; the window that closed can't.
      expect(
        coordinator.handlers["copyPaste:resolveConflict"](
          { operationId: "copy-op-1", conflictId: "conflict-1", resolution: "skip" },
          { sender },
        ),
      ).toEqual({ ok: false });
      expect(
        coordinator.handlers["copyPaste:resolveConflict"](
          { operationId: "copy-op-1", conflictId: "conflict-1", resolution: "skip" },
          { sender: successor },
        ),
      ).toEqual({ ok: true });
      emit(createCopyPasteTerminalEvent("copy-op-1", "completed"));
      expect(
        successor.send.mock.calls
          .filter(([channel]) => channel === "filetrail:writeOperationProgress")
          .map(([, payload]) => (payload as WriteOperationProgressEvent).status),
      ).toEqual(["completed"]);
      expect(countLifecycleListeners(successor)).toBe(0);
      coordinator.shutdown();
    });

    it("hands it on again when the window that took it over closes too", () => {
      const { writeService } = createSubscribingWriteService();
      const second = createLifecycleSender();
      const third = createLifecycleSender();
      const successors = new Map<unknown, unknown>();
      const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs(), {
        successorOf: (gone) =>
          (successors.get(gone) as ReturnType<typeof createLifecycleSender>) ?? null,
      });
      const first = createLifecycleSender();
      successors.set(first, second);
      successors.set(second, third);
      startPaste(coordinator, first);

      first.emit("destroyed");
      second.emit("render-process-gone");

      expect(writeService.cancelOperation).not.toHaveBeenCalled();
      expect(third.send).toHaveBeenCalledWith(
        "filetrail:writeOperationAdopted",
        expect.objectContaining({ operationId: "copy-op-1", event: null }),
      );
      // With no window left, it stops.
      third.emit("destroyed");
      expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
      coordinator.shutdown();
    });
  });

  it("rejects a paste that arrives while a rename is still being prepared", async () => {
    let finishLstat: (() => void) | null = null;
    const fs = createWriteOperationFs({
      lstat: vi.fn(
        (path: string) =>
          new Promise<{ isDirectory(): boolean }>((resolveLstat, rejectLstat) => {
            finishLstat = () =>
              path === "/Users/demo/source.txt"
                ? resolveLstat(createStats(false))
                : rejectLstat(new Error("missing"));
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();

    const rename = coordinator.handlers["writeOperation:rename"](
      { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
      { sender },
    );
    await expect(
      coordinator.handlers["copyPaste:start"](
        {
          analysisId: "analysis-1",
          action: "paste",
          policy: { file: "skip", directory: "merge", mismatch: "skip" },
        },
        { sender },
      ),
    ).rejects.toThrow("Another write operation is already running.");

    (finishLstat as (() => void) | null)?.();
    rename.catch(() => undefined);
    coordinator.shutdown();
  });

  it("passes per-item choices and standing runtime answers to the write service", () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();

    analyze(coordinator, sender);
    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
        overrides: [{ nodeId: "item-2", action: "overwrite" }],
      },
      { sender },
    );
    coordinator.handlers["copyPaste:resolveConflict"](
      {
        operationId: "copy-op-1",
        conflictId: "runtime-item-1-destination",
        resolution: "skip",
        applyToRemaining: true,
      },
      { sender },
    );

    expect(writeService.startCopyPaste).toHaveBeenCalledWith(
      {
        analysisId: "analysis-1",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
        overrides: [{ nodeId: "item-2", action: "overwrite" }],
      },
      new Set(),
    );
    expect(writeService.resolveRuntimeConflict).toHaveBeenCalledWith(
      "copy-op-1",
      "runtime-item-1-destination",
      "skip",
      true,
    );
    coordinator.shutdown();
  });

  it("cancels a paste when its window reloads, but not an operation the reloaded page starts afterwards", () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createLifecycleSender();

    startPaste(coordinator, sender);
    // Same-document navigations and navigation attempts that may still be blocked are not
    // reloads; only a committed main-frame load replaces the page.
    sender.emit("did-navigate-in-page");
    sender.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(writeService.cancelOperation).not.toHaveBeenCalled();

    sender.emit("did-navigate");
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");

    emit(createCopyPasteTerminalEvent("copy-op-1", "cancelled"));
    expect(countLifecycleListeners(sender)).toBe(0);

    // The reloaded page starts its own paste; the old page's navigation must not touch it.
    startPaste(coordinator, sender);
    expect(writeService.cancelOperation).not.toHaveBeenCalledWith("copy-op-2");
    sender.emit("did-navigate");
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-2");

    coordinator.shutdown();
  });

  it("cancels a local write when its window reloads and frees the write slot", async () => {
    let finishFirstDelete: (() => void) | null = null;
    const fs = createWriteOperationFs({
      rm: vi.fn(async (path: string) => {
        if (path.endsWith("a.txt")) {
          await new Promise<void>((resolveRm) => {
            finishFirstDelete = resolveRm;
          });
        }
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const sender = createLifecycleSender();

    coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a.txt", "/Users/demo/.Trash/b.txt"] },
      { sender },
    );
    await waitFor(() => (finishFirstDelete ? true : null));
    sender.emit("did-navigate");
    (finishFirstDelete as (() => void) | null)?.();
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    // a.txt was deleted before the cancel took effect: that can't be undone, so the
    // result is "partial" (as for Trash), not "cancelled".
    expect(terminal.status).toBe("partial");
    expect(terminal.completedItemCount).toBe(1);
    expect(fs.rm).toHaveBeenCalledTimes(1);
    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        { parentDirectoryPath: "/Users/demo", folderName: "Next" },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-2", status: "queued" });
    coordinator.shutdown();
  });

  it("frees the write slot when a local operation's window is destroyed and sending throws", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let finishRename: (() => void) | null = null;
      const fs = createWriteOperationFs({
        lstat: vi.fn(async (path: string) => {
          if (path === "/Users/demo/source.txt") {
            return createStats(false);
          }
          throw new Error("missing");
        }),
        renameExclusive: vi.fn(
          () =>
            new Promise<void>((resolveRename) => {
              finishRename = resolveRename;
            }),
        ),
      });
      const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
      // Mirrors a WebContents torn down mid-operation: isDestroyed has not caught up yet,
      // but send already throws.
      const sender = createLifecycleSender();
      await coordinator.handlers["writeOperation:rename"](
        { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
        { sender },
      );
      await waitFor(() => (finishRename ? true : null));
      sender.send.mockImplementation(() => {
        throw new Error("Object has been destroyed");
      });
      (finishRename as (() => void) | null)?.();
      await waitFor(() => (countLifecycleListeners(sender) === 0 ? true : null));
      await new Promise((resolveWait) => setTimeout(resolveWait, 0));

      expect(unhandled).not.toHaveBeenCalled();
      expect(countLifecycleListeners(sender)).toBe(0);
      await expect(
        coordinator.handlers["writeOperation:createFolder"](
          { parentDirectoryPath: "/Users/demo", folderName: "Next" },
          { sender: createSender() },
        ),
      ).resolves.toEqual({ operationId: "write-op-2", status: "queued" });
      coordinator.shutdown();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("skips sending to a destroyed window and still frees the slot for write-service operations", () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createLifecycleSender();
    startPaste(coordinator, sender);

    sender.destroyed = true;
    sender.send.mockImplementation(() => {
      throw new Error("Object has been destroyed");
    });
    sender.emit("destroyed");
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    expect(() => emit(createCopyPasteTerminalEvent("copy-op-1", "cancelled"))).not.toThrow();

    expect(sender.send).not.toHaveBeenCalled();
    expect(countLifecycleListeners(sender)).toBe(0);
    expect(() => startPaste(coordinator, createSender())).not.toThrow();
    coordinator.shutdown();
  });

  it("frees the slot even when sending a write-service terminal event throws", () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createLifecycleSender();
    startPaste(coordinator, sender);
    sender.send.mockImplementation(() => {
      throw new Error("Object has been destroyed");
    });

    expect(() => emit(createCopyPasteTerminalEvent("copy-op-1", "completed"))).not.toThrow();
    expect(countLifecycleListeners(sender)).toBe(0);
    expect(() => startPaste(coordinator, createSender())).not.toThrow();
    coordinator.shutdown();
  });

  it("cancels right away when the starting window is already destroyed", () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createLifecycleSender();
    analyze(coordinator, sender);
    // Closed while the start request was on its way.
    sender.destroyed = true;

    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );

    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    coordinator.shutdown();
  });

  it("removes window listeners when an operation finishes normally", async () => {
    let finishRename: (() => void) | null = null;
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
      renameExclusive: vi.fn(
        () =>
          new Promise<void>((resolveRename) => {
            finishRename = resolveRename;
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createLifecycleSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
      { sender },
    );
    expect(countLifecycleListeners(sender)).toBeGreaterThan(0);
    await waitFor(() => (finishRename ? true : null));
    (finishRename as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");

    expect(countLifecycleListeners(sender)).toBe(0);
    coordinator.shutdown();
  });

  it("sends the window a trimmed analysis report, keeps its own whole, and copies everything", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-trim-"));
    const source = join(root, "source");
    const destination = join(root, "destination");
    // "album" is new at the destination. "shared" exists there, with one of its files.
    await mkdir(join(source, "album", "raw"), { recursive: true });
    await mkdir(join(source, "shared", "deep"), { recursive: true });
    await mkdir(join(destination, "shared"), { recursive: true });
    const files = [
      "album/one.jpg",
      "album/two.jpg",
      "album/raw/one.dng",
      "album/raw/two.dng",
      "shared/clash.txt",
      "shared/new.txt",
      "shared/deep/a.txt",
      "shared/deep/b.txt",
    ];
    for (const file of files) {
      await writeFile(join(source, file), file);
    }
    await writeFile(join(destination, "shared", "clash.txt"), "already here");

    const writeService = createWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();
    const { analysisId } = await coordinator.handlers["copyPaste:analyzeStart"](
      {
        mode: "copy",
        sourcePaths: [join(source, "album"), join(source, "shared")],
        destinationDirectoryPath: destination,
        action: "paste",
      },
      { sender },
    );
    const update = await waitFor(() => {
      const current = coordinator.handlers["copyPaste:analyzeGetUpdate"](
        { analysisId },
        { sender },
      );
      return current.done ? current : null;
    });
    const names = (nodes: Array<{ sourcePath: string }>) =>
      nodes.map((node) => node.sourcePath.split("/").at(-1));
    const sent = update.report;
    if (!sent) {
      throw new Error("Expected a finished analysis report.");
    }

    // The window gets: nothing inside the new folder; the clashing folder's items, and
    // nothing inside the new folder within it.
    const [sentAlbum, sentShared] = sent.nodes;
    expect(sentAlbum?.conflictClass).toBeNull();
    expect(sentAlbum?.children).toEqual([]);
    expect(sentAlbum?.totalNodeCount).toBe(6);
    expect(sentShared?.conflictClass).toBe("directory_conflict");
    expect(names(sentShared?.children ?? []).sort()).toEqual(["clash.txt", "deep", "new.txt"]);
    expect(sentShared?.children.find((node) => node.sourcePath.endsWith("deep"))?.children).toEqual(
      [],
    );
    expect(sent.summary).toEqual(
      writeService.getCopyPasteAnalysisUpdate(analysisId).report?.summary,
    );

    // The write service's own report, which the copy runs from, is untouched.
    const kept = writeService.getCopyPasteAnalysisUpdate(analysisId).report;
    expect(names(kept?.nodes[0]?.children ?? []).sort()).toEqual(["one.jpg", "raw", "two.jpg"]);
    expect(
      kept?.nodes[1]?.children.find((node) => node.sourcePath.endsWith("deep"))?.children,
    ).toHaveLength(2);

    const { operationId } = await coordinator.handlers["copyPaste:start"](
      {
        analysisId,
        action: "paste",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
      },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, operationId);

    expect(terminal.status).toBe("completed");
    for (const file of files.filter((name) => name !== "shared/clash.txt")) {
      expect(existsSync(join(destination, file)), file).toBe(true);
    }
    // The clash was kept next to the existing file.
    expect((await readdir(join(destination, "shared"))).sort()).toEqual([
      "clash copy.txt",
      "clash.txt",
      "deep",
      "new.txt",
    ]);
    coordinator.shutdown();
  });

  it("sends at most one plain progress update per interval, and the newest always arrives", () => {
    vi.useFakeTimers();
    try {
      const { writeService, emit } = createSubscribingWriteService();
      const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
      const sender = createSender();
      startPaste(coordinator, sender);
      const sentCounts = () =>
        sender.send.mock.calls.map(
          ([, payload]) => (payload as WriteOperationProgressEvent).completedItemCount,
        );

      // A folder of small files: one update per file, all within the same moment.
      for (let completed = 1; completed <= 500; completed += 1) {
        emit({
          ...createCopyPasteTerminalEvent("copy-op-1", "running"),
          completedItemCount: completed,
          totalItemCount: 1000,
        });
      }
      expect(sentCounts()).toEqual([1]);

      vi.advanceTimersByTime(PROGRESS_UPDATE_INTERVAL_MS);
      expect(sentCounts()).toEqual([1, 500]);

      // Nothing new: nothing more is sent.
      vi.advanceTimersByTime(PROGRESS_UPDATE_INTERVAL_MS * 5);
      expect(sentCounts()).toEqual([1, 500]);

      // After a quiet spell the next update goes out at once.
      emit({ ...createCopyPasteTerminalEvent("copy-op-1", "running"), completedItemCount: 501 });
      expect(sentCounts()).toEqual([1, 500, 501]);

      // A question for the user does not wait, and replaces an update that was.
      emit({ ...createCopyPasteTerminalEvent("copy-op-1", "running"), completedItemCount: 502 });
      emit({
        ...createCopyPasteTerminalEvent("copy-op-1", "awaiting_resolution"),
        completedItemCount: 503,
        runtimeConflict: createRuntimeConflict("conflict-1"),
      });
      expect(sentCounts()).toEqual([1, 500, 501, 503]);

      // Neither does the end, after which nothing held back is sent late.
      emit({ ...createCopyPasteTerminalEvent("copy-op-1", "running"), completedItemCount: 504 });
      emit({ ...createCopyPasteTerminalEvent("copy-op-1", "running"), completedItemCount: 505 });
      emit(createCopyPasteTerminalEvent("copy-op-1", "completed"));
      const statuses = sender.send.mock.calls.map(
        ([, payload]) => (payload as WriteOperationProgressEvent).status,
      );
      expect(statuses.at(-1)).toBe("completed");
      const sentBeforeWaiting = sender.send.mock.calls.length;
      vi.advanceTimersByTime(PROGRESS_UPDATE_INTERVAL_MS * 5);
      expect(sender.send.mock.calls).toHaveLength(sentBeforeWaiting);
      coordinator.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes back the write service's rejection of a conflict answer", () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();
    startPaste(coordinator, sender);
    emit({
      ...createCopyPasteTerminalEvent("copy-op-1", "awaiting_resolution"),
      result: null,
      runtimeConflict: createRuntimeConflict("conflict-1"),
    });
    vi.mocked(writeService.resolveRuntimeConflict).mockReturnValueOnce({ ok: false });

    expect(
      coordinator.handlers["copyPaste:resolveConflict"](
        { operationId: "copy-op-1", conflictId: "conflict-1", resolution: "overwrite" },
        { sender },
      ),
    ).toEqual({ ok: false });
    expect(writeService.resolveRuntimeConflict).toHaveBeenCalledWith(
      "copy-op-1",
      "conflict-1",
      "overwrite",
      false,
    );
    coordinator.shutdown();
  });

  it("only accepts cancel and conflict answers from the window that started the operation", async () => {
    let finishRename: (() => void) | null = null;
    const writeService = createWriteServiceStub();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
      renameExclusive: vi.fn(
        () =>
          new Promise<void>((resolveRename) => {
            finishRename = resolveRename;
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(writeService, fs);
    const owner = createSender();
    const otherWindow = createSender();

    startPaste(coordinator, owner);
    expect(
      coordinator.handlers["copyPaste:resolveConflict"](
        { operationId: "copy-op-1", conflictId: "conflict-1", resolution: "skip" },
        { sender: otherWindow },
      ),
    ).toEqual({ ok: false });
    expect(
      coordinator.handlers["copyPaste:cancel"](
        { operationId: "copy-op-1" },
        { sender: otherWindow },
      ),
    ).toEqual({ ok: false });
    expect(
      coordinator.handlers["writeOperation:cancel"](
        { operationId: "copy-op-1" },
        { sender: otherWindow },
      ),
    ).toEqual({ ok: false });
    expect(writeService.resolveRuntimeConflict).not.toHaveBeenCalled();
    expect(writeService.cancelOperation).not.toHaveBeenCalled();

    expect(
      coordinator.handlers["copyPaste:cancel"]({ operationId: "copy-op-1" }, { sender: owner }),
    ).toEqual({ ok: true });
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    coordinator.shutdown();

    // Local operations follow the same rule.
    const localCoordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    await localCoordinator.handlers["writeOperation:rename"](
      { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
      { sender: owner },
    );
    expect(
      localCoordinator.handlers["writeOperation:cancel"](
        { operationId: "write-op-1" },
        { sender: otherWindow },
      ),
    ).toEqual({ ok: false });
    await waitFor(() => (finishRename ? true : null));
    (finishRename as (() => void) | null)?.();
    const terminal = await waitForTerminalEvent(owner, "write-op-1");
    expect(terminal.status).toBe("completed");
    localCoordinator.shutdown();
  });
});

describe("renaming on a real disk", () => {
  it("refuses to replace an item that took the new name after it was checked", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-rename-race-"));
    const source = join(root, "a.txt");
    const destination = join(root, "b.txt");
    await writeFile(source, "renamed item");
    // Something else creates b.txt between the check and the rename itself.
    const takeTheName = async () => {
      await writeFile(destination, "someone else's file");
    };
    const fs = createRealWriteOperationFs({
      rename: async (oldPath, newPath) => {
        await takeTheName();
        await originalRename(oldPath, newPath);
      },
      renameExclusive: async (oldPath, newPath) => {
        await takeTheName();
        await originalRenameExclusive(oldPath, newPath);
      },
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: source, destinationName: "b.txt" },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.status).toBe("failed");
    expect(terminal.result?.error).toBe("An item named “b.txt” already exists.");
    expect(await readFile(destination, "utf8")).toBe("someone else's file");
    expect(await readFile(source, "utf8")).toBe("renamed item");
    await rm(root, { recursive: true, force: true });
    coordinator.shutdown();
  });

  it("changes only the case of a name on a disk that ignores case", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-rename-case-"));
    await writeFile(join(root, "notes.txt"), "notes");
    if (!existsSync(join(root, "NOTES.TXT"))) {
      // This disk minds case; "notes.txt" and "Notes.txt" are different names there, and the
      // test below covers that.
      await rm(root, { recursive: true, force: true });
      return;
    }
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createRealWriteOperationFs(),
    );
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "notes.txt"), destinationName: "Notes.txt" },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.status).toBe("completed");
    expect(await readdir(root)).toEqual(["Notes.txt"]);
    expect(await readFile(join(root, "Notes.txt"), "utf8")).toBe("notes");
    await rm(root, { recursive: true, force: true });
    coordinator.shutdown();
  });

  it("changes only how an accented letter is encoded on a disk that ignores that", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-rename-nfc-"));
    const decomposed = "café.txt";
    const composed = "café.txt";
    await writeFile(join(root, decomposed), "menu");
    if (!existsSync(join(root, composed))) {
      await rm(root, { recursive: true, force: true });
      return;
    }
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createRealWriteOperationFs(),
    );
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, decomposed), destinationName: composed },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.status).toBe("completed");
    expect(await readdir(root)).toEqual([composed]);
    await rm(root, { recursive: true, force: true });
    coordinator.shutdown();
  });

  it("still refuses a name taken by a different item that differs only in case", async () => {
    // On a disk that minds case, "Notes.txt" next to "notes.txt" is another file.
    const lstat = vi.fn(async (path: string) => ({
      isDirectory: () => false,
      dev: 1,
      ino: path.endsWith("notes.txt") ? 10 : 11,
    }));
    const fs = createWriteOperationFs({ lstat });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await expect(
      coordinator.handlers["writeOperation:rename"](
        { sourcePath: "/Users/demo/notes.txt", destinationName: "Notes.txt" },
        { sender: createSender() },
      ),
    ).rejects.toThrow("An item named “Notes.txt” already exists.");
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.renameExclusive).not.toHaveBeenCalled();
    coordinator.shutdown();
  });

  it("refuses a name held by a hard link to the same file", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-rename-link-"));
    await writeFile(join(root, "a.txt"), "shared");
    await link(join(root, "a.txt"), join(root, "b.txt"));
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createRealWriteOperationFs(),
    );

    await expect(
      coordinator.handlers["writeOperation:rename"](
        { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
        { sender: createSender() },
      ),
    ).rejects.toThrow("An item named “b.txt” already exists.");
    expect((await readdir(root)).sort()).toEqual(["a.txt", "b.txt"]);
    await rm(root, { recursive: true, force: true });
    coordinator.shutdown();
  });

  // Two hard links to one file whose names differ only in case can exist on a disk that
  // minds case; renaming one onto the other would do nothing, yet report success.
  it.runIf(canMountDiskImages)(
    "refuses a name held by a hard link that differs only in case, on a disk that minds case",
    async () => {
      const volume = mountTestDiskImage({ caseSensitive: true, name: "FileTrailLinks" });
      const coordinator = createWriteOperationCoordinator(
        createWriteServiceStub(),
        createRealWriteOperationFs(),
      );
      try {
        await writeFile(join(volume.mountPath, "h.txt"), "shared");
        await link(join(volume.mountPath, "h.txt"), join(volume.mountPath, "H.txt"));

        await expect(
          coordinator.handlers["writeOperation:rename"](
            { sourcePath: join(volume.mountPath, "h.txt"), destinationName: "H.txt" },
            { sender: createSender() },
          ),
        ).rejects.toThrow("An item named “H.txt” already exists.");
      } finally {
        coordinator.shutdown();
        volume.detach();
      }
    },
    30_000,
  );

  it.runIf(canMountDiskImages)(
    "changes only the case of a name on a disk that minds case",
    async () => {
      const volume = mountTestDiskImage({ caseSensitive: true, name: "FileTrailCaseRename" });
      const coordinator = createWriteOperationCoordinator(
        createWriteServiceStub(),
        createRealWriteOperationFs(),
      );
      try {
        await writeFile(join(volume.mountPath, "notes.txt"), "notes");
        const sender = createSender();

        await coordinator.handlers["writeOperation:rename"](
          { sourcePath: join(volume.mountPath, "notes.txt"), destinationName: "Notes.txt" },
          { sender },
        );
        const terminal = await waitForTerminalEvent(sender, "write-op-1");

        expect(terminal.status).toBe("completed");
        expect((await readdir(volume.mountPath)).filter((name) => !name.startsWith("."))).toEqual([
          "Notes.txt",
        ]);
      } finally {
        coordinator.shutdown();
        volume.detach();
      }
    },
    30_000,
  );

  // FAT and exFAT give empty files ids too large to compare: an empty file must still be
  // recognized as itself when only the case of its name changes.
  it.runIf(canMountDiskImages)(
    "changes only the case of an empty file's name on a FAT32 disk",
    async () => {
      const volume = mountTestDiskImage({ format: "MS-DOS FAT32", name: "FTRENAME" });
      const coordinator = createWriteOperationCoordinator(
        createWriteServiceStub(),
        createRealWriteOperationFs(),
      );
      try {
        await writeFile(join(volume.mountPath, "empty.txt"), "");
        await writeFile(join(volume.mountPath, "other.txt"), "");
        const sender = createSender();

        await coordinator.handlers["writeOperation:rename"](
          { sourcePath: join(volume.mountPath, "empty.txt"), destinationName: "Empty.txt" },
          { sender },
        );
        const terminal = await waitForTerminalEvent(sender, "write-op-1");

        expect(terminal.status).toBe("completed");
        expect(
          (await readdir(volume.mountPath)).filter((name) => !name.startsWith(".")).sort(),
        ).toEqual(["Empty.txt", "other.txt"]);
        // Another empty file isn't mistaken for the item itself.
        await expect(
          coordinator.handlers["writeOperation:rename"](
            { sourcePath: join(volume.mountPath, "Empty.txt"), destinationName: "other.txt" },
            { sender: createSender() },
          ),
        ).rejects.toThrow("An item named “other.txt” already exists.");
      } finally {
        coordinator.shutdown();
        volume.detach();
      }
    },
    30_000,
  );

  it("says plainly that an item is gone instead of passing on the system's error", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-rename-gone-"));
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createRealWriteOperationFs(),
    );

    await expect(
      coordinator.handlers["writeOperation:rename"](
        { sourcePath: join(root, "gone.txt"), destinationName: "b.txt" },
        { sender: createSender() },
      ),
    ).rejects.toThrow(/^“gone\.txt” no longer exists\.$/);
    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        { parentDirectoryPath: join(root, "Missing"), folderName: "New" },
        { sender: createSender() },
      ),
    ).rejects.toThrow(/^“Missing” no longer exists\.$/);
    await rm(root, { recursive: true, force: true });
    coordinator.shutdown();
  });

  it("explains a rename that fails while running in plain words", async () => {
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }),
      renameExclusive: vi.fn(async () => {
        throw Object.assign(
          new Error("EACCES: permission denied, rename '/Users/demo/source.txt'"),
          { code: "EACCES" },
        );
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.result?.error).toBe("You don't have permission to access this item.");
    coordinator.shutdown();
  });

  it("doesn't report a finished rename as failed when reporting it goes wrong", async () => {
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();
    const parse = writeOperationProgressEventSchema.parse.bind(writeOperationProgressEventSchema);
    const parseSpy = vi
      .spyOn(writeOperationProgressEventSchema, "parse")
      .mockImplementation((event) => {
        if ((event as WriteOperationProgressEvent).status === "completed") {
          throw new Error("unexpected shape");
        }
        return parse(event);
      });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await coordinator.handlers["writeOperation:rename"](
        { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
        { sender },
      );
      await waitFor(() => (consoleError.mock.calls.length > 0 ? true : null));

      expect(fs.renameExclusive).toHaveBeenCalled();
      const statuses = sender.send.mock.calls.map(
        ([, payload]) => (payload as WriteOperationProgressEvent).status,
      );
      expect(statuses).not.toContain("failed");
      // The write slot is free again all the same.
      await expect(
        coordinator.handlers["writeOperation:createFolder"](
          { parentDirectoryPath: "/Users/demo", folderName: "Next" },
          { sender },
        ),
      ).resolves.toEqual({ operationId: "write-op-2", status: "queued" });
    } finally {
      parseSpy.mockRestore();
      consoleError.mockRestore();
    }
    coordinator.shutdown();
  });
});

describe("moving to the Trash and deleting", () => {
  it("counts an item that is already gone as done, and names the item when the Trash refuses", async () => {
    const trash = vi.fn(async (path: string) => {
      if (path.endsWith("locked.txt")) {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      }
      return inTrash(path);
    });
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path.endsWith("gone.txt")) {
          throw Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
        }
        return createStats(false);
      }),
      trash,
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();

    coordinator.handlers["writeOperation:trash"](
      { paths: ["/Users/demo/gone.txt", "/Users/demo/locked.txt", "/Users/demo/c.txt"] },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(trash.mock.calls.map(([path]) => path)).toEqual([
      "/Users/demo/locked.txt",
      "/Users/demo/c.txt",
    ]);
    expect(terminal.status).toBe("partial");
    expect(terminal.result?.items).toEqual([
      expect.objectContaining({ sourcePath: "/Users/demo/gone.txt", status: "completed" }),
      expect.objectContaining({
        sourcePath: "/Users/demo/locked.txt",
        status: "failed",
        // A known system error keeps its own plain sentence.
        error: "You don't have permission to access this item.",
      }),
      expect.objectContaining({ sourcePath: "/Users/demo/c.txt", status: "completed" }),
    ]);
    coordinator.shutdown();
  });

  it("stops moving items to the Trash when cancelled", async () => {
    let finishFirst: (() => void) | null = null;
    const trash = vi.fn(async (path: string) => {
      if (path.endsWith("a.txt")) {
        await new Promise<void>((resolveTrash) => {
          finishFirst = resolveTrash;
        });
      }
      return inTrash(path);
    });
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs({ trash }),
    );
    const sender = createSender();

    coordinator.handlers["writeOperation:trash"](
      { paths: ["/Users/demo/a.txt", "/Users/demo/b.txt"] },
      { sender },
    );
    await waitFor(() => (finishFirst ? true : null));
    coordinator.handlers["writeOperation:cancel"]({ operationId: "write-op-1" }, { sender });
    (finishFirst as (() => void) | null)?.();
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(trash).toHaveBeenCalledTimes(1);
    expect(terminal.status).toBe("partial");
    coordinator.shutdown();
  });

  it("refuses to delete or trash the disk, the system folders, a volume, or the home folder", async () => {
    const fs = createWriteOperationFs();
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const refused = [
      "/",
      "/Users",
      "/users/",
      "/Volumes",
      "/Volumes/Backup",
      "/volumes/Backup/",
      "/System",
      "/Applications",
      "/Library",
      homedir(),
      homedir().toUpperCase(),
      join(homedir(), "Desktop"),
      join(homedir(), "library"),
      "/Users/demo/../../Library",
      "Documents/report.txt",
    ];

    for (const path of refused) {
      await expect(
        coordinator.handlers["writeOperation:deleteImmediately"](
          { paths: ["/Users/demo/.Trash/fine.txt", path] },
          { sender: createSender() },
        ),
        path,
      ).rejects.toThrow();
      await expect(
        coordinator.handlers["writeOperation:trash"]({ paths: [path] }, { sender: createSender() }),
        path,
      ).rejects.toThrow();
    }
    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: ["/Volumes/Backup"] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("“Backup” can't be deleted.");
    expect(fs.rm).not.toHaveBeenCalled();
    expect(fs.trash).not.toHaveBeenCalled();

    // What is in that disk's Trash is fine.
    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: ["/Volumes/Backup/.Trashes/501/old.txt"] },
        { sender: createSender() },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    coordinator.shutdown();
  });

  it("protects the Trash folder however its name is written", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );

    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: [resolve(homedir(), ".trash")] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("protected system directory");
    await expect(
      coordinator.handlers["writeOperation:trash"](
        { paths: [resolve(homedir(), ".TRASH")] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("protected system directory");
    coordinator.shutdown();
  });

  // The same folder can be reached by other paths: on macOS the home folder is also at
  // /System/Volumes/Data/Users/<name>. What is on disk is compared, not only the path.
  it.runIf(process.platform === "darwin" && existsSync("/System/Volumes/Data"))(
    "refuses the home folder and the disks however they are reached",
    async () => {
      const realFs = createRealWriteOperationFs();
      for (const path of [
        `/System/Volumes/Data${homedir()}`,
        `/System/Volumes/Data${join(homedir(), "Documents")}`,
        "/System/Volumes/Data/Applications",
        "/System/Volumes/Data",
      ]) {
        await expect(assertNotSystemLocation([path], "deleted", realFs), path).rejects.toThrow(
          /can't be deleted/,
        );
      }
      // An ordinary folder is fine, however it is reached.
      const folder = await mkdtemp(join(tmpdir(), "filetrail-guard-"));
      try {
        await expect(assertNotSystemLocation([folder], "deleted", realFs)).resolves.toBe(undefined);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  );

  it.runIf(canMountDiskImages)(
    "refuses a disk mounted somewhere other than /Volumes",
    async () => {
      const volume = mountTestDiskImage();
      try {
        await expect(
          assertNotSystemLocation(
            [volume.mountPath],
            "moved to the Trash",
            createRealWriteOperationFs(),
          ),
        ).rejects.toThrow("is a disk, so it can't be moved to the Trash.");
      } finally {
        volume.detach();
      }
    },
    30_000,
  );

  // Moving to another disk copies, then deletes the originals: as final as deleting.
  it("refuses to move the home folder or a system folder, but copies it", async () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const request = (mode: "copy" | "cut") => ({
      mode,
      sourcePaths: [homedir()],
      destinationDirectoryPath: "/Volumes/Backup",
      action: "paste" as const,
    });

    await expect(
      coordinator.handlers["copyPaste:analyzeStart"](request("cut"), { sender: createSender() }),
    ).rejects.toThrow("can't be moved.");
    expect(writeService.startCopyPasteAnalysis).not.toHaveBeenCalled();
    await expect(
      coordinator.handlers["copyPaste:analyzeStart"](request("copy"), { sender: createSender() }),
    ).resolves.toEqual({ analysisId: "analysis-1", status: "queued" });
    coordinator.shutdown();
  });

  it("refuses to rename the home folder's own folders", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );

    await expect(
      coordinator.handlers["writeOperation:rename"](
        { sourcePath: join(homedir(), "Desktop"), destinationName: "Old Desktop" },
        { sender: createSender() },
      ),
    ).rejects.toThrow("“Desktop” can't be renamed.");
    coordinator.shutdown();
  });

  it("explains a failed delete in plain words", async () => {
    const fs = createWriteOperationFs({
      rm: vi.fn(async () => {
        throw Object.assign(new Error("EACCES: permission denied, rmdir '/Users/demo/a'"), {
          code: "EACCES",
        });
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const sender = createSender();

    coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a"] },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.status).toBe("failed");
    expect(terminal.result?.error).toBe("You don't have permission to access this item.");
    coordinator.shutdown();
  });
});

describe("folder listings after a write", () => {
  it("forgets cached listings before a local operation's end is sent", async () => {
    resetResponseCacheState();
    await getCachedResponse("directory", { path: "/Users/demo" }, async () => "old listing");
    expect(getResponseCacheSizes().directorySnapshots).toBe(1);
    const sizesAtEnd: number[] = [];
    const sender = createSender();
    sender.send.mockImplementation((_channel, payload) => {
      if ((payload as WriteOperationProgressEvent).status === "completed") {
        sizesAtEnd.push(getResponseCacheSizes().directorySnapshots);
      }
    });
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
      {
        homePath: "/Users/demo",
      },
    );

    coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a.txt"] },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(sizesAtEnd).toEqual([0]);
    coordinator.shutdown();
    resetResponseCacheState();
  });

  it("forgets cached listings before a paste's end is sent", async () => {
    resetResponseCacheState();
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createLifecycleSender();
    const sizesAtEnd: number[] = [];
    sender.send.mockImplementation((_channel, payload) => {
      if ((payload as WriteOperationProgressEvent).status === "completed") {
        sizesAtEnd.push(getResponseCacheSizes().treeChildren);
      }
    });
    startPaste(coordinator, sender);
    await getCachedResponse("tree", { path: "/Users/demo/target" }, async () => "old children");

    emit(createCopyPasteTerminalEvent("copy-op-1", "completed"));

    expect(sizesAtEnd).toEqual([0]);
    coordinator.shutdown();
    resetResponseCacheState();
  });
});

describe("quitting during an operation", () => {
  it("stops a running delete and waits for it to finish before shutdown resolves", async () => {
    let finishFirstDelete: (() => void) | null = null;
    const fs = createWriteOperationFs({
      rm: vi.fn(async (path: string) => {
        if (path.endsWith("a.txt")) {
          await new Promise<void>((resolveRm) => {
            finishFirstDelete = resolveRm;
          });
        }
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const sender = createSender();

    coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a.txt", "/Users/demo/.Trash/b.txt"] },
      { sender },
    );
    await waitFor(() => (finishFirstDelete ? true : null));
    expect(coordinator.getActiveOperation()).toEqual({ operationId: "write-op-1", kind: "delete" });

    let shutDown = false;
    const shutdown = coordinator.shutdown().then(() => {
      shutDown = true;
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    // Still on the first item: quitting waits for it.
    expect(shutDown).toBe(false);
    // Nothing new starts while the app is quitting.
    await expect(
      coordinator.handlers["writeOperation:trash"]({ paths: ["/Users/demo/c.txt"] }, { sender }),
    ).rejects.toThrow("File Trail is quitting.");

    (finishFirstDelete as (() => void) | null)?.();
    await shutdown;

    // It stopped after the current item, and its end was sent before shutdown finished.
    expect(fs.rm).toHaveBeenCalledTimes(1);
    const terminal = await waitForTerminalEvent(sender, "write-op-1");
    expect(terminal.status).toBe("partial");
    // Every item it never reached is counted, not only the next one.
    expect(terminal.result).toMatchObject({
      error: "Stopped after 1 item was deleted.",
      summary: { completedItemCount: 1, cancelledItemCount: 1, topLevelItemCount: 2 },
    });
    expect(coordinator.getActiveOperation()).toBeNull();
  });

  it("counts every item a stopped Trash never reached", async () => {
    let finishFirst: (() => void) | null = null;
    const fs = createWriteOperationFs({
      trash: vi.fn(async (path: string) => {
        if (path.endsWith("a.txt")) {
          await new Promise<void>((resolveTrash) => {
            finishFirst = resolveTrash;
          });
        }
        return inTrash(path);
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();
    const paths = ["a", "b", "c", "d", "e"].map((name) => `/Users/demo/${name}.txt`);

    await coordinator.handlers["writeOperation:trash"]({ paths }, { sender });
    await waitFor(() => (finishFirst ? true : null));
    coordinator.handlers["writeOperation:cancel"]({ operationId: "write-op-1" }, { sender });
    (finishFirst as (() => void) | null)?.();
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.result).toMatchObject({
      status: "partial",
      error: "Stopped after 1 item was moved to the Trash.",
      summary: { completedItemCount: 1, cancelledItemCount: 4, topLevelItemCount: 5 },
    });
    coordinator.shutdown();
  });

  // A disk that stops answering (a network share gone away) mustn't keep the app from
  // quitting: after a while it quits anyway.
  it("stops waiting for an operation that doesn't stop", async () => {
    const fs = createWriteOperationFs({
      rm: vi.fn(() => new Promise<void>(() => undefined)),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const sender = createSender();
    await coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a.txt"] },
      { sender },
    );
    await waitFor(() => (vi.mocked(fs.rm).mock.calls.length > 0 ? true : null));

    const started = Date.now();
    await coordinator.shutdown(50);

    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("cancels a running move and waits for the write service to say it stopped", async () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createLifecycleSender();
    startPaste(coordinator, sender);
    emit({ ...createCopyPasteTerminalEvent("copy-op-1", "running"), mode: "cut" });
    expect(coordinator.getActiveOperation()).toEqual({ operationId: "copy-op-1", kind: "move" });

    let shutDown = false;
    const shutdown = coordinator.shutdown().then(() => {
      shutDown = true;
    });
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    expect(shutDown).toBe(false);

    emit(createCopyPasteTerminalEvent("copy-op-1", "cancelled"));
    await shutdown;
    expect(shutDown).toBe(true);
    expect(sender.send.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ operationId: "copy-op-1", status: "cancelled" }),
    );
  });

  it("names a copy as a copy and has nothing to wait for when idle", async () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    expect(coordinator.getActiveOperation()).toBeNull();
    await coordinator.whenIdle();

    startPaste(coordinator, createSender());
    emit(createCopyPasteTerminalEvent("copy-op-1", "running"));
    expect(coordinator.getActiveOperation()).toEqual({ operationId: "copy-op-1", kind: "copy" });
    const idle = coordinator.whenIdle();
    emit(createCopyPasteTerminalEvent("copy-op-1", "completed"));
    await idle;
    expect(coordinator.getActiveOperation()).toBeNull();
    await coordinator.shutdown();
  });
});

describe("starting a paste", () => {
  it("doesn't hold the write slot for a paste that ended before its start returned", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-early-end-"));
    await writeFile(join(root, "a.txt"), "a");
    await mkdir(join(root, "target"));
    const writeService = createWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();
    const { analysisId } = await coordinator.handlers["copyPaste:analyzeStart"](
      {
        mode: "copy",
        sourcePaths: [join(root, "a.txt")],
        destinationDirectoryPath: join(root, "target"),
        action: "paste",
      },
      { sender },
    );
    await waitFor(() => {
      const update = coordinator.handlers["copyPaste:analyzeGetUpdate"]({ analysisId }, { sender });
      return update.done ? update : null;
    });
    // The review was dismissed after the analysis finished, then pasted from anyway: the
    // write service fails such a paste at once, inside startCopyPaste.
    coordinator.handlers["copyPaste:analyzeCancel"]({ analysisId }, { sender });

    const { operationId } = await coordinator.handlers["copyPaste:start"](
      {
        analysisId,
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );

    // The window still hears how it ended, after it has the operation's id.
    const terminal = await waitForTerminalEvent(sender, operationId);
    expect(terminal.status).toBe("failed");
    // And the next write is not refused with "Another write operation is already running."
    expect(coordinator.getActiveOperation()).toBeNull();
    expect(() => analyze(coordinator, sender)).not.toThrow("Another write operation");
    await rm(root, { recursive: true, force: true });
    coordinator.shutdown();
  });

  it("only lets the window that started an analysis read, cancel, or paste from it", async () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const owner = createSender();
    const otherWindow = createSender();
    analyze(coordinator, owner);

    expect(() =>
      coordinator.handlers["copyPaste:analyzeGetUpdate"](
        { analysisId: "analysis-1" },
        { sender: otherWindow },
      ),
    ).toThrow();
    expect(
      coordinator.handlers["copyPaste:analyzeCancel"](
        { analysisId: "analysis-1" },
        { sender: otherWindow },
      ),
    ).toEqual({ ok: false });
    await expect(
      coordinator.handlers["copyPaste:start"](
        {
          analysisId: "analysis-1",
          action: "paste",
          policy: { file: "skip", directory: "merge", mismatch: "skip" },
        },
        { sender: otherWindow },
      ),
    ).rejects.toThrow();
    expect(writeService.getCopyPasteAnalysisUpdate).not.toHaveBeenCalled();
    expect(writeService.cancelCopyPasteAnalysis).not.toHaveBeenCalled();
    expect(writeService.startCopyPaste).not.toHaveBeenCalled();

    expect(
      coordinator.handlers["copyPaste:analyzeCancel"](
        { analysisId: "analysis-1" },
        { sender: owner },
      ),
    ).toEqual({ ok: true });
    coordinator.shutdown();
  });
});

describe("locked items", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "filetrail-locked-ops-"));
  });

  afterEach(async () => {
    execFileSync("chflags", ["-R", "nouchg", root]);
    await rm(root, { recursive: true, force: true });
  });

  it("says a locked item is locked when it can't be renamed", async () => {
    await writeFile(join(root, "notes.txt"), "notes");
    execFileSync("chflags", ["uchg", join(root, "notes.txt")]);
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createRealWriteOperationFs(),
    );
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "notes.txt"), destinationName: "renamed.txt" },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.result?.error).toBe(
      "“notes.txt” is locked. Unlock it in Finder's Get Info and try again.",
    );
    expect(await readdir(root)).toEqual(["notes.txt"]);
    coordinator.shutdown();
  });

  it("names the locked item inside a folder that couldn't be deleted", async () => {
    const trash = join(root, ".Trash");
    await mkdir(join(trash, "Folder"), { recursive: true });
    await writeFile(join(trash, "Folder", "keep.txt"), "keep");
    execFileSync("chflags", ["uchg", join(trash, "Folder", "keep.txt")]);
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createRealWriteOperationFs(),
      { homePath: root },
    );
    const sender = createSender();

    await coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: [join(trash, "Folder")] },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.result?.items[0]?.error).toBe(
      "“keep.txt” is locked. Unlock it in Finder's Get Info and try again.",
    );
    expect(await readFile(join(trash, "Folder", "keep.txt"), "utf8")).toBe("keep");
    coordinator.shutdown();
  });
});

describe("emptying the Trash", () => {
  // Items replaced by a running paste are on their way to the Trash; emptying it then
  // would delete them for good.
  it("waits its turn: refused while another operation runs", async () => {
    let finishDelete: (() => void) | null = null;
    const fs = createWriteOperationFs({
      rm: vi.fn(
        () =>
          new Promise<void>((resolveRm) => {
            finishDelete = resolveRm;
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const sender = createSender();
    const empty = vi.fn(async () => ({ ok: true, error: null }));
    await coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a.txt"] },
      { sender },
    );
    await waitFor(() => (finishDelete ? true : null));

    await expect(coordinator.emptyTrash(empty)).resolves.toEqual({
      ok: false,
      error:
        "The Trash can't be emptied while another operation is running. Try again when it has finished.",
    });
    expect(empty).not.toHaveBeenCalled();

    (finishDelete as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");
    await expect(coordinator.emptyTrash(empty)).resolves.toEqual({ ok: true, error: null });
    expect(empty).toHaveBeenCalledTimes(1);
    coordinator.shutdown();
  });

  it("holds the write slot while emptying, so nothing starts alongside", async () => {
    let finishEmpty: (() => void) | null = null;
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );
    const emptying = coordinator.emptyTrash(
      () =>
        new Promise((resolveEmpty) => {
          finishEmpty = () => resolveEmpty({ ok: true, error: null });
        }),
    );
    await waitFor(() => (finishEmpty ? true : null));

    await expect(
      coordinator.handlers["writeOperation:trash"](
        { paths: ["/Users/demo/a.txt"] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("Another write operation is already running.");

    (finishEmpty as (() => void) | null)?.();
    await emptying;
    coordinator.shutdown();
  });
});

// Finishing a Replace that a crash cut short happens in the background, while the app is in
// use: it must never write at the same time as an operation the person started.
describe("writing alone (crash recovery retries)", () => {
  it("doesn't run while an operation holds the write slot", async () => {
    let finishDelete: (() => void) | null = null;
    const fs = createWriteOperationFs({
      rm: vi.fn(
        () =>
          new Promise<void>((resolveRm) => {
            finishDelete = resolveRm;
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: "/Users/demo",
    });
    const sender = createSender();
    await coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/.Trash/a.txt"] },
      { sender },
    );
    await waitFor(() => (finishDelete ? true : null));
    const write = vi.fn(async () => "done");

    await expect(coordinator.runWriteAlone(write)).resolves.toEqual({ ran: false });
    expect(write).not.toHaveBeenCalled();

    (finishDelete as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");
    await expect(coordinator.runWriteAlone(write)).resolves.toEqual({ ran: true, value: "done" });
    coordinator.shutdown();
  });

  it("doesn't run while a rename is still being checked", async () => {
    let finishLookup: (() => void) | null = null;
    let lookups = 0;
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          // Only the first look is held, which is enough to keep the check going.
          lookups += 1;
          if (lookups === 1) {
            await new Promise<void>((resolveLookup) => {
              finishLookup = resolveLookup;
            });
          }
          return createStats(false);
        }
        throw new Error("missing");
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();
    const renaming = coordinator.handlers["writeOperation:rename"](
      { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
      { sender },
    );
    await waitFor(() => (finishLookup ? true : null));
    const write = vi.fn(async () => undefined);

    await expect(coordinator.runWriteAlone(write)).resolves.toEqual({ ran: false });
    expect(write).not.toHaveBeenCalled();

    (finishLookup as (() => void) | null)?.();
    await renaming;
    await waitForTerminalEvent(sender, "write-op-1");
    coordinator.shutdown();
  });

  it("holds the write slot while it runs, so no operation starts alongside", async () => {
    let finishWrite: (() => void) | null = null;
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );
    const writing = coordinator.runWriteAlone(
      () =>
        new Promise<void>((resolveWrite) => {
          finishWrite = resolveWrite;
        }),
    );
    await waitFor(() => (finishWrite ? true : null));

    await expect(
      coordinator.handlers["writeOperation:trash"](
        { paths: ["/Users/demo/a.txt"] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("Another write operation is already running.");
    await expect(coordinator.emptyTrash(async () => ({ ok: true, error: null }))).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );

    (finishWrite as (() => void) | null)?.();
    await expect(writing).resolves.toEqual({ ran: true, value: undefined });
    // Free again once it is done.
    await expect(
      coordinator.handlers["writeOperation:trash"](
        { paths: ["/Users/demo/a.txt"] },
        { sender: createSender() },
      ),
    ).resolves.toEqual(expect.objectContaining({ status: "queued" }));
    coordinator.shutdown();
  });

  it("frees the write slot when the write fails", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );

    await expect(
      coordinator.runWriteAlone(async () => {
        throw new Error("EIO");
      }),
    ).rejects.toThrow("EIO");
    await expect(coordinator.runWriteAlone(async () => 1)).resolves.toEqual({
      ran: true,
      value: 1,
    });
    coordinator.shutdown();
  });

  it("doesn't run once the app is quitting", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );
    await coordinator.shutdown();
    const write = vi.fn(async () => undefined);

    await expect(coordinator.runWriteAlone(write)).resolves.toEqual({ ran: false });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("questions during a paste", () => {
  it("passes on a question about an item dated before 1970", () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();
    startPaste(coordinator, sender);
    const conflict = createRuntimeConflict("conflict-old");
    emit({
      ...createCopyPasteTerminalEvent("copy-op-1", "awaiting_resolution"),
      runtimeConflict: {
        ...conflict,
        // 1 January 1950.
        currentDestinationFingerprint: {
          ...conflict.currentDestinationFingerprint,
          mtimeMs: -631152000000,
        },
      },
    });

    const sent = sender.send.mock.calls.map(
      ([, payload]) => payload as WriteOperationProgressEvent,
    );
    expect(sent.at(-1)).toMatchObject({
      status: "awaiting_resolution",
      runtimeConflict: { conflictId: "conflict-old" },
    });
    expect(writeService.resolveRuntimeConflict).not.toHaveBeenCalled();
    coordinator.shutdown();
  });

  // A question the window would never see would leave the paste waiting forever.
  it("answers Skip to a question that can't be sent, and goes on", () => {
    const { writeService, emit } = createSubscribingWriteService();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();
    startPaste(coordinator, sender);
    const conflict = createRuntimeConflict("conflict-bad");
    emit({
      ...createCopyPasteTerminalEvent("copy-op-1", "awaiting_resolution"),
      runtimeConflict: {
        ...conflict,
        currentDestinationFingerprint: { ...conflict.currentDestinationFingerprint, size: -1 },
      },
    });

    expect(writeService.resolveRuntimeConflict).toHaveBeenCalledWith(
      "copy-op-1",
      "conflict-bad",
      "skip",
      false,
    );
    const sent = sender.send.mock.calls.map(
      ([, payload]) => payload as WriteOperationProgressEvent,
    );
    expect(sent.at(-1)).toMatchObject({ status: "running", runtimeConflict: null });

    // Its end still reaches the window.
    emit(createCopyPasteTerminalEvent("copy-op-1", "completed"));
    expect(
      sender.send.mock.calls.map(([, payload]) => (payload as WriteOperationProgressEvent).status),
    ).toContain("completed");
    coordinator.shutdown();
  });
});

// The app's own wiring (see bootstrap), with a Trash that does nothing.
function createRealWriteOperationFs(overrides: Partial<WriteOperationFs> = {}): WriteOperationFs {
  return {
    ...createOriginalWriteOperationFs(vi.fn(async (path: string) => inTrash(path))),
    ...overrides,
  };
}

type Coordinator = ReturnType<typeof createWriteOperationCoordinator>;

// Where a stand-in Trash says an item went.
function inTrash(path: string): string {
  return `/Users/demo/.Trash/${basename(path)}`;
}

const LIFECYCLE_EVENTS = [
  "render-process-gone",
  "destroyed",
  "did-navigate",
  "did-start-navigation",
  "did-navigate-in-page",
] as const;

// A stand-in for WebContents: an event emitter that can be marked destroyed.
function createLifecycleSender() {
  const sender = Object.assign(new EventEmitter(), {
    destroyed: false,
    send: vi.fn<(channel: string, payload: unknown) => void>(),
    isDestroyed: () => sender.destroyed,
  });
  return sender;
}

function countLifecycleListeners(sender: EventEmitter): number {
  return LIFECYCLE_EVENTS.reduce((total, name) => total + sender.listenerCount(name), 0);
}

// Pastes from an analysis the same window started, as the app does.
function startPaste(coordinator: Coordinator, sender: ReturnType<typeof createSender>) {
  analyze(coordinator, sender);
  return coordinator.handlers["copyPaste:start"](
    {
      analysisId: "analysis-1",
      action: "paste",
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
    },
    { sender },
  );
}

function analyze(coordinator: Coordinator, sender: ReturnType<typeof createSender>) {
  return coordinator.handlers["copyPaste:analyzeStart"](
    {
      mode: "copy",
      sourcePaths: ["/Users/demo/a.txt"],
      destinationDirectoryPath: "/Users/demo/b",
      action: "paste",
    },
    { sender },
  );
}

// A write service stub that hands out sequential operation ids and lets the test emit
// progress events the way the real service does.
function createSubscribingWriteService() {
  const subscribers: Array<(event: Record<string, unknown>) => void> = [];
  let sequence = 0;
  const writeService = createWriteServiceStub();
  vi.mocked(writeService.subscribe).mockImplementation(((
    callback: (event: Record<string, unknown>) => void,
  ) => {
    subscribers.push(callback);
    return () => undefined;
  }) as unknown as WriteService["subscribe"]);
  vi.mocked(writeService.startCopyPaste).mockImplementation(() => {
    sequence += 1;
    return { operationId: `copy-op-${sequence}`, status: "queued" as const };
  });
  return {
    writeService,
    emit(event: Record<string, unknown>) {
      for (const subscriber of subscribers) {
        subscriber(event);
      }
    },
  };
}

function createRuntimeConflict(conflictId: string) {
  return {
    conflictId,
    analysisId: "analysis-1",
    sourcePath: "/Users/demo/source/b.txt",
    destinationPath: "/Users/demo/target/b.txt",
    sourceKind: "file" as const,
    destinationKind: "file" as const,
    conflictClass: "file_conflict" as const,
    reason: "destination_changed" as const,
    sourceFingerprint: createNodeFingerprint(),
    destinationFingerprint: createNodeFingerprint(),
    currentSourceFingerprint: createNodeFingerprint(),
    currentDestinationFingerprint: createNodeFingerprint(),
  };
}

function createCopyPasteTerminalEvent(
  operationId: string,
  status: "running" | "awaiting_resolution" | "completed" | "cancelled",
): Record<string, unknown> {
  const terminal = status === "completed" || status === "cancelled";
  return {
    operationId,
    mode: "copy",
    status,
    completedItemCount: 0,
    totalItemCount: 1,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: terminal
      ? {
          operationId,
          mode: "copy",
          status,
          destinationDirectoryPath: "/Users/demo/target",
          startedAt: "2026-03-10T12:00:00.000Z",
          finishedAt: "2026-03-10T12:00:00.050Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: status === "completed" ? 1 : 0,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: status === "cancelled" ? 1 : 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [],
          error: null,
        }
      : null,
  };
}

function createNodeFingerprint() {
  return {
    exists: true,
    kind: "file" as const,
    size: 1,
    mtimeMs: 1,
    mode: 0o644,
    ino: 1,
    dev: 1,
    symlinkTarget: null,
  };
}

function createWriteServiceStub(): WriteService {
  return {
    subscribe: vi.fn(() => () => undefined),
    startCopyPaste: vi.fn(() => ({ operationId: "copy-op-1", status: "queued" as const })),
    getCopyPasteAnalysisUpdate: vi.fn(() => ({
      analysisId: "analysis-1",
      status: "complete" as const,
      done: true,
      report: null,
      error: null,
    })),
    resolveRuntimeConflict: vi.fn(() => ({ ok: true })),
    cancelOperation: vi.fn(() => ({ ok: true })),
    startCopyPasteAnalysis: vi.fn(() => ({ analysisId: "analysis-1", status: "queued" as const })),
    cancelCopyPasteAnalysis: vi.fn(() => ({ ok: true })),
  } as unknown as WriteService;
}

function createWriteOperationFs(overrides: Partial<WriteOperationFs> = {}): WriteOperationFs {
  return {
    lstat:
      overrides.lstat ??
      vi.fn(async () => {
        throw new Error("missing");
      }),
    stat: overrides.stat ?? vi.fn(async () => createStats(true)),
    mkdir: overrides.mkdir ?? vi.fn(async () => undefined),
    rename: overrides.rename ?? vi.fn(async () => undefined),
    renameExclusive: overrides.renameExclusive ?? vi.fn(async () => undefined),
    rm: overrides.rm ?? vi.fn(async () => undefined),
    trash: overrides.trash ?? vi.fn(async (path: string) => inTrash(path)),
    ...(overrides.itemSize ? { itemSize: overrides.itemSize } : {}),
  };
}

type WriteOperationFs = Parameters<typeof createWriteOperationCoordinator>[1];

function createStats(directory: boolean) {
  return {
    isDirectory: () => directory,
  };
}

function createSender() {
  return {
    send: vi.fn<(channel: string, payload: unknown) => void>(),
  };
}

async function waitForTerminalEvent(
  sender: ReturnType<typeof createSender>,
  operationId: string,
): Promise<WriteOperationProgressEvent> {
  return waitFor(() => {
    const event = sender.send.mock.calls
      .map(([, payload]) => payload as WriteOperationProgressEvent)
      .find(
        (candidate) =>
          candidate.operationId === operationId &&
          ["completed", "failed", "cancelled", "partial"].includes(candidate.status),
      );
    return event ?? null;
  });
}

// Some of these tests copy real files, which takes as long as the disk takes: the wait is
// bounded by time, not by a number of turns of the event loop, so a busy machine does not
// fail it. It still returns as soon as the condition holds.
const WAIT_FOR_TIMEOUT_MS = 4_000;

async function waitFor<T>(read: () => T | null): Promise<T> {
  const deadline = Date.now() + WAIT_FOR_TIMEOUT_MS;
  for (;;) {
    const value = read();
    if (value !== null) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
}

// Nothing is pasted, made or put back into the Trash, and only what is in a Trash (or was
// just found to have none) is deleted for good, whatever the window asks.
describe("the Trash", () => {
  const home = "/Users/demo";

  it("refuses to paste, move or make anything in it", async () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs(), {
      homePath: home,
    });
    const into = (destinationDirectoryPath: string) => ({
      mode: "cut" as const,
      sourcePaths: ["/Users/demo/a.txt"],
      destinationDirectoryPath,
      action: "paste" as const,
    });

    for (const destination of [
      "/Users/demo/.Trash",
      "/Users/demo/.Trash/Old",
      "/Volumes/USB/.Trashes/501",
    ]) {
      await expect(
        coordinator.handlers["copyPaste:analyzeStart"](into(destination), {
          sender: createSender(),
        }),
      ).rejects.toThrow("Nothing can be pasted into the Trash.");
      await expect(
        coordinator.handlers["writeOperation:createFolder"](
          { parentDirectoryPath: destination, folderName: "New Folder" },
          { sender: createSender() },
        ),
      ).rejects.toThrow("Nothing can be made in the Trash.");
    }
    expect(writeService.startCopyPasteAnalysis).not.toHaveBeenCalled();
    coordinator.shutdown();
  });

  it("doesn't move what is already in it to the Trash again", async () => {
    const fs = createWriteOperationFs();
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: home,
    });

    await expect(
      coordinator.handlers["writeOperation:trash"](
        { paths: ["/Users/demo/.Trash/old.txt"] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("“old.txt” is already in the Trash.");
    expect(fs.trash).not.toHaveBeenCalled();
    coordinator.shutdown();
  });

  it("deletes for good only what is in a Trash", async () => {
    const fs = createWriteOperationFs();
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: home,
    });

    for (const path of [
      "/Users/demo/Work/report.txt",
      "/Users/demo/.Trash/../Work/report.txt",
      "/Users/demo/.Trash2/report.txt",
      "/Volumes/USB/report.txt",
    ]) {
      await expect(
        coordinator.handlers["writeOperation:deleteImmediately"](
          { paths: ["/Users/demo/.Trash/old.txt", path] },
          { sender: createSender() },
        ),
        path,
      ).rejects.toThrow("isn't in the Trash, so it can't be deleted immediately.");
    }
    expect(fs.rm).not.toHaveBeenCalled();
    coordinator.shutdown();
  });

  it("deletes for good what just couldn't go to the Trash because its disk has none", async () => {
    const trash = vi.fn(async (path: string) => {
      if (path.startsWith("/Volumes/Share/")) {
        throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
      }
      return inTrash(path);
    });
    const fs = createWriteOperationFs({ trash });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      homePath: home,
    });
    const sender = createSender();

    await coordinator.handlers["writeOperation:trash"](
      { paths: ["/Volumes/Share/a.txt", "/Users/demo/b.txt"] },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");
    expect(terminal.result?.items).toEqual([
      expect.objectContaining({
        sourcePath: "/Volumes/Share/a.txt",
        status: "failed",
        noTrash: true,
        error: "“a.txt” couldn’t be moved to the Trash because its disk has no Trash.",
      }),
      expect.not.objectContaining({ noTrash: true }),
    ]);

    // Another item on that disk wasn't asked about, so it can't be deleted this way.
    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: ["/Volumes/Share/other.txt"] },
        { sender: createSender() },
      ),
    ).rejects.toThrow("isn't in the Trash");
    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: ["/Volumes/Share/a.txt"] },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-2", status: "queued" });
    await waitForTerminalEvent(sender, "write-op-2");
    expect(fs.rm).toHaveBeenCalledWith("/Volumes/Share/a.txt", { recursive: true, force: true });
    coordinator.shutdown();
  });

  // A symlink inside the Trash to a folder elsewhere: what is "in" it through the link is
  // really outside the Trash.
  it("doesn't delete through a link in the Trash that leads out of it", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-trash-link-"));
    try {
      await mkdir(join(root, ".Trash"));
      await mkdir(join(root, "Work"));
      await writeFile(join(root, "Work", "report.txt"), "keep");
      await symlink(join(root, "Work"), join(root, ".Trash", "link"));
      const coordinator = createWriteOperationCoordinator(
        createWriteServiceStub(),
        createRealWriteOperationFs(),
        { homePath: root },
      );

      await expect(
        coordinator.handlers["writeOperation:deleteImmediately"](
          { paths: [join(root, ".Trash", "link", "report.txt")] },
          { sender: createSender() },
        ),
      ).rejects.toThrow("isn't in the Trash");
      expect(await readFile(join(root, "Work", "report.txt"), "utf8")).toBe("keep");
      coordinator.shutdown();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("New Folder and Trash, picked items and names", () => {
  // The window suggests a free name from what it lists, which may be out of date.
  it("takes the next free name when the one suggested was taken meanwhile", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-new-folder-"));
    try {
      await mkdir(join(root, "New Folder"));
      await mkdir(join(root, "New Folder 2"));
      await mkdir(join(root, "Untitled 3"));
      const coordinator = createWriteOperationCoordinator(
        createWriteServiceStub(),
        createRealWriteOperationFs(),
      );
      const sender = createSender();

      await coordinator.handlers["writeOperation:createFolder"](
        { parentDirectoryPath: root, folderName: "New Folder", nextFreeName: true },
        { sender },
      );
      const made = await waitForTerminalEvent(sender, "write-op-1");
      expect(made.result?.items[0]?.destinationPath).toBe(join(root, "New Folder 3"));

      await coordinator.handlers["writeOperation:createFolder"](
        { parentDirectoryPath: root, folderName: "Untitled 3", nextFreeName: true },
        { sender },
      );
      const second = await waitForTerminalEvent(sender, "write-op-2");
      expect(second.result?.items[0]?.destinationPath).toBe(join(root, "Untitled 4"));

      // A name the person typed is never changed: it is refused.
      await expect(
        coordinator.handlers["writeOperation:createFolder"](
          { parentDirectoryPath: root, folderName: "New Folder" },
          { sender },
        ),
      ).rejects.toThrow("An item named “New Folder” already exists.");
      coordinator.shutdown();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("moves a folder and an item inside it to the Trash as one item", async () => {
    const trash = vi.fn(async (path: string) => inTrash(path));
    const fs = createWriteOperationFs({ trash });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();

    await coordinator.handlers["writeOperation:trash"](
      { paths: ["/Users/demo/F/child.txt", "/Users/demo/F", "/Users/demo/F"] },
      { sender },
    );
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(trash.mock.calls).toEqual([["/Users/demo/F"]]);
    expect(terminal.result?.summary).toMatchObject({ totalItemCount: 1, completedItemCount: 1 });
    coordinator.shutdown();
  });
});
