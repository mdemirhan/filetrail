// Shortcuts are written as "Cmd+Shift+G" in the app's data (Help, the toolbar buttons) and
// shown the macOS way: symbols in the standard modifier order (⌃⌥⇧⌘) followed by the key.
const SHORTCUT_GLYPHS: Record<string, string> = {
  Cmd: "⌘",
  Shift: "⇧",
  Option: "⌥",
  Alt: "⌥",
  Ctrl: "⌃",
  Backspace: "⌫",
  Delete: "⌦",
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Return: "↩",
  Enter: "↩",
  Esc: "esc",
  Tab: "⇥",
  Home: "↖",
  End: "↘",
  PageUp: "⇞",
  PageDown: "⇟",
  Plus: "+",
};
const MODIFIER_ORDER = ["⌃", "⌥", "⇧", "⌘"];

// One entry for each key, for Help's keycaps: ["⇧", "⌘", "G"].
export function shortcutParts(shortcut: string): string[] {
  const normalized = shortcut.endsWith("++") ? `${shortcut.slice(0, -2)}+Plus` : shortcut;
  const parts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => SHORTCUT_GLYPHS[part] ?? part);
  const modifiers = parts
    .filter((part) => MODIFIER_ORDER.includes(part))
    .sort((left, right) => MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right));
  return [...modifiers, ...parts.filter((part) => !MODIFIER_ORDER.includes(part))];
}

// As one piece of text, the way a menu writes it: "⇧⌘G". Escape is spelled out, as "Esc".
export function formatShortcut(shortcut: string): string {
  return shortcutParts(shortcut)
    .map((part) => (part === "esc" ? "Esc" : part))
    .join("");
}
