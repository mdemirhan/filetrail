// "background" is the empty space of the file list: its menu acts on the folder on screen.
export type ContextMenuSurface =
  | "content"
  | "search"
  | "treeFolder"
  | "favorite"
  | "trash"
  | "background";
export type ContextMenuTargetKind = "contentEntry" | "treeFolder" | "favorite";
export type ContextMenuScope = "selection" | "background";
export type ContextMenuSourceSubview = "tree" | "favorites" | null;

export type ContextMenuActionId =
  | "revealInFolder"
  | "revealInTree"
  | "open"
  | "openInNewTab"
  | "openWith"
  | "showPackageContents"
  | "edit"
  | "showInfo"
  | "calculateSize"
  | "cut"
  | "copy"
  | "paste"
  | "move"
  | "rename"
  | "duplicate"
  | "newFolder"
  | "toggleFavorite"
  | "terminal"
  | "showInFinder"
  | "copyPath"
  | "rootTreeHere"
  | "trash"
  | "deleteImmediately"
  | "emptyTrash";

export type ContextMenuSubmenuAction =
  | {
      kind: "application";
      id: string;
      label: string;
      appPath: string;
      appName: string;
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
  | "openInNewTab"
  | "openWith"
  | "showPackageContents"
  | "edit"
  | "showInfo"
  | "calculateSize"
  | "cut"
  | "copy"
  | "paste"
  | "move"
  | "rename"
  | "duplicate"
  | "newFolder"
  | "terminal"
  | "showInFinder"
  | "copyPath"
  | "rootTreeHere"
  | "trash"
  | "deleteImmediately"
  | "emptyTrash"
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

  if (input.surface === "trash") {
    return [
      ...getContextMenuItems({ surface: "content", favoriteToggleLabel }),
      {
        id: "deleteImmediately",
        label: "Delete Immediately",
        icon: "deleteImmediately",
        destructive: true,
      },
    ];
  }

  // Every menu uses the same group order: open, info, clipboard, organize, favorites,
  // other apps, remove.
  if (input.surface === "treeFolder") {
    return [
      { id: "open", label: "Open", icon: "open" },
      { id: "openInNewTab", label: "Open in New Tab", icon: "openInNewTab" },
      { id: "rootTreeHere", label: "Root Tree Here", icon: "rootTreeHere" },
      { type: "separator", key: "separator-tree-open" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { id: "calculateSize", label: "Calculate Size", icon: "calculateSize" },
      { type: "separator", key: "separator-tree-info" },
      { id: "cut", label: "Cut", icon: "cut" },
      { id: "copy", label: "Copy", icon: "copy" },
      { id: "paste", label: "Paste", icon: "paste" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-tree-clipboard" },
      { id: "rename", label: "Rename", icon: "rename" },
      { id: "duplicate", label: "Duplicate", icon: "duplicate" },
      { id: "move", label: "Move To…", icon: "move" },
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-tree-organize" },
      { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
      { type: "separator", key: "separator-tree-favorite" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "showInFinder", label: "Show in Finder", icon: "showInFinder" },
      { type: "separator", key: "separator-tree-apps" },
      { id: "trash", label: "Move to Trash", icon: "trash", destructive: true },
      {
        id: "deleteImmediately",
        label: "Delete Immediately",
        icon: "deleteImmediately",
        destructive: true,
      },
    ];
  }

  if (input.surface === "background") {
    // New Folder first, as in Finder's menu for a window's background.
    return [
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-background-organize" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { type: "separator", key: "separator-background-info" },
      { id: "paste", label: "Paste", icon: "paste" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-background-clipboard" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "showInFinder", label: "Show in Finder", icon: "showInFinder" },
      // Only in the Trash (the others are hidden by the caller).
      { type: "separator", key: "separator-background-trash" },
      { id: "emptyTrash", label: "Empty Trash…", icon: "emptyTrash", destructive: true },
    ];
  }

  if (input.surface === "favorite") {
    return [
      { id: "openInNewTab", label: "Open in New Tab", icon: "openInNewTab" },
      { id: "revealInTree", label: "Reveal in Tree", icon: "revealInTree" },
      { id: "rootTreeHere", label: "Root Tree Here", icon: "rootTreeHere" },
      { type: "separator", key: "separator-favorite-open" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { type: "separator", key: "separator-favorite-info" },
      { id: "paste", label: "Paste", icon: "paste" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-favorite-clipboard" },
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-favorite-organize" },
      { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
      { type: "separator", key: "separator-favorite-toggle" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "showInFinder", label: "Show in Finder", icon: "showInFinder" },
      // Only for the Trash favorite (hidden by the caller for the others).
      { type: "separator", key: "separator-favorite-trash" },
      { id: "emptyTrash", label: "Empty Trash…", icon: "emptyTrash", destructive: true },
    ];
  }

  return [
    { id: "open", label: "Open", icon: "open" },
    { id: "openInNewTab", label: "Open in New Tab", icon: "openInNewTab" },
    { id: "openWith", label: "Open With", icon: "openWith", hasSubmenu: true },
    { id: "edit", label: "Edit", icon: "edit" },
    { id: "showPackageContents", label: "Show Package Contents", icon: "showPackageContents" },
    { id: "rootTreeHere", label: "Root Tree Here", icon: "rootTreeHere" },
    { type: "separator", key: "separator-open" },
    { id: "showInfo", label: "Show Info", icon: "showInfo" },
    { id: "calculateSize", label: "Calculate Size", icon: "calculateSize" },
    { type: "separator", key: "separator-info" },
    { id: "cut", label: "Cut", icon: "cut" },
    { id: "copy", label: "Copy", icon: "copy" },
    { id: "paste", label: "Paste", icon: "paste" },
    { id: "copyPath", label: "Copy Path", icon: "copyPath" },
    { type: "separator", key: "separator-clipboard" },
    { id: "rename", label: "Rename", icon: "rename" },
    { id: "duplicate", label: "Duplicate", icon: "duplicate" },
    { id: "move", label: "Move To…", icon: "move" },
    { id: "newFolder", label: "New Folder", icon: "newFolder" },
    { type: "separator", key: "separator-organize" },
    { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
    { type: "separator", key: "separator-favorite" },
    { id: "terminal", label: "Open in Terminal", icon: "terminal" },
    { id: "showInFinder", label: "Show in Finder", icon: "showInFinder" },
    { type: "separator", key: "separator-apps" },
    { id: "trash", label: "Move to Trash", icon: "trash", destructive: true },
  ];
}
