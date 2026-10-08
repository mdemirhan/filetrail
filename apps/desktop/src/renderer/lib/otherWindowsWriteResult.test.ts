import {
  type WriteOperationAction,
  type WriteOperationResult,
  createChangeMatcher,
  itemsForOtherWindows,
  pathsChangedByWrite,
} from "@filetrail/contracts";

import { collectFollowedMoves } from "./explorerAppUtils";
import { type TabSnapshot, followMovedItems } from "./explorerTabs";

// A window other than the one that ran an operation is sent only the items it needs of the
// result (itemsForOtherWindows). What it does with them must come out as with all of them:
// the folder sizes it forgets and the folders its tabs follow.

type Item = WriteOperationResult["items"][number];

function result(action: WriteOperationAction, items: Item[], targetPath: string | null = null) {
  return {
    operationId: "op-1",
    action,
    status: "completed" as const,
    targetPath,
    startedAt: "2026-10-08T10:00:00.000Z",
    finishedAt: "2026-10-08T10:00:01.000Z",
    summary: {
      topLevelItemCount: 1,
      totalItemCount: items.length,
      completedItemCount: items.length,
      failedItemCount: 0,
      skippedItemCount: 0,
      cancelledItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
    },
    items,
    error: null,
  } satisfies WriteOperationResult;
}

function item(
  sourcePath: string | null,
  destinationPath: string | null,
  status: Item["status"] = "completed",
): Item {
  return { sourcePath, destinationPath, status, error: null, skipReason: null };
}

function tabAt(path: string): TabSnapshot {
  return {
    currentPath: path,
    historyPaths: [path],
    treeRootPath: path,
    selectedTreeItemId: `fs:${path}`,
    view: null,
  } as unknown as TabSnapshot;
}

// Every path the items name, the folders above them, and a few inside them.
function probesFor(full: WriteOperationResult): string[] {
  const probes = new Set<string>(["/", "/Users", "/elsewhere/x"]);
  for (const path of pathsChangedByWrite(full)) {
    for (let index = 1; index <= path.length; index += 1) {
      if (index === path.length || path[index] === "/") {
        probes.add(path.slice(0, index));
      }
    }
    probes.add(`${path}/inside`);
    probes.add(`${path}/inside/deeper`);
    probes.add(`${path} 2`);
  }
  return [...probes];
}

function expectSameForOtherWindows(full: WriteOperationResult): WriteOperationResult {
  const compact = { ...full, items: itemsForOtherWindows(full) };
  const fullChanges = createChangeMatcher(pathsChangedByWrite(full));
  const compactChanges = createChangeMatcher(pathsChangedByWrite(compact));
  const fullMoves = collectFollowedMoves(full);
  const compactMoves = collectFollowedMoves(compact);
  for (const probe of probesFor(full)) {
    // Folder sizes: forgotten at or inside a change, measured again around one.
    expect([probe, compactChanges.holdsChange(probe)]).toEqual([
      probe,
      fullChanges.holdsChange(probe),
    ]);
    expect([probe, compactChanges.isAtOrInsideChange(probe)]).toEqual([
      probe,
      fullChanges.isAtOrInsideChange(probe),
    ]);
    // Tabs: where a tab showing the probe goes.
    expect(followMovedItems(tabAt(probe), compactMoves)).toEqual(
      followMovedItems(tabAt(probe), fullMoves),
    );
  }
  return compact;
}

describe("the result of an operation as other windows are sent it", () => {
  it("leaves out all but one item in each folder inside a pasted folder", () => {
    const inFolder = (path: string, status: Item["status"] = "completed") =>
      item(`/Users/me/Folder${path}`, `/Users/me/b/Folder${path}`, status);
    const compact = expectSameForOtherWindows(
      result(
        "paste",
        [
          inFolder(""),
          ...["a", "b", "c"].map((name) => inFolder(`/${name}.txt`)),
          inFolder("/Inner/d.txt", "failed"),
          inFolder("/Inner/e.txt"),
          item("/Users/me/f.txt", "/Users/me/b/f.txt"),
        ],
        "/Users/me/b",
      ),
    );
    expect(compact.items.map((kept) => kept.sourcePath)).toEqual([
      "/Users/me/Folder",
      "/Users/me/Folder/a.txt",
      "/Users/me/Folder/Inner/d.txt",
      "/Users/me/f.txt",
    ]);
  });

  it("keeps what moved inside a folder whose own move failed", () => {
    const compact = expectSameForOtherWindows(
      result("move_to", [
        item("/Users/me/Folder", "/Volumes/Disk/Folder", "failed"),
        item("/Users/me/Folder/a.txt", "/Volumes/Disk/Folder/a.txt"),
        item("/Users/me/Folder/Inner", "/Volumes/Disk/Folder/Inner"),
        item("/Users/me/Folder/Inner/b.txt", "/Volumes/Disk/Folder/Inner/b.txt"),
        item("/Users/me/Folder/Inner/c.txt", "/Volumes/Disk/Folder/Inner/c.txt"),
      ]),
    );
    expect(compact.items.map((kept) => kept.sourcePath)).toEqual([
      "/Users/me/Folder",
      "/Users/me/Folder/a.txt",
      "/Users/me/Folder/Inner",
      "/Users/me/Folder/Inner/b.txt",
    ]);
  });

  it("keeps a renamed item put back under another name", () => {
    expectSameForOtherWindows(
      result("batch_rename", [
        item("/Users/me/a", "/Users/me/b"),
        item("/Users/me/b", "/Users/me/b 2", "failed"),
        item("/Users/me/a/x", "/Users/me/b/x", "failed"),
      ]),
    );
  });

  it("keeps every item a Trash or an Undo moved on its own", () => {
    expectSameForOtherWindows(
      result("trash", [
        item("/Users/me/a", null),
        item("/Users/me/a/b", null),
        item("/Users/me/c", null, "failed"),
      ]),
    );
    expectSameForOtherWindows(
      result("undo", [
        item("/Users/me/b/Folder", "/Users/me/Folder"),
        item("/Users/me/copy.txt", null),
        item("/Users/me/Folder/x", "/Users/me/x", "skipped"),
      ]),
    );
  });

  // Paths drawn from a few names, so that items fall inside one another in every way.
  it("does as all the items would for any operation", () => {
    let seed = 7;
    const random = (count: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % count;
    };
    const names = ["a", "b", "a b", "c"];
    const randomPath = () => {
      let path = "/u";
      for (let depth = random(4); depth >= 0; depth -= 1) {
        path += `/${names[random(names.length)]}`;
      }
      return path;
    };
    const actions: WriteOperationAction[] = ["paste", "move_to", "rename", "batch_rename", "undo"];
    const statuses: Item["status"][] = ["completed", "failed", "skipped", "cancelled"];
    for (let run = 0; run < 300; run += 1) {
      const items = Array.from({ length: 1 + random(8) }, () =>
        item(
          random(10) === 0 ? null : randomPath(),
          random(6) === 0 ? null : randomPath(),
          statuses[random(statuses.length)],
        ),
      );
      expectSameForOtherWindows(
        result(
          actions[random(actions.length)] as WriteOperationAction,
          items,
          random(2) === 0 ? randomPath() : null,
        ),
      );
    }
  });
});
