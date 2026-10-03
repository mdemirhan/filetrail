import type { MenuItemConstructorOptions } from "electron";

import { createApplicationMenuTemplate } from "../../main/appMenu";
import { isShortcutCommandId, resolveShortcuts, toMenuAccelerator } from "../../shared/shortcuts";
import {
  HELP_SHORTCUT_GROUPS,
  HELP_TOPICS,
  fillShortcutMentions,
  listShortcuts,
  searchHelp,
} from "./helpContent";
import { createShortcutDisplay } from "./shortcutDisplay";

describe("helpContent", () => {
  it("gives every topic a title, an introduction and uniquely named sections and rows", () => {
    expect(HELP_TOPICS.map((topic) => topic.id)).toEqual([
      "navigation",
      "files",
      "search",
      "views",
      "shortcuts",
    ]);
    for (const topic of HELP_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.intro.length).toBeGreaterThan(0);
      const sectionTitles = topic.sections.map((section) => section.title);
      expect(new Set(sectionTitles).size).toBe(sectionTitles.length);
      for (const section of topic.sections) {
        const labels = section.rows.map((row) => row.label);
        expect(new Set(labels).size).toBe(labels.length);
        // Backticks come in pairs, or the rest of a sentence would turn into code.
        for (const text of [section.note ?? "", ...section.rows.map((row) => row.description)]) {
          expect(text.split("`").length % 2).toBe(1);
        }
      }
    }
  });

  it("lists shortcuts for each topic without repeating one within a topic", () => {
    const shown = listShortcuts();
    for (const group of HELP_SHORTCUT_GROUPS) {
      const rows = shown
        .filter((item) => item.group === group)
        .map((item) => `${item.shortcut} ${item.description}`);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows).size).toBe(rows.length);
    }
    // A command without a key has no row, and a second key is mentioned after the first.
    expect(shown.map((item) => item.description)).not.toContain("Show in Finder");
    expect(shown.find((item) => item.shortcut === "Cmd+[")?.description).toBe(
      "Go back (Cmd+Left also works)",
    );
    expect(shown.find((item) => item.description.startsWith("Rename"))).toEqual({
      group: "files",
      shortcut: "Return",
      description: "Rename (F2 also works)",
    });
  });

  it("documents every keyboard shortcut in the application menu", () => {
    // The same shortcut is written "Command+Alt+T" in the menu and "Cmd+Option+T" in Help.
    const collect = (items: MenuItemConstructorOptions[]): string[] =>
      items.flatMap((item) => [
        ...(typeof item.accelerator === "string" ? [item.accelerator] : []),
        ...(Array.isArray(item.submenu) ? collect(item.submenu) : []),
      ]);
    const accelerators = collect(createApplicationMenuTemplate({ send: () => undefined }));
    const documented = new Set(listShortcuts().map((item) => toMenuAccelerator(item.shortcut)));
    expect(accelerators.length).toBeGreaterThan(10);
    for (const accelerator of accelerators) {
      expect(documented.has(accelerator), `menu shortcut ${accelerator} is missing from Help`).toBe(
        true,
      );
    }
  });

  it("follows the keys chosen in Settings, in the list and in the sentences", () => {
    const shortcuts = createShortcutDisplay(
      resolveShortcuts({
        newTab: [],
        goBack: ["Cmd+Option+Left"],
        showInFinder: ["Cmd+Shift+J"],
        zoomIn: ["Cmd+=", "Cmd+Plus"],
      }),
    );
    const shown = listShortcuts(shortcuts);

    expect(shown.map((item) => item.description)).not.toContain("New tab, on the same folder");
    expect(shown.find((item) => item.description === "Go back")?.shortcut).toBe("Cmd+Option+Left");
    expect(shown.find((item) => item.description === "Show in Finder")?.shortcut).toBe(
      "Cmd+Shift+J",
    );
    expect(shown.find((item) => item.shortcut === "Cmd+=")?.description).toBe(
      "Zoom in (Cmd++ also works)",
    );
    // A sentence names the key, or the menu item when the command has no key.
    expect(fillShortcutMentions("{goBack} goes back; {newTab} opens a tab.", shortcuts)).toBe(
      "⌥⌘← goes back; File > New Tab opens a tab.",
    );
    // Braces that name no command are left as they are (search patterns use them).
    expect(fillShortcutMentions("*.{jpg,png} and \\d{2} and {nothing}")).toBe(
      "*.{jpg,png} and \\d{2} and {nothing}",
    );
    expect(searchHelp("cmd+shift+j", shortcuts)[0]?.shortcuts[0]?.description).toBe(
      "Show in Finder",
    );
  });

  it("names only commands that exist in its sentences", () => {
    const texts = HELP_TOPICS.flatMap((topic) => [
      topic.intro,
      ...topic.sections.flatMap((section) => [
        section.note ?? "",
        ...section.rows.map((row) => row.description),
      ]),
    ]);
    const mentions = texts.flatMap((text) => text.match(/\{\w+\}/g) ?? []);

    expect(mentions.length).toBeGreaterThan(8);
    for (const mention of mentions) {
      expect(isShortcutCommandId(mention.slice(1, -1)), mention).toBe(true);
    }
    // No sentence spells a changeable key out. ⌘⌫ in Go To, ⌃⌘F and ⌘-click are always
    // the same.
    for (const text of texts) {
      const changeable = text.replace(/⌘⌫|⌃⌘F|⌘-(double-)?click/g, "");
      expect(changeable, text).not.toMatch(/[⌘⌥⌃⇧]/u);
    }
  });

  it("covers the search patterns people get wrong", () => {
    const search = HELP_TOPICS.find((topic) => topic.id === "search");
    const patterns = search?.sections.flatMap((section) =>
      section.rows.filter((row) => row.code).map((row) => row.label),
    );
    expect(patterns).toEqual(
      expect.arrayContaining(["*.pdf", "report*", "*draft*", "*.{jpg,png,gif}", "**/src/**/*.ts"]),
    );
    const notes = search?.sections.map((section) => section.note ?? "").join(" ");
    expect(notes).toContain("must match the whole name");
    expect(notes).toContain("Start a glob with `**/`");
  });

  it("searches rows and shortcuts by their words and by the shortcut as written", () => {
    expect(searchHelp("   ")).toEqual([]);
    const trash = searchHelp("TRASH");
    expect(trash.map((result) => result.topic.id)).toEqual(["files"]);
    expect(trash[0]?.shortcuts.map((item) => item.shortcut)).toEqual([
      "Cmd+Backspace",
      "Cmd+Option+Backspace",
      "Cmd+Shift+Backspace",
    ]);
    expect(searchHelp("cmd+k")[0]?.shortcuts[0]?.description).toBe(
      "Go to a folder by name or path (Cmd+Shift+G also works)",
    );
    // A section title brings its rows along ("glob" is in "Glob patterns").
    expect(searchHelp("glob patterns")[0]?.rows.length).toBeGreaterThanOrEqual(6);
  });
});
