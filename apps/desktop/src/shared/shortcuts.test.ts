import { RENDERER_COMMAND_TYPES } from "./rendererCommands";
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_COMMANDS,
  type ShortcutKeyEvent,
  assignShortcut,
  checkShortcutAssignment,
  getMenuShortcut,
  getShortcutRefusal,
  isShortcutCustomized,
  isShortcutUsedByMacOSByDefault,
  isTextEditingShortcut,
  normalizeShortcut,
  removeShortcut,
  resetShortcut,
  resolveShortcuts,
  sanitizeShortcutOverrides,
  shortcutFromKeyboardEvent,
  toMenuAccelerator,
  toShortcutOverrides,
} from "./shortcuts";

function keyEvent(init: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

describe("shortcut commands", () => {
  it("names every command once and gives no key to two commands", () => {
    const ids = SHORTCUT_COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keys = SHORTCUT_COMMANDS.flatMap((command) => DEFAULT_SHORTCUT_BINDINGS[command.id]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const command of SHORTCUT_COMMANDS) {
      // Every default is written the one way shortcuts are written, and none was dropped.
      expect(DEFAULT_SHORTCUT_BINDINGS[command.id], command.id).toEqual([...command.defaults]);
      expect(DEFAULT_SHORTCUTS.bindings[command.id], command.id).toEqual([...command.defaults]);
    }
  });

  it("lets 48 commands be changed and keeps the standard ones fixed", () => {
    const fixed = SHORTCUT_COMMANDS.filter((command) => "fixed" in command && command.fixed);
    expect(SHORTCUT_COMMANDS.length - fixed.length).toBe(48);
    expect(fixed.map((command) => command.id)).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "settings",
      "closeWindow",
      "minimize",
      "fullScreen",
      "hide",
      "hideOthers",
      "quit",
    ]);
    expect(fixed.every((command) => command.group === "standard")).toBe(true);
  });

  it("covers every command the menus and toolbars can send", () => {
    // These have a fixed key of their own (⌘C, ⌘,) under another name.
    const fixedElsewhere = new Set([
      "editCut",
      "editCopy",
      "editPaste",
      "editSelectAll",
      "openSettings",
      "copySelection",
      "cutSelection",
      "pasteSelection",
    ]);
    const ids = new Set<string>(SHORTCUT_COMMANDS.map((command) => command.id));
    for (const type of RENDERER_COMMAND_TYPES) {
      expect(ids.has(type) || fixedElsewhere.has(type), type).toBe(true);
    }
  });
});

describe("normalizeShortcut", () => {
  it("writes a shortcut one way, whatever order and names it came in", () => {
    expect(normalizeShortcut("shift+cmd+g")).toBe("Cmd+Shift+G");
    expect(normalizeShortcut("Alt+CommandOrControl+T")).toBe("Cmd+Option+T");
    expect(normalizeShortcut("Shift+Option+Cmd+Ctrl+F5")).toBe("Ctrl+Cmd+Option+Shift+F5");
    expect(normalizeShortcut("Cmd++")).toBe("Cmd+Plus");
    expect(normalizeShortcut("Cmd+-")).toBe("Cmd+-");
    expect(normalizeShortcut("cmd+escape")).toBe("Cmd+Esc");
    expect(normalizeShortcut("Ctrl+Enter")).toBe("Ctrl+Return");
    expect(normalizeShortcut("space")).toBe("Space");
    expect(normalizeShortcut("Shift+?")).toBe("?");
  });

  it("refuses text that names no shortcut", () => {
    for (const value of ["", "Cmd", "Cmd+", "Cmd+Shift", "Hyper+K", "Cmd+F25", "Cmd+?", "Cmd+ab"]) {
      expect(normalizeShortcut(value), value).toBeNull();
    }
  });
});

describe("shortcutFromKeyboardEvent", () => {
  it("reads letters from the character, so the keyboard layout is followed", () => {
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "d", code: "KeyD", metaKey: true }))).toBe(
      "Cmd+D",
    );
    // Dvorak: the key at the QWERTY "D" position types "e".
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "e", code: "KeyD", metaKey: true }))).toBe(
      "Cmd+E",
    );
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ key: "N", code: "KeyN", metaKey: true, shiftKey: true }),
      ),
    ).toBe("Cmd+Shift+N");
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "u", code: "KeyU", ctrlKey: true }))).toBe(
      "Ctrl+U",
    );
  });

  it("reads the key itself when Option or Shift changes the character", () => {
    expect(
      shortcutFromKeyboardEvent(keyEvent({ key: "ç", code: "KeyC", metaKey: true, altKey: true })),
    ).toBe("Cmd+Option+C");
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ key: ">", code: "Period", metaKey: true, shiftKey: true }),
      ),
    ).toBe("Cmd+Shift+.");
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true }),
      ),
    ).toBe("Cmd+Shift+]");
    expect(shortcutFromKeyboardEvent(keyEvent({ key: " ", code: "Space", altKey: true }))).toBe(
      "Option+Space",
    );
  });

  it("names the keys that have no character", () => {
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "ArrowUp", metaKey: true }))).toBe("Cmd+Up");
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "Backspace", metaKey: true }))).toBe(
      "Cmd+Backspace",
    );
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "Tab", ctrlKey: true, shiftKey: true }))).toBe(
      "Ctrl+Shift+Tab",
    );
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "F2" }))).toBe("F2");
    expect(shortcutFromKeyboardEvent(keyEvent({ key: " ", code: "Space" }))).toBe("Space");
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "Enter" }))).toBe("Return");
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "Escape" }))).toBe("Esc");
    expect(
      shortcutFromKeyboardEvent(keyEvent({ key: "+", code: "NumpadAdd", metaKey: true })),
    ).toBe("Cmd+Plus");
  });

  it("takes ? as the character, however it is typed", () => {
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "?", code: "Slash", shiftKey: true }))).toBe(
      "?",
    );
    expect(
      shortcutFromKeyboardEvent(
        keyEvent({ key: "?", code: "Slash", shiftKey: true, metaKey: true }),
      ),
    ).toBe("Cmd+Shift+/");
  });

  it("is nothing while only modifiers are down, or for a key it has no name for", () => {
    expect(
      shortcutFromKeyboardEvent(keyEvent({ key: "Meta", code: "MetaLeft", metaKey: true })),
    ).toBe(null);
    expect(
      shortcutFromKeyboardEvent(keyEvent({ key: "Shift", code: "ShiftLeft", shiftKey: true })),
    ).toBe(null);
    expect(shortcutFromKeyboardEvent(keyEvent({ key: "ö", code: "", metaKey: true }))).toBeNull();
  });
});

describe("getShortcutRefusal", () => {
  it("needs ⌘ or ⌃ on a key that types", () => {
    for (const shortcut of ["D", "Shift+D", "Option+D", "7", "Space", "Shift+Space", "/"]) {
      expect(getShortcutRefusal(shortcut), shortcut).toEqual({ reason: "needsCommandOrControl" });
    }
    for (const shortcut of ["Cmd+D", "Ctrl+D", "Ctrl+Option+7", "Cmd+Shift+Space"]) {
      expect(getShortcutRefusal(shortcut), shortcut).toBeNull();
    }
  });

  it("needs a modifier on a key that moves around or edits the list", () => {
    for (const shortcut of ["Up", "Shift+Down", "Home", "Tab", "Return", "Esc", "Backspace"]) {
      expect(getShortcutRefusal(shortcut), shortcut).toEqual({ reason: "needsModifier" });
    }
    for (const shortcut of ["Option+Left", "Cmd+Return", "Ctrl+Tab", "Option+Backspace"]) {
      expect(getShortcutRefusal(shortcut), shortcut).toBeNull();
    }
  });

  it("allows function keys, forward delete and the page keys on their own", () => {
    for (const shortcut of ["F2", "F12", "Shift+F5", "Delete", "PageUp", "PageDown"]) {
      expect(getShortcutRefusal(shortcut), shortcut).toBeNull();
    }
  });

  it("keeps the keys of the fixed commands, of cancelling, and of macOS", () => {
    expect(getShortcutRefusal("Cmd+C")).toEqual({ reason: "fixedCommand", command: "copy" });
    expect(getShortcutRefusal("Cmd+Shift+Z")).toEqual({ reason: "fixedCommand", command: "redo" });
    expect(getShortcutRefusal("Cmd+Q")).toEqual({ reason: "fixedCommand", command: "quit" });
    expect(getShortcutRefusal("Cmd+,")).toEqual({ reason: "fixedCommand", command: "settings" });
    expect(getShortcutRefusal("Ctrl+Cmd+F")).toEqual({
      reason: "fixedCommand",
      command: "fullScreen",
    });
    expect(getShortcutRefusal("Cmd+.")).toEqual({ reason: "cancelsDialogs" });
    for (const shortcut of ["Cmd+Tab", "Cmd+Space", "Cmd+`", "Cmd+Shift+4", "Cmd+Option+Esc"]) {
      expect(getShortcutRefusal(shortcut), shortcut).toEqual({ reason: "macOS" });
    }
  });

  it("warns about, but allows, keys macOS uses until they are switched off", () => {
    expect(getShortcutRefusal("Ctrl+Up")).toBeNull();
    expect(isShortcutUsedByMacOSByDefault("Ctrl+Up")).toBe(true);
    expect(isShortcutUsedByMacOSByDefault("F11")).toBe(true);
    expect(isShortcutUsedByMacOSByDefault("Cmd+Up")).toBe(false);
  });
});

describe("resolveShortcuts", () => {
  it("gives every command its default keys when nothing was saved", () => {
    for (const saved of [undefined, null, "x", [], {}]) {
      expect(resolveShortcuts(saved).bindings).toEqual(DEFAULT_SHORTCUT_BINDINGS);
    }
    expect(DEFAULT_SHORTCUTS.commandByShortcut.get("Cmd+D")).toBe("duplicateSelection");
    expect(DEFAULT_SHORTCUTS.commandByShortcut.get("Cmd+Left")).toBe("goBack");
    expect(DEFAULT_SHORTCUTS.commandByShortcut.get("Space")).toBe("quickLookSelection");
    expect(DEFAULT_SHORTCUTS.commandByShortcut.get("?")).toBe("openHelp");
    // Fixed commands have handlers of their own.
    expect(DEFAULT_SHORTCUTS.commandByShortcut.has("Cmd+C")).toBe(false);
  });

  it("replaces the keys of the commands that were changed and leaves the rest", () => {
    const { bindings, commandByShortcut } = resolveShortcuts({
      newTab: ["Cmd+Option+N"],
      showInFinder: ["Cmd+Shift+J", "F5"],
      duplicateSelection: [],
    });

    expect(bindings.newTab).toEqual(["Cmd+Option+N"]);
    expect(bindings.showInFinder).toEqual(["Cmd+Shift+J", "F5"]);
    expect(bindings.duplicateSelection).toEqual([]);
    expect(bindings.closeTab).toEqual(["Cmd+W"]);
    expect(commandByShortcut.has("Cmd+T")).toBe(false);
    expect(commandByShortcut.has("Cmd+D")).toBe(false);
    expect(commandByShortcut.get("F5")).toBe("showInFinder");
  });

  it("gives a key two commands claim to the one that was given it", () => {
    // New Folder was given ⌘D; Duplicate only has it by default.
    const given = resolveShortcuts({ newFolder: ["Cmd+Shift+N", "Cmd+D"] }).bindings;
    expect(given.newFolder).toEqual(["Cmd+Shift+N", "Cmd+D"]);
    expect(given.duplicateSelection).toEqual([]);

    // Both were given it: the first command in the list keeps it.
    const both = resolveShortcuts({ newTab: ["Cmd+J"], closeTab: ["Cmd+J", "Cmd+W"] }).bindings;
    expect(both.newTab).toEqual(["Cmd+J"]);
    expect(both.closeTab).toEqual(["Cmd+W"]);
  });

  it("drops what makes no sense: unknown commands, unusable keys, a third key", () => {
    const { bindings } = resolveShortcuts({
      noSuchCommand: ["Cmd+J"],
      copy: ["Cmd+J"],
      newTab: ["Cmd+C", "D", "Cmd+Tab", 7, "cmd+shift+y", "Cmd+Shift+Y", "Cmd+U", "Cmd+Y"],
      closeTab: "Cmd+J",
    });

    expect(bindings.copy).toEqual(["Cmd+C"]);
    expect(bindings.newTab).toEqual(["Cmd+Shift+Y", "Cmd+U"]);
    expect(bindings.closeTab).toEqual(["Cmd+W"]);
  });

  it("lets a command keep a key of its own defaults that could not be given out today", () => {
    expect(
      resolveShortcuts({ quickLookSelection: ["Cmd+Y", "Space"] }).bindings.quickLookSelection,
    ).toEqual(["Cmd+Y", "Space"]);
    expect(resolveShortcuts({ openHelp: ["F1", "?"] }).bindings.openHelp).toEqual(["F1", "?"]);
    // Space is Quick Look's alone.
    expect(resolveShortcuts({ newTab: ["Space"] }).bindings.newTab).toEqual([]);
  });
});

describe("saving shortcuts", () => {
  it("saves only the commands that differ from their defaults", () => {
    expect(toShortcutOverrides(DEFAULT_SHORTCUT_BINDINGS)).toEqual({});
    expect(
      sanitizeShortcutOverrides({
        newTab: ["option+cmd+n"],
        closeTab: ["Cmd+W"],
        duplicateSelection: [],
        noSuchCommand: ["Cmd+J"],
      }),
    ).toEqual({ newTab: ["Cmd+Option+N"], duplicateSelection: [] });
  });

  it("writes down the key a command lost to another, so it stays lost", () => {
    expect(sanitizeShortcutOverrides({ newFolder: ["Cmd+D"] })).toEqual({
      newFolder: ["Cmd+D"],
      duplicateSelection: [],
    });
  });
});

describe("changing shortcuts", () => {
  const bindings = DEFAULT_SHORTCUT_BINDINGS;

  it("says whether a key can be given to a command", () => {
    expect(checkShortcutAssignment(bindings, "showInFinder", "Cmd+Shift+J")).toEqual({
      status: "ok",
    });
    expect(checkShortcutAssignment(bindings, "goBack", "Cmd+Left")).toEqual({
      status: "unchanged",
    });
    expect(checkShortcutAssignment(bindings, "newFolder", "Cmd+D")).toEqual({
      status: "conflict",
      command: "duplicateSelection",
    });
    expect(checkShortcutAssignment(bindings, "newFolder", "Cmd+V")).toEqual({
      status: "refused",
      refusal: { reason: "fixedCommand", command: "paste" },
    });
    expect(checkShortcutAssignment(bindings, "newFolder", "N")).toEqual({
      status: "refused",
      refusal: { reason: "needsCommandOrControl" },
    });
    // Quick Look can have Space back; nothing else can have it.
    const withoutSpace = removeShortcut(bindings, "quickLookSelection", 0);
    expect(checkShortcutAssignment(withoutSpace, "quickLookSelection", "Space")).toEqual({
      status: "ok",
    });
    expect(checkShortcutAssignment(withoutSpace, "newTab", "Space").status).toBe("refused");
  });

  it("puts a key in the main or the alternate place", () => {
    const main = assignShortcut(bindings, "duplicateSelection", 0, "Cmd+Shift+D");
    expect(main.duplicateSelection).toEqual(["Cmd+Shift+D"]);

    const alternate = assignShortcut(bindings, "duplicateSelection", 1, "Cmd+Shift+D");
    expect(alternate.duplicateSelection).toEqual(["Cmd+D", "Cmd+Shift+D"]);

    // The alternate place of a command without keys is its main place.
    expect(assignShortcut(bindings, "showInFinder", 1, "F5").showInFinder).toEqual(["F5"]);
    // Replacing the main key keeps the alternate.
    expect(assignShortcut(bindings, "goBack", 0, "Cmd+J").goBack).toEqual(["Cmd+J", "Cmd+Left"]);
    expect(isShortcutCustomized(main, "duplicateSelection")).toBe(true);
    expect(isShortcutCustomized(main, "newFolder")).toBe(false);
  });

  it("takes a reassigned key away from the command that had it", () => {
    const next = assignShortcut(bindings, "newFolder", 1, "Cmd+D");

    expect(next.newFolder).toEqual(["Cmd+Shift+N", "Cmd+D"]);
    expect(next.duplicateSelection).toEqual([]);
    expect(toShortcutOverrides(next)).toEqual({
      newFolder: ["Cmd+Shift+N", "Cmd+D"],
      duplicateSelection: [],
    });
  });

  it("makes the alternate the main key when the main key is removed", () => {
    expect(removeShortcut(bindings, "goBack", 0).goBack).toEqual(["Cmd+Left"]);
    expect(removeShortcut(bindings, "goBack", 1).goBack).toEqual(["Cmd+["]);
  });

  it("resets a command to its defaults, taking them back from a command given one since", () => {
    const reassigned = assignShortcut(bindings, "newFolder", 1, "Cmd+D");
    const result = resetShortcut(reassigned, "duplicateSelection");

    expect(result.takenFrom).toEqual(["newFolder"]);
    expect(result.bindings).toEqual(DEFAULT_SHORTCUT_BINDINGS);
    expect(resetShortcut(bindings, "goBack")).toEqual({ bindings, takenFrom: [] });
  });
});

describe("shortcuts in the application menu", () => {
  it("gives the menu the first key that has ⌘ or ⌃", () => {
    expect(getMenuShortcut(["Cmd+[", "Cmd+Left"])).toBe("Cmd+[");
    expect(getMenuShortcut(["Space", "Cmd+Y"])).toBe("Cmd+Y");
    expect(getMenuShortcut(["F2"])).toBeUndefined();
    expect(getMenuShortcut(["?"])).toBeUndefined();
    expect(getMenuShortcut([])).toBeUndefined();
  });

  it("writes a shortcut the way Electron's menus do", () => {
    expect(toMenuAccelerator("Cmd+Option+T")).toBe("Command+Alt+T");
    expect(toMenuAccelerator("Ctrl+Shift+Tab")).toBe("Control+Shift+Tab");
    expect(toMenuAccelerator("Cmd+Plus")).toBe("Command+Plus");
    expect(toMenuAccelerator("Cmd+Esc")).toBe("Command+Escape");
    expect(toMenuAccelerator("Cmd+Backspace")).toBe("Command+Backspace");
    expect(toMenuAccelerator("?")).toBeUndefined();
    expect(toMenuAccelerator("nonsense")).toBeUndefined();
  });

  it("knows the keys a text field uses for itself", () => {
    for (const shortcut of ["Cmd+Up", "Cmd+Backspace", "Option+Left", "Ctrl+A", "Delete"]) {
      expect(isTextEditingShortcut(shortcut), shortcut).toBe(true);
    }
    for (const shortcut of ["Cmd+D", "Cmd+[", "Ctrl+Cmd+A", "F2"]) {
      expect(isTextEditingShortcut(shortcut), shortcut).toBe(false);
    }
  });
});
