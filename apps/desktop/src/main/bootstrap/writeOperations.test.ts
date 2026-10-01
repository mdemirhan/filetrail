import { describe, expect, it, vi } from "vitest";

import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import { type WriteService, createWriteService } from "@filetrail/core";

import { PROGRESS_UPDATE_INTERVAL_MS, createWriteOperationCoordinator } from "./writeOperations";

const electronMock = vi.hoisted(() => ({
  trashItem: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: {
    trashItem: electronMock.trashItem,
  },
}));

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

    expect(fs.rename).toHaveBeenCalledWith("/Users/demo/source.txt", "/Users/demo/renamed.txt");
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

  it("moves local paths to Trash through Electron shell and reports partial failures", async () => {
    electronMock.trashItem.mockReset();
    electronMock.trashItem
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Trash unavailable"));
    const sender = createSender();
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );

    expect(
      coordinator.handlers["writeOperation:trash"](
        {
          paths: ["/Users/demo/a.txt", "/Users/demo/b.txt", "/Users/demo/c.txt"],
        },
        { sender },
      ),
    ).toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(electronMock.trashItem).toHaveBeenCalledWith("/Users/demo/a.txt");
    expect(electronMock.trashItem).toHaveBeenCalledWith("/Users/demo/b.txt");
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "trash",
        status: "partial",
        completedItemCount: 1,
        result: expect.objectContaining({
          error: "Trash unavailable",
          items: [
            expect.objectContaining({ sourcePath: "/Users/demo/a.txt", status: "completed" }),
            expect.objectContaining({ sourcePath: "/Users/demo/b.txt", status: "failed" }),
            expect.objectContaining({ sourcePath: "/Users/demo/c.txt", status: "cancelled" }),
          ],
        }),
      }),
    );

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
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        {
          paths: ["/Users/demo/a.txt", "/Users/demo/b.txt", "/Users/demo/c.txt"],
        },
        { sender },
      ),
    ).toEqual({ operationId: "write-op-1", status: "queued" });
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
    expect(() =>
      coordinator.handlers["writeOperation:trash"](
        { paths: [trashPath] },
        { sender: createSender() },
      ),
    ).toThrow("protected system directory");
    expect(() =>
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: [trashPath] },
        { sender: createSender() },
      ),
    ).toThrow("protected system directory");

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
      rename: vi.fn(
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
      rename: vi.fn(
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
    expect(() =>
      coordinator.handlers["copyPaste:start"](
        {
          analysisId: "analysis-1",
          action: "paste",
          policy: { file: "skip", directory: "merge", mismatch: "skip" },
        },
        { sender },
      ),
    ).toThrow("Another write operation is already running.");

    (finishLstat as (() => void) | null)?.();
    rename.catch(() => undefined);
    coordinator.shutdown();
  });

  it("passes per-item choices and standing runtime answers to the write service", () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();

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

    expect(writeService.startCopyPaste).toHaveBeenCalledWith({
      analysisId: "analysis-1",
      policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
      overrides: [{ nodeId: "item-2", action: "overwrite" }],
    });
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
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createLifecycleSender();

    coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: ["/Users/demo/a.txt", "/Users/demo/b.txt"] },
      { sender },
    );
    await waitFor(() => (finishFirstDelete ? true : null));
    sender.emit("did-navigate");
    (finishFirstDelete as (() => void) | null)?.();
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(terminal.status).toBe("cancelled");
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
        rename: vi.fn(
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
    sender.destroyed = true;

    startPaste(coordinator, sender);

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
      rename: vi.fn(
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
    const { analysisId } = coordinator.handlers["copyPaste:analyzeStart"]({
      mode: "copy",
      sourcePaths: [join(source, "album"), join(source, "shared")],
      destinationDirectoryPath: destination,
      action: "paste",
    });
    const update = await waitFor(() => {
      const current = coordinator.handlers["copyPaste:analyzeGetUpdate"]({ analysisId });
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

    const { operationId } = coordinator.handlers["copyPaste:start"](
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
      rename: vi.fn(
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

type Coordinator = ReturnType<typeof createWriteOperationCoordinator>;

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

function startPaste(coordinator: Coordinator, sender: ReturnType<typeof createSender>) {
  return coordinator.handlers["copyPaste:start"](
    {
      analysisId: "analysis-1",
      action: "paste",
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
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
    planCopyPaste: vi.fn(),
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
    rm: overrides.rm ?? vi.fn(async () => undefined),
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

async function waitFor<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = read();
    if (value !== null) {
      return value;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
  throw new Error("Timed out waiting for condition.");
}
