// @vitest-environment jsdom

import type { IpcRequest, IpcResponse, Volume } from "@filetrail/contracts";
import { act, renderHook } from "@testing-library/react";

import type { FiletrailClient } from "../lib/filetrailClient";
import { useEjectVolume } from "./useEjectVolume";
import type { CopyPasteDialogState } from "./useWriteOperations";

type EjectResponse = IpcResponse<"system:ejectVolume">;

function volume(name: string, disk: string): Volume {
  return {
    path: `/Volumes/${name}`,
    name,
    isLocal: true,
    isReadOnly: false,
    fileSystem: "hfs",
    canEject: true,
    disk,
  };
}

const ejected: EjectResponse = { status: "ejected", failedPath: null, code: null, reason: null };

function setup(volumes: Volume[], responses: EjectResponse[]) {
  const requests: Array<IpcRequest<"system:ejectVolume">> = [];
  const client = {
    invoke: vi.fn(async (_channel: string, payload: IpcRequest<"system:ejectVolume">) => {
      requests.push(payload);
      return responses.shift() ?? ejected;
    }),
  } as unknown as FiletrailClient;
  let dialog: CopyPasteDialogState | null = null;
  const setCopyPasteDialogState = vi.fn((value) => {
    dialog = typeof value === "function" ? value(dialog) : value;
  });
  const showNotice = vi.fn();
  const { result } = renderHook(() =>
    useEjectVolume({ client, volumes, setCopyPasteDialogState, showNotice }),
  );
  return { result, requests, showNotice, dialog: () => dialog };
}

describe("useEjectVolume", () => {
  it("ejects a disk of its own with its whole disk, at once", async () => {
    const { result, requests, dialog } = setup([volume("USB", "disk4")], []);
    await act(async () => result.current.requestEject("/Volumes/USB"));
    expect(requests).toEqual([{ path: "/Volumes/USB", wholeDisk: true, force: false }]);
    expect(dialog()).toBeNull();
    expect(result.current.ejectingPaths.size).toBe(0);
  });

  it("asks about the other volumes of the disk, then ejects all or only this one", async () => {
    const volumes = [volume("Photos", "disk7"), volume("Video", "disk7")];
    const { result, requests, dialog } = setup(volumes, []);
    act(() => result.current.requestEject("/Volumes/Photos"));
    expect(requests).toEqual([]);
    expect(dialog()).toEqual({
      type: "ejectWhichVolumes",
      path: "/Volumes/Photos",
      name: "Photos",
      otherNames: ["Video"],
    });

    await act(async () => result.current.answerWhichVolumes("/Volumes/Photos", "one"));
    await act(async () => result.current.answerWhichVolumes("/Volumes/Photos", "all"));
    await act(async () => result.current.answerWhichVolumes("/Volumes/Photos", "cancel"));
    expect(requests).toEqual([
      { path: "/Volumes/Photos", wholeDisk: false, force: false },
      { path: "/Volumes/Photos", wholeDisk: true, force: false },
    ]);
    expect(dialog()).toBeNull();
  });

  it("asks about a disk in use, and goes on from the volume in use when forced", async () => {
    const volumes = [volume("Photos", "disk7"), volume("Video", "disk7")];
    const { result, requests, dialog } = setup(volumes, [
      { status: "busy", failedPath: "/Volumes/Video", code: "EBUSY", reason: null },
    ]);
    await act(async () => result.current.answerWhichVolumes("/Volumes/Photos", "all"));
    expect(dialog()).toEqual({ type: "ejectBusy", busyPath: "/Volumes/Video", wholeDisk: true });

    // Photos is unmounted already: Force Eject carries on from Video.
    await act(async () => result.current.answerBusy("/Volumes/Video", true, "force"));
    expect(requests.at(-1)).toEqual({ path: "/Volumes/Video", wholeDisk: true, force: true });
    expect(dialog()).toBeNull();
  });

  it("tells of any other failure in a dialog", async () => {
    const { result, showNotice } = setup(
      [volume("USB", "disk4")],
      [{ status: "failed", failedPath: "/dev/disk4", code: "EIO", reason: null }],
    );
    await act(async () => result.current.requestEject("/Volumes/USB"));
    expect(showNotice).toHaveBeenCalledWith(
      "The disk “USB” couldn’t be ejected.",
      "An unexpected error occurred (EIO).",
    );
  });
});
