import { type Dispatch, type SetStateAction, useCallback, useRef, useState } from "react";

import type { Volume } from "@filetrail/contracts";
import { describeEjectFailure, planEject } from "../lib/eject";
import type { FiletrailClient } from "../lib/filetrailClient";
import { createRendererLogger } from "../lib/logging";
import { useLatest } from "./useLatest";
import type { CopyPasteDialogState } from "./useWriteOperations";

const logger = createRendererLogger("filetrail.eject");

// Eject, from a disk's button in Locations, its right-click menu or File ▸ Eject. A disk
// that shares its physical disk with other volumes asks first, as Finder does; a disk in use
// asks whether to force it. When the disk is gone the sidebar loses its row, and tabs on it
// go Home (see App).
export function useEjectVolume(args: {
  client: FiletrailClient;
  volumes: readonly Volume[];
  setCopyPasteDialogState: Dispatch<SetStateAction<CopyPasteDialogState | null>>;
  showNotice: (title: string, message: string) => void;
}) {
  const latest = useLatest(args);
  const [ejectingPaths, setEjectingPaths] = useState<ReadonlySet<string>>(() => new Set());
  const ejectingRef = useRef(new Set<string>());

  const run = useCallback(
    async (path: string, options: { wholeDisk: boolean; force: boolean }) => {
      if (ejectingRef.current.has(path)) {
        return;
      }
      const setEjecting = (on: boolean) => {
        if (on) {
          ejectingRef.current.add(path);
        } else {
          ejectingRef.current.delete(path);
        }
        setEjectingPaths(new Set(ejectingRef.current));
      };
      setEjecting(true);
      const { client } = latest.current;
      try {
        const response = await client.invoke("system:ejectVolume", { path, ...options });
        if (response.status === "busy") {
          latest.current.setCopyPasteDialogState({
            type: "ejectBusy",
            busyPath: response.failedPath ?? path,
            wholeDisk: options.wholeDisk,
          });
        } else if (response.status === "failed") {
          const notice = describeEjectFailure(latest.current.volumes, path, response);
          latest.current.showNotice(notice.title, notice.message);
        }
      } catch (error) {
        logger.error("eject failed", error);
        const notice = describeEjectFailure(latest.current.volumes, path, {
          failedPath: null,
          code: null,
          reason: null,
        });
        latest.current.showNotice(notice.title, notice.message);
      } finally {
        setEjecting(false);
      }
    },
    [latest],
  );

  const requestEject = useCallback(
    (path: string) => {
      const plan = planEject(latest.current.volumes, path);
      if (plan === null) {
        return;
      }
      if (plan.kind === "askWhichVolumes") {
        latest.current.setCopyPasteDialogState({
          type: "ejectWhichVolumes",
          path: plan.path,
          name: plan.name,
          otherNames: plan.otherNames,
        });
        return;
      }
      void run(plan.path, { wholeDisk: true, force: false });
    },
    [latest, run],
  );

  // Eject All, Eject (this volume only) or Cancel.
  const answerWhichVolumes = useCallback(
    (path: string, answer: "all" | "one" | "cancel") => {
      latest.current.setCopyPasteDialogState(null);
      if (answer !== "cancel") {
        void run(path, { wholeDisk: answer === "all", force: false });
      }
    },
    [latest, run],
  );

  // Force Eject, Try Again or Cancel. Both go on from the volume in use: volumes of the
  // same disk unmounted before it was refused are gone already.
  const answerBusy = useCallback(
    (busyPath: string, wholeDisk: boolean, answer: "force" | "retry" | "cancel") => {
      latest.current.setCopyPasteDialogState(null);
      if (answer !== "cancel") {
        void run(busyPath, { wholeDisk, force: answer === "force" });
      }
    },
    [latest, run],
  );

  return { ejectingPaths, requestEject, answerWhichVolumes, answerBusy };
}
