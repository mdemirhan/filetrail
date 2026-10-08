import type { IpcResponse } from "@filetrail/contracts";
import type { ItemId } from "@filetrail/core";

import type { ClipboardChange } from "./windowIpcHandlers";

type Clipboard = IpcResponse<"app:getClipboard">["clipboard"];

// Which item each path on the app's clipboard was when it was put there, so a paste can
// tell the item copied from another one put at its path since (an app saved a new file in
// its place). Each item is read when it arrives: when copied, and when the app moved it and
// the clipboard followed it there (renamed, it keeps its id; moved to another disk, it has
// a new one). A change that only follows what the clipboard held keeps the other paths'
// ids, so an item replaced outside the app meanwhile is still told apart.
export function createClipboardItemIds(readItemId: (path: string) => Promise<ItemId | null>) {
  let ids = new Map<string, Promise<ItemId | null>>();

  return {
    update(clipboard: Clipboard, change: ClipboardChange): void {
      const next = new Map<string, Promise<ItemId | null>>();
      if (clipboard.type === "ready") {
        const readAgain = change.copied ? null : new Set(change.followedTo);
        for (const path of clipboard.sourcePaths) {
          const known = readAgain === null || readAgain.has(path) ? undefined : ids.get(path);
          next.set(path, known ?? readItemId(path).catch(() => null));
        }
      }
      ids = next;
    },

    // The ids known for those of `paths` on the clipboard, as it is when asked: a change
    // made while they are being read doesn't change the answer. An item that couldn't be
    // read when it arrived isn't checked.
    async expectedIds(paths: readonly string[]): Promise<Record<string, ItemId>> {
      const asked = paths.flatMap((path) => {
        const id = ids.get(path);
        return id ? [[path, id] as const] : [];
      });
      const expected: Record<string, ItemId> = {};
      for (const [path, read] of asked) {
        const id = await read;
        if (id) {
          expected[path] = id;
        }
      }
      return expected;
    },
  };
}
