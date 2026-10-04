// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";

import type { IpcRequestInput, IpcResponse } from "@filetrail/contracts";

import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { DEFAULT_BATCH_RENAME_SETTINGS, MAX_BATCH_RENAME_PRESETS } from "../../shared/batchRename";
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

  it("sends only the items to rename, with the numbered names, and leaves out what can't be renamed", async () => {
    const mixed: BatchRenameTarget[] = [
      { path: "/trip/x locked.jpg", name: "x locked.jpg", isFolder: false },
      { path: "/trip/same.jpg", name: "same.jpg", isFolder: false },
      { path: "/trip/x.jpg", name: "x.jpg", isFolder: false },
      { path: "/trip/x2", name: "x2", isFolder: true },
    ];
    const { hook } = setup({
      preferences: {
        batchRenameSettings: { ...DEFAULT_BATCH_RENAME_SETTINGS, find: "x", replaceWith: "Lisbon" },
      },
      inspect: async (payload) => ({
        items: payload.paths.map((path) => ({
          path,
          createdAt: null,
          modifiedAt: null,
          takenAt: null,
          cannotRename: path === "/trip/x locked.jpg" ? "“x locked.jpg” is locked." : null,
        })),
        folders: [
          {
            path: "/trip",
            names: [...mixed.map((target) => target.name), "Lisbon.jpg"],
            caseSensitive: false,
          },
        ],
      }),
    });
    await act(async () => {
      await hook.result.current.open(mixed);
    });
    await waitFor(() => expect(hook.result.current.sheet?.inspect).not.toBeNull());
    const plan = hook.result.current.plan;
    expect(plan?.items.map((item) => item.status)).toEqual([
      "problem",
      "unchanged",
      "rename",
      "rename",
    ]);
    expect(plan?.items[0]).toMatchObject({
      problem: { kind: "cannotRename", message: "“x locked.jpg” is locked." },
    });
    // A locked item is left as it is: it doesn't stop the others.
    expect(plan).toMatchObject({
      renameCount: 2,
      unchangedCount: 1,
      skippedCount: 1,
      blockingCount: 0,
    });
    expect(hook.result.current.request).toEqual({
      items: [
        { sourcePath: "/trip/x.jpg", destinationName: "Lisbon 2.jpg", isFolder: false },
        { sourcePath: "/trip/x2", destinationName: "Lisbon2", isFolder: true },
      ],
      onConflict: "number",
      numberSeparator: " ",
    });
  });

  it("doesn't take the answer for a sheet closed before it came into the next one", async () => {
    const answers: Array<(value: IpcResponse<"batchRename:inspect">) => void> = [];
    const { hook } = setup({
      preferences: { batchRenameSettings: { ...DEFAULT_BATCH_RENAME_SETTINGS, find: "IMG" } },
      inspect: () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    });
    const other: BatchRenameTarget[] = [
      { path: "/home/IMG_9.jpg", name: "IMG_9.jpg", isFolder: false },
    ];
    await act(async () => {
      await hook.result.current.open(targets);
    });
    act(() => {
      hook.result.current.close();
    });
    await act(async () => {
      await hook.result.current.open(other);
    });
    // The first sheet's answer comes late: it says nothing of the second sheet's items.
    await act(async () => {
      answers[0]?.(answerFor(targets, { cannotRename: "locked", folderNames: ["IMG_1.jpg"] }));
    });
    expect(hook.result.current.sheet?.targets).toEqual(other);
    expect(hook.result.current.sheet?.inspect).toBeNull();
    expect(hook.result.current.request).toBeNull();
    await act(async () => {
      answers[1]?.(answerFor(other, { folderNames: ["IMG_9.jpg"] }));
    });
    expect(hook.result.current.request?.items).toEqual([
      { sourcePath: "/home/IMG_9.jpg", destinationName: "_9.jpg", isFolder: false },
    ]);
  });

  it("asks for the dates taken once, and keeps the newest sheet's answer when answers cross", async () => {
    const answers: Array<{
      payload: IpcRequestInput<"batchRename:inspect">;
      resolve: (value: IpcResponse<"batchRename:inspect">) => void;
    }> = [];
    const { hook } = setup({
      inspect: (payload) =>
        new Promise((resolve) => {
          answers.push({ payload, resolve });
        }),
    });
    const takenSettings = {
      ...DEFAULT_BATCH_RENAME_SETTINGS,
      mode: "format" as const,
      nameFormat: "date" as const,
      dateSource: "taken" as const,
      separator: "_" as const,
    };
    await act(async () => {
      await hook.result.current.open(targets);
    });
    // Dates taken are wanted before the first answer comes: they are asked for after it.
    act(() => {
      hook.result.current.setSettings(takenSettings);
    });
    expect(answers).toHaveLength(1);
    await act(async () => {
      answers[0]?.resolve(answerFor(targets, {}));
    });
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(answers[1]?.payload.includeDateTaken).toBe(true);
    expect(hook.result.current.sheet?.inspect).toBeNull();
    // Switching away and back while they are read asks no more.
    act(() => {
      hook.result.current.setSettings(DEFAULT_BATCH_RENAME_SETTINGS);
    });
    act(() => {
      hook.result.current.setSettings(takenSettings);
    });
    expect(answers).toHaveLength(2);

    // The sheet is closed and opened again before the dates come. The new sheet asks on its
    // own (these preferences open it on Replace Text, then Format by date taken is chosen):
    // the old sheet's dates, coming last, are not taken.
    act(() => {
      hook.result.current.close();
    });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    expect(answers.map((answer) => answer.payload.includeDateTaken)).toEqual([false, true, false]);
    act(() => {
      hook.result.current.setSettings(takenSettings);
    });
    await act(async () => {
      answers[2]?.resolve(answerFor(targets, {}));
    });
    await waitFor(() => expect(answers).toHaveLength(4));
    await act(async () => {
      answers[3]?.resolve(answerFor(targets, { takenAt: "2026-05-14T18:02:11" }));
    });
    await act(async () => {
      answers[1]?.resolve(answerFor(targets, { takenAt: "1999-01-01T00:00:00" }));
    });
    expect(hook.result.current.sheet?.inspectHasDatesTaken).toBe(true);
    expect(hook.result.current.request?.items.map((item) => item.destinationName)).toEqual([
      "File_2026-05-14.jpg",
      "File_2026-05-14_2.jpg",
    ]);
  });

  it("keeps the newest presets, dropping the oldest, when there are too many", async () => {
    const saved = Array.from({ length: MAX_BATCH_RENAME_PRESETS }, (_, index) => ({
      name: `Preset ${index + 1}`,
      settings: DEFAULT_BATCH_RENAME_SETTINGS,
    }));
    const { hook, updates } = setup({ preferences: { batchRenamePresets: saved } });
    await act(async () => {
      await hook.result.current.open(targets);
    });
    expect(hook.result.current.presets).toHaveLength(MAX_BATCH_RENAME_PRESETS);
    // Saved again under a name it has: replaced, and moved to the end; nothing dropped.
    act(() => {
      hook.result.current.savePreset("preset 1");
    });
    expect(hook.result.current.presets).toHaveLength(MAX_BATCH_RENAME_PRESETS);
    expect(hook.result.current.presets[0]?.name).toBe("Preset 2");
    expect(hook.result.current.presets.at(-1)?.name).toBe("preset 1");
    // A new one: the oldest goes.
    act(() => {
      hook.result.current.savePreset("New");
    });
    const names = hook.result.current.presets.map((preset) => preset.name);
    expect(names).toHaveLength(MAX_BATCH_RENAME_PRESETS);
    expect(names[0]).toBe("Preset 3");
    expect(names.slice(-2)).toEqual(["preset 1", "New"]);
    await waitFor(() =>
      expect(updates.at(-1)?.batchRenamePresets?.map((preset) => preset.name)).toEqual(names),
    );
  });
});

// What the main process answers for these items, all in the folder of the first.
function answerFor(
  items: BatchRenameTarget[],
  options: { cannotRename?: string; folderNames?: string[]; takenAt?: string },
): IpcResponse<"batchRename:inspect"> {
  const folder = items[0]?.path.slice(0, items[0].path.lastIndexOf("/")) ?? "/";
  return {
    items: items.map((item) => ({
      path: item.path,
      createdAt: "2026-09-30T10:12:40",
      modifiedAt: "2026-10-01T08:30:15",
      takenAt: options.takenAt ?? null,
      cannotRename: options.cannotRename ?? null,
    })),
    folders: [
      {
        path: folder,
        names: options.folderNames ?? items.map((item) => item.name),
        caseSensitive: false,
      },
    ],
  };
}
