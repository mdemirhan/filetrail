import { type ToolbarItemId, getToolbarItemDefinition } from "../../shared/toolbarItems";
import { DEFAULT_SHORTCUT_DISPLAY, type ShortcutDisplay } from "./shortcutDisplay";
import { formatShortcut } from "./shortcutLabels";

// How tooltips are worded, everywhere in the app:
//
// - A button says the command it runs, named as the menus name it, then its shortcut in
//   brackets: "Move to Trash (⌘⌫)".
// - A button that switches something on and off says what the click will do:
//   "Show Hidden Files (⇧⌘.)" while they are hidden, "Hide Hidden Files (⇧⌘.)" while shown.
// - Text that can be cut short (a name, a path) carries the whole text, and a value shown
//   in short (a relative date, a permission code) carries the exact one.
//
// The shortcut is written as in the app's data ("Cmd+Shift+M") and shown as symbols.
export function formatTooltip(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${formatShortcut(shortcut)})` : label;
}

// What the toolbar's on/off buttons need to know to say what a click will do.
export type ToolbarTooltipState = {
  foldersFirst?: boolean;
  hiddenFilesShown?: boolean;
  infoPanelOpen?: boolean;
  infoRowOpen?: boolean;
};

export function getToolbarItemTooltip(
  itemId: ToolbarItemId,
  state: ToolbarTooltipState = {},
  shortcuts: ShortcutDisplay = DEFAULT_SHORTCUT_DISPLAY,
): string {
  const definition = getToolbarItemDefinition(itemId);
  return formatTooltip(
    resolveToolbarItemLabel(itemId, state),
    definition.shortcutCommand ? shortcuts.written(definition.shortcutCommand) : undefined,
  );
}

function resolveToolbarItemLabel(itemId: ToolbarItemId, state: ToolbarTooltipState): string {
  if (itemId === "foldersFirst") {
    return state.foldersFirst ? "Mix Files and Folders" : "List Folders First";
  }
  if (itemId === "hidden") {
    return state.hiddenFilesShown ? "Hide Hidden Files" : "Show Hidden Files";
  }
  if (itemId === "infoPanel") {
    return state.infoPanelOpen ? "Hide Info Panel" : "Show Info Panel";
  }
  if (itemId === "infoRow") {
    return state.infoRowOpen ? "Hide Info Row" : "Show Info Row";
  }
  const definition = getToolbarItemDefinition(itemId);
  return definition.tooltipLabel ?? definition.label;
}
