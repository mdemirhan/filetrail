import { useCallback, useEffect, useState } from "react";

import type { FiletrailClient } from "../lib/filetrailClient";

// Whether the Trash has anything in it, for greying out Empty Trash when it hasn't (as
// Finder does). Asked when the window opens or comes to the front, and after every file
// operation and Empty Trash. null while it can't be told: Empty Trash stays available.
export function useTrashState(client: FiletrailClient): {
  trashIsEmpty: boolean | null;
  refreshTrashState: () => void;
} {
  const [trashIsEmpty, setTrashIsEmpty] = useState<boolean | null>(null);
  const refreshTrashState = useCallback(() => {
    void client
      .invoke("system:getTrashState", {})
      .then((state) => setTrashIsEmpty(state.empty))
      .catch(() => setTrashIsEmpty(null));
  }, [client]);

  useEffect(() => {
    refreshTrashState();
    window.addEventListener("focus", refreshTrashState);
    const unsubscribe = client.onWriteOperationProgress((event) => {
      if (event.result) {
        refreshTrashState();
      }
    });
    return () => {
      window.removeEventListener("focus", refreshTrashState);
      unsubscribe();
    };
  }, [client, refreshTrashState]);

  return { trashIsEmpty, refreshTrashState };
}
