import { getVolumeRootPath, isOnSameVolume } from "./volumes";

describe("volumes", () => {
  it("puts paths under /Volumes/<name> on that volume", () => {
    expect(getVolumeRootPath("/Volumes/Backup")).toBe("/Volumes/Backup");
    expect(getVolumeRootPath("/Volumes/Backup/")).toBe("/Volumes/Backup");
    expect(getVolumeRootPath("/Volumes/Backup/Photos/2024")).toBe("/Volumes/Backup");
    expect(getVolumeRootPath("/Volumes/My Disk/a.txt")).toBe("/Volumes/My Disk");
  });

  it("puts everything else on the startup volume", () => {
    expect(getVolumeRootPath("/")).toBe("/");
    expect(getVolumeRootPath("/Users/demo/a.txt")).toBe("/");
    expect(getVolumeRootPath("/Volumes")).toBe("/");
    expect(getVolumeRootPath("/Volumes/")).toBe("/");
    // Only the top-level /Volumes folder holds mount points.
    expect(getVolumeRootPath("/Users/demo/Volumes/Backup")).toBe("/");
    expect(getVolumeRootPath("/VolumesX/Backup")).toBe("/");
  });

  it("compares the volumes of two paths", () => {
    expect(isOnSameVolume("/Users/demo/a.txt", "/Applications")).toBe(true);
    expect(isOnSameVolume("/Volumes/Backup/a", "/Volumes/Backup/b/c")).toBe(true);
    expect(isOnSameVolume("/Users/demo/a.txt", "/Volumes/Backup")).toBe(false);
    expect(isOnSameVolume("/Volumes/Backup/a", "/Volumes/Other/a")).toBe(false);
  });
});
