export type ContextMenuSurface = "content" | "search" | "treeFolder" | "favorite";
export type ContextMenuTargetKind = "contentEntry" | "treeFolder" | "favorite";
export type ContextMenuScope = "selection" | "background";
export type ContextMenuSourceSubview = "tree" | "favorites" | null;

export type ContextMenuActionId =
  | "revealInFolder"
  | "revealInTree"
  | "open"
  | "openWith"
  | "edit"
  | "showInfo"
  | "cut"
  | "copy"
  | "paste"
  | "move"
  | "rename"
  | "duplicate"
  | "newFolder"
  | "toggleFavorite"
  | "terminal"
  | "copyPath"
  | "trash";

export type ContextMenuSubmenuAction =
  | {
      kind: "application";
      id: string;
      label: string;
      appPath: string;
      appName: string;
    }
  | {
      kind: "finder";
      id: "finder";
      label: "Finder";
      appName: "Finder";
      appPath: "Finder";
    }
  | {
      kind: "other";
      id: "other";
      label: "Other…";
      appName: "Other…";
    };

export type ContextMenuSubmenuItem =
  | {
      type: "separator";
      key: string;
    }
  | {
      type?: "item";
      action: ContextMenuSubmenuAction;
    };

export type ContextMenuIconName =
  | "revealInFolder"
  | "revealInTree"
  | "open"
  | "openWith"
  | "edit"
  | "showInfo"
  | "cut"
  | "copy"
  | "paste"
  | "move"
  | "rename"
  | "duplicate"
  | "newFolder"
  | "terminal"
  | "copyPath"
  | "trash"
  | "favorite";

export type ContextMenuItem =
  | {
      type: "separator";
      key: string;
    }
  | {
      type?: "action";
      id: ContextMenuActionId;
      label: string;
      icon: ContextMenuIconName;
      destructive?: boolean;
      hasSubmenu?: boolean;
    };

export function getContextMenuItems(input: {
  surface: ContextMenuSurface;
  favoriteToggleLabel?: string | null;
}): readonly ContextMenuItem[] {
  const favoriteToggleLabel = input.favoriteToggleLabel ?? "Add to Favorites";

  if (input.surface === "search") {
    return [
      { id: "revealInFolder", label: "Reveal in Folder", icon: "revealInFolder" },
      { type: "separator", key: "separator-reveal" },
      ...getContextMenuItems({
        surface: "content",
        favoriteToggleLabel,
      }),
    ];
  }

  if (input.surface === "treeFolder") {
    return [
      { id: "open", label: "Open", icon: "open" },
      { type: "separator", key: "separator-tree-after-open" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { type: "separator", key: "separator-tree-open" },
      { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
      { type: "separator", key: "separator-tree-favorite" },
      { id: "copy", label: "Copy", icon: "copy" },
      { id: "cut", label: "Cut", icon: "cut" },
      { id: "paste", label: "Paste", icon: "paste" },
      { id: "move", label: "Move To…", icon: "move" },
      { id: "rename", label: "Rename", icon: "rename" },
      { id: "duplicate", label: "Duplicate", icon: "duplicate" },
      { type: "separator", key: "separator-tree-new-folder" },
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-tree-copy-path" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-tree-write" },
      { id: "trash", label: "Move to Trash", icon: "trash", destructive: true },
    ];
  }

  if (input.surface === "favorite") {
    return [
      { id: "revealInTree", label: "Reveal in Tree", icon: "revealInTree" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { type: "separator", key: "separator-favorite-open" },
      { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
      { type: "separator", key: "separator-favorite-toggle" },
      { id: "paste", label: "Paste", icon: "paste" },
      { type: "separator", key: "separator-favorite-between-paste-and-new-folder" },
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-favorite-copy-path" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
    ];
  }

  return [
    { id: "open", label: "Open", icon: "open" },
    { id: "openWith", label: "Open With", icon: "openWith", hasSubmenu: true },
    { id: "edit", label: "Edit", icon: "edit" },
    { type: "separator", key: "separator-open" },
    { id: "showInfo", label: "Show Info", icon: "showInfo" },
    { type: "separator", key: "separator-info" },
    { id: "copy", label: "Copy", icon: "copy" },
    { id: "cut", label: "Cut", icon: "cut" },
    { id: "paste", label: "Paste", icon: "paste" },
    { id: "move", label: "Move To…", icon: "move" },
    { id: "rename", label: "Rename", icon: "rename" },
    { id: "duplicate", label: "Duplicate", icon: "duplicate" },
    { type: "separator", key: "separator-duplicate" },
    { id: "newFolder", label: "New Folder", icon: "newFolder" },
    { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
    { type: "separator", key: "separator-new-folder" },
    { id: "terminal", label: "Open in Terminal", icon: "terminal" },
    { id: "copyPath", label: "Copy Path", icon: "copyPath" },
    { type: "separator", key: "separator-copy-path" },
    { id: "trash", label: "Move to Trash", icon: "trash", destructive: true },
  ];
}
