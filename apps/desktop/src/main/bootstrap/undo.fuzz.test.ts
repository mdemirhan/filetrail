import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import type { WriteService } from "@filetrail/core";
import {
  REPLACE_ALL,
  nativeFileSystemWithTrash,
  runPaste,
} from "@filetrail/core/fs/testNativePaste";
import type { CopyPastePolicy } from "@filetrail/core/fs/writeServiceTypes";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { type Random, random } from "./batchRenameMemoryDisk.testkit";
import { createUndoHistory } from "./undoHistory";
import { createWriteOperationCoordinator } from "./writeOperations";

// Random runs of renames, batch renames, new folders, Trash, copies, moves and Replaces on
// a real disk, then Undo all the way back and Redo all the way forward:
// - With nothing changed in between, Undo gets back every item as it was (path, kind and
//   file id), and Redo gets back the end.
// - With random changes made outside the app between them, no item is ever lost or
//   replaced, every item left as it was says why, and nothing stays under a hidden name;
//   and the same for Redo after more changes.
// - With writes that fail (no permission) and Undos stopped part way, trying again gets
//   back to the start and Redo to the end; with failures that look like changes outside
//   (a name taken, an item gone), nothing is lost or replaced.
// The cases come from seeds, so a failure names the seed that makes it again:
//   UNDO_FUZZ_SEED=1234 UNDO_FUZZ_CASES=1 bun ./apps/desktop/scripts/runVitest.ts run undo.fuzz
const FIRST_SEED = Number(process.env.UNDO_FUZZ_SEED ?? 1);
const CASES = Number(process.env.UNDO_FUZZ_CASES ?? 60);

const OPERATIONS = ["rename", "newFolder", "trash", "batch", "copy", "move", "replace"] as const;

const KEEP_BOTH: CopyPastePolicy = {
  file: "keep_both",
  directory: "keep_both",
  mismatch: "keep_both",
};

type Item = { path: string; isFolder: boolean };

// Writes that fail on their own, with these error codes, and Undos stopped after a write.
type Failures = { codes: string[]; chance: number; stopChance: number };

class Case {
  readonly root = mkdtempSync(join(tmpdir(), "filetrail-undo-fuzz-"));
  readonly trashDir = join(this.root, ".Trash");
  readonly pasteTrashDir = join(this.root, ".PasteTrash");
  readonly history = createUndoHistory();
  readonly sender = { send: vi.fn<(channel: string, payload: unknown) => void>() };
  readonly coordinator;
  // One for the whole case: its Trash numbers items, so two never take one name there.
  readonly pasteFileSystem = nativeFileSystemWithTrash(this.pasteTrashDir);
  readonly log: string[] = [];
  private names = 0;
  private outsideNames = 0;
  private trashed = 0;
  // While set, the app's writes fail and stop at random (the operations themselves run
  // before it is set, so only Undo and Redo meet it).
  failures: Failures | null = null;

  constructor(readonly random: Random) {
    mkdirSync(this.trashDir);
    mkdirSync(this.pasteTrashDir);
    for (const folder of ["A", "A/Sub", "B", "C"]) {
      mkdirSync(join(this.root, folder));
    }
    for (const file of ["A/x.txt", "A/y.txt", "A/Sub/x.txt", "B/x.txt", "B/z.txt"]) {
      writeFileSync(join(this.root, file), file);
    }
    const trash = async (path: string) => {
      this.trashed += 1;
      const destination = join(this.trashDir, `${this.trashed}-${basename(path)}`);
      renameSync(path, destination);
      return destination;
    };
    const fs = createOriginalWriteOperationFs(trash);
    this.coordinator = createWriteOperationCoordinator(
      {
        subscribe: () => () => undefined,
        cancelOperation: () => ({ ok: true }),
      } as unknown as WriteService,
      {
        ...fs,
        renameExclusive: (from, to) => this.failOrStop(from, () => fs.renameExclusive(from, to)),
        rename: (from, to) => this.failOrStop(from, () => fs.rename(from, to)),
        trash: (path) => this.failOrStop(path, () => fs.trash(path)),
      },
      { homePath: this.root, recordUndo: this.history.record, undoHistory: this.history },
    );
  }

  // A write that may fail before it starts, or stop the operation once it is done. An item
  // waiting under a batch rename's hidden name always gets out of it: a failure there is
  // left to the batch rename's own fuzz test.
  private async failOrStop<T>(path: string, write: () => Promise<T>): Promise<T> {
    const failures = this.failures;
    if (
      failures &&
      !basename(path).startsWith(".filetrail") &&
      this.random.chance(failures.chance)
    ) {
      const code = this.random.pick(failures.codes);
      throw Object.assign(new Error(`${code}: failed on purpose`), { code });
    }
    const written = await write();
    const running = this.coordinator.getActiveOperation();
    if (failures && running && this.random.chance(failures.stopChance)) {
      this.coordinator.handlers["writeOperation:cancel"](
        { operationId: running.operationId },
        { sender: this.sender },
      );
    }
    return written;
  }

  dispose(): void {
    void this.coordinator.shutdown();
    rmSync(this.root, { recursive: true, force: true });
  }

  // Every item but the Trash folders, as "path kind id".
  snapshot(): string[] {
    return this.items().map((item) => {
      const stats = lstatSync(item.path);
      return `${relative(this.root, item.path)} ${item.isFolder ? "dir" : "file"} ${stats.ino}`;
    });
  }

  items(folder = this.root): Item[] {
    const found: Item[] = [];
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (path === this.trashDir || path === this.pasteTrashDir) {
        continue;
      }
      const isFolder = lstatSync(path).isDirectory();
      found.push({ path, isFolder });
      if (isFolder) {
        found.push(...this.items(path));
      }
    }
    return found;
  }

  // Every file id anywhere under the root, the Trash folders included.
  ids(folder = this.root): Set<number> {
    const ids = new Set<number>();
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      const stats = lstatSync(path);
      ids.add(stats.ino);
      if (stats.isDirectory()) {
        for (const id of this.ids(path)) {
          ids.add(id);
        }
      }
    }
    return ids;
  }

  hiddenLeftovers(folder = this.root): string[] {
    const found: string[] = [];
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (name.startsWith(".filetrail")) {
        found.push(relative(this.root, path));
      }
      if (lstatSync(path).isDirectory()) {
        found.push(...this.hiddenLeftovers(path));
      }
    }
    return found;
  }

  folders(): string[] {
    return [
      this.root,
      ...this.items()
        .filter((item) => item.isFolder)
        .map((item) => item.path),
    ];
  }

  freshName(): string {
    this.names += 1;
    return `n${this.names}`;
  }

  async finish(
    started: Promise<{ operationId: string }> | { operationId: string },
  ): Promise<WriteOperationProgressEvent | null> {
    let operationId: string;
    try {
      ({ operationId } = await started);
    } catch {
      // Refused before it started (a name taken, say): nothing happened.
      return null;
    }
    for (;;) {
      const terminal = this.sender.send.mock.calls
        .map(([, payload]) => payload as WriteOperationProgressEvent)
        .find(
          (event) =>
            event.operationId === operationId &&
            ["completed", "failed", "cancelled", "partial"].includes(event.status),
        );
      if (terminal) {
        return terminal;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    }
  }

  // One random operation the person could make. Says which kind, when it went into the
  // history.
  async operate(): Promise<string | null> {
    const before = this.history.generation();
    const kind = await this.operateOnce();
    return this.history.generation() !== before ? kind : null;
  }

  private async operateOnce(): Promise<string> {
    const { random: r, coordinator, sender } = this;
    const items = this.items();
    const kind = r.pick(OPERATIONS);
    const item = items.length > 0 ? r.pick(items) : null;
    switch (kind) {
      case "rename": {
        if (!item) return kind;
        const name = r.chance(0.2) ? basename(item.path).toUpperCase() : this.freshName();
        this.log.push(`rename ${relative(this.root, item.path)} -> ${name}`);
        await this.finish(
          coordinator.handlers["writeOperation:rename"](
            { sourcePath: item.path, destinationName: name },
            { sender },
          ),
        );
        return kind;
      }
      case "newFolder": {
        const parent = r.pick(this.folders());
        const name = this.freshName();
        this.log.push(`new folder ${relative(this.root, join(parent, name))}`);
        await this.finish(
          coordinator.handlers["writeOperation:createFolder"](
            { parentDirectoryPath: parent, folderName: name },
            { sender },
          ),
        );
        return kind;
      }
      case "trash": {
        if (items.length === 0) return kind;
        const picked = r
          .shuffle(items)
          .slice(0, r.integer(1, 2))
          .map((each) => each.path);
        this.log.push(`trash ${picked.map((path) => relative(this.root, path)).join(", ")}`);
        await this.finish(
          coordinator.handlers["writeOperation:trash"]({ paths: picked }, { sender }),
        );
        return kind;
      }
      case "batch": {
        const folder = r.pick(this.folders());
        const children = items.filter((each) => dirname(each.path) === folder);
        if (children.length === 0) return kind;
        const picked = r.shuffle(children).slice(0, r.integer(1, 3));
        const swap = picked.length >= 2 && r.chance(0.5);
        const renames = picked.map((each, index) => ({
          sourcePath: each.path,
          destinationName: swap
            ? basename((picked[(index + 1) % picked.length] as Item).path)
            : this.freshName(),
          isFolder: each.isFolder,
        }));
        this.log.push(
          `batch ${renames.map((each) => `${relative(this.root, each.sourcePath)}->${each.destinationName}`).join(", ")}`,
        );
        await this.finish(
          coordinator.handlers["writeOperation:batchRename"](
            { items: renames, onConflict: "number", numberSeparator: " " },
            { sender },
          ),
        );
        return kind;
      }
      case "copy":
      case "move":
      case "replace": {
        if (!item) return kind;
        const into = this.folders().filter(
          (folder) =>
            folder !== item.path &&
            !folder.startsWith(`${item.path}/`) &&
            (kind === "copy" || folder !== dirname(item.path)),
        );
        const targets =
          kind === "replace"
            ? into.filter((folder) => {
                try {
                  return (
                    lstatSync(join(folder, basename(item.path))).isDirectory() === item.isFolder
                  );
                } catch {
                  return false;
                }
              })
            : into;
        if (targets.length === 0) return kind;
        const destination = r.pick(targets);
        const mode = kind === "copy" || (kind === "replace" && r.chance(0.5)) ? "copy" : "cut";
        this.log.push(
          `${kind} (${mode}) ${relative(this.root, item.path)} -> ${relative(this.root, destination) || "."}`,
        );
        const { result } = await runPaste({
          mode,
          sourcePaths: [item.path],
          destinationDirectoryPath: destination,
          policy: kind === "replace" ? REPLACE_ALL : KEEP_BOTH,
          fileSystem: this.pasteFileSystem,
        });
        if (result?.undoLog && (!result.undoLog.undoable || result.undoLog.units.length > 0)) {
          this.history.record({
            action: kind === "copy" ? "copy_to" : kind === "move" ? "move_to" : "paste",
            log: result.undoLog,
            items: result.items,
          });
        }
        return kind;
      }
    }
  }

  // One random change made outside the app: what it removed for good, if anything.
  changeOutside(): Set<number> {
    const { random: r } = this;
    const items = this.items();
    const removed = new Set<number>();
    if (items.length === 0) {
      return removed;
    }
    const item = r.pick(items);
    switch (r.integer(0, 4)) {
      case 0: {
        for (const id of this.ids(item.isFolder ? item.path : dirname(item.path))) {
          if (!item.isFolder) break;
          removed.add(id);
        }
        removed.add(lstatSync(item.path).ino);
        this.log.push(`outside: delete ${relative(this.root, item.path)}`);
        rmSync(item.path, { recursive: true, force: true });
        return removed;
      }
      case 1: {
        this.outsideNames += 1;
        const name = `outside ${this.outsideNames}`;
        this.log.push(`outside: rename ${relative(this.root, item.path)} -> ${name}`);
        renameSync(item.path, join(dirname(item.path), name));
        return removed;
      }
      case 2: {
        // Something new under a name an item had, or may get back.
        const name = r.pick(["x.txt", "y.txt", "z.txt", "n1", "n2", "Sub"]);
        const path = join(dirname(item.path), name);
        try {
          lstatSync(path);
        } catch {
          this.log.push(`outside: new ${relative(this.root, path)}`);
          writeFileSync(path, "new outside");
        }
        return removed;
      }
      case 3: {
        if (!item.isFolder) {
          this.log.push(`outside: edit ${relative(this.root, item.path)}`);
          writeFileSync(item.path, "edited outside");
        }
        return removed;
      }
      default: {
        // The Trash emptied, in part.
        const inTrash = readdirSync(this.trashDir);
        if (inTrash.length > 0) {
          const name = r.pick(inTrash);
          for (const id of this.ids(this.trashDir)) {
            removed.add(id);
          }
          this.log.push(`outside: empty ${name} from the Trash`);
          rmSync(join(this.trashDir, name), { recursive: true, force: true });
          // Ids of what is still there stay counted.
          for (const id of this.ids(this.trashDir)) {
            removed.delete(id);
          }
        }
        return removed;
      }
    }
  }

  // Undoes (or redoes) until there is nothing left, as many times as it takes: what failed
  // or was stopped stays on the list for the next try.
  async undoAll(direction: "undo" | "redo", tries = 50) {
    const results: WriteOperationProgressEvent[] = [];
    for (let step = 0; step < tries; step += 1) {
      const prepared = await this.coordinator.handlers["undo:prepare"]({ direction });
      if (prepared.ticket === null) {
        return results;
      }
      const terminal = await this.finish(
        this.coordinator.handlers["undo:start"](
          { ticket: prepared.ticket },
          { sender: this.sender },
        ),
      );
      if (terminal) {
        results.push(terminal);
      }
    }
    throw new Error("Undo never ran out of things to undo.");
  }
}

function fail(seed: number, testCase: Case, message: string): never {
  throw new Error(
    `${message}\nReproduce: UNDO_FUZZ_SEED=${seed} UNDO_FUZZ_CASES=1 bun ./apps/desktop/scripts/runVitest.ts run undo.fuzz\n${testCase.log.join("\n")}`,
  );
}

describe("Undo, fuzzed on a real disk", () => {
  it("gets back to the start, and Redo to the end, when nothing else changes", async () => {
    const recorded = new Set<string>();
    let undoneOperations = 0;
    for (let seed = FIRST_SEED; seed < FIRST_SEED + CASES; seed += 1) {
      const testCase = new Case(random(seed));
      try {
        const start = testCase.snapshot();
        const operations = testCase.random.integer(1, 6);
        for (let index = 0; index < operations; index += 1) {
          const kind = await testCase.operate();
          if (kind !== null) {
            recorded.add(kind);
          }
        }
        const end = testCase.snapshot();
        // Undo goes back only as far as the last operation that can't be undone.
        const fullyUndoable = !testCase.history.menu().cantUndo;
        const undone = await testCase.undoAll("undo");
        undoneOperations += undone.length;
        for (const result of undone) {
          if (result.status !== "completed") {
            fail(seed, testCase, `An Undo ended "${result.status}": ${result.result?.error}`);
          }
        }
        if (fullyUndoable && testCase.snapshot().join("\n") !== start.join("\n")) {
          fail(
            seed,
            testCase,
            `Undo didn't get back to the start.\nStart:\n${start.join("\n")}\nNow:\n${testCase.snapshot().join("\n")}`,
          );
        }
        await testCase.undoAll("redo");
        if (testCase.snapshot().join("\n") !== end.join("\n")) {
          fail(
            seed,
            testCase,
            `Redo didn't get back to the end.\nEnd:\n${end.join("\n")}\nNow:\n${testCase.snapshot().join("\n")}`,
          );
        }
        if (testCase.hiddenLeftovers().length > 0) {
          fail(seed, testCase, `Hidden items left: ${testCase.hiddenLeftovers().join(", ")}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Reproduce:")) {
          throw error;
        }
        fail(seed, testCase, `Stopped: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        testCase.dispose();
      }
    }
    // Every kind of operation went into the history and was undone, in a run long enough.
    if (CASES >= 50) {
      expect([...recorded].sort()).toEqual([...OPERATIONS].sort());
      expect(undoneOperations).toBeGreaterThan(CASES);
    }
  }, 120_000);

  it("loses and replaces nothing, and says why it left anything, when things change outside", async () => {
    for (let seed = FIRST_SEED; seed < FIRST_SEED + CASES; seed += 1) {
      const testCase = new Case(random(seed));
      try {
        const operations = testCase.random.integer(1, 6);
        for (let index = 0; index < operations; index += 1) {
          await testCase.operate();
          if (testCase.random.chance(0.3)) {
            testCase.changeOutside();
          }
        }
        const removedOutside = new Set<number>();
        for (let index = testCase.random.integer(0, 3); index > 0; index -= 1) {
          for (const id of testCase.changeOutside()) {
            removedOutside.add(id);
          }
        }
        const before = testCase.ids();
        const undone = await testCase.undoAll("undo");
        const after = testCase.ids();
        for (const id of before) {
          if (!removedOutside.has(id) && !after.has(id)) {
            fail(seed, testCase, `An item (id ${id}) was lost by Undo.`);
          }
        }
        checkSaidWhy(seed, testCase, undone);
        if (testCase.hiddenLeftovers().length > 0) {
          fail(seed, testCase, `Hidden items left: ${testCase.hiddenLeftovers().join(", ")}`);
        }
        // And Redo of what was undone, after more changes outside.
        for (let index = testCase.random.integer(0, 2); index > 0; index -= 1) {
          for (const id of testCase.changeOutside()) {
            removedOutside.add(id);
          }
        }
        const redone = await testCase.undoAll("redo");
        const afterRedo = testCase.ids();
        for (const id of before) {
          if (!removedOutside.has(id) && !afterRedo.has(id)) {
            fail(seed, testCase, `An item (id ${id}) was lost by Redo.`);
          }
        }
        checkSaidWhy(seed, testCase, redone);
        if (testCase.hiddenLeftovers().length > 0) {
          fail(seed, testCase, `Hidden items left: ${testCase.hiddenLeftovers().join(", ")}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Reproduce:")) {
          throw error;
        }
        fail(seed, testCase, `Stopped: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        testCase.dispose();
      }
    }
  }, 120_000);

  it("gets back to the start, and Redo to the end, through failed writes and stops", async () => {
    let failed = 0;
    let stopped = 0;
    for (let seed = FIRST_SEED; seed < FIRST_SEED + CASES; seed += 1) {
      const testCase = new Case(random(seed));
      try {
        const start = testCase.snapshot();
        const operations = testCase.random.integer(1, 6);
        for (let index = 0; index < operations; index += 1) {
          await testCase.operate();
        }
        const end = testCase.snapshot();
        const fullyUndoable = !testCase.history.menu().cantUndo;
        // No permission, or the Trash refusing, now and then: what failed stays on the list
        // and is tried again by the next Undo.
        testCase.failures = { codes: ["EACCES", "EPERM"], chance: 0.2, stopChance: 0.1 };
        const undone = await testCase.undoAll("undo", 500);
        if (fullyUndoable && testCase.snapshot().join("\n") !== start.join("\n")) {
          fail(
            seed,
            testCase,
            `Undo didn't get back to the start.\nStart:\n${start.join("\n")}\nNow:\n${testCase.snapshot().join("\n")}`,
          );
        }
        const redone = await testCase.undoAll("redo", 500);
        if (testCase.snapshot().join("\n") !== end.join("\n")) {
          fail(
            seed,
            testCase,
            `Redo didn't get back to the end.\nEnd:\n${end.join("\n")}\nNow:\n${testCase.snapshot().join("\n")}`,
          );
        }
        for (const result of [...undone, ...redone]) {
          if (result.result?.items.some((item) => item.status === "failed")) {
            failed += 1;
          }
          if (result.status === "partial" && result.result?.error?.startsWith("Stopped")) {
            stopped += 1;
          }
          // Only what failed is left, never anything skipped: nothing changed outside.
          if (result.result?.items.some((item) => item.status === "skipped")) {
            fail(seed, testCase, `An item was skipped: ${JSON.stringify(result.result?.items)}`);
          }
        }
        checkSaidWhy(seed, testCase, [...undone, ...redone]);
        if (testCase.hiddenLeftovers().length > 0) {
          fail(seed, testCase, `Hidden items left: ${testCase.hiddenLeftovers().join(", ")}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Reproduce:")) {
          throw error;
        }
        fail(seed, testCase, `Stopped: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        testCase.dispose();
      }
    }
    if (CASES >= 50) {
      expect(failed).toBeGreaterThan(0);
      expect(stopped).toBeGreaterThan(0);
    }
  }, 120_000);

  it("loses and replaces nothing when writes fail as if things changed outside", async () => {
    for (let seed = FIRST_SEED; seed < FIRST_SEED + CASES; seed += 1) {
      const testCase = new Case(random(seed));
      try {
        const operations = testCase.random.integer(1, 6);
        for (let index = 0; index < operations; index += 1) {
          await testCase.operate();
        }
        const before = testCase.ids();
        testCase.failures = {
          codes: ["EACCES", "EPERM", "ENOENT", "EEXIST"],
          chance: 0.2,
          stopChance: 0.1,
        };
        const undone = await testCase.undoAll("undo", 500);
        const redone = await testCase.undoAll("redo", 500);
        // Nothing was deleted, and nothing taken a name from another item: every id is
        // still somewhere.
        const after = testCase.ids();
        for (const id of before) {
          if (!after.has(id)) {
            fail(seed, testCase, `An item (id ${id}) was lost.`);
          }
        }
        checkSaidWhy(seed, testCase, [...undone, ...redone]);
        if (testCase.hiddenLeftovers().length > 0) {
          fail(seed, testCase, `Hidden items left: ${testCase.hiddenLeftovers().join(", ")}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("Reproduce:")) {
          throw error;
        }
        fail(seed, testCase, `Stopped: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        testCase.dispose();
      }
    }
  }, 120_000);
});

// Every item left as it was says why.
function checkSaidWhy(seed: number, testCase: Case, results: WriteOperationProgressEvent[]): void {
  for (const result of results) {
    for (const item of result.result?.items ?? []) {
      if ((item.status === "skipped" || item.status === "failed") && !item.error) {
        fail(seed, testCase, `An item was left without saying why: ${JSON.stringify(item)}`);
      }
    }
  }
}
