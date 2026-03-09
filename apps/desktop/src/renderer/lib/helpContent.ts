// Help content is intentionally maintained as static data so wording can be tuned without
// chasing implementation details through multiple components.
export const SHORTCUT_ITEMS = [
  { group: "Navigation", shortcut: "Cmd+Left", description: "Go back to the previous folder" },
  { group: "Navigation", shortcut: "Cmd+Right", description: "Go forward to the next folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+Up",
    description: "Open the parent folder",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Down",
    description:
      "Open the selected item from the file list, or expand the current folder in the tree",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+O",
    description: "Open the selected item or selection",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+E",
    description: "Edit the selected files with the configured text editor",
  },
  {
    group: "Navigation",
    shortcut: "Ctrl+U",
    description: "Scroll one page up in the focused tree or content view",
  },
  {
    group: "Navigation",
    shortcut: "Ctrl+D",
    description: "Scroll one page down in the focused tree or content view",
  },
  { group: "Navigation", shortcut: "Cmd+Shift+G", description: "Open Go to Folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+R",
    description: "Refresh the current folder when search results are not visible",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Option+C",
    description: "Copy the selected item path, or the current folder if nothing is selected",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Shift+.",
    description: "Toggle hidden files",
  },
  { group: "Search", shortcut: "Cmd+F", description: "Focus file search" },
  {
    group: "Search",
    shortcut: "Cmd+Shift+F",
    description: "Show cached search results without opening the search box",
  },
  {
    group: "Search",
    shortcut: "Cmd+R",
    description: "Apply the selected sort to the current search results",
  },
  {
    group: "Search",
    shortcut: "Esc",
    description: "Close visible search results and return to normal browsing",
  },
  {
    group: "Panels",
    shortcut: "Tab",
    description:
      "Move focus between the folder tree and file list when pane tab switching is enabled",
  },
  {
    group: "Panels",
    shortcut: "Shift+Tab",
    description:
      "Move focus back between the file list and folder tree when pane tab switching is enabled",
  },
  { group: "Panels", shortcut: "Cmd+I", description: "Toggle Info Panel" },
  { group: "Panels", shortcut: "Cmd+Shift+I", description: "Toggle Info Row" },
  { group: "Panels", shortcut: "Cmd+1", description: "Focus the folder tree" },
  { group: "Panels", shortcut: "Cmd+2", description: "Focus the file list" },
  { group: "Views", shortcut: "?", description: "Open help" },
  { group: "Views", shortcut: "Cmd+,", description: "Open settings" },
  { group: "Views", shortcut: "Cmd++", description: "Zoom in" },
  { group: "Views", shortcut: "Cmd+-", description: "Zoom out" },
  { group: "Views", shortcut: "Cmd+0", description: "Reset zoom to 100%" },
  { group: "Views", shortcut: "Esc", description: "Return from Help or Settings to Explorer" },
] as const;

// These reference notes cover UI behaviors that are not obvious from shortcut listings alone.
export const REFERENCE_ITEMS = [
  {
    label: "Single click path segment",
    description: "Navigate directly to that folder in the current browsing history.",
  },
  {
    label: "Double click path bar",
    description: "Switch the path bar into editable mode without opening a separate dialog.",
  },
  {
    label: "Inline path suggestions",
    description: "Autocomplete shows real directory names under the typed parent folder.",
  },
  {
    label: "List view activation",
    description:
      "Double click a folder to enter it. Double click a file follows the Open/Edit setting.",
  },
  {
    label: "Tree disclosure chevron",
    description: "Expand or collapse subfolders without changing the selected path.",
  },
  {
    label: "Find files",
    description: "Search runs from the current folder with Regex or Glob matching.",
  },
] as const;
