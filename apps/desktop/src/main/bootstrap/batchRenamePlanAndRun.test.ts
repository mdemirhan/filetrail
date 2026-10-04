// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";

import type { IpcRequest } from "@filetrail/contracts";

import { type BatchRenameTarget, useBatchRename } from "../../renderer/hooks/useBatchRename";
import { createMockFiletrailClient } from "../../renderer/test/mockFiletrailClient";
import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import {
  type BatchRenamePlan,
  type BatchRenameSettings,
  DEFAULT_BATCH_RENAME_SETTINGS,
  parentPathOf,
} from "../../shared/batchRename";
import { runBatchRename } from "./batchRenameExecution";
import { MemoryDisk, random } from "./batchRenameMemoryDisk.testkit";

// The sheet's preview and the rename must agree: the plan the window shows is turned into a
// request by the window's own hook, and the main process, renaming on a disk holding the
// same names, gives every item the name the plan gave it, with no number added on the way.

const FORMAT: BatchRenameSettings = {
  ...DEFAULT_BATCH_RENAME_SETTINGS,
  mode: "format",
  nameFormat: "index",
  customName: "File",
};

// Opens the sheet on the items with these settings, as the window does, checks them
// against the disk, and renames as the main process would.
async function planAndRename(
  disk: MemoryDisk,
  paths: string[],
  settings: BatchRenameSettings,
): Promise<{
  plan: BatchRenamePlan;
  request: IpcRequest<"writeOperation:batchRename"> | null;
  inos: Array<number | null>;
}> {
  const client = createMockFiletrailClient({
    "app:getPreferences": async () => ({
      preferences: { ...DEFAULT_APP_PREFERENCES, batchRenameSettings: settings },
    }),
    "app:updatePreferences": async () => ({ preferences: DEFAULT_APP_PREFERENCES }),
    "batchRename:inspect": async (payload) => ({
      items: payload.paths.map((path) => ({
        path,
        createdAt: "2026-09-30T10:12:40",
        modifiedAt: "2026-10-01T08:30:15",
        takenAt: null,
        cannotRename: null,
      })),
      folders: [...new Set(payload.paths.map(parentPathOf))].map((path) => ({
        path,
        names: disk.names(path),
        caseSensitive: disk.caseSensitive,
      })),
    }),
  });
  const targets: BatchRenameTarget[] = paths.map((path) => ({
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    isFolder: false,
  }));
  const hook = renderHook(() => useBatchRename(client));
  await act(async () => {
    await hook.result.current.open(targets);
  });
  await waitFor(() => expect(hook.result.current.sheet?.inspect).not.toBeNull());
  const { plan, request } = hook.result.current;
  hook.unmount();
  if (!plan) {
    throw new Error("no plan");
  }
  const inos = paths.map((path) => disk.inoOf(path));
  if (request) {
    let temporary = 0;
    const run = await runBatchRename({
      request,
      fs: disk,
      signal: new AbortController().signal,
      temporaryName: () => `.tmp-${temporary++}`,
    });
    expect(run.items.filter((item) => item.status !== "completed")).toEqual([]);
  }
  return { plan, request, inos };
}

// Where each item is, and where the plan said it would be: its new name, or its old one.
function placesAfter(
  disk: MemoryDisk,
  paths: string[],
  plan: BatchRenamePlan,
  inos: Array<number | null>,
) {
  return paths.map((path, index) => {
    const planned = plan.items[index];
    const name =
      planned?.status === "rename" ? planned.name : path.slice(path.lastIndexOf("/") + 1);
    return {
      planned: `${parentPathOf(path)}/${name}`,
      actual: disk.pathOf(inos[index] as number),
    };
  });
}

function expectPlanKept(
  disk: MemoryDisk,
  paths: string[],
  result: Awaited<ReturnType<typeof planAndRename>>,
) {
  for (const place of placesAfter(disk, paths, result.plan, result.inos)) {
    expect(place.actual).toBe(place.planned);
  }
}

describe("the plan shown and the rename done", () => {
  it("number a taken name alike when Format has no separator", async () => {
    const disk = new MemoryDisk(["/trip/IMG_a.jpg", "/trip/IMG_b.jpg", "/trip/File1.jpg"]);
    const paths = ["/trip/IMG_a.jpg", "/trip/IMG_b.jpg"];
    const result = await planAndRename(disk, paths, { ...FORMAT, separator: "" });
    // "File1.jpg" is taken outside the batch: the plan adds a number with a space.
    expect(result.request?.items.map((item) => item.destinationName)).toEqual([
      "File1 2.jpg",
      "File2.jpg",
    ]);
    expect(result.request?.numberSeparator).toBe(" ");
    expectPlanKept(disk, paths, result);
    expect(disk.names()).toEqual(["File1 2.jpg", "File1.jpg", "File2.jpg"]);
  });

  it("number a taken name alike with Format's separator", async () => {
    const disk = new MemoryDisk(["/trip/a.jpg", "/trip/b.jpg", "/trip/File_1.jpg"]);
    const paths = ["/trip/a.jpg", "/trip/b.jpg"];
    const result = await planAndRename(disk, paths, { ...FORMAT, separator: "_" });
    expect(result.request?.items.map((item) => item.destinationName)).toEqual([
      "File_1_2.jpg",
      "File_2.jpg",
    ]);
    expectPlanKept(disk, paths, result);
  });

  it("swap two names, and pass names along a chain, without numbers", async () => {
    const swap = new MemoryDisk(["/trip/File 1.jpg", "/trip/File 2.jpg"]);
    // Listed in reverse: the second becomes "File 1" and the first "File 2".
    const swapPaths = ["/trip/File 2.jpg", "/trip/File 1.jpg"];
    const swapped = await planAndRename(swap, swapPaths, FORMAT);
    expect(swapped.plan.items.map((item) => item.status === "rename" && item.addedNumber)).toEqual([
      null,
      null,
    ]);
    expectPlanKept(swap, swapPaths, swapped);

    const chain = new MemoryDisk(["/trip/File 1.jpg", "/trip/File 2.jpg", "/trip/File 3.jpg"]);
    const chainPaths = ["/trip/File 1.jpg", "/trip/File 2.jpg", "/trip/File 3.jpg"];
    const passed = await planAndRename(chain, chainPaths, { ...FORMAT, startAt: 2 });
    expectPlanKept(chain, chainPaths, passed);
    expect(chain.names()).toEqual(["File 2.jpg", "File 3.jpg", "File 4.jpg"]);
  });

  it("give items in several folders the names planned for each folder", async () => {
    const disk = new MemoryDisk([
      "/trip/a.jpg",
      "/trip/b.jpg",
      "/trip/File 3.jpg",
      "/home/c.jpg",
      "/home/File 1.jpg",
      "/home/File 2.jpg",
    ]);
    // Numbered across the folders in the order given; each folder settles its own clashes.
    const paths = ["/trip/a.jpg", "/home/c.jpg", "/trip/b.jpg", "/home/File 1.jpg"];
    const result = await planAndRename(disk, paths, FORMAT);
    expect(result.request?.items.map((item) => item.destinationName)).toEqual([
      "File 1.jpg",
      "File 2 2.jpg",
      "File 3 2.jpg",
      "File 4.jpg",
    ]);
    expectPlanKept(disk, paths, result);
    expect(disk.names("/home")).toEqual(["File 2 2.jpg", "File 2.jpg", "File 4.jpg"]);
  });

  it("change only the case of a name in place, and number it on a disk that minds case", async () => {
    const insensitive = new MemoryDisk(["/trip/Notes.txt", "/trip/Todo.txt"]);
    const paths = ["/trip/Notes.txt", "/trip/Todo.txt"];
    const lowered = await planAndRename(insensitive, paths, {
      ...DEFAULT_BATCH_RENAME_SETTINGS,
      mode: "case",
      caseStyle: "lower",
    });
    expectPlanKept(insensitive, paths, lowered);
    expect(insensitive.names()).toEqual(["notes.txt", "todo.txt"]);

    const sensitive = new MemoryDisk(
      ["/trip/Notes.txt", "/trip/notes.txt", "/trip/Todo.txt"],
      true,
    );
    const numbered = await planAndRename(sensitive, paths, {
      ...DEFAULT_BATCH_RENAME_SETTINGS,
      mode: "case",
      caseStyle: "lower",
    });
    expect(numbered.request?.items.map((item) => item.destinationName)).toEqual([
      "notes 2.txt",
      "todo.txt",
    ]);
    expectPlanKept(sensitive, paths, numbered);
  });

  it("treat a name with its accents typed another way as taken, as the disk does", async () => {
    const nfd = "Re\u0301sume\u0301";
    const disk = new MemoryDisk(["/trip/a.txt", "/trip/b.txt", "/trip/R\u00e9sum\u00e9.txt"]);
    const paths = ["/trip/a.txt", "/trip/b.txt"];
    const result = await planAndRename(disk, paths, {
      ...DEFAULT_BATCH_RENAME_SETTINGS,
      mode: "replace",
      find: "^[ab]$",
      useRegex: true,
      replaceWith: nfd,
    });
    expect(result.request?.items.map((item) => item.destinationName)).toEqual([
      `${nfd} 2.txt`,
      `${nfd} 3.txt`,
    ]);
    expectPlanKept(disk, paths, result);
  });

  it("leave the items Skip leaves, and give the rest their planned names", async () => {
    const disk = new MemoryDisk(["/trip/a.jpg", "/trip/b.jpg", "/trip/c.jpg", "/trip/File 2.jpg"]);
    const paths = ["/trip/a.jpg", "/trip/b.jpg", "/trip/c.jpg"];
    const result = await planAndRename(disk, paths, { ...FORMAT, onConflict: "skip" });
    expect(result.plan.skippedCount).toBe(1);
    expect(result.request?.items.map((item) => item.sourcePath)).toEqual([
      "/trip/a.jpg",
      "/trip/c.jpg",
    ]);
    expectPlanKept(disk, paths, result);
    expect(disk.names()).toEqual(["File 1.jpg", "File 2.jpg", "File 3.jpg", "b.jpg"]);
  });

  // "File 1 2.jpg" asks for "File 1.jpg", which is taken, and would be numbered " 2": its own
  // name. Asked for, the main process would find that name taken by the item itself and make
  // it "File 1 2 2.jpg".
  it("leave an item alone when the numbered name it gets is the one it has", async () => {
    const disk = new MemoryDisk(["/trip/File 1.jpg", "/trip/File 1 2.jpg", "/trip/a.jpg"]);
    const paths = ["/trip/File 1 2.jpg", "/trip/a.jpg"];
    const result = await planAndRename(disk, paths, { ...FORMAT, startAt: 1 });
    expect(disk.names()).toEqual(["File 1 2.jpg", "File 1.jpg", "File 2.jpg"]);
    expectPlanKept(disk, paths, result);
  });

  it("agree at random, for names that clash in every way", async () => {
    const names = [
      "a.jpg",
      "A.jpg",
      "b.jpg",
      "File 1.jpg",
      "File 2.jpg",
      "File 3.jpg",
      "File1.jpg",
      "File-1.jpg",
      "File_2.jpg",
      "file 1.JPG",
      "File 1 2.jpg",
      "R\u00e9sum\u00e9.jpg",
      "notes",
      "Notes.txt",
    ];
    let renamed = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const rng = random(seed);
      const caseSensitive = rng.chance(0.25);
      const key = (name: string) =>
        caseSensitive ? name.normalize("NFD") : name.normalize("NFD").toLowerCase();
      const onDisk = new Map<string, string>();
      for (const name of rng.shuffle(names).slice(0, rng.integer(2, 8))) {
        onDisk.set(key(name), name);
      }
      const disk = new MemoryDisk(
        [...onDisk.values()].map((name) => `/trip/${name}`),
        caseSensitive,
      );
      const paths = rng
        .shuffle([...onDisk.values()])
        .slice(0, rng.integer(1, onDisk.size))
        .map((name) => `/trip/${name}`);
      const settings: BatchRenameSettings = rng.pick([
        { ...FORMAT, separator: rng.pick([" ", "-", "_", ""] as const) },
        { ...FORMAT, nameFormat: "counter", digits: "auto", startAt: rng.integer(0, 3) },
        {
          ...DEFAULT_BATCH_RENAME_SETTINGS,
          mode: "case",
          caseStyle: rng.pick(["lower", "upper", "title"] as const),
        },
        {
          ...DEFAULT_BATCH_RENAME_SETTINGS,
          mode: "replace",
          find: rng.pick(["a", "1", "File", " "]),
          replaceWith: rng.pick(["", "File", "2", "A"]),
        },
        { ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "add", addText: rng.pick([" 1", "1", " 2"]) },
      ]);
      settings.onConflict = rng.pick(["number", "skip"] as const);
      const result = await planAndRename(disk, paths, settings);
      renamed += result.request ? 1 : 0;
      const places = placesAfter(disk, paths, result.plan, result.inos);
      expect({ seed, settings, places }).toEqual({
        seed,
        settings,
        places: places.map((place) => ({ ...place, actual: place.planned })),
      });
    }
    // Most cases rename something: the agreement isn't checked on nothing.
    expect(renamed).toBeGreaterThan(40);
  });
});
