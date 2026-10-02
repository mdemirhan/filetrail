import { useEffect } from "react";

import type { AppPreferences } from "../../shared/appPreferences";
import type { FiletrailClient } from "../lib/filetrailClient";
import { applyPreferencesPatch, useAppPreferences } from "./useAppPreferences";

// For a window that has no settings of its own (About, Acknowledgements): it takes the
// palette, accent and font chosen in Settings, and follows them while it is open.
export function useWindowAppearance(client: FiletrailClient): void {
  const preferences = useAppPreferences();

  // biome-ignore lint/correctness/useExhaustiveDependencies: load the preferences once per client.
  useEffect(() => {
    let cancelled = false;
    void client
      .invoke("app:getPreferences", {})
      .then((response) => {
        if (!cancelled) {
          applyPreferencesPatch(preferences, response.preferences);
        }
      })
      .catch(() => {
        // The window keeps the default look.
      });
    const unsubscribe = client.onPreferencesChanged?.((patch) =>
      applyPreferencesPatch(preferences, patch as Partial<AppPreferences>),
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client]);
}

// Escape closes a window that is only read, like ⌘W.
export function useCloseOnEscape(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
        return;
      }
      event.preventDefault();
      window.close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
