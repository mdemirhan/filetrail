// The one table of keyboard shortcuts. The application menu, the window's key handler, the
// context menus, tooltips, Help and Settings all read it, so a shortcut changed in
// Settings changes everywhere at once.
//
// A shortcut is written as "Cmd+Shift+G": modifiers in the order Ctrl, Cmd, Option, Shift,
// then one key. Each command has up to two: the main one, which menus and tooltips show,
// and an alternate.

export type ShortcutGroup = "navigation" | "tabs" | "files" | "search" | "view" | "standard";

export type ShortcutCommandDefinition = {
  id: string;
  // Named as the menus name it.
  label: string;
  group: ShortcutGroup;
  defaults: readonly string[];
  // Where the command is in the menus, for text that has no key to name.
  menuPath?: string;
  // Never changed in Settings: the key is shared with text fields, or is macOS's own.
  fixed?: boolean;
};

export const SHORTCUT_GROUP_LABELS: Record<ShortcutGroup, string> = {
  navigation: "Navigation",
  tabs: "Tabs",
  files: "Files",
  search: "Search",
  view: "View",
  standard: "Standard",
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  "navigation",
  "tabs",
  "files",
  "search",
  "view",
  "standard",
];

export const SHORTCUT_COMMANDS = [
  {
    id: "goBack",
    label: "Back",
    group: "navigation",
    defaults: ["Cmd+[", "Cmd+Left"],
    menuPath: "Go > Back",
  },
  {
    id: "goForward",
    label: "Forward",
    group: "navigation",
    defaults: ["Cmd+]", "Cmd+Right"],
    menuPath: "Go > Forward",
  },
  {
    id: "goEnclosingFolder",
    label: "Enclosing Folder",
    group: "navigation",
    defaults: ["Cmd+Up"],
    menuPath: "Go > Enclosing Folder",
  },
  {
    id: "goHomeRootTree",
    label: "Home",
    group: "navigation",
    defaults: ["Cmd+Shift+H"],
    menuPath: "Go > Home",
  },
  {
    id: "openLocationSheet",
    label: "Go To…",
    group: "navigation",
    defaults: ["Cmd+K", "Cmd+Shift+G"],
    menuPath: "Go > Go To…",
  },
  {
    id: "rootTreeAtSelection",
    label: "Root Tree at Selected Folder",
    group: "navigation",
    defaults: ["Cmd+Shift+R"],
    menuPath: "Go > Root Tree at Selected Folder",
  },
  {
    id: "refreshOrApplySearchSort",
    label: "Refresh",
    group: "navigation",
    defaults: ["Cmd+R"],
    menuPath: "View > Refresh",
  },
  {
    id: "focusTreePane",
    label: "Focus Folder Tree",
    group: "navigation",
    defaults: ["Cmd+1"],
    menuPath: "Window > Focus Folder Tree",
  },
  {
    id: "focusContentPane",
    label: "Focus File List",
    group: "navigation",
    defaults: ["Cmd+2"],
    menuPath: "Window > Focus File List",
  },
  { id: "pageUp", label: "Scroll One Page Up", group: "navigation", defaults: ["Ctrl+U"] },
  { id: "pageDown", label: "Scroll One Page Down", group: "navigation", defaults: ["Ctrl+D"] },

  {
    id: "newTab",
    label: "New Tab",
    group: "tabs",
    defaults: ["Cmd+T"],
    menuPath: "File > New Tab",
  },
  {
    id: "closeTab",
    label: "Close Tab",
    group: "tabs",
    defaults: ["Cmd+W"],
    menuPath: "File > Close Tab",
  },
  {
    id: "reopenClosedTab",
    label: "Reopen Closed Tab",
    group: "tabs",
    defaults: ["Cmd+Shift+T"],
    menuPath: "File > Reopen Closed Tab",
  },
  {
    id: "selectNextTab",
    label: "Show Next Tab",
    group: "tabs",
    defaults: ["Ctrl+Tab", "Cmd+Shift+]"],
    menuPath: "Window > Show Next Tab",
  },
  {
    id: "selectPreviousTab",
    label: "Show Previous Tab",
    group: "tabs",
    defaults: ["Ctrl+Shift+Tab", "Cmd+Shift+["],
    menuPath: "Window > Show Previous Tab",
  },
  {
    id: "openSelectionInNewTab",
    label: "Open in New Tab",
    group: "tabs",
    defaults: [],
    menuPath: "File > Open in New Tab",
  },

  {
    id: "openSelection",
    label: "Open",
    group: "files",
    defaults: ["Cmd+O"],
    menuPath: "File > Open",
  },
  // What a double-click does: it follows Settings → Files for a file, and in the folder
  // tree it expands or collapses the folder.
  { id: "openSelectedItem", label: "Open Selected Item", group: "files", defaults: ["Cmd+Down"] },
  {
    id: "editSelection",
    label: "Edit in Text Editor",
    group: "files",
    defaults: ["Cmd+E"],
    menuPath: "File > Edit in Text Editor",
  },
  {
    id: "quickLookSelection",
    label: "Quick Look",
    group: "files",
    defaults: ["Space"],
    menuPath: "File > Quick Look",
  },
  // Return renames as well while Settings → Files says so.
  {
    id: "renameSelection",
    label: "Rename",
    group: "files",
    defaults: ["F2"],
    menuPath: "File > Rename",
  },
  {
    id: "duplicateSelection",
    label: "Duplicate",
    group: "files",
    defaults: ["Cmd+D"],
    menuPath: "File > Duplicate",
  },
  {
    id: "moveSelection",
    label: "Move To…",
    group: "files",
    defaults: ["Cmd+Shift+M"],
    menuPath: "File > Move To…",
  },
  {
    id: "newFolder",
    label: "New Folder",
    group: "files",
    defaults: ["Cmd+Shift+N"],
    menuPath: "File > New Folder",
  },
  {
    id: "trashSelection",
    label: "Move to Trash",
    group: "files",
    defaults: ["Cmd+Backspace"],
    menuPath: "File > Move to Trash",
  },
  {
    id: "deleteImmediately",
    label: "Delete Immediately…",
    group: "files",
    defaults: ["Cmd+Option+Backspace"],
    menuPath: "File > Delete Immediately…",
  },
  {
    id: "emptyTrash",
    label: "Empty Trash…",
    group: "files",
    defaults: ["Cmd+Shift+Backspace"],
    menuPath: "File Trail > Empty Trash…",
  },
  {
    id: "copyPath",
    label: "Copy Path",
    group: "files",
    defaults: ["Cmd+Option+C"],
    menuPath: "Edit > Copy Path",
  },
  {
    id: "showClipboard",
    label: "Show Clipboard",
    group: "files",
    defaults: [],
    menuPath: "Edit > Show Clipboard",
  },
  {
    id: "clearClipboard",
    label: "Clear Clipboard",
    group: "files",
    defaults: [],
    menuPath: "Edit > Clear Clipboard",
  },
  {
    id: "openInTerminal",
    label: "Open in Terminal",
    group: "files",
    defaults: ["Cmd+Option+T"],
    menuPath: "File > Open in Terminal",
  },
  {
    id: "showInFinder",
    label: "Show in Finder",
    group: "files",
    defaults: [],
    menuPath: "File > Show in Finder",
  },
  {
    id: "toggleFavorite",
    label: "Add to Favorites",
    group: "files",
    defaults: [],
    menuPath: "File > Add to Favorites",
  },

  {
    id: "focusFileSearch",
    label: "Find Files…",
    group: "search",
    defaults: ["Cmd+F"],
    menuPath: "Edit > Find Files…",
  },
  {
    id: "showLastSearchResults",
    label: "Show Last Results",
    group: "search",
    defaults: ["Cmd+Shift+F"],
    menuPath: "Edit > Show Last Results",
  },

  {
    id: "viewAsIcons",
    label: "View as Icons",
    group: "view",
    defaults: [],
    menuPath: "View > as Icons",
  },
  {
    id: "viewAsList",
    label: "View as List",
    group: "view",
    defaults: [],
    menuPath: "View > as List",
  },
  {
    id: "viewAsDetails",
    label: "View as Details",
    group: "view",
    defaults: [],
    menuPath: "View > as Details",
  },
  {
    id: "sortByName",
    label: "Sort by Name",
    group: "view",
    defaults: [],
    menuPath: "View > Sort By > Name",
  },
  {
    id: "sortByModified",
    label: "Sort by Date Modified",
    group: "view",
    defaults: [],
    menuPath: "View > Sort By > Date Modified",
  },
  {
    id: "sortBySize",
    label: "Sort by Size",
    group: "view",
    defaults: [],
    menuPath: "View > Sort By > Size",
  },
  {
    id: "sortByKind",
    label: "Sort by Kind",
    group: "view",
    defaults: [],
    menuPath: "View > Sort By > Kind",
  },
  {
    id: "toggleFoldersFirst",
    label: "Folders First",
    group: "view",
    defaults: [],
    menuPath: "View > Folders First",
  },
  {
    id: "toggleHiddenFiles",
    label: "Show Hidden Files",
    group: "view",
    defaults: ["Cmd+Shift+."],
    menuPath: "View > Hidden Files",
  },
  {
    id: "toggleInfoPanel",
    label: "Show Info Panel",
    group: "view",
    defaults: ["Cmd+I"],
    menuPath: "View > Info Panel",
  },
  {
    id: "toggleInfoRow",
    label: "Show Info Row",
    group: "view",
    defaults: ["Cmd+Shift+I"],
    menuPath: "View > Info Row",
  },
  {
    id: "zoomIn",
    label: "Zoom In",
    group: "view",
    defaults: ["Cmd+Plus"],
    menuPath: "View > Zoom In",
  },
  {
    id: "zoomOut",
    label: "Zoom Out",
    group: "view",
    defaults: ["Cmd+-"],
    menuPath: "View > Zoom Out",
  },
  {
    id: "resetZoom",
    label: "Actual Size",
    group: "view",
    defaults: ["Cmd+0"],
    menuPath: "View > Actual Size",
  },
  {
    id: "openHelp",
    label: "File Trail Help",
    group: "view",
    defaults: ["?"],
    menuPath: "Help > File Trail Help",
  },
  {
    id: "openKeyboardShortcuts",
    label: "Keyboard Shortcuts",
    group: "view",
    defaults: [],
    menuPath: "Help > Keyboard Shortcuts",
  },

  { id: "undo", label: "Undo", group: "standard", defaults: ["Cmd+Z"], fixed: true },
  { id: "redo", label: "Redo", group: "standard", defaults: ["Cmd+Shift+Z"], fixed: true },
  { id: "cut", label: "Cut", group: "standard", defaults: ["Cmd+X"], fixed: true },
  { id: "copy", label: "Copy", group: "standard", defaults: ["Cmd+C"], fixed: true },
  { id: "paste", label: "Paste", group: "standard", defaults: ["Cmd+V"], fixed: true },
  { id: "selectAll", label: "Select All", group: "standard", defaults: ["Cmd+A"], fixed: true },
  { id: "settings", label: "Settings…", group: "standard", defaults: ["Cmd+,"], fixed: true },
  {
    id: "closeWindow",
    label: "Close Window",
    group: "standard",
    defaults: ["Cmd+Shift+W"],
    fixed: true,
  },
  { id: "minimize", label: "Minimize", group: "standard", defaults: ["Cmd+M"], fixed: true },
  {
    id: "fullScreen",
    label: "Enter Full Screen",
    group: "standard",
    defaults: ["Ctrl+Cmd+F"],
    fixed: true,
  },
  { id: "hide", label: "Hide File Trail", group: "standard", defaults: ["Cmd+H"], fixed: true },
  {
    id: "hideOthers",
    label: "Hide Others",
    group: "standard",
    defaults: ["Cmd+Option+H"],
    fixed: true,
  },
  { id: "quit", label: "Quit File Trail", group: "standard", defaults: ["Cmd+Q"], fixed: true },
] as const satisfies readonly ShortcutCommandDefinition[];

export type ShortcutCommandId = (typeof SHORTCUT_COMMANDS)[number]["id"];

// The keys of every command, main first.
export type ShortcutBindings = Readonly<Record<ShortcutCommandId, readonly string[]>>;

// What is saved: the keys of the commands that differ from their defaults, and nothing
// else, so a default that changes later still reaches everyone who left it alone.
export type ShortcutOverrides = Record<string, string[]>;

export type ResolvedShortcuts = {
  bindings: ShortcutBindings;
  // The command a key press runs. Fixed commands are not in it; they have handlers of
  // their own.
  commandByShortcut: ReadonlyMap<string, ShortcutCommandId>;
};

export const SHORTCUTS_PER_COMMAND = 2;

const COMMAND_BY_ID = new Map<string, ShortcutCommandDefinition>(
  SHORTCUT_COMMANDS.map((command) => [command.id, command]),
);

export function getShortcutCommand(id: ShortcutCommandId): ShortcutCommandDefinition {
  const command = COMMAND_BY_ID.get(id);
  if (!command) {
    throw new Error(`Unknown shortcut command: ${id}`);
  }
  return command;
}

export function isShortcutCommandId(value: string): value is ShortcutCommandId {
  return COMMAND_BY_ID.has(value);
}

type ParsedShortcut = {
  ctrl: boolean;
  cmd: boolean;
  option: boolean;
  shift: boolean;
  key: string;
};

const MODIFIER_NAMES: Record<string, keyof Omit<ParsedShortcut, "key">> = {
  ctrl: "ctrl",
  control: "ctrl",
  cmd: "cmd",
  command: "cmd",
  commandorcontrol: "cmd",
  option: "option",
  alt: "option",
  shift: "shift",
};

// Keys that have a name rather than a character.
const NAMED_KEYS = [
  "Up",
  "Down",
  "Left",
  "Right",
  "Backspace",
  "Delete",
  "Return",
  "Tab",
  "Space",
  "Esc",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Plus",
] as const;
const NAMED_KEY_BY_LOWERCASE = new Map<string, string>(
  NAMED_KEYS.map((key) => [key.toLowerCase(), key]),
);
const PUNCTUATION_KEYS = new Set(["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"]);
const FUNCTION_KEY_PATTERN = /^F([1-9]|1[0-9]|20)$/;
// Keys that move around or edit a list on their own, so they need a modifier.
const MOTION_KEYS = new Set([
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "Tab",
  "Return",
  "Esc",
  "Backspace",
]);

function normalizeKeyName(value: string): string | null {
  if (value.length === 1) {
    if (/[a-z]/i.test(value)) {
      return value.toUpperCase();
    }
    if (/[0-9]/.test(value) || PUNCTUATION_KEYS.has(value) || value === "?") {
      return value;
    }
    return value === "+" ? "Plus" : null;
  }
  const upper = value.toUpperCase();
  if (FUNCTION_KEY_PATTERN.test(upper)) {
    return upper;
  }
  const lower = value.toLowerCase();
  if (lower === "escape") {
    return "Esc";
  }
  if (lower === "enter") {
    return "Return";
  }
  return NAMED_KEY_BY_LOWERCASE.get(lower) ?? null;
}

function parseShortcut(value: string): ParsedShortcut | null {
  // "Cmd++" and "+" name the plus key.
  const text = value.trim();
  const endsWithPlusKey = text === "+" || text.endsWith("++");
  const parts = (endsWithPlusKey ? `${text.slice(0, -1)}Plus` : text)
    .split("+")
    .map((part) => part.trim());
  const keyPart = parts.pop();
  if (keyPart === undefined || parts.some((part) => part.length === 0)) {
    return null;
  }
  const key = normalizeKeyName(keyPart);
  if (!key) {
    return null;
  }
  const parsed: ParsedShortcut = { ctrl: false, cmd: false, option: false, shift: false, key };
  for (const part of parts) {
    const modifier = MODIFIER_NAMES[part.toLowerCase()];
    if (!modifier) {
      return null;
    }
    parsed[modifier] = true;
  }
  if (key === "?") {
    // "?" is the character, however it is typed; it only stands on its own.
    if (parsed.ctrl || parsed.cmd || parsed.option) {
      return null;
    }
    parsed.shift = false;
  }
  return parsed;
}

function writeShortcut(parsed: ParsedShortcut): string {
  return [
    parsed.ctrl ? "Ctrl" : null,
    parsed.cmd ? "Cmd" : null,
    parsed.option ? "Option" : null,
    parsed.shift ? "Shift" : null,
    parsed.key,
  ]
    .filter((part) => part !== null)
    .join("+");
}

// The one way a shortcut is written, or null when the text does not name one.
export function normalizeShortcut(value: string): string | null {
  const parsed = parseShortcut(value);
  return parsed ? writeShortcut(parsed) : null;
}

const KEY_BY_EVENT_KEY: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Backspace: "Backspace",
  Delete: "Delete",
  Enter: "Return",
  Tab: "Tab",
  Escape: "Esc",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
};

// The key at a position of the keyboard, for when a modifier changes the character the
// key types (Option always does; Shift does for everything but letters).
const KEY_BY_EVENT_CODE: Record<string, string> = {
  Space: "Space",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
};

function keyFromEventCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) {
    return letter[1];
  }
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1]) {
    return digit[1];
  }
  return KEY_BY_EVENT_CODE[code] ?? null;
}

export type ShortcutKeyEvent = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

// The shortcut a key press spells, or null while only modifiers are down. Characters
// follow the keyboard layout, as menus do.
export function shortcutFromKeyboardEvent(event: ShortcutKeyEvent): string | null {
  const { key, code } = event;
  if (key === "?" && !event.metaKey && !event.ctrlKey && !event.altKey) {
    return "?";
  }
  let name: string | null = null;
  if (code === "Space" || key === " ") {
    name = "Space";
  } else if (KEY_BY_EVENT_KEY[key]) {
    name = KEY_BY_EVENT_KEY[key];
  } else if (FUNCTION_KEY_PATTERN.test(key)) {
    name = key;
  } else if (!event.altKey && /^[a-z]$/i.test(key)) {
    name = key.toUpperCase();
  } else if (event.altKey) {
    name = keyFromEventCode(code);
  } else {
    const character = key.length === 1 ? normalizeKeyName(key) : null;
    name = event.shiftKey
      ? (keyFromEventCode(code) ?? character)
      : (character ?? keyFromEventCode(code));
  }
  if (!name || name === "?") {
    return null;
  }
  return writeShortcut({
    ctrl: event.ctrlKey,
    cmd: event.metaKey,
    option: event.altKey,
    shift: event.shiftKey,
    key: name,
  });
}

function normalizeAll(shortcuts: readonly string[]): string[] {
  return shortcuts.flatMap((shortcut) => normalizeShortcut(shortcut) ?? []);
}

export const DEFAULT_SHORTCUT_BINDINGS: ShortcutBindings = Object.fromEntries(
  SHORTCUT_COMMANDS.map((command) => [command.id, normalizeAll(command.defaults)]),
) as unknown as ShortcutBindings;

const FIXED_COMMAND_BY_SHORTCUT = new Map<string, ShortcutCommandId>(
  SHORTCUT_COMMANDS.flatMap((command) =>
    "fixed" in command && command.fixed
      ? normalizeAll(command.defaults).map((shortcut) => [shortcut, command.id] as const)
      : [],
  ),
);

// Keys that never reach the app: macOS acts on them first.
const MACOS_SHORTCUTS = new Set(
  normalizeAll([
    "Cmd+Tab",
    "Cmd+Shift+Tab",
    "Cmd+`",
    "Cmd+Shift+`",
    "Cmd+Space",
    "Ctrl+Space",
    "Ctrl+Cmd+Space",
    "Cmd+Option+Space",
    "Cmd+Option+Esc",
    "Ctrl+Cmd+Q",
    "Cmd+Shift+Q",
    "Cmd+Option+Shift+Q",
    "Cmd+Shift+3",
    "Cmd+Shift+4",
    "Cmd+Shift+5",
    "Ctrl+Cmd+Shift+3",
    "Ctrl+Cmd+Shift+4",
    "Cmd+Option+D",
    "Cmd+Shift+/",
  ]),
);

// Keys macOS uses unless they were switched off in System Settings.
const MACOS_OPTIONAL_SHORTCUTS = new Set(
  normalizeAll(["Ctrl+Up", "Ctrl+Down", "Ctrl+Left", "Ctrl+Right", "F11"]),
);

// ⌘. cancels a dialog, as Escape does.
const CANCEL_SHORTCUT = "Cmd+.";

// Keys a text field uses to move the caret or delete. A command on one of them leaves the
// key to the field while a field has the keyboard.
const TEXT_EDITING_KEYS = new Set(["Up", "Down", "Left", "Right", "Home", "End", "Backspace"]);
const TEXT_EDITING_CONTROL_KEYS = new Set(["A", "B", "D", "E", "F", "H", "K", "N", "P", "T"]);

export function isTextEditingShortcut(shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }
  if (TEXT_EDITING_KEYS.has(parsed.key) || parsed.key === "Delete") {
    return true;
  }
  return parsed.ctrl && !parsed.cmd && TEXT_EDITING_CONTROL_KEYS.has(parsed.key);
}

function isTypingKey(key: string): boolean {
  return key.length === 1 || key === "Plus" || key === "Space";
}

export type ShortcutRefusal =
  // Letters, digits, punctuation and Space type into the file list.
  | { reason: "needsCommandOrControl" }
  // Arrows, Tab, Return, Esc and Backspace move around or edit the list.
  | { reason: "needsModifier" }
  | { reason: "fixedCommand"; command: ShortcutCommandId }
  | { reason: "cancelsDialogs" }
  | { reason: "macOS" };

// Why a key can not be given to any command, or null when it can.
export function getShortcutRefusal(shortcut: string): ShortcutRefusal | null {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return { reason: "needsCommandOrControl" };
  }
  const fixedCommand = FIXED_COMMAND_BY_SHORTCUT.get(shortcut);
  if (fixedCommand) {
    return { reason: "fixedCommand", command: fixedCommand };
  }
  if (shortcut === CANCEL_SHORTCUT) {
    return { reason: "cancelsDialogs" };
  }
  if (MACOS_SHORTCUTS.has(shortcut)) {
    return { reason: "macOS" };
  }
  if (isTypingKey(parsed.key) && !parsed.cmd && !parsed.ctrl) {
    return { reason: "needsCommandOrControl" };
  }
  if (MOTION_KEYS.has(parsed.key) && !parsed.cmd && !parsed.ctrl && !parsed.option) {
    return { reason: "needsModifier" };
  }
  return null;
}

// macOS may take the key before the app sees it; it works once that is switched off.
export function isShortcutUsedByMacOSByDefault(shortcut: string): boolean {
  return MACOS_OPTIONAL_SHORTCUTS.has(shortcut);
}

// A command keeps a key of its own defaults that could not be given out today (Space for
// Quick Look, ? for Help).
function isAllowedFor(command: ShortcutCommandDefinition, shortcut: string): boolean {
  if (getShortcutRefusal(shortcut) === null) {
    return true;
  }
  return normalizeAll(command.defaults).includes(shortcut);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameShortcuts(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((shortcut, index) => shortcut === right[index]);
}

// The keys every command has, given what was saved. Saved keys are taken as far as they
// make sense: an unknown command or an unusable key is dropped, and a key two commands
// claim goes to the one that was given it over the one that has it by default.
export function resolveShortcuts(overrides: unknown): ResolvedShortcuts {
  const saved = isPlainObject(overrides) ? overrides : {};
  const taken = new Map<string, ShortcutCommandId>();
  const bindings = {} as Record<ShortcutCommandId, readonly string[]>;
  const claim = (command: (typeof SHORTCUT_COMMANDS)[number], shortcuts: readonly string[]) => {
    const kept: string[] = [];
    for (const shortcut of shortcuts) {
      if (kept.length === SHORTCUTS_PER_COMMAND || taken.has(shortcut)) {
        continue;
      }
      taken.set(shortcut, command.id);
      kept.push(shortcut);
    }
    bindings[command.id] = kept;
  };
  const isFixed = (command: ShortcutCommandDefinition) => command.fixed === true;
  for (const command of SHORTCUT_COMMANDS) {
    if (isFixed(command)) {
      claim(command, DEFAULT_SHORTCUT_BINDINGS[command.id]);
    }
  }
  const customized = (command: ShortcutCommandDefinition): string[] | null => {
    const value = saved[command.id];
    if (isFixed(command) || !Array.isArray(value)) {
      return null;
    }
    return value.flatMap((candidate) => {
      const shortcut = typeof candidate === "string" ? normalizeShortcut(candidate) : null;
      return shortcut && isAllowedFor(command, shortcut) ? [shortcut] : [];
    });
  };
  for (const command of SHORTCUT_COMMANDS) {
    const shortcuts = customized(command);
    if (shortcuts) {
      claim(command, shortcuts);
    }
  }
  for (const command of SHORTCUT_COMMANDS) {
    if (bindings[command.id] === undefined) {
      claim(command, DEFAULT_SHORTCUT_BINDINGS[command.id]);
    }
  }
  const commandByShortcut = new Map<string, ShortcutCommandId>();
  for (const [shortcut, commandId] of taken) {
    if (!isFixed(getShortcutCommand(commandId))) {
      commandByShortcut.set(shortcut, commandId);
    }
  }
  return { bindings, commandByShortcut };
}

export const DEFAULT_SHORTCUTS: ResolvedShortcuts = resolveShortcuts({});

// What to save for a set of keys: the commands that differ from their defaults.
export function toShortcutOverrides(bindings: ShortcutBindings): ShortcutOverrides {
  const overrides: ShortcutOverrides = {};
  for (const command of SHORTCUT_COMMANDS) {
    const shortcuts = bindings[command.id];
    if (!sameShortcuts(shortcuts, DEFAULT_SHORTCUT_BINDINGS[command.id])) {
      overrides[command.id] = [...shortcuts];
    }
  }
  return overrides;
}

// Saved keys as the app will use them, whatever shape they arrived in.
export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrides {
  return toShortcutOverrides(resolveShortcuts(value).bindings);
}

export function isShortcutCustomized(bindings: ShortcutBindings, id: ShortcutCommandId): boolean {
  return !sameShortcuts(bindings[id], DEFAULT_SHORTCUT_BINDINGS[id]);
}

export type ShortcutAssignment =
  | { status: "ok" }
  // The command already has the key.
  | { status: "unchanged" }
  | { status: "refused"; refusal: ShortcutRefusal }
  // Another command has the key; it can be moved here.
  | { status: "conflict"; command: ShortcutCommandId };

// Whether a key can be given to a command, as things stand.
export function checkShortcutAssignment(
  bindings: ShortcutBindings,
  id: ShortcutCommandId,
  shortcut: string,
): ShortcutAssignment {
  const command = getShortcutCommand(id);
  if (bindings[id].includes(shortcut)) {
    return { status: "unchanged" };
  }
  const refusal = getShortcutRefusal(shortcut);
  if (refusal && !normalizeAll(command.defaults).includes(shortcut)) {
    return { status: "refused", refusal };
  }
  for (const other of SHORTCUT_COMMANDS) {
    if (other.id !== id && bindings[other.id].includes(shortcut)) {
      return { status: "conflict", command: other.id };
    }
  }
  return { status: "ok" };
}

// Gives a key to a command in the main (0) or alternate (1) place, taking it away from
// any command that had it. A key put in an empty main place stays the only one.
export function assignShortcut(
  bindings: ShortcutBindings,
  id: ShortcutCommandId,
  slot: number,
  shortcut: string,
): ShortcutBindings {
  const next = { ...bindings } as Record<ShortcutCommandId, readonly string[]>;
  for (const command of SHORTCUT_COMMANDS) {
    if (command.id !== id && next[command.id].includes(shortcut)) {
      next[command.id] = next[command.id].filter((candidate) => candidate !== shortcut);
    }
  }
  const own = next[id].filter((candidate) => candidate !== shortcut);
  if (slot < own.length) {
    own[slot] = shortcut;
  } else {
    own.push(shortcut);
  }
  next[id] = own.slice(0, SHORTCUTS_PER_COMMAND);
  return next;
}

// Takes a key away from a command; the alternate, if there is one, becomes the main key.
export function removeShortcut(
  bindings: ShortcutBindings,
  id: ShortcutCommandId,
  slot: number,
): ShortcutBindings {
  return { ...bindings, [id]: bindings[id].filter((_, index) => index !== slot) };
}

// Gives a command its default keys back. A default key another command was given since is
// taken back from it; the commands it was taken from are returned.
export function resetShortcut(
  bindings: ShortcutBindings,
  id: ShortcutCommandId,
): { bindings: ShortcutBindings; takenFrom: ShortcutCommandId[] } {
  const defaults = DEFAULT_SHORTCUT_BINDINGS[id];
  const next = { ...bindings, [id]: defaults } as Record<ShortcutCommandId, readonly string[]>;
  const takenFrom: ShortcutCommandId[] = [];
  for (const command of SHORTCUT_COMMANDS) {
    if (command.id === id) {
      continue;
    }
    const kept = next[command.id].filter((shortcut) => !defaults.includes(shortcut));
    if (kept.length !== next[command.id].length) {
      next[command.id] = kept;
      takenFrom.push(command.id);
    }
  }
  return { bindings: next, takenFrom };
}

function hasCommandOrControl(shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  return parsed !== null && (parsed.cmd || parsed.ctrl);
}

// The key the application menu shows and listens for. A key without ⌘ or ⌃ (Space, F2)
// is left to the window: as a menu key it would be taken from text fields and dialogs.
export function getMenuShortcut(shortcuts: readonly string[]): string | undefined {
  return shortcuts.find(hasCommandOrControl);
}

const ACCELERATOR_KEYS: Record<string, string> = { Esc: "Escape" };

// A shortcut as Electron's menus write it: "Command+Shift+G".
export function toMenuAccelerator(shortcut: string): string | undefined {
  const parsed = parseShortcut(shortcut);
  if (!parsed || parsed.key === "?") {
    return undefined;
  }
  return [
    parsed.ctrl ? "Control" : null,
    parsed.cmd ? "Command" : null,
    parsed.option ? "Alt" : null,
    parsed.shift ? "Shift" : null,
    ACCELERATOR_KEYS[parsed.key] ?? parsed.key,
  ]
    .filter((part) => part !== null)
    .join("+");
}
