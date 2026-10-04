import { useEffect, useState } from "react";

import type { Volume } from "@filetrail/contracts";
import type { FiletrailClient } from "../lib/filetrailClient";

// The disks mounted besides the startup disk: asked for once, then kept up to date by the
// main process, which sends the list again whenever a disk is mounted or unmounted.
export function useVolumes(client: FiletrailClient): Volume[] {
  const [volumes, setVolumes] = useState<Volume[]>([]);

  useEffect(() => {
    let changed = false;
    const unsubscribe = client.onVolumesChanged?.((next) => {
      changed = true;
      setVolumes(next);
    });
    void client
      .invoke("system:listVolumes", {})
      .then((response) => {
        // A change that arrived first is newer than this answer.
        if (!changed) {
          setVolumes(response.volumes);
        }
      })
      .catch(() => undefined);
    return () => {
      unsubscribe?.();
    };
  }, [client]);

  return volumes;
}
