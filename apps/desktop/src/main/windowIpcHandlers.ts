import type { IpcResponse } from "@filetrail/contracts";

import {
  type AppPreferences,
  type OpenTabPreference,
  isWindowSessionKey,
} from "../shared/appPreferences";
import type { AppStateStore } from "./appStateStore";
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
  // Closes the other explorer windows whose tabs fit beside the asking window's
  // `tabCount`, and returns their tabs.
  mergeExplorerWindows: (senderId: number | null, tabCount: number) => Promise<OpenTabPreference[]>;
  // A window's answer to Merge All Windows asking for its tabs.
  answerMergeRequest: (
    senderId: number | null,
    requestId: string,
    answer: WindowTabsAnswer,
  ) => void;
  explorerWindowCount: () => number;
  // Closes the explorer window as its close button does; false when it isn't one.
  closeExplorerWindow: (senderId: number | null) => boolean;
  // Sends to every window of the app but the one asking.
  sendToOtherWindows: (senderId: number | null, channel: string, payload: unknown) => void;
};

export type PreferencesChange = { patch: Partial<AppPreferences>; senderId: number | null };

// What a window says when Merge All Windows asks for its tabs.
export type WindowTabsAnswer = { tabs: OpenTabPreference[]; busy: boolean };

// How long Merge All Windows waits for a window's tabs: one that doesn't answer stays open.
export const TABS_REQUEST_TIMEOUT_MS = 2_000;

// Asks windows for their tabs as they are now, rather than as last saved (the window saves
// them a moment after each change), and hands over each answer from the window asked.
export class WindowTabsRequests {
  private nextRequestId = 1;
  private readonly pending = new Map<
    string,
    { senderId: number; resolve: (answer: WindowTabsAnswer | null) => void }
  >();

  /** Resolves with the window's answer, or null when it doesn't answer in time. */
  ask(
    contents: { readonly id: number; send(channel: string, ...args: unknown[]): void },
    timeoutMs: number = TABS_REQUEST_TIMEOUT_MS,
  ): Promise<WindowTabsAnswer | null> {
    const requestId = `merge-${this.nextRequestId}`;
    this.nextRequestId += 1;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(requestId, null), timeoutMs);
      this.pending.set(requestId, {
        senderId: contents.id,
        resolve: (answer) => {
          clearTimeout(timer);
          resolve(answer);
        },
      });
      try {
        contents.send("filetrail:mergeRequest", { requestId });
      } catch {
        // The window went away as it was asked.
        this.settle(requestId, null);
      }
    });
  }

  answer(senderId: number | null, requestId: string, answer: WindowTabsAnswer): void {
    if (this.pending.get(requestId)?.senderId === senderId) {
      this.settle(requestId, answer);
    }
  }

  private settle(requestId: string, answer: WindowTabsAnswer | null): void {
    const request = this.pending.get(requestId);
    this.pending.delete(requestId);
    request?.resolve(answer);
  }
}

export const WINDOW_IPC_CHANNELS = [
  "app:getPreferences",
  "app:updatePreferences",
  "app:getLaunchContext",
  "app:openWindow",
  "app:getExplorerWindowCount",
  "app:closeWindow",
  "app:mergeAllWindows",
  "app:answerMergeRequest",
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
    "app:closeWindow": (_payload, event) => ({
      ok: windows.closeExplorerWindow(senderIdOf(event)),
    }),
    "app:mergeAllWindows": async (payload, event) => ({
      tabs: await windows.mergeExplorerWindows(senderIdOf(event), payload.tabCount),
    }),
    "app:answerMergeRequest": (payload, event) => {
      windows.answerMergeRequest(senderIdOf(event), payload.requestId, {
        tabs: payload.tabs as OpenTabPreference[],
        busy: payload.busy,
      });
      return { ok: true };
    },
    "app:getClipboard": () => ({ clipboard: sharedClipboard }),
    "app:setClipboard": (payload, event) => {
      if (
        payload.follows !== undefined &&
        (sharedClipboard.type !== "ready" || sharedClipboard.capturedAt !== payload.follows)
      ) {
        // Something else was put on the clipboard since; that window told the others.
        return { ok: false };
      }
      sharedClipboard = payload.clipboard;
      windows.sendToOtherWindows(senderIdOf(event), "filetrail:clipboardChanged", sharedClipboard);
      return { ok: true };
    },
  };
}
