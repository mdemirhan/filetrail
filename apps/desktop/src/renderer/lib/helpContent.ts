// Help content is static data so wording can be tuned without touching the view. Text in
// `backticks` is shown as code. Every pattern example was checked against the bundled fd.

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

export type ShortcutItem = {
  group: HelpShortcutGroup;
  /** Written as "Cmd+Shift+G"; shown as keycaps. */
  shortcut: string;
  description: string;
};

export const SHORTCUT_ITEMS: readonly ShortcutItem[] = [
  { group: "navigation", shortcut: "Cmd+[", description: "Go back" },
  { group: "navigation", shortcut: "Cmd+]", description: "Go forward" },
  { group: "navigation", shortcut: "Cmd+Up", description: "Open the parent folder" },
  {
    group: "navigation",
    shortcut: "Cmd+Down",
    description: "Open the selected item, or expand the folder in the tree",
  },
  { group: "navigation", shortcut: "Cmd+Shift+G", description: "Go to Folder" },
  { group: "navigation", shortcut: "Cmd+1", description: "Focus the folder tree" },
  { group: "navigation", shortcut: "Cmd+2", description: "Focus the file list" },
  {
    group: "navigation",
    shortcut: "Tab",
    description: "Switch between the tree and the list (when enabled in Settings)",
  },
  { group: "navigation", shortcut: "Ctrl+U", description: "Scroll one page up" },
  { group: "navigation", shortcut: "Ctrl+D", description: "Scroll one page down" },
  { group: "navigation", shortcut: "Cmd+R", description: "Refresh the current folder" },

  { group: "files", shortcut: "Cmd+O", description: "Open" },
  { group: "files", shortcut: "Cmd+E", description: "Edit in your text editor" },
  { group: "files", shortcut: "Space", description: "Quick Look" },
  { group: "files", shortcut: "Return", description: "Rename (F2 also works)" },
  { group: "files", shortcut: "Cmd+C", description: "Copy" },
  { group: "files", shortcut: "Cmd+X", description: "Cut" },
  { group: "files", shortcut: "Cmd+V", description: "Paste" },
  { group: "files", shortcut: "Cmd+D", description: "Duplicate" },
  { group: "files", shortcut: "Cmd+Shift+M", description: "Move to another folder" },
  { group: "files", shortcut: "Cmd+Shift+N", description: "New folder" },
  { group: "files", shortcut: "Cmd+Backspace", description: "Move to Trash" },
  { group: "files", shortcut: "Cmd+A", description: "Select all" },
  { group: "files", shortcut: "Cmd+Option+C", description: "Copy the path" },
  { group: "files", shortcut: "Cmd+T", description: "Open in Terminal" },

  { group: "search", shortcut: "Cmd+F", description: "Find files" },
  { group: "search", shortcut: "Cmd+Shift+F", description: "Show the last results again" },
  { group: "search", shortcut: "Cmd+R", description: "Run the search again" },
  { group: "search", shortcut: "Esc", description: "Close the results" },

  { group: "views", shortcut: "Cmd+I", description: "Show or hide the Info panel" },
  { group: "views", shortcut: "Cmd+Shift+I", description: "Show or hide the Info row" },
  { group: "views", shortcut: "Cmd+Shift+.", description: "Show or hide hidden files" },
  { group: "views", shortcut: "Cmd++", description: "Zoom in" },
  { group: "views", shortcut: "Cmd+-", description: "Zoom out" },
  { group: "views", shortcut: "Cmd+0", description: "Actual size" },
  { group: "views", shortcut: "Cmd+,", description: "Settings" },
  { group: "views", shortcut: "?", description: "Help" },
  { group: "views", shortcut: "Esc", description: "Return from Help or the Action Log" },
];

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: "navigation",
    title: "Getting around",
    intro: "Move between folders with the sidebar, the file list, and the path bar under the list.",
    sections: [
      {
        title: "Folders",
        rows: [
          {
            label: "Sidebar",
            description:
              "Click a favorite or a folder to open it. The arrow beside a folder shows its subfolders without leaving the folder you are in.",
          },
          {
            label: "File list",
            description: "Double-click a folder to open it. Back and forward retrace your steps.",
          },
          {
            label: "Go to Folder",
            description:
              "Type or paste a path, with suggestions as you type. `~` stands for your home folder.",
          },
          {
            label: "Favorites",
            description:
              "Right-click a folder and choose Add to Favorites to pin it in the sidebar.",
          },
        ],
      },
      {
        title: "Path bar",
        rows: [
          { label: "Click a folder", description: "Jumps straight to that folder." },
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
            label: "Type a name",
            description:
              "Jumps to the first item that starts with what you type (Settings → General).",
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
          { label: "Quick Look", description: "Press Space to preview without opening." },
        ],
      },
      {
        title: "Copying and moving",
        rows: [
          {
            label: "Copy, cut, paste",
            description:
              "Paste goes into the folder you are browsing. With exactly one folder selected in the list, it goes into that folder.",
          },
          { label: "Drag", description: "Drag items onto a folder to move them there." },
          {
            label: "Same name",
            description:
              "If an item already exists, you choose: Replace, Keep both, Merge (for folders) or Skip. Replaced items go to the Trash.",
          },
          {
            label: "Action Log",
            description:
              "A record of what was copied, moved and deleted, in the View menu (Settings → General turns it on).",
          },
        ],
      },
      {
        title: "Changing",
        rows: [
          {
            label: "Rename",
            description:
              "Press Return or F2. Settings → Files can make Return open the item instead.",
          },
          {
            label: "Move to Trash",
            description: "Items can be put back from the Trash in Finder.",
          },
        ],
      },
    ],
  },
  {
    id: "search",
    title: "Searching",
    intro:
      "Search looks for files in the folder you are browsing. Type in the search field and press Return. The magnifier in the field opens the options.",
    sections: [
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
            description: "Glob: files directly inside any folder named “docs”",
          },
          {
            label: "/src/.*\\.ts$",
            code: true,
            description: "Regex: the same .ts files under “src”",
          },
        ],
        note: "With Match set to Full path, the pattern is compared with the whole path from the top of the disk, including the folders above the one you search. Start a glob with `**/`. For file names alone, use Match: Name.",
      },
      {
        title: "Options",
        rows: [
          {
            label: "Search subfolders",
            description: "Also look in the folders below the current one.",
          },
          {
            label: "Hidden files",
            description:
              "Found whenever the file list shows them. Pressing ⇧⌘. with results on screen searches again.",
          },
          {
            label: "Skip .git folders",
            description: "Keeps Git’s internal files out of the results.",
          },
          {
            label: "Skip files ignored by Git",
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
            description: "Narrows the results you already have, by name or by path.",
          },
          {
            label: "Limits",
            description: "Search finds files, not folders, and stops at 20,000 results.",
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
            label: "List and Details",
            description:
              "The two buttons in the toolbar switch between a compact list and columns with size, date and permissions.",
          },
          {
            label: "Sort",
            description:
              "The sort button orders by name, kind, date or size. Choosing the same order again reverses it.",
          },
          {
            label: "Hidden files",
            description: "Files whose names start with a dot. Search follows this setting too.",
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
              "Folders show no size until you ask: click Calculate in the Info panel, or right-click and choose Calculate Size.",
          },
        ],
      },
      {
        title: "Appearance",
        rows: [
          { label: "Zoom", description: "Makes everything larger or smaller, text included." },
          {
            label: "Theme, accent, font",
            description: "Settings → Appearance. Help and the Action Log follow them too.",
          },
        ],
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    intro: "Every shortcut, grouped by what it is for.",
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
  shortcuts: ShortcutItem[];
};

export function searchHelp(query: string): HelpSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const matches = (...texts: string[]) => texts.some((text) => text.toLowerCase().includes(needle));
  return HELP_TOPICS.filter((topic) => topic.id !== "shortcuts")
    .map((topic) => ({
      topic,
      rows: topic.sections.flatMap((section) =>
        section.rows
          .filter((row) => matches(row.label, row.description, section.title))
          .map((row) => ({ section: section.title, row })),
      ),
      shortcuts: SHORTCUT_ITEMS.filter(
        (item) => item.group === topic.id && matches(item.description, item.shortcut),
      ),
    }))
    .filter((result) => result.rows.length > 0 || result.shortcuts.length > 0);
}
