import type { Volume } from "@filetrail/contracts";

import {
  describeEjectBusy,
  describeEjectFailure,
  describeWhichVolumesQuestion,
  planEject,
  resolveEjectTargetPath,
} from "./eject";

function volume(name: string, overrides: Partial<Volume> = {}): Volume {
  return {
    path: `/Volumes/${name}`,
    name,
    isLocal: true,
    isReadOnly: false,
    fileSystem: "apfs",
    canEject: true,
    disk: `disk-${name}`,
    ...overrides,
  };
}

describe("planEject", () => {
  it("ejects a disk of its own at once", () => {
    expect(planEject([volume("USB"), volume("Backup")], "/Volumes/USB")).toEqual({
      kind: "eject",
      path: "/Volumes/USB",
    });
  });

  it("asks first about a volume whose disk holds others, naming them", () => {
    const volumes = [
      volume("Photos", { disk: "disk7" }),
      volume("USB"),
      volume("Video", { disk: "disk7" }),
    ];
    expect(planEject(volumes, "/Volumes/Photos")).toEqual({
      kind: "askWhichVolumes",
      path: "/Volumes/Photos",
      name: "Photos",
      otherNames: ["Video"],
    });
  });

  it("never groups network shares, which have no disk", () => {
    const volumes = [
      volume("Shared", { isLocal: false, disk: null }),
      volume("Media", { isLocal: false, disk: null }),
    ];
    expect(planEject(volumes, "/Volumes/Shared")).toEqual({
      kind: "eject",
      path: "/Volumes/Shared",
    });
  });

  it("does nothing for a disk that can't be ejected or is gone", () => {
    expect(planEject([volume("Data", { canEject: false })], "/Volumes/Data")).toBeNull();
    expect(planEject([], "/Volumes/USB")).toBeNull();
  });
});

describe("resolveEjectTargetPath", () => {
  const volumes = [volume("USB"), volume("Data", { canEject: false })];

  it("is the disk selected in the sidebar, its Locations row or the top of the tree", () => {
    for (const selectedTreeItemId of ["location:/Volumes/USB", "fs:/Volumes/USB"] as const) {
      expect(resolveEjectTargetPath({ focusedPane: "tree", selectedTreeItemId, volumes })).toBe(
        "/Volumes/USB",
      );
      expect(resolveEjectTargetPath({ focusedPane: null, selectedTreeItemId, volumes })).toBe(
        "/Volumes/USB",
      );
    }
  });

  it("is none with the file list in front, or for anything but a disk that can be ejected", () => {
    expect(
      resolveEjectTargetPath({
        focusedPane: "content",
        selectedTreeItemId: "location:/Volumes/USB",
        volumes,
      }),
    ).toBeNull();
    for (const selectedTreeItemId of [
      "location:/Volumes/Data",
      "fs:/Volumes/USB/Photos",
      "location:/",
      "favorite:/Volumes/Gone",
    ] as const) {
      expect(resolveEjectTargetPath({ focusedPane: "tree", selectedTreeItemId, volumes })).toBe(
        null,
      );
    }
  });
});

describe("eject wording", () => {
  it("asks about all the volumes of the disk", () => {
    expect(describeWhichVolumesQuestion("Photos", ["Video"])).toEqual({
      title: "Do you want to eject “Photos” only, or all 2 volumes on its disk?",
      message:
        "The disk also holds “Video”. Eject All lets you disconnect it; Eject leaves the others mounted.",
    });
    expect(describeWhichVolumesQuestion("A", ["B", "C", "D", "E"]).message).toContain(
      "“B”, “C”, “D” and 1 more",
    );
  });

  it("says which disk is in use, and calls a server a volume", () => {
    const volumes = [volume("USB"), volume("Shared", { isLocal: false, disk: null })];
    expect(describeEjectBusy(volumes, "/Volumes/USB").title).toBe(
      "The disk “USB” wasn’t ejected because one or more programs may be using it.",
    );
    expect(describeEjectBusy(volumes, "/Volumes/Shared").title).toBe(
      "The volume “Shared” wasn’t ejected because one or more programs may be using it.",
    );
  });

  it("names the disk asked for when the disk itself failed, with Disk Arbitration's reason", () => {
    const volumes = [volume("USB")];
    expect(
      describeEjectFailure(volumes, "/Volumes/USB", {
        failedPath: "/dev/disk7",
        code: "EIO",
        reason: "The device is not responding.",
      }),
    ).toEqual({
      title: "The disk “USB” couldn’t be ejected.",
      message: "The device is not responding.",
    });
    expect(
      describeEjectFailure(volumes, "/Volumes/USB", {
        failedPath: "/Volumes/USB",
        code: "ETIMEDOUT",
        reason: null,
      }).message,
    ).toBe("The disk didn’t answer in time. Try again in a moment.");
  });
});
