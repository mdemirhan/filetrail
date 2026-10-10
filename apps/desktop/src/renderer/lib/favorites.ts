import { isInsideTrash } from "@filetrail/contracts";

import type { FavoriteIconId, FavoritePreference } from "../../shared/appPreferences";
import type { TreeNodeState } from "../components/TreePane";

const FAVORITES_ROOT_ID = "favorites-root";
const FAVORITE_ID_PREFIX = "favorite:";
const LOCATIONS_ROOT_ID = "locations-root";
const LOCATION_ID_PREFIX = "location:";
const FILE_SYSTEM_ID_PREFIX = "fs:";

export type TreeItemId =
  | typeof FAVORITES_ROOT_ID
  | `favorite:${string}`
  | typeof LOCATIONS_ROOT_ID
  | `location:${string}`
  | `fs:${string}`;

// A place in the sidebar's Locations, as in Finder's: the home folder (under the account's
// name), Macintosh HD, the other disks mounted, and the Trash. Like a favorite, it is a
// place to go to, not a folder to expand; its icon is drawn as an outline in gray. A disk
// Finder would eject has an Eject button after its name.
export type SidebarLocation = {
  path: string;
  label: string;
  icon: FavoriteIconId;
  canEject?: boolean;
};

export function buildSidebarLocations(
  volumes: ReadonlyArray<{ path: string; name: string; isLocal: boolean; canEject: boolean }>,
  homePath: string,
): SidebarLocation[] {
  const home: SidebarLocation[] =
    homePath.length > 0
      ? [
          {
            path: homePath,
            label: homePath.split("/").filter(Boolean).at(-1) ?? homePath,
            icon: "home",
          },
        ]
      : [];
  const trash: SidebarLocation[] =
    homePath.length > 0 ? [{ path: getTrashPath(homePath), label: "Trash", icon: "trash" }] : [];
  // The places always there come first and keep their rows; disks come and go after them.
  return [
    ...home,
    { path: "/", label: "Macintosh HD", icon: "drive" },
    ...trash,
    ...volumes.map((volume) => ({
      path: volume.path,
      label: volume.name,
      // A network share is drawn as one; a drive or a disk image as a drive.
      icon: volume.isLocal ? ("drive" as const) : ("server" as const),
      canEject: volume.canEject,
    })),
  ];
}

// The favorites with one of them, dragged in the sidebar, put just before or after another.
export function reorderFavorites(
  favorites: FavoritePreference[],
  movedPath: string,
  targetPath: string,
  position: "before" | "after",
): FavoritePreference[] {
  const moved = favorites.find((favorite) => favorite.path === movedPath);
  if (!moved || movedPath === targetPath) {
    return favorites;
  }
  const rest = favorites.filter((favorite) => favorite.path !== movedPath);
  const targetIndex = rest.findIndex((favorite) => favorite.path === targetPath);
  if (targetIndex < 0) {
    return favorites;
  }
  const next = [...rest];
  next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, moved);
  return next.every((favorite, index) => favorite === favorites[index]) ? favorites : next;
}

export type TreePresentationItem = {
  id: TreeItemId;
  kind: "favorites-root" | "favorite" | "locations-root" | "location" | "filesystem";
  label: string;
  depth: number;
  path: string | null;
  parentId: TreeItemId | null;
  expanded: boolean;
  canExpand: boolean;
  loading: boolean;
  error: string | null;
  isSymlink: boolean;
  childIds: TreeItemId[];
  icon: FavoriteIconId | null;
  /** A disk's row in Locations that has an Eject button. */
  canEject: boolean;
};

export function getTrashPath(homePath: string): string {
  return homePath.length > 0 ? `${homePath}/.Trash` : "";
}

// macOS refuses to list the Trash ("EPERM: operation not permitted, scandir …") to an app
// without Full Disk Access, even though everything inside it can still be read.
export function isTrashListingRefused(
  path: string,
  error: string | null,
  homePath: string,
): boolean {
  if (error === null || path !== getTrashPath(homePath) || path.length === 0) {
    return false;
  }
  return error.includes("EPERM") || error.toLowerCase().includes("operation not permitted");
}

// Finder's sidebar places, all ordinary favorites the user can remove or reorder. Home,
// Macintosh HD and the Trash are under Locations, as in Finder.
export function getDefaultFavorites(homePath: string): FavoritePreference[] {
  if (homePath.length === 0) {
    return [{ path: "/Applications", icon: "applications" }];
  }
  return [
    { path: "/Applications", icon: "applications" },
    { path: `${homePath}/Desktop`, icon: "desktop" },
    { path: `${homePath}/Documents`, icon: "documents" },
    { path: `${homePath}/Downloads`, icon: "downloads" },
  ];
}

export function inferFavoriteIcon(path: string, homePath: string): FavoriteIconId {
  if (path === homePath) {
    return "home";
  }
  if (path === "/Applications") {
    return "applications";
  }
  if (path === getTrashPath(homePath)) {
    return "trash";
  }
  if (path === "/") {
    return "drive";
  }
  const normalizedPath = path.replace(/\/+$/u, "");
  const leaf = normalizedPath.split("/").filter(Boolean).at(-1) ?? normalizedPath;
  if (leaf === "Desktop") {
    return "desktop";
  }
  if (leaf === "Documents") {
    return "documents";
  }
  if (leaf === "Downloads") {
    return "downloads";
  }
  if (leaf === "Music") {
    return "music";
  }
  if (leaf === "Pictures" || leaf === "Photos") {
    return "photos";
  }
  if (leaf === "Movies" || leaf === "Videos") {
    return "videos";
  }
  if (leaf === "Projects") {
    return "projects";
  }
  if (leaf === "Applications") {
    return "applications";
  }
  return "folder";
}

export function createFavorite(path: string, homePath: string): FavoritePreference {
  return {
    path,
    icon: inferFavoriteIcon(path, homePath),
  };
}

export function createFavoriteItemId(path: string): TreeItemId {
  return `${FAVORITE_ID_PREFIX}${path}`;
}

export function createFileSystemItemId(path: string): TreeItemId {
  return `${FILE_SYSTEM_ID_PREFIX}${path}`;
}

export function createLocationItemId(path: string): TreeItemId {
  return `${LOCATION_ID_PREFIX}${path}`;
}

export function isLocationItemId(id: TreeItemId | string | null): id is `location:${string}` {
  return typeof id === "string" && id.startsWith(LOCATION_ID_PREFIX);
}

export function getLocationItemPath(id: TreeItemId | string | null): string | null {
  return isLocationItemId(id) ? id.slice(LOCATION_ID_PREFIX.length) : null;
}

export function getLocationsRootItemId(): TreeItemId {
  return LOCATIONS_ROOT_ID;
}

export function isLocationsRootItemId(id: TreeItemId | string | null): boolean {
  return id === LOCATIONS_ROOT_ID;
}

// A favorite or a location: a sidebar row that goes to its folder.
export function getShortcutItemPath(id: TreeItemId | string | null): string | null {
  return getFavoriteItemPath(id) ?? getLocationItemPath(id);
}

export function isFavoriteItemId(id: TreeItemId | string | null): id is `favorite:${string}` {
  return typeof id === "string" && id.startsWith(FAVORITE_ID_PREFIX);
}

export function isFileSystemItemId(id: TreeItemId | string | null): id is `fs:${string}` {
  return typeof id === "string" && id.startsWith(FILE_SYSTEM_ID_PREFIX);
}

export function getFavoriteItemPath(id: TreeItemId | string | null): string | null {
  return isFavoriteItemId(id) ? id.slice(FAVORITE_ID_PREFIX.length) : null;
}

export function getFileSystemItemPath(id: TreeItemId | string | null): string | null {
  return isFileSystemItemId(id) ? id.slice(FILE_SYSTEM_ID_PREFIX.length) : null;
}

export function getFavoritesRootItemId(): TreeItemId {
  return FAVORITES_ROOT_ID;
}

export function isFavoritesRootItemId(id: TreeItemId | string | null): boolean {
  return id === FAVORITES_ROOT_ID;
}

export function getFavoriteLabel(path: string, homePath: string): string {
  if (path === homePath) {
    return "Home";
  }
  if (path === "/Applications") {
    return "Applications";
  }
  if (path === getTrashPath(homePath)) {
    return "Trash";
  }
  if (path === "/") {
    return "Macintosh HD";
  }
  const trimmedPath = path.replace(/\/+$/u, "");
  return trimmedPath.split("/").filter(Boolean).at(-1) ?? path;
}

export function isFavoritePath(favorites: FavoritePreference[], path: string): boolean {
  return favorites.some((favorite) => favorite.path === path);
}

// The home folder's Trash, another disk's, or anything in one (see isInsideTrash).
export function isPathInsideTrash(path: string, homePath: string): boolean {
  return isInsideTrash(path, homePath);
}

// Rows for the Locations: under the Locations row in the tree, or in their own section.
export function buildLocationItems(
  locations: SidebarLocation[],
  parentId: TreeItemId | null,
  depth: number,
): TreePresentationItem[] {
  return locations.map((location) => ({
    id: createLocationItemId(location.path),
    kind: "location",
    label: location.label,
    depth,
    path: location.path,
    parentId,
    expanded: false,
    canExpand: false,
    loading: false,
    error: null,
    isSymlink: false,
    childIds: [],
    icon: location.icon,
    canEject: location.canEject === true,
  }));
}

export function buildTreePresentation(args: {
  favorites: FavoritePreference[];
  favoritesExpanded: boolean;
  homePath: string;
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
  includeFavorites?: boolean;
  /** Shown as a Locations row after Favorites when `includeFavorites` is set. */
  locations?: SidebarLocation[];
  locationsExpanded?: boolean;
}): {
  items: Record<TreeItemId, TreePresentationItem>;
  visibleItemIds: TreeItemId[];
} {
  const {
    favorites,
    favoritesExpanded,
    homePath,
    rootPath,
    nodes,
    includeFavorites = true,
    locations = [],
    locationsExpanded = true,
  } = args;
  const items = {} as Record<TreeItemId, TreePresentationItem>;
  const visibleItemIds: TreeItemId[] = [];

  if (includeFavorites) {
    const favoriteChildIds = favorites.map((favorite) => createFavoriteItemId(favorite.path));
    const favoritesRootId = getFavoritesRootItemId();
    items[favoritesRootId] = {
      id: favoritesRootId,
      kind: "favorites-root",
      label: "Favorites",
      depth: 0,
      path: null,
      parentId: null,
      expanded: favoritesExpanded,
      canExpand: favoriteChildIds.length > 0,
      loading: false,
      error: null,
      isSymlink: false,
      childIds: favoriteChildIds,
      icon: "star",
      canEject: false,
    };
    visibleItemIds.push(favoritesRootId);

    if (favoritesExpanded) {
      for (const favorite of favorites) {
        const itemId = createFavoriteItemId(favorite.path);
        items[itemId] = {
          id: itemId,
          kind: "favorite",
          label: getFavoriteLabel(favorite.path, homePath),
          depth: 1,
          path: favorite.path,
          parentId: favoritesRootId,
          expanded: false,
          canExpand: false,
          loading: false,
          error: null,
          isSymlink: false,
          childIds: [],
          icon: favorite.icon,
          canEject: false,
        };
        visibleItemIds.push(itemId);
      }
    }
  }

  if (includeFavorites && locations.length > 0) {
    const locationsRootId = getLocationsRootItemId();
    items[locationsRootId] = {
      id: locationsRootId,
      kind: "locations-root",
      label: "Locations",
      depth: 0,
      path: null,
      parentId: null,
      expanded: locationsExpanded,
      canExpand: true,
      loading: false,
      error: null,
      isSymlink: false,
      childIds: locations.map((location) => createLocationItemId(location.path)),
      icon: "drive",
      canEject: false,
    };
    visibleItemIds.push(locationsRootId);
    if (locationsExpanded) {
      for (const item of buildLocationItems(locations, locationsRootId, 1)) {
        items[item.id] = item;
        visibleItemIds.push(item.id);
      }
    }
  }

  const addFileSystemNode = (path: string, depth: number, parentId: TreeItemId | null) => {
    const node = nodes[path];
    if (!node) {
      return;
    }
    const itemId = createFileSystemItemId(path);
    items[itemId] = {
      id: itemId,
      kind: "filesystem",
      label: node.name,
      depth,
      path,
      parentId,
      expanded: node.expanded,
      canExpand: !node.isSymlink,
      loading: node.loading,
      error: node.error,
      isSymlink: node.isSymlink,
      childIds: node.childPaths.map((childPath) => createFileSystemItemId(childPath)),
      icon: null,
      canEject: false,
    };
    visibleItemIds.push(itemId);
    if (!node.expanded) {
      return;
    }
    for (const childPath of node.childPaths) {
      addFileSystemNode(childPath, depth + 1, itemId);
    }
  };

  if (rootPath.length > 0) {
    addFileSystemNode(rootPath, 0, null);
  }

  return {
    items,
    visibleItemIds,
  };
}
