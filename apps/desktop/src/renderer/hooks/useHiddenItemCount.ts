import { useEffect, useState } from "react";

import type { useFiletrailClient } from "../lib/filetrailClient";

// How many hidden items a folder that lists nothing has, so its empty state can say they
// are there. Asked only for such a folder, while hidden files are left out: every item the
// folder then has is a hidden one.
export function useHiddenItemCount(
  client: ReturnType<typeof useFiletrailClient>,
  path: string,
  shouldCount: boolean,
): number {
  const [counted, setCounted] = useState<{ path: string; count: number } | null>(null);

  useEffect(() => {
    if (!shouldCount || path.length === 0) {
      return;
    }
    let cancelled = false;
    client
      .invoke("directory:getSnapshot", { path, includeHidden: true })
      .then((response) => {
        if (!cancelled) {
          setCounted({ path, count: response.entries.length });
        }
      })
      // The folder still reads as empty; that it has hidden items is only a hint.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, path, shouldCount]);

  return shouldCount && counted?.path === path ? counted.count : 0;
}
