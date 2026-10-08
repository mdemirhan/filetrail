import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listMounts, realpathNow } from "../originalFileSystem";
import { type Mount, createDiskHasTrash } from "./diskHasTrash";

const mounts: Mount[] = [
  { path: "/", isLocal: true },
  { path: "/System/Volumes/Data", isLocal: true },
  { path: "/Volumes/Share", isLocal: false },
  { path: "/Volumes/USB", isLocal: true },
  { path: "/Volumes/Share 2", isLocal: true },
  // An automounted share, mounted outside /Volumes.
  { path: "/System/Volumes/Data/mnt/nas", isLocal: false },
];

// Every path is where it says, except the links listed.
function linksAt(links: Record<string, string>): (path: string) => string {
  return (path) => {
    for (const [link, target] of Object.entries(links)) {
      if (path === link || path.startsWith(`${link}/`)) {
        return target + path.slice(link.length);
      }
    }
    return path;
  };
}

describe("createDiskHasTrash", () => {
  const diskHasTrash = createDiskHasTrash(() => mounts, linksAt({}));

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
    let current: Mount[] = [];
    const hasTrash = createDiskHasTrash(() => current, linksAt({}));
    expect(hasTrash("/Volumes/Share/a.txt")).toBe(true);
    current = [{ path: "/Volumes/Share", isLocal: false }];
    expect(hasTrash("/Volumes/Share/a.txt")).toBe(false);
  });

  it("finds a share reached through a link", () => {
    const hasTrash = createDiskHasTrash(
      () => mounts,
      linksAt({ "/Users/demo/NAS": "/Volumes/Share" }),
    );
    expect(hasTrash("/Users/demo/NAS/Projects")).toBe(false);
  });

  it("finds a share named in another case", () => {
    expect(diskHasTrash("/volumes/SHARE/Projects")).toBe(false);
  });

  it("finds a share mounted outside /Volumes", () => {
    const hasTrash = createDiskHasTrash(
      () => mounts,
      linksAt({ "/mnt": "/System/Volumes/Data/mnt" }),
    );
    expect(hasTrash("/mnt/nas/a.txt")).toBe(false);
    expect(hasTrash("/mnt/other/a.txt")).toBe(true);
  });

  // A folder a paste makes may not be there yet, or be gone already.
  it("follows the part of the path that exists", () => {
    const realpath = (path: string) => {
      if (path === "/Users/demo/NAS") {
        return "/Volumes/Share";
      }
      if (path.startsWith("/Users/demo/NAS/")) {
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      }
      return path;
    };
    const hasTrash = createDiskHasTrash(() => mounts, realpath);
    expect(hasTrash("/Users/demo/NAS/New/Deeper")).toBe(false);
  });

  it("goes by the path as given when no part of it can be read", () => {
    const hasTrash = createDiskHasTrash(
      () => mounts,
      () => {
        throw new Error("no such file");
      },
    );
    expect(hasTrash("/Volumes/Share/a.txt")).toBe(false);
    expect(hasTrash("/Users/demo/a.txt")).toBe(true);
  });
});

describe("the mount table", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "filetrail-disk-trash-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("lists the startup disk, wherever it is mounted", () => {
    expect(listMounts()).toEqual(
      expect.arrayContaining([
        { path: "/", isLocal: true },
        { path: "/System/Volumes/Data", isLocal: true },
      ]),
    );
  });

  it("follows a link to the disk it leads to", () => {
    // The link leads to a share as far as this mount table says.
    symlinkSync("/System/Volumes/Data", join(root, "Share"));
    const hasTrash = createDiskHasTrash(
      () => [
        { path: "/", isLocal: true },
        { path: "/System/Volumes/Data", isLocal: false },
      ],
      realpathNow,
    );

    expect(hasTrash(join(root, "Share", "New Folder"))).toBe(false);
  });
});
