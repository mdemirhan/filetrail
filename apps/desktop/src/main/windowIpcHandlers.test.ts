import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OpenTabPreference } from "../shared/appPreferences";
import { createAppStateStore, resolveAppStatePath } from "./appStateStore";
import { type WindowHost, createWindowIpcHandlers } from "./windowIpcHandlers";

function tab(path: string): OpenTabPreference {
  return {
    path,
    treeRootPath: "/Users/demo",
    favoritePath: null,
    viewMode: "list",
    searchViewMode: "details",
    sortBy: "name",
    sortDirection: "asc",
    includeHidden: false,
    foldersFirst: true,
    favoritesExpanded: true,
    locationsExpanded: true,
  };
}

// The IPC event of a message from the web contents `id`.
function from(id: number) {
  return { sender: { id } } as never;
}

function setUp() {
  const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-window-ipc-")));
  writeFileSync(filePath, JSON.stringify({ preferences: {}, windows: [] }), "utf8");
  const store = createAppStateStore(filePath, { defaultTheme: "dark" });
  store.addExplorerWindow({
    id: "window-a",
    bounds: { width: 900, height: 600, maximized: false },
    session: store.createWindowSession(),
  });
  // Web contents 1 is window A; 2 is Settings.
  const windows = {
    explorerWindowIdOf: (senderId: number | null) => (senderId === 1 ? "window-a" : null),
    launchContextFor: vi.fn((senderId: number | null) => ({
      startupFolderPath: senderId === 1 ? "/Users/demo" : null,
      restoreTabs: false,
    })),
    openExplorerWindow: vi.fn(() => true),
    mergeExplorerWindows: vi.fn(() => [tab("/Users/demo/merged")]),
    explorerWindowCount: () => 2,
    sendToOtherWindows: vi.fn(),
  } satisfies WindowHost;
  const onPreferencesChanged = vi.fn();
  const handlers = createWindowIpcHandlers({ store, windows, onPreferencesChanged });
  return { store, windows, handlers, onPreferencesChanged };
}

describe("createWindowIpcHandlers", () => {
  it("shows an explorer window the app's preferences with its own session", async () => {
    const { store, handlers } = setUp();
    store.updateWindowPreferences("window-a", { treeWidth: 333 });
    store.updatePreferences({ treeWidth: 280 });

    expect((await handlers["app:getPreferences"]({}, from(1))).preferences.treeWidth).toBe(333);
    expect((await handlers["app:getPreferences"]({}, from(2))).preferences.treeWidth).toBe(280);
  });

  it("keeps a window's own keys to it, and tells the other windows only the shared ones", async () => {
    const { store, handlers, onPreferencesChanged } = setUp();

    const { preferences } = await handlers["app:updatePreferences"](
      { preferences: { treeWidth: 345, notificationsEnabled: false } },
      from(1),
    );

    expect(preferences.treeWidth).toBe(345);
    expect(store.getWindowPreferences("window-a").treeWidth).toBe(345);
    expect(onPreferencesChanged).toHaveBeenCalledWith(store.getPreferences(), {
      patch: { notificationsEnabled: false },
      senderId: 1,
    });

    // From Settings: the app's preferences only.
    await handlers["app:updatePreferences"]({ preferences: { theme: "light" } }, from(2));
    expect(store.getPreferences().theme).toBe("light");
    expect(onPreferencesChanged).toHaveBeenLastCalledWith(store.getPreferences(), {
      patch: { theme: "light" },
      senderId: 2,
    });
  });

  it("asks the host about the window asking", async () => {
    const { windows, handlers } = setUp();

    expect(await handlers["app:getLaunchContext"]({}, from(1))).toEqual({
      startupFolderPath: "/Users/demo",
      restoreTabs: false,
    });
    expect(
      await handlers["app:openWindow"](
        { tabs: [tab("/Users/demo/x")], activeTabIndex: 0 },
        from(1),
      ),
    ).toEqual({ ok: true });
    expect(windows.openExplorerWindow).toHaveBeenCalledWith(1, [tab("/Users/demo/x")], 0);
    expect(await handlers["app:getExplorerWindowCount"]({}, from(1))).toEqual({ count: 2 });
    expect(await handlers["app:mergeAllWindows"]({}, from(1))).toEqual({
      tabs: [tab("/Users/demo/merged")],
    });
    expect(windows.mergeExplorerWindows).toHaveBeenCalledWith(1);
  });

  it("keeps one clipboard for every window, and tells the others of a change", async () => {
    const { windows, handlers } = setUp();
    expect(await handlers["app:getClipboard"]({}, from(1))).toEqual({
      clipboard: { type: "empty" },
    });
    const clipboard = {
      type: "ready" as const,
      mode: "copy" as const,
      sourcePaths: ["/Users/demo/a.txt"],
      sourceEntries: { "/Users/demo/a.txt": { kind: "file" as const, isSymlink: false } },
      capturedAt: "2026-10-08T10:00:00.000Z",
    };

    await handlers["app:setClipboard"]({ clipboard }, from(1));

    expect(await handlers["app:getClipboard"]({}, from(2))).toEqual({ clipboard });
    expect(windows.sendToOtherWindows).toHaveBeenCalledWith(
      1,
      "filetrail:clipboardChanged",
      clipboard,
    );
  });
});
