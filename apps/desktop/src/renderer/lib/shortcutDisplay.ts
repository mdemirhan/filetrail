import type { ReturnKeyAction } from "../../shared/appPreferences";
import {
  DEFAULT_SHORTCUTS,
  type ResolvedShortcuts,
  type ShortcutCommandId,
  getShortcutCommand,
} from "../../shared/shortcuts";
import { formatShortcut } from "./shortcutLabels";

// What the window shows for a command's shortcut: in a tooltip, beside a menu item, in
// Help. It follows the keys chosen in Settings.
export type ShortcutDisplay = {
  shortcuts: ResolvedShortcuts;
  // The key shown for a command, written as "Cmd+D"; undefined when it has none.
  written: (id: ShortcutCommandId) => string | undefined;
  // The same key as symbols ("⌘D"), or null.
  label: (id: ShortcutCommandId) => string | null;
  // The command's other key, written as "Cmd+Left".
  alternate: (id: ShortcutCommandId) => string | undefined;
  // For a sentence: the key as symbols, or where the command is in the menus when it has
  // no key ("File > New Tab").
  mention: (id: ShortcutCommandId) => string;
};

export function createShortcutDisplay(
  shortcuts: ResolvedShortcuts,
  options: { returnKeyAction?: ReturnKeyAction } = {},
): ShortcutDisplay {
  // Return renames while Settings → Files says so; it then comes before the keys Rename
  // was given.
  const keysOf = (id: ShortcutCommandId): readonly string[] =>
    id === "renameSelection" && (options.returnKeyAction ?? "rename") === "rename"
      ? ["Return", ...shortcuts.bindings[id]]
      : shortcuts.bindings[id];
  const written = (id: ShortcutCommandId) => keysOf(id)[0];
  const label = (id: ShortcutCommandId) => {
    const shortcut = written(id);
    return shortcut ? formatShortcut(shortcut) : null;
  };
  return {
    shortcuts,
    written,
    label,
    alternate: (id) => keysOf(id)[1],
    mention: (id) => {
      const command = getShortcutCommand(id);
      return label(id) ?? command.menuPath ?? command.label;
    },
  };
}

export const DEFAULT_SHORTCUT_DISPLAY: ShortcutDisplay = createShortcutDisplay(DEFAULT_SHORTCUTS);
