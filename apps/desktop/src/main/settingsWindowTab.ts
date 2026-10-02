import { type SettingsTab, settingsTabSchema } from "@filetrail/contracts";

// The tab named after "#settings/" in a Settings window's address. The window keeps its
// address in step with the tab on screen, which is how the main process knows where
// Settings was left.
export function readSettingsTabFromUrl(url: string): SettingsTab | null {
  const hashIndex = url.indexOf("#");
  const match = hashIndex === -1 ? null : /^#settings\/([a-z]+)$/u.exec(url.slice(hashIndex));
  const parsed = settingsTabSchema.safeParse(match?.[1]);
  return parsed.success ? parsed.data : null;
}
