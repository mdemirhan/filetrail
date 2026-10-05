import { type ShortcutCommandId, isShortcutCommandId } from "../../shared/shortcuts";
import { DEFAULT_SHORTCUT_DISPLAY, type ShortcutDisplay } from "./shortcutDisplay";

// Help content is static data so wording can be tuned without touching the view. Text in
// `backticks` is shown as code, and `{newTab}` as the key that command has now. Every
// pattern example was checked against the bundled fd.

export type HelpTopicId = "navigation" | "files" | "search" | "views" | "shortcuts";
/** The topics a shortcut can belong to (everything except the shortcut list itself). */
export type HelpShortcutGroup = Exclude<HelpTopicId, "shortcuts">;

export type HelpRow = {
  label: string;
  /** Show the label as code (a search pattern). */
  code?: boolean;
  description: string;
};

export type HelpSection = {
  title: string;
  rows: readonly HelpRow[];
  /** A short remark under the rows, for the mistake people make most. */
  note?: string;
};

export type HelpTopic = {
  id: HelpTopicId;
  title: string;
  intro: string;
  sections: readonly HelpSection[];
};

// A row of the shortcut list. One that names a command shows the key the command has now
// (Settings → Shortcuts) and is left out while the command has none; the others are keys
// that are always the same.
export type ShortcutItem = {
  group: HelpShortcutGroup;
  description: string;
} & (
  | {
      /** Written as "Cmd+Shift+G"; shown as keycaps. */
      shortcut: string;
    }
  | { command: ShortcutCommandId }
);

/** A row as it is shown: the key, and what it does. */
export type ShownShortcut = {
  group: HelpShortcutGroup;
  shortcut: string;
  description: string;
};

export const SHORTCUT_ITEMS: readonly ShortcutItem[] = [
  { group: "navigation", command: "goBack", description: "Go back" },
  { group: "navigation", command: "goForward", description: "Go forward" },
  { group: "navigation", command: "goEnclosingFolder", description: "Open the enclosing folder" },
  {
    group: "navigation",
    command: "openSelectedItem",
    description: "Open the selected item, or expand or collapse the folder in the tree",
  },
  {
    group: "navigation",
    command: "openLocationSheet",
    description: "Go to a folder by name or path",
  },
  {
    group: "navigation",
    command: "goHomeRootTree",
    description: "Go Home and root the folder tree there",
  },
  {
    group: "navigation",
    command: "rootTreeAtSelection",
    description: "Root the folder tree at the selected folder",
  },
  { group: "navigation", command: "newTab", description: "New tab, on the same folder" },
  {
    group: "navigation",
    command: "openSelectionInNewTab",
    description: "Open the selected folder in a new tab",
  },
  {
    group: "navigation",
    command: "closeTab",
    description: "Close the tab (the window, when it has a single view)",
  },
  { group: "navigation", command: "selectNextTab", description: "Next tab" },
  { group: "navigation", command: "selectPreviousTab", description: "Previous tab" },
  { group: "navigation", command: "reopenClosedTab", description: "Reopen the tab closed last" },
  { group: "navigation", command: "closeWindow", description: "Close the window" },
  { group: "navigation", command: "focusTreePane", description: "Focus the folder tree" },
  { group: "navigation", command: "focusContentPane", description: "Focus the file list" },
  {
    group: "navigation",
    shortcut: "Tab",
    description: "Switch between the tree and the list",
  },
  {
    group: "navigation",
    shortcut: "Shift+Down",
    description: "Extend the selection (Shift+Up, the other way)",
  },
  { group: "navigation", shortcut: "Home", description: "Select the first item (End, the last)" },
  { group: "navigation", command: "pageUp", description: "Scroll one page up" },
  { group: "navigation", command: "pageDown", description: "Scroll one page down" },
  {
    group: "navigation",
    command: "refreshOrApplySearchSort",
    description: "Refresh the current folder",
  },

  { group: "files", command: "openSelection", description: "Open" },
  { group: "files", command: "editSelection", description: "Edit in your text editor" },
  { group: "files", command: "quickLookSelection", description: "Quick Look" },
  { group: "files", command: "renameSelection", description: "Rename" },
  {
    group: "files",
    command: "undo",
    description: "Undo the last file operation (in a text field, its typing)",
  },
  { group: "files", command: "redo", description: "Redo what was undone" },
  { group: "files", command: "copy", description: "Copy" },
  { group: "files", command: "cut", description: "Cut" },
  { group: "files", command: "paste", description: "Paste" },
  { group: "files", command: "duplicateSelection", description: "Duplicate" },
  { group: "files", command: "moveSelection", description: "Move to another folder" },
  { group: "files", command: "newFolder", description: "New folder" },
  { group: "files", command: "trashSelection", description: "Move to Trash" },
  { group: "files", command: "emptyTrash", description: "Empty the Trash (asks first)" },
  { group: "files", command: "selectAll", description: "Select all" },
  { group: "files", command: "copyPath", description: "Copy the path" },
  { group: "files", command: "showClipboard", description: "See what is waiting to be pasted" },
  { group: "files", command: "clearClipboard", description: "Empty the clipboard" },
  { group: "files", command: "openInTerminal", description: "Open in Terminal" },
  { group: "files", command: "showInFinder", description: "Show in Finder" },
  { group: "files", command: "toggleFavorite", description: "Add to or remove from Favorites" },
  { group: "files", shortcut: "Esc", description: "Cancel a dialog (Cmd+. also works)" },

  { group: "search", command: "focusFileSearch", description: "Find files" },
  {
    group: "search",
    shortcut: "Down",
    description: "Move from the search field into the results (Return also works)",
  },
  {
    group: "search",
    command: "showLastSearchResults",
    description: "Show the last results again",
  },
  { group: "search", command: "refreshOrApplySearchSort", description: "Run the search again" },
  { group: "search", shortcut: "Esc", description: "Close the results" },

  { group: "views", command: "toggleFolderTree", description: "Show or hide the folder tree" },
  { group: "views", command: "toggleInfoPanel", description: "Show or hide the Info panel" },
  { group: "views", command: "toggleInfoRow", description: "Show or hide the Info row" },
  { group: "views", command: "toggleHiddenFiles", description: "Show or hide hidden files" },
  { group: "views", command: "viewAsIcons", description: "View as icons" },
  { group: "views", command: "viewAsDetails", description: "View as a list, with columns" },
  { group: "views", command: "viewAsList", description: "View as a compact list of names" },
  { group: "views", command: "sortByName", description: "Sort by name" },
  { group: "views", command: "sortByKind", description: "Sort by kind" },
  { group: "views", command: "sortByModified", description: "Sort by date modified" },
  { group: "views", command: "sortBySize", description: "Sort by size" },
  { group: "views", command: "toggleFoldersFirst", description: "Keep folders first, or not" },
  { group: "views", command: "zoomIn", description: "Zoom in" },
  { group: "views", command: "zoomOut", description: "Zoom out" },
  { group: "views", command: "resetZoom", description: "Actual size" },
  { group: "views", command: "fullScreen", description: "Enter or leave full screen" },
  { group: "views", command: "minimize", description: "Minimize the window" },
  { group: "views", command: "hide", description: "Hide File Trail" },
  { group: "views", command: "settings", description: "Settings" },
  { group: "views", command: "openHelp", description: "Help" },
  { group: "views", command: "openKeyboardShortcuts", description: "Keyboard shortcuts" },
  { group: "views", shortcut: "Esc", description: "Return from Help" },
];

// The shortcut list as it is shown: every row with the key it has now. A command's other
// key is mentioned after what it does ("Go back (Cmd+Left also works)").
export function listShortcuts(
  shortcuts: ShortcutDisplay = DEFAULT_SHORTCUT_DISPLAY,
): ShownShortcut[] {
  return SHORTCUT_ITEMS.flatMap((item) => {
    if ("shortcut" in item) {
      return [item];
    }
    const shortcut = shortcuts.written(item.command);
    if (!shortcut) {
      return [];
    }
    const alternate = shortcuts.alternate(item.command);
    return [
      {
        group: item.group,
        shortcut,
        description: alternate
          ? `${item.description} (${writeForReading(alternate)} also works)`
          : item.description,
      },
    ];
  });
}

// "Cmd+Plus" reads as "Cmd++".
function writeForReading(shortcut: string): string {
  return shortcut.endsWith("+Plus") ? `${shortcut.slice(0, -4)}+` : shortcut;
}

// Help's sentences name a command's key as `{newTab}`. It is replaced by the key the
// command has now, or by where the command is in the menus when it has none.
export function fillShortcutMentions(
  text: string,
  shortcuts: ShortcutDisplay = DEFAULT_SHORTCUT_DISPLAY,
): string {
  return text.replace(/\{(\w+)\}/g, (match, id: string) =>
    isShortcutCommandId(id) ? shortcuts.mention(id) : match,
  );
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "navigation",
    title: "Getting around",
    intro:
      "Move between folders with the folder tree, the file list, and the path bar under the list.",
    sections: [
      {
        title: "Folders",
        rows: [
          {
            label: "Folder tree",
            description:
              "Click a favorite or a folder to open it. The arrow beside a folder shows its subfolders without leaving the folder you are in.",
          },
          {
            label: "File list",
            description:
              "Double-click a folder to open it. Back and Forward retrace your steps; hold either button, or right-click it, to pick from the folders it leads to.",
          },
          {
            label: "Go to Folder",
            description:
              "{openLocationSheet} finds a folder you have opened before, or a favorite, from a few letters of its name; the folders you use most come first. Start with `/` or `~` to type a path instead, and Tab completes it. ⌘⌫ removes the selected folder from the list.",
          },
          {
            label: "Favorites",
            description:
              "Right-click a folder and choose Add to Favorites to pin it in the folder tree. File > Add to Favorites does the same for the selected folder, or for the folder you are in when nothing is selected.",
          },
          {
            label: "Tree root",
            description:
              "Use as Tree Root makes a folder the top of the folder tree, until you open a folder outside it. Go > Home returns the tree to your home folder.",
          },
        ],
      },
      {
        title: "Tabs",
        rows: [
          {
            label: "New tab",
            description:
              "{newTab} opens a tab on the folder you are in. The row of tabs appears with the second tab; with a single view the window looks as it always did.",
          },
          {
            label: "Open in New Tab",
            description:
              "Right-click a folder, or ⌘-double-click it. ⌘-click works on a folder in the folder tree or the path bar, and File > Open in New Tab on the selected folder.",
          },
          {
            label: "Each tab",
            description:
              "Keeps its own folder, history, folder tree, selection, view, sort order, hidden files, Folders First and search. A new tab starts with these from the tab it was opened from. A search keeps running while its tab is in the background.",
          },
          {
            label: "Moving between tabs",
            description:
              "Click a tab, or use {selectNextTab} and {selectPreviousTab}. Drag a tab to move it along the row.",
          },
          {
            label: "Closing",
            description:
              "{closeTab} closes the tab, and the window when a single view is left. {reopenClosedTab} brings back the tab closed last. Right-click a tab for Close Other Tabs and Duplicate Tab.",
          },
          {
            label: "Between tabs",
            description:
              "Copy or cut in one tab and paste in another; the clipboard button in the toolbar shows what is waiting to be pasted. Drag items onto a tab to move them into its folder, or hold them over the tab to bring it to the front.",
          },
          {
            label: "Next launch",
            description:
              "File Trail reopens the tabs you had, each in its own folder. Settings → General → Reopen the last folder and tabs turns that off: it then opens one tab in your home folder.",
          },
        ],
        note: "Only one copy, move or delete runs at a time, whichever tab it was started from. While it runs, the other tabs can browse, search, copy and cut.",
      },
      {
        title: "Path bar",
        rows: [
          { label: "Click a folder", description: "Jumps straight to that folder." },
          {
            label: "Click a ›",
            description:
              "Lists the folders at that level, with the one on your path ticked, so a neighbouring folder is one click away.",
          },
          {
            label: "Double-click the bar",
            description:
              "Edit the path as text. Suggestions come from the folder you are typing in, and Esc cancels.",
          },
        ],
      },
      {
        title: "Keyboard",
        rows: [
          {
            label: "Arrow keys",
            description: "Move the selection. In the tree, left and right collapse and expand.",
          },
          {
            label: "Type in the list",
            description:
              "Narrows the folder to the names containing what you type and selects the best match. Backspace takes a character back; Esc shows everything again and keeps the selection. {focusFileSearch} looks for the same text in the subfolders.",
          },
          {
            label: "Type in the folder tree",
            description: "Jumps to the first folder that starts with what you type.",
          },
        ],
      },
    ],
  },
  {
    id: "files",
    title: "Working with files",
    intro:
      "Select items in the list, then use the keyboard, the File and Edit menus, or right-click for the full set of actions.",
    sections: [
      {
        title: "Opening",
        rows: [
          {
            label: "Double-click a file",
            description:
              "Opens it, or edits it in your text editor: your choice in Settings → Files.",
          },
          {
            label: "Open With",
            description: "Right-click a file to pick another app. Settings → Files sets the list.",
          },
          {
            label: "Quick Look",
            description: "{quickLookSelection} previews the selected item without opening it.",
          },
          {
            label: "Open in Terminal",
            description:
              "Opens a Terminal window in the folder. Settings → Files chooses the terminal app.",
          },
        ],
      },
      {
        title: "Copying and moving",
        rows: [
          {
            label: "Copy, cut, paste",
            description:
              "Paste and New Folder go into the folder you are browsing, whatever is selected. To paste into another folder, or make a folder inside it, right-click that folder.",
          },
          {
            label: "From the folder tree",
            description:
              "With the folder tree active, Copy and Cut take the folder the tree is on, with everything in it, and never what is selected in the list.",
          },
          {
            label: "What was copied",
            description:
              "Copied and cut items flash, and keep a copy or cut icon after their name until they are pasted or the clipboard changes. A button with their count appears in the toolbar: click it to list them, show one in its folder, take one off, or choose Clear Clipboard. Settings → General → Copy and Cut turns the marks off.",
          },
          {
            label: "Drag",
            description:
              "Drag items onto a folder to move them there. Dragged to another disk (a USB drive, a network share) they are copied instead, as in Finder. Hold Option to copy, or Command to move.",
          },
          {
            label: "Same name",
            description:
              "If an item already exists, you choose: Skip, Keep Both or Replace, and for a folder being copied, Add Missing, which copies only what the folder there lacks. Replaced items go to the Trash.",
          },
        ],
      },
      {
        title: "Changing",
        rows: [
          {
            label: "Rename",
            description:
              "{renameSelection} renames the selected item. With several selected it opens the Rename sheet: replace or add text, number or date them, or change their case, with every new name shown before anything is renamed, and settings saved as presets. Settings → Files chooses whether Return renames or opens.",
          },
          {
            label: "Move to Trash",
            description:
              "{undo} puts what you just moved to the Trash back. Items can also be put back from the Trash in Finder.",
          },
          {
            label: "Undo",
            description:
              "{undo} undoes the last file operation and {redo} does it again, one at a time, back to when File Trail opened: renames, moves on the same disk, Move to Trash, New Folder, copies and duplicates (which go to the Trash), and Replace. Each item is checked first: one that has changed place since is left as it is, and listed. Merging folders, moving to another disk, Delete Immediately and Empty Trash can't be undone. While you type a name or a search, {undo} undoes the typing.",
          },
        ],
      },
    ],
  },
  {
    id: "search",
    title: "Searching",
    intro:
      "Search looks for files and folders in the folder you are browsing, as you type in the search field. Return or ↓ moves into the results and Esc shows the folder again. The magnifier in the field opens the options.",
    sections: [
      {
        title: "Plain Text",
        rows: [
          { label: "draft", code: true, description: "Names containing “draft”" },
          {
            label: "report (1).pdf",
            code: true,
            description: "Found exactly as typed: brackets, dots and `+` have no special meaning",
          },
        ],
        note: "Plain text is how a new search matches. Choose Glob or Regex under Match As in the options to search with a pattern instead.",
      },
      {
        title: "Glob patterns",
        rows: [
          { label: "*.pdf", code: true, description: "Names ending in .pdf" },
          { label: "report*", code: true, description: "Names starting with “report”" },
          { label: "*draft*", code: true, description: "Names containing “draft”" },
          {
            label: "photo-??.jpg",
            code: true,
            description: "Each `?` is exactly one character: photo-01.jpg, not photo-123.jpg",
          },
          { label: "*.{jpg,png,gif}", code: true, description: "Any of several endings" },
          {
            label: "[a-c]*.txt",
            code: true,
            description: "Starts with a, b or c. `[!a-c]` means any other character.",
          },
        ],
        note: "A glob must match the whole name: `report` only finds a file called exactly “report”, so add `*` where more text may follow.",
      },
      {
        title: "Regex patterns",
        rows: [
          { label: "draft", code: true, description: "Names containing “draft”" },
          { label: "^report", code: true, description: "Names starting with “report”" },
          { label: "\\.pdf$", code: true, description: "Names ending in .pdf" },
          { label: "\\.(jpg|png)$", code: true, description: "Names ending in .jpg or .png" },
          {
            label: "^photo-\\d{2}\\.jpg$",
            code: true,
            description: "“photo-”, two digits, “.jpg”",
          },
        ],
        note: "A regex matches anywhere in the name unless you anchor it with `^` (start) or `$` (end).",
      },
      {
        title: "Upper and lower case",
        rows: [
          {
            label: "report",
            code: true,
            description: "All lowercase ignores case: finds report.pdf and Report-final.pdf",
          },
          {
            label: "Report",
            code: true,
            description: "A capital letter makes the search case-sensitive: only Report-final.pdf",
          },
        ],
      },
      {
        title: "Matching the full path",
        rows: [
          {
            label: "**/src/**/*.ts",
            code: true,
            description: "Glob: .ts files anywhere under a folder named “src”",
          },
          {
            label: "**/docs/*",
            code: true,
            description: "Glob: items directly inside any folder named “docs”",
          },
          {
            label: "/src/.*\\.ts$",
            code: true,
            description: "Regex: the same .ts files under “src”",
          },
        ],
        note: "With Match set to Full Path, the pattern is compared with the whole path from the top of the disk, including the folders above the one you search. Start a glob with `**/`. For names alone, use Match: Name.",
      },
      {
        title: "Options",
        rows: [
          {
            label: "Search Subfolders",
            description: "Also look in the folders below the current one.",
          },
          {
            label: "Hidden files",
            description:
              "Found whenever the file list shows them. Showing or hiding them ({toggleHiddenFiles}) with results on screen searches again.",
          },
          {
            label: "Skip .git Folders",
            description: "Keeps Git’s internal files out of the results.",
          },
          {
            label: "Skip Files Ignored by Git",
            description:
              "Inside a Git repository, leaves out what `.gitignore` excludes, such as build output.",
          },
          {
            label: "Defaults",
            description:
              "Options you change in the search field last until you quit. Settings → Search sets what each launch starts with.",
          },
        ],
      },
      {
        title: "Results",
        rows: [
          {
            label: "Search elsewhere",
            description:
              "The bar above the results switches between this folder, Home and the whole disk.",
          },
          {
            label: "Filter",
            description:
              "The Filter field narrows what was found, by name or by the folder a result is in, without searching again. Typing in the results goes to the same filter, and Esc clears it.",
          },
          {
            label: "Keep typing",
            description:
              "Making plain text longer narrows the results at once. Other changes are searched for when you stop typing.",
          },
          {
            label: "Open",
            description:
              "Opening a folder in the results goes into it and closes the search. {showLastSearchResults} brings the results back.",
          },
          {
            label: "Limits",
            description: "Search stops at 20,000 results. Aliases are not searched for.",
          },
        ],
      },
    ],
  },
  {
    id: "views",
    title: "Views and panels",
    intro: "Choose how the list looks and what information sits beside it.",
    sections: [
      {
        title: "The list",
        rows: [
          {
            label: "Icons, List and Compact List",
            description:
              "The three buttons in the toolbar, the View menu, or {viewAsIcons}, {viewAsDetails} and {viewAsList} switch between large icons with previews of photos, PDFs and other files, a list with columns for date, size and kind, and a compact list of names. Settings → Browsing chooses the columns, and the density of every view.",
          },
          {
            label: "Sort",
            description:
              "The sort button, View > Sort By, or a click on a column heading in List view orders by name, kind, date or size. Choosing the same order again reverses it.",
          },
          {
            label: "Hidden files",
            description:
              "Files whose names start with a dot. {toggleHiddenFiles} shows them in the tab on screen; search follows this setting too.",
          },
          {
            label: "Dates",
            description:
              "Recent dates read the way you would say them: “24 min ago”, “Today, 9:12 AM”, “Yesterday, 6:03 PM”, “Mon, 4:05 PM”. Earlier this year the year is left out; before that, the time. Rest the pointer on a date for the full date and time.",
          },
          {
            label: "Permissions",
            description:
              "The Permissions column shows the numeric code, such as `644`. Rest the pointer on it for the letters (`rw-r--r--`).",
          },
        ],
      },
      {
        title: "Information",
        rows: [
          {
            label: "Info panel",
            description:
              "Details of the selected item at the right: kind, size, dates, permissions and quick actions.",
          },
          { label: "Info row", description: "The same essentials in a strip under the list." },
          {
            label: "Folder sizes",
            description:
              "Folders show no size until you ask: click Calculate in the Info panel, or choose Calculate Size from the right-click menu. Right-click empty space to size the folder on screen. With several items selected it sizes the folders among them. The path bar's right end shows the size of the selection, or of the folder on screen when nothing is selected, once every size in it is known. Sizing a folder also sizes every folder inside it.",
          },
          {
            label: "What takes the space",
            description:
              "Sort List view by Size: each size gets a bar showing its share of the largest item, so the big ones stand out. Folders get a bar once their size is known.",
          },
        ],
      },
      {
        title: "Appearance",
        rows: [
          {
            label: "Zoom",
            description: "{zoomIn} and {zoomOut} make everything larger or smaller, text included.",
          },
          {
            label: "Full screen",
            description: "⌃⌘F, or the green button of the window. The same key leaves it.",
          },
          {
            label: "Light, Dark, accent",
            description:
              "Settings → General → Appearance. Auto follows macOS. Help follows them too.",
          },
          {
            label: "Toolbar",
            description:
              "View > Customize Toolbar…, or right-click the toolbar. Drag items in from the panel, along the toolbar to move them, or out of it to remove them; a click adds an item at the far right. Done or Escape when finished.",
          },
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    intro:
      "Every shortcut, grouped by what it is for. The menus show them beside each command, and Settings → Shortcuts changes them.",
    sections: [],
  },
];

export const HELP_SHORTCUT_GROUPS: readonly HelpShortcutGroup[] = [
  "navigation",
  "files",
  "search",
  "views",
];

export function getHelpTopic(id: HelpTopicId): HelpTopic {
  const topic = HELP_TOPICS.find((candidate) => candidate.id === id);
  if (!topic) {
    throw new Error(`Unknown help topic: ${id}`);
  }
  return topic;
}

// What the "Search help" field looks through: every row and every shortcut, by the words
// on screen (and the shortcut as written, so "cmd+f" finds Find files).
export type HelpSearchResult = {
  topic: HelpTopic;
  rows: Array<{ section: string; row: HelpRow }>;
  shortcuts: ShownShortcut[];
};

export function searchHelp(
  query: string,
  shortcuts: ShortcutDisplay = DEFAULT_SHORTCUT_DISPLAY,
): HelpSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const matches = (...texts: string[]) => texts.some((text) => text.toLowerCase().includes(needle));
  const shownShortcuts = listShortcuts(shortcuts);
  return HELP_TOPICS.filter((topic) => topic.id !== "shortcuts")
    .map((topic) => ({
      topic,
      rows: topic.sections.flatMap((section) =>
        section.rows
          .filter((row) =>
            matches(row.label, fillShortcutMentions(row.description, shortcuts), section.title),
          )
          .map((row) => ({ section: section.title, row })),
      ),
      shortcuts: shownShortcuts.filter(
        (item) =>
          item.group === topic.id && matches(item.description, writeForReading(item.shortcut)),
      ),
    }))
    .filter((result) => result.rows.length > 0 || result.shortcuts.length > 0);
}
