import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { recoverInterruptedReplaces } from "./copyPasteRecovery";
import { MockWriteServiceFileSystem } from "./testUtils";
import {
  type CopyPasteOperationResult,
  type CopyPastePolicy,
  type CopyPasteProgressEvent,
  type ReplaceJournalEntry,
  type WriteJournalEntry,
  isReplaceJournalEntry,
} from "./writeServiceTypes";

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function recordingJournal(onAdd: (entry: ReplaceJournalEntry) => void = () => undefined) {
  const live = new Map<string, ReplaceJournalEntry>();
  return {
    live,
    journal: {
      add: async (entry: WriteJournalEntry) => {
        if (isReplaceJournalEntry(entry)) {
          live.set(entry.id, entry);
          onAdd(entry);
        }
      },
      remove: async (id: string) => {
        live.delete(id);
      },
    },
  };
}

// Removing a hidden copy takes one item in it away, then the disk errs: what is left is
// only part of the copy.
function failRemovingHiddenCopiesPartWay(fileSystem: MockWriteServiceFileSystem): void {
  fileSystem.rmImpl = async (path) => {
    if (!path.includes(".filetrail-")) {
      throw codeError("EPERM");
    }
    const inside = [...fileSystem.nodes.keys()].find((key) => key.startsWith(`${path}/`));
    if (inside !== undefined) {
      fileSystem.nodes.delete(inside);
    }
    throw codeError("EIO");
  };
}

async function paste(args: {
  fileSystem: MockWriteServiceFileSystem;
  policy: CopyPastePolicy;
  writeJournal: ReturnType<typeof recordingJournal>["journal"];
}): Promise<CopyPasteOperationResult> {
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-1",
    request: { mode: "copy", sourcePaths: ["/source/dir"], destinationDirectoryPath: "/target" },
    fileSystem: args.fileSystem,
    thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1000 },
  });
  const events: CopyPasteProgressEvent[] = [];
  await executeCopyPasteFromAnalysis({
    operationId: "op-1",
    report,
    mode: "copy",
    policy: args.policy,
    fileSystem: args.fileSystem,
    now: () => new Date("2026-10-09T00:00:00.000Z"),
    signal: new AbortController().signal,
    resolvedNodes: await resolveAnalysisWithPolicy({
      report,
      policy: args.policy,
      fileSystem: args.fileSystem,
    }),
    emit: (event) => events.push(event),
    requestResolution: async () => null,
    writeJournal: args.writeJournal,
  });
  const result = events.at(-1)?.result;
  if (!result) {
    throw new Error("The paste didn't finish.");
  }
  return result;
}

function hiddenCopies(fileSystem: MockWriteServiceFileSystem): string[] {
  return [...fileSystem.nodes.keys()].filter((path) => /\/\.dir\.filetrail-[0-9a-f]+$/u.test(path));
}

describe("a complete hidden copy given up, whose removal stops part way", () => {
  it("is removed at the next start, not put in place as if whole (a folder copied)", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/dir/a.txt": { kind: "file", size: 1 },
      "/source/dir/b.txt": { kind: "file", size: 2 },
      "/target": { kind: "directory" },
    });
    fileSystem.enableRename();
    // Complete, but it can't take its name.
    fileSystem.renameImpl = async (from, to) => {
      if (to === "/target/dir") {
        throw codeError("EIO");
      }
      await fileSystem.renameDirectly(from, to);
    };
    const { live, journal } = recordingJournal((entry) => {
      if (entry.staged) {
        failRemovingHiddenCopiesPartWay(fileSystem);
      }
    });

    const result = await paste({
      fileSystem,
      policy: { file: "skip", directory: "skip", mismatch: "skip" },
      writeJournal: journal,
    });

    expect(result.status).toBe("failed");
    const entries = [...live.values()];
    expect(entries).toEqual([expect.objectContaining({ staged: false })]);
    expect(hiddenCopies(fileSystem)).toHaveLength(1);

    // The next start.
    fileSystem.rmImpl = null;
    fileSystem.renameImpl = null;
    const outcomes = await recoverInterruptedReplaces(entries, fileSystem);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: "removed_copy" })]);
    expect(fileSystem.exists("/target/dir")).toBe(false);
    expect(hiddenCopies(fileSystem)).toEqual([]);
  });

  it("is removed at the next start when a Replace is undone (the old folder went meanwhile)", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/dir/a.txt": { kind: "file", size: 1 },
      "/source/dir/b.txt": { kind: "file", size: 2 },
      "/target/dir/old.txt": { kind: "file", size: 3 },
    });
    fileSystem.enableRename();
    fileSystem.enableTrash();
    const { live, journal } = recordingJournal((entry) => {
      if (entry.staged) {
        // Another app deletes the folder being replaced: the Replace is undone.
        for (const key of [...fileSystem.nodes.keys()]) {
          if (key === "/target/dir" || key.startsWith("/target/dir/")) {
            fileSystem.nodes.delete(key);
          }
        }
        failRemovingHiddenCopiesPartWay(fileSystem);
      }
    });

    const result = await paste({
      fileSystem,
      policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      writeJournal: journal,
    });

    expect(result.status).toBe("failed");
    const entries = [...live.values()];
    expect(entries).toEqual([expect.objectContaining({ staged: false })]);

    fileSystem.rmImpl = null;
    const outcomes = await recoverInterruptedReplaces(entries, fileSystem);

    expect(outcomes).toEqual([expect.objectContaining({ outcome: "removed_copy" })]);
    expect(fileSystem.exists("/target/dir")).toBe(false);
    expect(hiddenCopies(fileSystem)).toEqual([]);
  });

  it("is left whole, for the next start to put in place, when its record can't be changed", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/dir/a.txt": { kind: "file", size: 1 },
      "/source/dir/b.txt": { kind: "file", size: 2 },
      "/target": { kind: "directory" },
    });
    fileSystem.enableRename();
    fileSystem.renameImpl = async (from, to) => {
      if (to === "/target/dir") {
        throw codeError("EIO");
      }
      await fileSystem.renameDirectly(from, to);
    };
    const { live, journal } = recordingJournal();
    let journalWorks = true;
    const add = journal.add;
    journal.add = async (entry) => {
      if (!journalWorks) {
        throw codeError("EIO");
      }
      await add(entry);
      if (isReplaceJournalEntry(entry) && entry.staged) {
        journalWorks = false;
      }
    };

    await paste({
      fileSystem,
      policy: { file: "skip", directory: "skip", mismatch: "skip" },
      writeJournal: journal,
    });

    expect([...live.values()]).toEqual([expect.objectContaining({ staged: true })]);
    const [hidden] = hiddenCopies(fileSystem);
    expect(fileSystem.exists(`${hidden}/a.txt`)).toBe(true);
    expect(fileSystem.exists(`${hidden}/b.txt`)).toBe(true);
  });
});
