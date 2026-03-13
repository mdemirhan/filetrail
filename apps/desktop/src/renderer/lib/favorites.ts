import type { FavoriteIconId, FavoritePreference } from "../../shared/appPreferences";
import type { TreeNodeState } from "../components/TreePane";

const FAVORITES_ROOT_ID = "favorites-root";
const FAVORITE_ID_PREFIX = "favorite:";
const FILE_SYSTEM_ID_PREFIX = "fs:";

export type TreeItemId = typeof FAVORITES_ROOT_ID | `favorite:${string}` | `fs:${string}`;

export type TreePresentationItem = {
  id: TreeItemId;
  kind: "favorites-root" | "favorite" | "filesystem";
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
};

export function getTrashPath(homePath: string): string {
  return homePath.length > 0 ? `${homePath}/.Trash` : "";
}

export function getDefaultFavorites(homePath: string): FavoritePreference[] {
  if (homePath.length === 0) {
    return [{ path: "/Applications", icon: "applications" }];
  }
  return [
    { path: homePath, icon: "home" },
    { path: "/Applications", icon: "applications" },
    { path: `${homePath}/Desktop`, icon: "desktop" },
    { path: `${homePath}/Documents`, icon: "documents" },
    { path: `${homePath}/Downloads`, icon: "downloads" },
    { path: getTrashPath(homePath), icon: "trash" },
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

export function isPathInsideTrash(path: string, homePath: string): boolean {
  const trashPath = getTrashPath(homePath);
  return trashPath.length > 0 && (path === trashPath || path.startsWith(`${trashPath}/`));
}

export function buildTreePresentation(args: {
  favorites: FavoritePreference[];
  favoritesExpanded: boolean;
  homePath: string;
  rootPath: string;
  nodes: Record<string, TreeNodeState>;
  includeFavorites?: boolean;
}): {
  items: Record<TreeItemId, TreePresentationItem>;
  visibleItemIds: TreeItemId[];
} {
  const { favorites, favoritesExpanded, homePath, rootPath, nodes, includeFavorites = true } = args;
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
        };
        visibleItemIds.push(itemId);
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
