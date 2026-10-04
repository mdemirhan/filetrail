import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  type BatchRenameFolder,
  type BatchRenameItem,
  type BatchRenamePlan,
  type BatchRenamePreset,
  type BatchRenameSettings,
  DEFAULT_BATCH_RENAME_SETTINGS,
  type LocalDateTime,
  MAX_BATCH_RENAME_PRESETS,
  planBatchRename,
  sanitizeBatchRenamePresets,
  sanitizeBatchRenameSettings,
  toLocalDateTime,
} from "../../shared/batchRename";
import type { FiletrailClient } from "../lib/filetrailClient";
import { createRendererLogger } from "../lib/logging";

const logger = createRendererLogger("filetrail.batchRename");

type InspectAnswer = IpcResponse<"batchRename:inspect">;

/** An item the sheet renames, as the list knows it. */
export type BatchRenameTarget = { path: string; name: string; isFolder: boolean };

export type BatchRenameSheetState = {
  targets: BatchRenameTarget[];
  /** When the sheet opened, for Today. */
  now: LocalDateTime;
  /** What the main process found; null while it is being asked. */
  inspect: InspectAnswer | null;
  /** Whether `inspect` includes the dates taken (asked for only when they are used). */
  inspectHasDatesTaken: boolean;
  /** The checks couldn't be made: nothing can be renamed. */
  inspectError: string | null;
};

// The Rename sheet for several items: what is shown, its settings (as last used) and saved
// presets, and the plan built from them. Settings and presets are read when the sheet opens
// and saved with the app's preferences.
export function useBatchRename(client: FiletrailClient) {
  const [sheet, setSheet] = useState<BatchRenameSheetState | null>(null);
  const [settings, setSettingsState] = useState<BatchRenameSettings>(DEFAULT_BATCH_RENAME_SETTINGS);
  const [presets, setPresets] = useState<BatchRenamePreset[]>([]);
  const inspectRequestRef = useRef(0);

  const needsDatesTaken =
    settings.mode === "format" && settings.nameFormat === "date" && settings.dateSource === "taken";

  const inspect = useCallback(
    (targets: BatchRenameTarget[], includeDateTaken: boolean) => {
      const requestId = ++inspectRequestRef.current;
      void client
        .invoke("batchRename:inspect", {
          paths: targets.map((target) => target.path),
          includeDateTaken,
        })
        .then(
          (answer) => {
            if (inspectRequestRef.current !== requestId) {
              return;
            }
            setSheet((current) =>
              current
                ? { ...current, inspect: answer, inspectHasDatesTaken: includeDateTaken }
                : current,
            );
          },
          (error: unknown) => {
            if (inspectRequestRef.current !== requestId) {
              return;
            }
            logger.error("batch rename inspection failed", error);
            setSheet((current) =>
              current
                ? {
                    ...current,
                    inspectError: "File Trail couldn’t read the items to check their new names.",
                  }
                : current,
            );
          },
        );
    },
    [client],
  );

  const open = useCallback(
    async (targets: BatchRenameTarget[]) => {
      if (targets.length === 0) {
        return;
      }
      let loaded = DEFAULT_BATCH_RENAME_SETTINGS;
      try {
        const { preferences } = await client.invoke("app:getPreferences", {});
        loaded = sanitizeBatchRenameSettings(preferences.batchRenameSettings);
        setPresets(sanitizeBatchRenamePresets(preferences.batchRenamePresets));
      } catch (error) {
        logger.error("batch rename settings could not be read", error);
      }
      setSettingsState(loaded);
      setSheet({
        targets,
        now: toLocalDateTime(new Date()),
        inspect: null,
        inspectHasDatesTaken: false,
        inspectError: null,
      });
      inspect(
        targets,
        loaded.mode === "format" && loaded.nameFormat === "date" && loaded.dateSource === "taken",
      );
    },
    [client, inspect],
  );

  // Dates taken are read from the files, so only once they are used.
  useEffect(() => {
    if (sheet && needsDatesTaken && !sheet.inspectHasDatesTaken && sheet.inspect !== null) {
      setSheet((current) => (current ? { ...current, inspect: null } : current));
      inspect(sheet.targets, true);
    }
  }, [inspect, needsDatesTaken, sheet]);

  const saveSettings = useCallback(
    (next: BatchRenameSettings) => {
      void client
        .invoke("app:updatePreferences", { preferences: { batchRenameSettings: next } })
        .catch((error: unknown) => logger.error("batch rename settings not saved", error));
    },
    [client],
  );

  const close = useCallback(() => {
    inspectRequestRef.current += 1;
    // What was typed is kept for next time, whether or not anything was renamed.
    saveSettings(settings);
    setSheet(null);
  }, [saveSettings, settings]);

  const savePresets = useCallback(
    (next: BatchRenamePreset[]) => {
      setPresets(next);
      void client
        .invoke("app:updatePreferences", { preferences: { batchRenamePresets: next } })
        .catch((error: unknown) => logger.error("batch rename presets not saved", error));
    },
    [client],
  );

  /** Saves the settings as they are under `name`, replacing a preset of that name. */
  const savePreset = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return;
      }
      const others = presets.filter(
        (preset) => preset.name.toLowerCase() !== trimmed.toLowerCase(),
      );
      savePresets([...others, { name: trimmed, settings }].slice(-MAX_BATCH_RENAME_PRESETS));
    },
    [presets, savePresets, settings],
  );

  const deletePreset = useCallback(
    (name: string) => savePresets(presets.filter((preset) => preset.name !== name)),
    [presets, savePresets],
  );

  const plan = useMemo<BatchRenamePlan | null>(() => {
    if (!sheet) {
      return null;
    }
    const answer = sheet.inspect;
    const itemsByPath = new Map(answer?.items.map((item) => [item.path, item]) ?? []);
    const items: BatchRenameItem[] = sheet.targets.map((target) => {
      const inspected = itemsByPath.get(target.path);
      return {
        ...target,
        createdAt: inspected?.createdAt ?? null,
        modifiedAt: inspected?.modifiedAt ?? null,
        takenAt: inspected?.takenAt ?? null,
      };
    });
    const folders = new Map<string, BatchRenameFolder>(
      answer?.folders.map((folder) => [
        folder.path,
        { names: folder.names, caseSensitive: folder.caseSensitive },
      ]) ?? [],
    );
    const cannotRename = new Map<string, string>();
    for (const item of answer?.items ?? []) {
      if (item.cannotRename !== null) {
        cannotRename.set(item.path, item.cannotRename);
      }
    }
    return planBatchRename({ settings, items, folders, cannotRename, now: sheet.now });
  }, [settings, sheet]);

  /** What to ask the main process to do, when the plan can be carried out. */
  const request = useMemo<IpcRequest<"writeOperation:batchRename"> | null>(() => {
    if (
      !sheet ||
      !plan ||
      sheet.inspect === null ||
      sheet.inspectError !== null ||
      plan.settingsError !== null ||
      plan.blockingCount > 0 ||
      plan.renameCount === 0
    ) {
      return null;
    }
    const items = plan.items.flatMap((planItem, index) => {
      const target = sheet.targets[index];
      return planItem.status === "rename" && target
        ? [{ sourcePath: target.path, destinationName: planItem.name, isFolder: target.isFolder }]
        : [];
    });
    const separator = settings.mode === "format" ? settings.separator : " ";
    return {
      items,
      onConflict: settings.onConflict,
      numberSeparator: separator === "-" || separator === "_" ? separator : " ",
    };
  }, [plan, settings, sheet]);

  return {
    sheet,
    settings,
    setSettings: setSettingsState,
    presets,
    savePreset,
    deletePreset,
    plan,
    request,
    open,
    close,
  };
}

export type BatchRename = ReturnType<typeof useBatchRename>;
