import type { IpcResponse } from "@filetrail/contracts";

import type { OpenWithApplication } from "../../shared/appPreferences";
import type { ContextMenuSubmenuItem } from "./contextMenu";

// What macOS says about the items Open With is for (system:getOpenWithApplications).
export type OpenWithLookup = IpcResponse<"system:getOpenWithApplications">;
type ApplicationInfo = OpenWithLookup["apps"][number];

// The same app however its path was written.
function appKey(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

// Always Open With changes what every file of one kind opens in: it is offered only when
// the items are all of one kind, and never for folders, packages or apps.
export function canAlwaysOpenWith(lookup: OpenWithLookup | null): boolean {
  const kinds = lookup?.kinds ?? [];
  return kinds.length === 1 && kinds[0]?.isFolder === false;
}

// An app as Open With tells apps apart: two copies of one version (an app in /Applications
// and the same build elsewhere) are one app; another version of it is another.
function appIdentity(app: ApplicationInfo): string {
  return app.bundleId ? `id:${app.bundleId}\n${app.version ?? ""}` : `path:${appKey(app.path)}`;
}

// The apps Open With lists, in order, as Finder's menu does: the default app, then the pinned
// apps (Settings → Files) that can open the items, then every other app macOS offers, A to Z.
// An app is listed once, in its first place, and of two copies of one version the one macOS
// puts first. Pinned apps that are gone are left out. Until macOS has answered (`lookup`
// null) only the pinned apps are known, and they are all listed.
export function getOpenWithSections(
  lookup: OpenWithLookup | null,
  pinned: readonly OpenWithApplication[],
): { defaultApp: ApplicationInfo | null; pinned: ApplicationInfo[]; others: ApplicationInfo[] } {
  const listed = new Set<string>();
  const take = (app: ApplicationInfo | null): app is ApplicationInfo => {
    if (!app) {
      return false;
    }
    const keys = [`path:${appKey(app.path)}`, appIdentity(app)];
    if (keys.some((key) => listed.has(key))) {
      return false;
    }
    for (const key of keys) {
      listed.add(key);
    }
    return true;
  };
  const defaultApp = lookup?.defaultApp ?? null;
  take(defaultApp);
  // The answer is for the pinned list it was asked with; one asked before the list changed
  // says nothing about it.
  const pinnedInfo =
    lookup && lookup.pinnedApps.length === pinned.length
      ? lookup.pinnedApps
      : pinned.map((entry) => ({
          path: entry.appPath,
          name: entry.appName,
          bundleId: null,
          version: null,
        }));
  // A pinned app is listed only for items macOS says it can open: by its path, or by its
  // bundle id when macOS offers another copy of it. An answer with no kinds is one macOS
  // couldn't give, which says nothing either way.
  const offered = lookup?.apps ?? [];
  const canOpen = (app: ApplicationInfo) =>
    !lookup ||
    lookup.kinds.length === 0 ||
    offered.some(
      (candidate) =>
        appKey(candidate.path) === appKey(app.path) ||
        (app.bundleId !== null && candidate.bundleId === app.bundleId),
    );
  const pinnedApps = pinnedInfo.filter(
    (app): app is ApplicationInfo => app !== null && canOpen(app) && take(app),
  );
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const others = offered
    .filter(take)
    .sort((left, right) => collator.compare(left.name, right.name));
  return { defaultApp, pinned: pinnedApps, others };
}

// The Open With submenu. With `always` (Option held, items of one kind) choosing an app makes
// it the one the kind opens in, as Finder's Always Open With does.
export function buildOpenWithMenuItems(args: {
  lookup: OpenWithLookup | null;
  pinned: readonly OpenWithApplication[];
  always?: boolean;
}): ContextMenuSubmenuItem[] {
  const { lookup, pinned, always = false } = args;
  const sections = getOpenWithSections(lookup, pinned);
  const labels = getApplicationLabels([
    ...(sections.defaultApp ? [sections.defaultApp] : []),
    ...sections.pinned,
    ...sections.others,
  ]);
  const items: ContextMenuSubmenuItem[] = [];
  const addSection = (key: string, apps: ApplicationInfo[], isDefault: boolean) => {
    if (apps.length === 0) {
      return;
    }
    if (items.length > 0) {
      items.push({ type: "separator", key: `separator-${key}` });
    }
    for (const app of apps) {
      const label = labels.get(appKey(app.path)) ?? app.name;
      items.push({
        action: {
          kind: "application",
          id: `app:${appKey(app.path)}`,
          label: isDefault ? `${label} (default)` : label,
          appPath: app.path,
          appName: app.name,
          ...(always ? { always: true } : {}),
        },
      });
    }
  };
  addSection("default", sections.defaultApp ? [sections.defaultApp] : [], true);
  addSection("pinned", sections.pinned, false);
  addSection("others", sections.others, false);
  if (items.length > 0) {
    items.push({ type: "separator", key: "separator-other" });
  }
  items.push({
    action: {
      kind: "other",
      id: "other",
      label: "Other…",
      appName: "Other…",
      ...(always ? { always: true } : {}),
    },
  });
  return items;
}

// Each app's name, with its version after it when another app listed has the same name
// (Xcode and a beta of Xcode), as Finder shows them.
function getApplicationLabels(apps: readonly ApplicationInfo[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const app of apps) {
    const name = app.name.toLocaleLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const app of apps) {
    const shared = (counts.get(app.name.toLocaleLowerCase()) ?? 0) > 1;
    labels.set(appKey(app.path), shared && app.version ? `${app.name} (${app.version})` : app.name);
  }
  return labels;
}
