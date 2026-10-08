import type { IpcResponse } from "@filetrail/contracts";

import type { AppPreferences, OpenTabPreference } from "../shared/appPreferences";
import { type AppStateStore, isWindowSessionKey } from "./appStateStore";
import { toPreferencePatch } from "./bootstrap/preferencesPatch";
import type { IpcHandlerMap } from "./ipc";

// The IPC that knows which window is asking: preferences seen through the window's own
// session, opening, counting and merging explorer windows, and the clipboard every window
// shares.

// The windows, as the main process's IPC sees them.
export type WindowHost = {
  // The id of the explorer window a web contents belongs to; null for other windows
  // (Settings), which see only the app's preferences.
  explorerWindowIdOf: (senderId: number | null) => string | null;
  // What an explorer window opens with: the launch folder for the window in front at
  // startup, and whether it opens the tabs it was given.
  launchContextFor: (senderId: number | null) => IpcResponse<"app:getLaunchContext">;
  // Opens a window with the tabs; false when none was opened.
  openExplorerWindow: (
    senderId: number | null,
    tabs: OpenTabPreference[],
    activeTabIndex: number,
  ) => boolean;
  // Closes the other explorer windows and returns their tabs.
  mergeExplorerWindows: (senderId: number | null) => OpenTabPreference[];
  explorerWindowCount: () => number;
  // Sends to every window of the app but the one asking.
  sendToOtherWindows: (senderId: number | null, channel: string, payload: unknown) => void;
};

export type PreferencesChange = { patch: Partial<AppPreferences>; senderId: number | null };

export const WINDOW_IPC_CHANNELS = [
  "app:getPreferences",
  "app:updatePreferences",
  "app:getLaunchContext",
  "app:openWindow",
  "app:getExplorerWindowCount",
  "app:mergeAllWindows",
  "app:getClipboard",
  "app:setClipboard",
] as const;

export type WindowIpcChannel = (typeof WINDOW_IPC_CHANNELS)[number];

export function createWindowIpcHandlers(deps: {
  store: Pick<
    AppStateStore,
    "getPreferences" | "getWindowPreferences" | "updatePreferences" | "updateWindowPreferences"
  >;
  windows: WindowHost;
  // Told of every change, with only the keys the whole app shares.
  onPreferencesChanged: (preferences: AppPreferences, change: PreferencesChange) => void;
}): Pick<IpcHandlerMap, WindowIpcChannel> {
  const { store, windows } = deps;
  // What Copy or Cut put on the clipboard, in whichever window: every window pastes it.
  let sharedClipboard: IpcResponse<"app:getClipboard">["clipboard"] = { type: "empty" };
  const senderIdOf = (event: { sender?: { id: number } } | undefined) => event?.sender?.id ?? null;

  return {
    "app:getPreferences": (_payload, event) => {
      const windowId = windows.explorerWindowIdOf(senderIdOf(event));
      return {
        preferences: windowId ? store.getWindowPreferences(windowId) : store.getPreferences(),
      };
    },
    "app:getLaunchContext": (_payload, event) => windows.launchContextFor(senderIdOf(event)),
    "app:updatePreferences": (payload, event) => {
      const senderId = senderIdOf(event);
      const patch = toPreferencePatch(payload.preferences);
      const windowId = windows.explorerWindowIdOf(senderId);
      const preferences = windowId
        ? store.updateWindowPreferences(windowId, patch)
        : store.updatePreferences(patch);
      // The sender id lets main forward the change to the other windows (e.g. Settings).
      // What belongs to one window (its tabs, panels, column widths) stays with it.
      const sharedPatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => !isWindowSessionKey(key)),
      ) as Partial<AppPreferences>;
      deps.onPreferencesChanged(store.getPreferences(), { patch: sharedPatch, senderId });
      return { preferences };
    },
    "app:openWindow": (payload, event) => ({
      ok: windows.openExplorerWindow(
        senderIdOf(event),
        payload.tabs as OpenTabPreference[],
        payload.activeTabIndex,
      ),
    }),
    "app:getExplorerWindowCount": () => ({ count: windows.explorerWindowCount() }),
    "app:mergeAllWindows": (_payload, event) => ({
      tabs: windows.mergeExplorerWindows(senderIdOf(event)),
    }),
    "app:getClipboard": () => ({ clipboard: sharedClipboard }),
    "app:setClipboard": (payload, event) => {
      sharedClipboard = payload.clipboard;
      windows.sendToOtherWindows(senderIdOf(event), "filetrail:clipboardChanged", sharedClipboard);
      return { ok: true };
    },
  };
}
