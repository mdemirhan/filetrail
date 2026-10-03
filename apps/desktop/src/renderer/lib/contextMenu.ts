import type { IpcRequest } from "@filetrail/contracts";

import type { ExplorerViewMode } from "../../shared/appPreferences";

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
  | "quickLook"
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
  | "viewAs"
  | "sortBy"
  | "toggleFavorite"
  | "terminal"
  | "showInFinder"
  | "copyPath"
  | "rootTreeHere"
  | "trash"
  | "deleteImmediately"
  | "emptyTrash";

// The items that open a submenu rather than act.
export type ContextMenuSubmenuId = "openWith" | "viewAs" | "sortBy";

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
    }
  | {
      kind: "viewMode";
      id: ExplorerViewMode;
      label: string;
      checked: boolean;
    }
  | {
      kind: "sortBy";
      id: IpcRequest<"directory:getSnapshot">["sortBy"];
      label: string;
      checked: boolean;
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

export type ContextMenuSubmenus = Partial<
  Record<ContextMenuSubmenuId, readonly ContextMenuSubmenuItem[]>
>;

export type ContextMenuIconName =
  | "revealInFolder"
  | "revealInTree"
  | "open"
  | "openFile"
  | "openInNewTab"
  | "openWith"
  | "quickLook"
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
  | "viewAs"
  | "sortBy"
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

// What a menu says about the items it is for.
export type ContextMenuOptions = {
  favoriteToggleLabel?: string | null;
  /** The app Edit opens files in, which its label names, as the menu bar's Edit does. */
  textEditorName?: string | null;
  /** The menu is for folders: Open shows a folder, and Paste goes into the folder. */
  targetsFolder?: boolean;
};

export function getContextMenuItems(
  input: { surface: ContextMenuSurface } & ContextMenuOptions,
): readonly ContextMenuItem[] {
  const favoriteToggleLabel = input.favoriteToggleLabel ?? "Add to Favorites";
  const textEditorName = input.textEditorName ?? "Text Editor";

  if (input.surface === "search") {
    return [
      { id: "revealInFolder", label: "Reveal in Folder", icon: "revealInFolder" },
      { type: "separator", key: "separator-reveal" },
      ...getContextMenuItems({ ...input, surface: "content" }),
    ];
  }

  if (input.surface === "trash") {
    return [
      ...getContextMenuItems({ ...input, surface: "content" }),
      {
        id: "deleteImmediately",
        label: "Delete Immediately…",
        icon: "deleteImmediately",
        destructive: true,
      },
    ];
  }

  // Every menu uses the same group order: open, info, clipboard, organize, favorites,
  // other apps, remove. A folder's menu in the tree or the favorites starts with New Folder,
  // as the menu of a window's background does; clicking the folder already opens it.
  if (input.surface === "treeFolder") {
    return [
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-tree-new" },
      { id: "openInNewTab", label: "Open in New Tab", icon: "openInNewTab" },
      { id: "rootTreeHere", label: "Use as Tree Root", icon: "rootTreeHere" },
      { type: "separator", key: "separator-tree-open" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { id: "calculateSize", label: "Calculate Size", icon: "calculateSize" },
      { type: "separator", key: "separator-tree-info" },
      { id: "cut", label: "Cut", icon: "cut" },
      { id: "copy", label: "Copy", icon: "copy" },
      { id: "paste", label: "Paste into Folder", icon: "paste" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-tree-clipboard" },
      { id: "rename", label: "Rename", icon: "rename" },
      { id: "duplicate", label: "Duplicate", icon: "duplicate" },
      { id: "move", label: "Move to…", icon: "move" },
      { type: "separator", key: "separator-tree-organize" },
      { id: "toggleFavorite", label: favoriteToggleLabel, icon: "favorite" },
      { type: "separator", key: "separator-tree-favorite" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "showInFinder", label: "Show in Finder", icon: "showInFinder" },
      { type: "separator", key: "separator-tree-apps" },
      { id: "trash", label: "Move to Trash", icon: "trash", destructive: true },
      {
        id: "deleteImmediately",
        label: "Delete Immediately…",
        icon: "deleteImmediately",
        destructive: true,
      },
    ];
  }

  if (input.surface === "background") {
    // New Folder first, and View As and Sort By, as in Finder's menu for a window's
    // background.
    return [
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-background-organize" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { type: "separator", key: "separator-background-info" },
      { id: "paste", label: "Paste", icon: "paste" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-background-clipboard" },
      { id: "viewAs", label: "View As", icon: "viewAs", hasSubmenu: true },
      { id: "sortBy", label: "Sort By", icon: "sortBy", hasSubmenu: true },
      { type: "separator", key: "separator-background-view" },
      { id: "terminal", label: "Open in Terminal", icon: "terminal" },
      { id: "showInFinder", label: "Show in Finder", icon: "showInFinder" },
      // Only in the Trash (the others are hidden by the caller).
      { type: "separator", key: "separator-background-trash" },
      { id: "emptyTrash", label: "Empty Trash…", icon: "emptyTrash", destructive: true },
    ];
  }

  if (input.surface === "favorite") {
    return [
      { id: "newFolder", label: "New Folder", icon: "newFolder" },
      { type: "separator", key: "separator-favorite-new" },
      { id: "openInNewTab", label: "Open in New Tab", icon: "openInNewTab" },
      { id: "revealInTree", label: "Reveal in Tree", icon: "revealInTree" },
      { id: "rootTreeHere", label: "Use as Tree Root", icon: "rootTreeHere" },
      { type: "separator", key: "separator-favorite-open" },
      { id: "showInfo", label: "Show Info", icon: "showInfo" },
      { id: "calculateSize", label: "Calculate Size", icon: "calculateSize" },
      { type: "separator", key: "separator-favorite-info" },
      { id: "paste", label: "Paste into Folder", icon: "paste" },
      { id: "copyPath", label: "Copy Path", icon: "copyPath" },
      { type: "separator", key: "separator-favorite-clipboard" },
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
    { id: "open", label: "Open", icon: input.targetsFolder ? "open" : "openFile" },
    { id: "openInNewTab", label: "Open in New Tab", icon: "openInNewTab" },
    { id: "openWith", label: "Open With", icon: "openWith", hasSubmenu: true },
    { id: "quickLook", label: "Quick Look", icon: "quickLook" },
    { id: "edit", label: `Edit in ${textEditorName}`, icon: "edit" },
    { id: "showPackageContents", label: "Show Package Contents", icon: "showPackageContents" },
    { type: "separator", key: "separator-open" },
    { id: "showInfo", label: "Show Info", icon: "showInfo" },
    // For one folder only: hidden by the caller otherwise.
    { id: "calculateSize", label: "Calculate Size", icon: "calculateSize" },
    { type: "separator", key: "separator-info" },
    { id: "cut", label: "Cut", icon: "cut" },
    { id: "copy", label: "Copy", icon: "copy" },
    { id: "paste", label: "Paste into Folder", icon: "paste" },
    { id: "copyPath", label: "Copy Path", icon: "copyPath" },
    { type: "separator", key: "separator-clipboard" },
    { id: "rename", label: "Rename", icon: "rename" },
    { id: "duplicate", label: "Duplicate", icon: "duplicate" },
    { id: "move", label: "Move to…", icon: "move" },
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
