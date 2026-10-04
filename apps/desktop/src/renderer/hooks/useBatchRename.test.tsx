// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";

import type { IpcRequestInput, IpcResponse } from "@filetrail/contracts";

import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { DEFAULT_BATCH_RENAME_SETTINGS } from "../../shared/batchRename";
import { createMockFiletrailClient } from "../test/mockFiletrailClient";
import { type BatchRenameTarget, useBatchRename } from "./useBatchRename";

const targets: BatchRenameTarget[] = [
  { path: "/trip/IMG_1.jpg", name: "IMG_1.jpg", isFolder: false },
  { path: "/trip/IMG_2.jpg", name: "IMG_2.jpg", isFolder: false },
];

function setup(
  overrides: {
    preferences?: Partial<typeof DEFAULT_APP_PREFERENCES>;
    inspect?: (
      payload: IpcRequestInput<"batchRename:inspect">,
    ) => Promise<IpcResponse<"batchRename:inspect">>;
    getPreferencesFails?: boolean;
  } = {},
) {
  const updates: Array<IpcRequestInput<"app:updatePreferences">["preferences"]> = [];
  const inspections: Array<IpcRequestInput<"batchRename:inspect">> = [];
  const client = createMockFiletrailClient({
    "app:getPreferences": async () => {
      if (overrides.getPreferencesFails) {
        throw new Error("no preferences");
      }
      return { preferences: { ...DEFAULT_APP_PREFERENCES, ...overrides.preferences } };
    },
    "app:updatePreferences": async (payload) => {
      updates.push(payload.preferences);
      return { preferences: DEFAULT_APP_PREFERENCES };
    },
    "batchRename:inspect": async (payload) => {
      inspections.push(payload);
      if (overrides.inspect) {
        return overrides.inspect(payload);
      }
      return {
        items: payload.paths.map((path) => ({
          path,
          createdAt: "2026-09-30T10:12:40",
          modifiedAt: "2026-10-01T08:30:15",
          takenAt: payload.includeDateTaken ? "2026-05-14T18:02:11" : null,
          cannotRename: null,
        })),
        folders: [{ path: "/trip", names: ["IMG_1.jpg", "IMG_2.jpg"], caseSensitive: false }],
      };
    },
  });
  const hook = renderHook(() => useBatchRename(client));
  return { hook, updates, inspections };
}

describe("the Rename sheet's state", () => {
  it("opens with the settings last used and the presets saved, and checks the items", async () => {
    const { hook, inspections } = setup({
      preferences: {
        batchRenameSettings: { ...DEFAULT_BATCH_RENAME_SETTINGS, find: "IMG_", replaceWith: "x" },
        batchRenamePresets: [{ name: "Saved", settings: DEFAULT_BATCH_RENAME_SETTINGS }],
      },
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    expect(hook.result.current.settings.find).toBe("IMG_");
    expect(hook.result.current.presets.map((preset) => preset.name)).toEqual(["Saved"]);
    await waitFor(() => expect(hook.result.current.sheet?.inspect).not.toBeNull());
    expect(inspections).toEqual([
      { paths: ["/trip/IMG_1.jpg", "/trip/IMG_2.jpg"], includeDateTaken: false },
    ]);
    expect(hook.result.current.plan?.renameCount).toBe(2);
    expect(hook.result.current.request).toEqual({
      items: [
        { sourcePath: "/trip/IMG_1.jpg", destinationName: "x1.jpg", isFolder: false },
        { sourcePath: "/trip/IMG_2.jpg", destinationName: "x2.jpg", isFolder: false },
      ],
      onConflict: "number",
      numberSeparator: " ",
    });
  });

  it("asks for the dates taken once they are used, and only then", async () => {
    const { hook, inspections } = setup();
    await act(async () => {
      await hook.result.current.open(targets);
    });
    await waitFor(() => expect(hook.result.current.sheet?.inspect).not.toBeNull());
    act(() => {
      hook.result.current.setSettings({
        ...DEFAULT_BATCH_RENAME_SETTINGS,
        mode: "format",
        nameFormat: "date",
        dateSource: "taken",
        separator: "_",
      });
    });
    await waitFor(() => expect(hook.result.current.sheet?.inspectHasDatesTaken).toBe(true));
    expect(inspections.map((inspection) => inspection.includeDateTaken)).toEqual([false, true]);
    expect(hook.result.current.request?.items[0]?.destinationName).toBe("File_2026-05-14.jpg");
    // A clash would be numbered with Format's separator.
    expect(hook.result.current.request?.numberSeparator).toBe("_");
  });

  it("asks for the dates taken at once when the settings opened with already use them", async () => {
    const { hook, inspections } = setup({
      preferences: {
        batchRenameSettings: {
          ...DEFAULT_BATCH_RENAME_SETTINGS,
          mode: "format",
          nameFormat: "date",
          dateSource: "taken",
          separator: "",
        },
      },
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    await waitFor(() => expect(hook.result.current.sheet?.inspect).not.toBeNull());
    expect(inspections.map((inspection) => inspection.includeDateTaken)).toEqual([true]);
    // No separator in Format: a number added to a taken name gets a space.
    expect(hook.result.current.request?.numberSeparator).toBe(" ");
  });

  it("sends nothing while checking, with a name to fix, or with nothing to rename", async () => {
    let answer: (value: IpcResponse<"batchRename:inspect">) => void = () => undefined;
    const { hook } = setup({
      preferences: {
        batchRenameSettings: {
          ...DEFAULT_BATCH_RENAME_SETTINGS,
          find: "IMG_1",
          onConflict: "block",
        },
      },
      inspect: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    expect(hook.result.current.request).toBeNull();
    await act(async () => {
      answer({
        items: targets.map((target) => ({
          path: target.path,
          createdAt: null,
          modifiedAt: null,
          takenAt: null,
          cannotRename: null,
        })),
        folders: [
          { path: "/trip", names: ["IMG_1.jpg", "IMG_2.jpg", ".jpg"], caseSensitive: false },
        ],
      });
    });
    // "IMG_1.jpg" without "IMG_1" is only an extension: that must be fixed first.
    expect(hook.result.current.plan?.blockingCount).toBe(1);
    expect(hook.result.current.request).toBeNull();
    act(() => {
      hook.result.current.setSettings({ ...DEFAULT_BATCH_RENAME_SETTINGS, find: "nothing" });
    });
    expect(hook.result.current.request).toBeNull();
  });

  it("keeps the settings for next time when it closes", async () => {
    const { hook, updates } = setup();
    await act(async () => {
      await hook.result.current.open(targets);
    });
    act(() => {
      hook.result.current.setSettings({ ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "case" });
    });
    act(() => {
      hook.result.current.close();
    });
    expect(hook.result.current.sheet).toBeNull();
    await waitFor(() =>
      expect(updates).toContainEqual({
        batchRenameSettings: { ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "case" },
      }),
    );
  });

  it("saves presets by name, replacing one of the same name, and deletes them", async () => {
    const { hook, updates } = setup({
      preferences: {
        batchRenamePresets: [{ name: "Photos", settings: DEFAULT_BATCH_RENAME_SETTINGS }],
      },
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    act(() => {
      hook.result.current.setSettings({ ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "add" });
    });
    act(() => {
      hook.result.current.savePreset("  photos ");
    });
    expect(hook.result.current.presets).toEqual([
      { name: "photos", settings: { ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "add" } },
    ]);
    act(() => {
      hook.result.current.savePreset("   ");
    });
    expect(hook.result.current.presets).toHaveLength(1);
    act(() => {
      hook.result.current.deletePreset("photos");
    });
    expect(hook.result.current.presets).toEqual([]);
    await waitFor(() => expect(updates.at(-1)).toEqual({ batchRenamePresets: [] }));
  });

  it("says when the items couldn't be checked, and renames nothing", async () => {
    const { hook } = setup({
      preferences: { batchRenameSettings: { ...DEFAULT_BATCH_RENAME_SETTINGS, find: "IMG" } },
      inspect: async () => Promise.reject(new Error("gone")),
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    await waitFor(() =>
      expect(hook.result.current.sheet?.inspectError).toBe(
        "File Trail couldn’t read the items to check their new names.",
      ),
    );
    expect(hook.result.current.request).toBeNull();
  });

  it("opens with the defaults when the preferences can't be read, and not at all for nothing", async () => {
    const { hook } = setup({ getPreferencesFails: true });
    await act(async () => {
      await hook.result.current.open([]);
    });
    expect(hook.result.current.sheet).toBeNull();
    await act(async () => {
      await hook.result.current.open(targets);
    });
    expect(hook.result.current.settings).toEqual(DEFAULT_BATCH_RENAME_SETTINGS);
  });

  it("forgets an answer that comes after the sheet closed", async () => {
    let answer: (value: IpcResponse<"batchRename:inspect">) => void = () => undefined;
    const { hook } = setup({
      inspect: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    act(() => {
      hook.result.current.close();
    });
    await act(async () => {
      answer({ items: [], folders: [] });
    });
    expect(hook.result.current.sheet).toBeNull();
  });
});
