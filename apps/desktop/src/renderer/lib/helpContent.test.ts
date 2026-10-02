import type { MenuItemConstructorOptions } from "electron";

import { createApplicationMenuTemplate } from "../../main/appMenu";
import { HELP_SHORTCUT_GROUPS, HELP_TOPICS, SHORTCUT_ITEMS, searchHelp } from "./helpContent";

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
    for (const group of HELP_SHORTCUT_GROUPS) {
      const shortcuts = SHORTCUT_ITEMS.filter((item) => item.group === group).map(
        (item) => item.shortcut,
      );
      expect(shortcuts.length).toBeGreaterThan(0);
      expect(new Set(shortcuts).size).toBe(shortcuts.length);
    }
  });

  it("documents every keyboard shortcut in the application menu", () => {
    // The same shortcut is written "CommandOrControl+Plus" in the menu and "Cmd++" in Help.
    const canonical = (shortcut: string) =>
      (shortcut.endsWith("++") ? `${shortcut.slice(0, -2)}+Plus` : shortcut)
        .replace("CommandOrControl", "Cmd")
        .replace("Alt", "Option")
        .split("+")
        .sort()
        .join("+");
    const collect = (items: MenuItemConstructorOptions[]): string[] =>
      items.flatMap((item) => [
        ...(typeof item.accelerator === "string" ? [item.accelerator] : []),
        ...(Array.isArray(item.submenu) ? collect(item.submenu) : []),
      ]);
    const accelerators = collect(createApplicationMenuTemplate({ send: () => undefined }));
    const documented = new Set(SHORTCUT_ITEMS.map((item) => canonical(item.shortcut)));
    expect(accelerators.length).toBeGreaterThan(10);
    for (const accelerator of accelerators) {
      expect(
        documented.has(canonical(accelerator)),
        `menu shortcut ${accelerator} is missing from Help`,
      ).toBe(true);
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
    expect(trash[0]?.shortcuts.map((item) => item.shortcut)).toEqual(["Cmd+Backspace"]);
    expect(searchHelp("cmd+k")[0]?.shortcuts[0]?.description).toBe(
      "Go to a folder by name or path (Cmd+Shift+G also works)",
    );
    // A section title brings its rows along ("glob" is in "Glob patterns").
    expect(searchHelp("glob patterns")[0]?.rows.length).toBeGreaterThanOrEqual(6);
  });
});
