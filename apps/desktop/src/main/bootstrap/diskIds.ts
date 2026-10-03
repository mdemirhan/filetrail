import { stat } from "node:fs/promises";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

// Which disk each path is on: the device number of what it names, followed through
// symlinks (a drop on a link to a folder lands in that folder). A drag uses it to tell a
// move on one disk from a copy to another, as Finder does; the path alone can't, since
// disks can be mounted anywhere (network shares under /net, FUSE mounts in the home
// folder). Null where the path can't be read.
export async function getDiskIds(
  payload: IpcRequest<"system:getDiskIds">,
  statFn: (path: string) => Promise<{ dev: number }> = stat,
): Promise<IpcResponse<"system:getDiskIds">> {
  const ids = await Promise.all(
    payload.paths.map(async (path) => {
      try {
        return (await statFn(path)).dev;
      } catch {
        return null;
      }
    }),
  );
  return { ids };
}
