import { describe, expect, it } from "vitest";

import type { OpenWithApplication } from "../../shared/appPreferences";
import type { ContextMenuSubmenuItem } from "./contextMenu";
import { type OpenWithLookup, buildOpenWithMenuItems, canAlwaysOpenWith } from "./openWith";

function app(name: string, version: string | null = "1.0", path = `/Applications/${name}.app`) {
  return { path, name, bundleId: null, version };
}

function pin(name: string, path = `/Applications/${name}.app`): OpenWithApplication {
  return { id: name.toLowerCase(), appPath: path, appName: name };
}

function lookup(overrides: Partial<OpenWithLookup> = {}): OpenWithLookup {
  return {
    defaultApp: null,
    apps: [],
    kinds: [{ contentType: "net.daringfireball.markdown", name: "Markdown", isFolder: false }],
    pinnedApps: [],
    ...overrides,
  };
}

// The menu as its rows read: labels, and "---" for a separator.
function rows(items: readonly ContextMenuSubmenuItem[]): string[] {
  return items.map((item) => (item.type === "separator" ? "---" : item.action.label));
}

describe("buildOpenWithMenuItems", () => {
  it("lists the default app, the pinned apps, then the others A to Z, then Other…", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({
        defaultApp: app("Typora"),
        apps: [
          app("Xcode"),
          app("Typora"),
          app("Zed"),
          app("obsidian"),
          app("Visual Studio Code"),
          app("TextEdit"),
        ],
        pinnedApps: [app("Zed"), app("Visual Studio Code")],
      }),
      pinned: [pin("Zed"), pin("Visual Studio Code")],
    });

    expect(rows(items)).toEqual([
      "Typora (default)",
      "---",
      "Zed",
      "Visual Studio Code",
      "---",
      "obsidian",
      "TextEdit",
      "Xcode",
      "---",
      "Other…",
    ]);
  });

  it("lists an app once, in its first place", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({
        defaultApp: app("Zed"),
        // macOS's list repeats the default and a pinned app; a trailing slash is the same app.
        apps: [
          app("Zed"),
          app("Visual Studio Code", "1.0", "/Applications/Visual Studio Code.app/"),
        ],
        pinnedApps: [app("Zed"), app("Visual Studio Code")],
      }),
      pinned: [pin("Zed"), pin("Visual Studio Code")],
    });

    expect(rows(items)).toEqual(["Zed (default)", "---", "Visual Studio Code", "---", "Other…"]);
  });

  it("leaves out pinned apps that aren't there any more", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({ apps: [app("Zed")], pinnedApps: [null, app("Zed")] }),
      pinned: [pin("Gone"), pin("Zed")],
    });

    expect(rows(items)).toEqual(["Zed", "---", "Other…"]);
  });

  it("lists the pinned apps as saved until macOS answers", () => {
    const items = buildOpenWithMenuItems({ lookup: null, pinned: [pin("Zed")] });

    expect(rows(items)).toEqual(["Zed", "---", "Other…"]);
  });

  // An answer asked for an older pinned list can't say which of today's pins are there.
  it("ignores pinned answers asked with a different list", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({ apps: [app("Zed"), app("Nova")], pinnedApps: [null] }),
      pinned: [pin("Zed"), pin("Nova")],
    });

    expect(rows(items)).toEqual(["Zed", "Nova", "---", "Other…"]);
  });

  it("leaves out pinned apps that can't open the items", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({
        defaultApp: app("DiskImageMounter"),
        apps: [app("DiskImageMounter"), app("Zed")],
        pinnedApps: [app("Visual Studio Code"), app("Zed")],
      }),
      pinned: [pin("Visual Studio Code"), pin("Zed")],
    });

    expect(rows(items)).toEqual(["DiskImageMounter (default)", "---", "Zed", "---", "Other…"]);
  });

  it("lists a pinned app where it is when macOS offers another copy of it", () => {
    const zed = { ...app("Zed"), bundleId: "dev.zed.Zed" };
    const pinnedZed = { ...zed, path: "/Users/demo/Applications/Zed.app" };
    const items = buildOpenWithMenuItems({
      lookup: lookup({ apps: [zed], pinnedApps: [pinnedZed] }),
      pinned: [pin("Zed", pinnedZed.path)],
    });

    expect(rows(items)).toEqual(["Zed", "---", "Other…"]);
    expect(items[0]).toMatchObject({ action: { appPath: "/Users/demo/Applications/Zed.app" } });
  });

  // An answer with no kinds is one macOS couldn't give.
  it("lists every pinned app when macOS couldn't say what opens the items", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({ kinds: [], pinnedApps: [app("Zed")] }),
      pinned: [pin("Zed")],
    });

    expect(rows(items)).toEqual(["Zed", "---", "Other…"]);
  });

  it("lists two copies of one version of an app once, the one macOS puts first", () => {
    const fileTrail = (path: string, version: string) => ({
      path,
      name: "File Trail",
      bundleId: "com.filetrail.app",
      version,
    });
    const items = buildOpenWithMenuItems({
      lookup: lookup({
        apps: [
          fileTrail("/Applications/File Trail.app", "0.6.1"),
          fileTrail("/Users/demo/src/filetrail/out/File Trail.app", "0.6.1"),
          fileTrail("/Users/demo/Downloads/File Trail.app", "0.5.0"),
        ],
      }),
      pinned: [],
    });

    expect(rows(items)).toEqual(["File Trail (0.6.1)", "File Trail (0.5.0)", "---", "Other…"]);
    expect(items[0]).toMatchObject({ action: { appPath: "/Applications/File Trail.app" } });
  });

  it("offers only Other… when there is nothing else", () => {
    expect(rows(buildOpenWithMenuItems({ lookup: lookup(), pinned: [] }))).toEqual(["Other…"]);
  });

  it("adds the version to apps that share a name", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({
        defaultApp: app("Xcode", "26.0"),
        apps: [
          app("Xcode", "26.0"),
          app("Xcode", "27.0 beta", "/Applications/Xcode-beta.app"),
          app("Preview"),
        ],
      }),
      pinned: [],
    });

    expect(rows(items)).toEqual([
      "Xcode (26.0) (default)",
      "---",
      "Preview",
      "Xcode (27.0 beta)",
      "---",
      "Other…",
    ]);
  });

  it("opens each app by its path and name, and marks every choice when it is for Always", () => {
    const items = buildOpenWithMenuItems({
      lookup: lookup({ defaultApp: app("Zed") }),
      pinned: [],
      always: true,
    });

    expect(items.flatMap((item) => (item.type === "separator" ? [] : [item.action]))).toEqual([
      {
        kind: "application",
        id: "app:/Applications/Zed.app",
        label: "Zed (default)",
        appPath: "/Applications/Zed.app",
        appName: "Zed",
        always: true,
      },
      { kind: "other", id: "other", label: "Other…", appName: "Other…", always: true },
    ]);
  });
});

describe("canAlwaysOpenWith", () => {
  it("is for items of one kind of file", () => {
    expect(canAlwaysOpenWith(lookup())).toBe(true);
  });

  it("is not for folders, packages or apps", () => {
    expect(
      canAlwaysOpenWith(
        lookup({ kinds: [{ contentType: "public.folder", name: "Folder", isFolder: true }] }),
      ),
    ).toBe(false);
  });

  it("is not for items of several kinds, or before macOS answers", () => {
    expect(
      canAlwaysOpenWith(
        lookup({
          kinds: [
            { contentType: "net.daringfireball.markdown", name: "Markdown", isFolder: false },
            { contentType: "public.plain-text", name: "Plain Text", isFolder: false },
          ],
        }),
      ),
    ).toBe(false);
    expect(canAlwaysOpenWith(null)).toBe(false);
  });
});
