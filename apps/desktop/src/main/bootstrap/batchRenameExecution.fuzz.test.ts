import { basename, dirname } from "node:path";

import type { IpcRequest } from "@filetrail/contracts";

import { type BatchRenameRun, runBatchRename } from "./batchRenameExecution";
import { MemoryDisk, type Random, errno, random } from "./batchRenameMemoryDisk.testkit";

// Random folders and random renames, with random failures and stops: whatever happens, no
// item is lost or replaced, and every result says where its item really is. The cases come
// from seeds, so a failure names the seed that makes it again:
//   BATCH_RENAME_FUZZ_SEED=1234 BATCH_RENAME_FUZZ_CASES=1 bun ./apps/desktop/scripts/runVitest.ts run batchRenameExecution.fuzz
const FIRST_SEED = Number(process.env.BATCH_RENAME_FUZZ_SEED ?? 1);
const CASES = Number(process.env.BATCH_RENAME_FUZZ_CASES ?? 400);

const NFC_E = "\u00e9";
const NFD_E = "e\u0301";
// Few names, so they clash often: case variants, accents typed both ways, numbered names,
// and the temporary names the rename itself uses.
const NAMES = [
  "a",
  "b",
  "c",
  "A",
  "B",
  "x.txt",
  "X.TXT",
  "File 1",
  "File 2",
  "File 3",
  "File 1.jpg",
  "File 2.jpg",
  "File-2.jpg",
  "notes",
  "Notes",
  NFC_E,
  NFD_E,
  `Caf${NFC_E}`,
  `Caf${NFD_E}`,
  `CAF${NFC_E.toUpperCase()}`,
  ".tmp-0",
  ".tmp-2",
] as const;
const CODES = ["EACCES", "EIO", "ENOENT", "EEXIST"] as const;
const ON_CONFLICT = ["number", "skip", "block"] as const;
const SEPARATORS = [" ", "-", "_"] as const;

type FuzzCase = {
  disk: MemoryDisk;
  request: IpcRequest<"writeOperation:batchRename">;
  /** Stop as the item with this many done starts, or after this many renames. */
  stopAtItemStart: number | null;
  stopAfterMoves: number | null;
  failureRate: number;
  /** Where the failures come from: the same ones for the same case. */
  failureSeed: number;
};

function makeCase(rng: Random, options: { nested: boolean }): FuzzCase {
  const caseSensitive = rng.chance(0.25);
  const disk = new MemoryDisk([], caseSensitive);
  const key = (name: string) =>
    caseSensitive ? name.normalize("NFD") : name.normalize("NFD").toLowerCase();
  // Names unique as the disk compares them.
  const someNames = (count: number) => {
    const chosen = new Map<string, string>();
    for (const name of rng.shuffle(NAMES)) {
      if (chosen.size === count) {
        break;
      }
      if (!chosen.has(key(name))) {
        chosen.set(key(name), name);
      }
    }
    return [...chosen.values()];
  };

  const folders = rng.chance(0.4) ? ["/trip", "/home"] : ["/trip"];
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    disk.add(folder);
    const names = someNames(rng.integer(2, 6));
    children.set(folder, names);
    for (const name of names) {
      const path = `${folder}/${name}`;
      disk.add(path);
      if (options.nested && rng.chance(0.35)) {
        const inside = someNames(rng.integer(1, 3));
        children.set(path, inside);
        for (const child of inside) {
          disk.add(`${path}/${child}`);
        }
      }
    }
  }

  // Each folder's items to rename, and the names they ask for.
  const items: Array<{ sourcePath: string; destinationName: string; isFolder: boolean }> = [];
  for (const [folder, names] of children) {
    const chosen = names.filter(() => rng.chance(0.6));
    if (chosen.length === 0) {
      continue;
    }
    const destinations = new Map<string, string>();
    if (chosen.length > 1 && rng.chance(0.3)) {
      // A cycle (a swap, for two): each takes the next one's name.
      chosen.forEach((name, index) => {
        destinations.set(name, chosen[(index + 1) % chosen.length] as string);
      });
    } else {
      for (const name of chosen) {
        destinations.set(name, destinationFor(rng, name, names));
      }
    }
    for (const name of chosen) {
      const destinationName = destinations.get(name) as string;
      // The plan never asks for an item's own name.
      if (destinationName === name) {
        continue;
      }
      const sourcePath = `${folder}/${name}`;
      items.push({ sourcePath, destinationName, isFolder: children.has(sourcePath) });
    }
  }
  if (items.length === 0) {
    const name = children.get("/trip")?.[0] as string;
    items.push({ sourcePath: `/trip/${name}`, destinationName: `${name} new`, isFolder: false });
  }

  const stop = rng.next();
  return {
    disk,
    request: {
      items: rng.shuffle(items),
      onConflict: rng.pick(ON_CONFLICT),
      numberSeparator: rng.pick(SEPARATORS),
    },
    stopAtItemStart: stop < 0.25 ? rng.integer(0, items.length) : null,
    stopAfterMoves: stop >= 0.25 && stop < 0.4 ? rng.integer(0, items.length * 2) : null,
    failureRate: rng.pick([0, 0, 0.1, 0.3]),
    failureSeed: rng.integer(1, 2 ** 31),
  };
}

function destinationFor(rng: Random, name: string, neighbours: readonly string[]): string {
  const roll = rng.next();
  if (roll < 0.25) {
    // A name another item in the folder has: a chain, or a name taken.
    return rng.pick(neighbours);
  }
  if (roll < 0.4) {
    // Only the case changes.
    const flipped = name === name.toLowerCase() ? name.toUpperCase() : name.toLowerCase();
    return flipped === name ? `${name}x` : flipped;
  }
  if (roll < 0.5) {
    // Only how the accents are typed changes.
    const other = name.normalize(name === name.normalize("NFC") ? "NFD" : "NFC");
    return other === name ? rng.pick(NAMES) : other;
  }
  if (roll < 0.6) {
    // A name the rename would number to.
    return `${name}${rng.pick(SEPARATORS)}2`;
  }
  return rng.pick(NAMES);
}

async function runCase(fuzz: FuzzCase): Promise<BatchRenameRun> {
  const { disk, request } = fuzz;
  const rng = random(fuzz.failureSeed);
  const controller = new AbortController();
  disk.failWith = () =>
    fuzz.failureRate > 0 && rng.chance(fuzz.failureRate) ? errno(rng.pick(CODES)) : null;
  let moves = 0;
  disk.afterMove = () => {
    moves += 1;
    if (moves === fuzz.stopAfterMoves) {
      controller.abort();
    }
  };
  let temporary = 0;
  return runBatchRename({
    request,
    fs: disk,
    signal: controller.signal,
    temporaryName: () => `.tmp-${temporary++}`,
    onItemStart: (_item, completed) => {
      if (completed === fuzz.stopAtItemStart) {
        controller.abort();
      }
    },
  });
}

type Before = {
  inos: number[];
  pathByIno: Map<number, string>;
  sourceInos: Array<number | null>;
};

function snapshot(fuzz: FuzzCase): Before {
  const entries = fuzz.disk.entries();
  return {
    inos: entries.map((entry) => entry.ino).sort((left, right) => left - right),
    pathByIno: new Map(entries.map((entry) => [entry.ino, entry.path])),
    sourceInos: fuzz.request.items.map((item) => fuzz.disk.inoOf(item.sourcePath)),
  };
}

// What is wrong after a run, as sentences; none when all is well. Each result's path must be
// exactly where its item is, even when a folder it is in changed its name.
function problems(fuzz: FuzzCase, before: Before, run: BatchRenameRun) {
  const { disk, request } = fuzz;
  const after = disk.entries();
  const found: string[] = [];

  const inos = after.map((entry) => entry.ino).sort((left, right) => left - right);
  if (JSON.stringify(inos) !== JSON.stringify(before.inos)) {
    found.push(
      `items lost or replaced: ${JSON.stringify(before.inos)} became ${JSON.stringify(inos)}`,
    );
  }
  const order = run.items.map((item) => item.sourcePath);
  if (JSON.stringify(order) !== JSON.stringify(request.items.map((item) => item.sourcePath))) {
    found.push(`results out of the order asked for: ${JSON.stringify(order)}`);
  }
  const completed = run.items.filter((item) => item.status === "completed").length;
  if (run.completedItemCount !== completed) {
    found.push(`completedItemCount ${run.completedItemCount}, but ${completed} completed`);
  }
  if (run.items.some((item) => item.status === "cancelled") && !run.cancelled) {
    found.push("an item was cancelled, but the run says it wasn't");
  }

  run.items.forEach((result, index) => {
    const ino = before.sourceInos[index] ?? null;
    if (ino === null) {
      return;
    }
    const now = disk.pathOf(ino);
    const said = result.destinationPath ?? result.sourcePath ?? "";
    if (result.status === "completed" && result.destinationPath === null) {
      found.push(`${result.sourcePath} completed without a new path`);
    }
    if (now !== said) {
      found.push(`${JSON.stringify(result)} is really at ${now}`);
    }
  });

  // A temporary name is left only where a result says its item is. (An item named so before
  // the rename, and not renamed, may be anywhere its folder went.)
  const reportedByIno = new Map(
    run.items.map((item, index) => [before.sourceInos[index], item.destinationPath]),
  );
  for (const entry of after) {
    const renamed = basename(before.pathByIno.get(entry.ino) ?? "") !== basename(entry.path);
    if (!renamed || !basename(entry.path).startsWith(".tmp-")) {
      continue;
    }
    const reported = reportedByIno.get(entry.ino) ?? null;
    if (reported !== entry.path) {
      found.push(`left under a temporary name, unreported: ${entry.path}`);
    }
  }
  return found;
}

async function fuzz(options: { nested: boolean }): Promise<void> {
  // What the cases came to, so a change to them that stops reaching an outcome is noticed.
  const outcomes = new Set<string>();
  for (let seed = FIRST_SEED; seed < FIRST_SEED + CASES; seed += 1) {
    const fuzzCase = makeCase(random(seed), options);
    const before = snapshot(fuzzCase);
    const run = await runCase(fuzzCase);
    const found = problems(fuzzCase, before, run);
    if (found.length > 0) {
      const stop = `${fuzzCase.stopAtItemStart} / ${fuzzCase.stopAfterMoves}`;
      throw new Error(
        [
          `Seed ${seed} failed (BATCH_RENAME_FUZZ_SEED=${seed} BATCH_RENAME_FUZZ_CASES=1).`,
          `Disk before: ${JSON.stringify([...before.pathByIno.values()])}`,
          `Request: ${JSON.stringify(fuzzCase.request)}`,
          `Stop at item start / after renames: ${stop}; failure rate ${fuzzCase.failureRate}`,
          `Calls: ${fuzzCase.disk.calls.filter((call) => !call.startsWith("lstat")).join(", ")}`,
          `Disk after: ${JSON.stringify(fuzzCase.disk.entries().map((entry) => entry.path))}`,
          ...found,
        ].join("\n"),
      );
    }
    for (const result of run.items) {
      outcomes.add(result.status);
      if (result.status === "failed" && result.destinationPath !== null) {
        const hidden = basename(result.destinationPath).startsWith(".tmp-");
        outcomes.add(hidden ? "left hidden" : "put back with a number");
      }
    }
    if (fuzzCase.disk.calls.some((call) => call.startsWith("rename:"))) {
      outcomes.add("case changed in place");
    }
  }
  if (CASES >= 100) {
    expect([...outcomes].sort()).toEqual([
      "cancelled",
      "case changed in place",
      "completed",
      "failed",
      "left hidden",
      "put back with a number",
      "skipped",
    ]);
  }
}

describe("renaming several items, at random", () => {
  it("never loses an item, and says where each one is, for items in folders side by side", async () => {
    await fuzz({ nested: false });
  });

  it("never loses an item, and says where each one is, when folders are renamed with items inside them", async () => {
    await fuzz({ nested: true });
  });
});

describe("where the results say items are, when a folder is renamed with items inside it", () => {
  // A folder that can't take its new name and is put back under another one takes the paths
  // of the items inside it along, as a renamed folder does: "/trip/sub/y" is now inside "a",
  // the item that took the folder's name.
  it("says where an item is when its folder was put back under a numbered name", async () => {
    const disk = new MemoryDisk(["/trip/a", "/trip/sub", "/trip/sub/x", "/trip/c"]);
    const xIno = disk.inoOf("/trip/sub/x");
    const result = await runBatchRename({
      request: {
        items: [
          { sourcePath: "/trip/a", destinationName: "sub", isFolder: false },
          { sourcePath: "/trip/sub", destinationName: "c", isFolder: true },
          { sourcePath: "/trip/sub/x", destinationName: "y", isFolder: false },
        ],
        onConflict: "skip",
        numberSeparator: " ",
      },
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: () => ".tmp-0",
    });
    // "sub" moved aside for "a", couldn't become "c" (taken), and went back as "sub 2".
    expect(result.items[1]).toMatchObject({ status: "failed", destinationPath: "/trip/sub 2" });
    expect(disk.pathOf(xIno as number)).toBe("/trip/sub 2/y");
    expect(result.items[2]).toMatchObject({
      status: "completed",
      destinationPath: "/trip/sub 2/y",
    });
  });
});
