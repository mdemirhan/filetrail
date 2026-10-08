import { ipcContractSchemas } from "@filetrail/contracts";
import { type AppPreferences, DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { toPreferencePatch } from "./preferencesPatch";

// What main does with a window's `app:updatePreferences`: the payload is checked against
// the contract (as ipc.ts does for every channel), and what passes becomes the patch the
// store applies. A payload that fails changes nothing.
function receive(preferences: unknown): Partial<AppPreferences> | null {
  const request = ipcContractSchemas["app:updatePreferences"].request.safeParse({ preferences });
  return request.success ? toPreferencePatch(request.data.preferences) : null;
}

const preferenceKeys = Object.keys(DEFAULT_APP_PREFERENCES) as (keyof AppPreferences)[];

const tab = {
  path: "/Users/demo",
  treeRootPath: "/",
  favoritePath: null,
  viewMode: "list",
  searchViewMode: "details",
  sortBy: "name",
  sortDirection: "asc",
  includeHidden: false,
  foldersFirst: true,
  favoritesExpanded: true,
  locationsExpanded: true,
} as const;

describe("a preference change sent by a window", () => {
  it("carries every preference a window may change", () => {
    expect(receive(DEFAULT_APP_PREFERENCES)).toEqual(DEFAULT_APP_PREFERENCES);
    // Every preference the contract knows has a way into the store.
    const contractKeys = Object.keys(
      ipcContractSchemas["app:getPreferences"].response.shape.preferences.shape,
    ).sort();
    expect([...preferenceKeys].sort()).toEqual(contractKeys);
  });

  it.each(preferenceKeys)("carries %s by itself, and nothing else", (key) => {
    expect(receive({ [key]: DEFAULT_APP_PREFERENCES[key] })).toEqual({
      [key]: DEFAULT_APP_PREFERENCES[key],
    });
  });

  it("changes nothing when nothing is sent", () => {
    expect(receive({})).toEqual({});
    expect(receive({ theme: undefined, zoomPercent: undefined })).toEqual({});
  });

  it("keeps false, zero, empty and cleared values, which are changes too", () => {
    expect(
      receive({
        foldersFirst: false,
        activeTabIndex: 0,
        terminalApp: null,
        treeRootPath: null,
        lastVisitedPath: null,
        favorites: [],
        openTabs: [],
        shortcutOverrides: {},
        topToolbarItems: [],
      }),
    ).toEqual({
      foldersFirst: false,
      activeTabIndex: 0,
      terminalApp: null,
      treeRootPath: null,
      lastVisitedPath: null,
      favorites: [],
      openTabs: [],
      shortcutOverrides: {},
      topToolbarItems: [],
    });
  });

  it("drops keys that are not preferences", () => {
    expect(receive({ theme: "dark", isAdmin: true, version: 2 })).toEqual({
      theme: "dark",
    });
    // Even past the contract, only known preferences are copied.
    expect(
      toPreferencePatch({ theme: "light", extra: "x" } as unknown as Partial<AppPreferences>),
    ).toEqual({ theme: "light" });
  });

  it("takes the limits of each number range", () => {
    expect(
      receive({
        zoomPercent: 75,
        treeWidth: 220,
        inspectorWidth: 260,
        openItemLimit: 1,
        activeTabIndex: 0,
      }),
    ).toEqual({
      zoomPercent: 75,
      treeWidth: 220,
      inspectorWidth: 260,
      openItemLimit: 1,
      activeTabIndex: 0,
    });
    expect(
      receive({ zoomPercent: 150, treeWidth: 520, inspectorWidth: 480, openItemLimit: 50 }),
    ).toEqual({ zoomPercent: 150, treeWidth: 520, inspectorWidth: 480, openItemLimit: 50 });
  });

  it.each<[string, unknown]>([
    ["zoomPercent", 74],
    ["zoomPercent", 151],
    ["zoomPercent", 100.5],
    ["zoomPercent", "100"],
    ["zoomPercent", Number.NaN],
    ["treeWidth", 219],
    ["treeWidth", 521],
    ["inspectorWidth", 259],
    ["inspectorWidth", 481],
    ["openItemLimit", 0],
    ["openItemLimit", 51],
    ["activeTabIndex", -1],
    ["activeTabIndex", 1.5],
  ])("refuses %s of %s", (key, value) => {
    expect(receive({ [key]: value })).toBeNull();
  });

  it.each<[string, unknown]>([
    ["theme", "purple"],
    ["theme", null],
    ["accent", "red"],
    ["accent", "#12345"],
    ["accent", "#1234567"],
    ["viewMode", "columns"],
    ["searchViewMode", "gallery"],
    ["sortBy", "date"],
    ["sortDirection", "up"],
    ["searchPatternMode", "fuzzy"],
    ["searchMatchScope", "content"],
    ["searchResultsSortBy", "size"],
    ["searchResultsSortDirection", "down"],
    ["fileActivationAction", "run"],
    ["returnKeyAction", "delete"],
    ["favoritesPlacement", "hidden"],
    ["topToolbarItems", ["back", "launchMissiles"]],
    ["topToolbarItems", "back"],
  ])("refuses %s set to %j, which is not one of its choices", (key, value) => {
    expect(receive({ [key]: value })).toBeNull();
  });

  it.each([
    "foldersFirst",
    "compactListView",
    "compactDetailsView",
    "compactIconView",
    "compactTreeView",
    "singleClickExpandTreeItems",
    "notificationsEnabled",
    "markClipboardItems",
    "autoCalculateFolderSizes",
    "folderTreeOpen",
    "propertiesOpen",
    "detailRowOpen",
    "includeHidden",
    "searchRecursive",
    "searchSkipGitFolders",
    "searchSkipGitIgnored",
    "restoreSessionOnStartup",
    "favoritesExpanded",
    "locationsExpanded",
    "favoritesInitialized",
  ])("refuses %s as anything but true or false", (key) => {
    expect(receive({ [key]: "true" })).toBeNull();
    expect(receive({ [key]: 1 })).toBeNull();
    expect(receive({ [key]: null })).toBeNull();
  });

  it("refuses an empty folder path, and clears one only with null", () => {
    for (const key of ["treeRootPath", "lastVisitedPath", "lastVisitedFavoritePath"]) {
      expect(receive({ [key]: "" })).toBeNull();
      expect(receive({ [key]: 42 })).toBeNull();
      expect(receive({ [key]: "/Users/demo" })).toEqual({ [key]: "/Users/demo" });
    }
  });

  it("refuses column settings that are partial, out of range or repeated", () => {
    const { detailColumns, detailColumnWidths, searchColumns, searchColumnWidths } =
      DEFAULT_APP_PREFERENCES;
    expect(receive({ detailColumns: { size: true } })).toBeNull();
    expect(receive({ detailColumns: { ...detailColumns, size: "yes" } })).toBeNull();
    expect(receive({ detailColumnWidths: { ...detailColumnWidths, name: 139 } })).toBeNull();
    expect(receive({ detailColumnWidths: { ...detailColumnWidths, size: 241 } })).toBeNull();
    const { permissions: _, ...widthsWithoutPermissions } = detailColumnWidths;
    expect(receive({ detailColumnWidths: widthsWithoutPermissions })).toBeNull();
    expect(receive({ searchColumns: { ...searchColumns, folder: undefined } })).toBeNull();
    expect(receive({ searchColumnWidths: { ...searchColumnWidths, folder: 79 } })).toBeNull();
    expect(
      receive({
        searchColumnOrder: ["folder", "folder", "modified", "size", "kind", "created"],
      }),
    ).toBeNull();
    expect(receive({ searchColumnOrder: ["folder", "modified", "size", "kind"] })).toBeNull();
  });

  it("refuses an application without a path or a name, and trims the ones it takes", () => {
    expect(receive({ terminalApp: { appPath: "/Applications/iTerm.app" } })).toBeNull();
    expect(receive({ terminalApp: { appPath: "  ", appName: "iTerm" } })).toBeNull();
    expect(receive({ defaultTextEditor: null })).toBeNull();
    expect(
      receive({
        openWithApplications: [{ id: "", appPath: "/Applications/Zed.app", appName: "Zed" }],
      }),
    ).toBeNull();
    expect(receive({ openWithApplications: { id: "zed" } })).toBeNull();
    expect(
      receive({ defaultTextEditor: { appPath: " /Applications/Zed.app ", appName: " Zed " } }),
    ).toEqual({ defaultTextEditor: { appPath: "/Applications/Zed.app", appName: "Zed" } });
  });

  it("refuses shortcuts with more than two keys, or names out of bounds", () => {
    expect(receive({ shortcutOverrides: { newTab: ["Cmd+T", "Cmd+Shift+T"] } })).toEqual({
      shortcutOverrides: { newTab: ["Cmd+T", "Cmd+Shift+T"] },
    });
    expect(receive({ shortcutOverrides: { newTab: ["Cmd+T", "Cmd+Y", "Cmd+U"] } })).toBeNull();
    expect(receive({ shortcutOverrides: { newTab: [""] } })).toBeNull();
    expect(receive({ shortcutOverrides: { newTab: ["x".repeat(65)] } })).toBeNull();
    expect(receive({ shortcutOverrides: { ["x".repeat(65)]: ["Cmd+T"] } })).toBeNull();
    expect(receive({ shortcutOverrides: { newTab: "Cmd+T" } })).toBeNull();
  });

  it("refuses tabs and favorites that are malformed or too many", () => {
    expect(receive({ openTabs: [tab] })).toEqual({ openTabs: [tab] });
    expect(receive({ openTabs: Array.from({ length: 100 }, () => tab) })).not.toBeNull();
    expect(receive({ openTabs: Array.from({ length: 101 }, () => tab) })).toBeNull();
    expect(receive({ openTabs: [{ ...tab, viewMode: "columns" }] })).toBeNull();
    expect(receive({ openTabs: [{ ...tab, path: "" }] })).toBeNull();
    const { locationsExpanded: _, ...tabWithoutLocations } = tab;
    expect(receive({ openTabs: [tabWithoutLocations] })).toBeNull();
    expect(receive({ favorites: [{ path: "/Users/demo", icon: "home" }] })).toEqual({
      favorites: [{ path: "/Users/demo", icon: "home" }],
    });
    expect(receive({ favorites: [{ path: " ", icon: "home" }] })).toBeNull();
    expect(receive({ favorites: [{ path: "/Users/demo", icon: "rocket" }] })).toBeNull();
  });

  it("refuses Rename settings and saved presets that are out of bounds", () => {
    const settings = DEFAULT_APP_PREFERENCES.batchRenameSettings;
    expect(receive({ batchRenameSettings: { ...settings, startAt: -1 } })).toBeNull();
    expect(receive({ batchRenameSettings: { ...settings, step: 0 } })).toBeNull();
    expect(receive({ batchRenameSettings: { ...settings, digits: 6 } })).toBeNull();
    expect(receive({ batchRenameSettings: { ...settings, find: "x".repeat(256) } })).toBeNull();
    expect(receive({ batchRenameSettings: { ...settings, mode: "shuffle" } })).toBeNull();
    expect(receive({ batchRenamePresets: [{ name: "Photos", settings }] })).toEqual({
      batchRenamePresets: [{ name: "Photos", settings }],
    });
    expect(receive({ batchRenamePresets: [{ name: "  ", settings }] })).toBeNull();
    expect(receive({ batchRenamePresets: [{ name: "x".repeat(81), settings }] })).toBeNull();
    expect(
      receive({
        batchRenamePresets: Array.from({ length: 51 }, (_, index) => ({
          name: `Preset ${index}`,
          settings,
        })),
      }),
    ).toBeNull();
  });

  it("applies none of a change when any part of it is refused", () => {
    expect(receive({ theme: "dark", foldersFirst: false, zoomPercent: 500 })).toBeNull();
  });
});
