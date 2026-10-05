import type { Volume } from "@filetrail/contracts";

import { createDiskHasTrash } from "./diskHasTrash";

function volume(path: string, isLocal: boolean): Volume {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    isLocal,
    isReadOnly: false,
    fileSystem: "apfs",
  };
}

describe("createDiskHasTrash", () => {
  const diskHasTrash = createDiskHasTrash(() => [
    volume("/Volumes/Share", false),
    volume("/Volumes/USB", true),
    volume("/Volumes/Share 2", true),
  ]);

  it("takes a network share to have no Trash, in it or at its top", () => {
    expect(diskHasTrash("/Volumes/Share")).toBe(false);
    expect(diskHasTrash("/Volumes/Share/Projects/a.txt")).toBe(false);
  });

  it("takes any other disk to have one", () => {
    expect(diskHasTrash("/Volumes/USB/a.txt")).toBe(true);
    expect(diskHasTrash("/Users/demo/a.txt")).toBe(true);
  });

  it("doesn't mistake a disk whose name starts like a share's for the share", () => {
    expect(diskHasTrash("/Volumes/Share 2/a.txt")).toBe(true);
  });

  it("reads the disks each time, since they come and go", () => {
    let volumes: Volume[] = [];
    const hasTrash = createDiskHasTrash(() => volumes);
    expect(hasTrash("/Volumes/Share/a.txt")).toBe(true);
    volumes = [volume("/Volumes/Share", false)];
    expect(hasTrash("/Volumes/Share/a.txt")).toBe(false);
  });
});
