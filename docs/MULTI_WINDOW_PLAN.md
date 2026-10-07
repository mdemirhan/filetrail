# Multiple windows: implementation plan

Status: decisions agreed and built on 2026-10-07 on `claude/multiple-windows-support-915df7` (not merged). Dragging between windows still needs a check by hand: a real drag can't be scripted.

## What the user sees

| | |
|---|---|
| File › New Window (⌘N) | A window on the front tab's folder, with that tab's view settings, the front window's size and panels, placed a step down and right of it |
| File › Open in New Window (and folder right-click menus) | The selected folder in a new window, like Open in New Tab |
| Window › Move Tab to New Window | The tab on screen leaves this window for a new one. Dimmed with one tab |
| Window › Merge All Windows | Every other window's tabs are added after the front window's tabs, and those windows close. Dimmed with one window |
| Dock menu › New Window | As File › New Window |
| Window title | The front tab's folder name (Window menu, ⌘\`, Mission Control). The title bar itself stays hidden |

All four commands are in the shortcut table, so Settings › Shortcuts can change or add keys. Only New Window has a key by default (⌘N; New Folder stays ⇧⌘N, as in Finder).

**Closing.** Closing a window just closes it, and it won't come back at the next launch. Since 2026-10-08 this includes the last window: File Trail stays open with no window, like Finder (it used to quit). Closing the last window while an operation runs asks first, and Stop and Close stops the operation, so nothing runs with no window. Settings, About and Acknowledgements stay open.

**With no window open** (2026-10-08). A click on the Dock icon, New Window (menu, ⌘N, Dock menu) or a second launch opens a window where the window closed last was: its place and size, panels, column widths and the tab that was in front. The Go menu's places and Go to Folder open such a window and go there. Everything else that needs a window is dimmed, Undo, Redo and Empty Trash included. Quitting with no window open brings back one window started the same way at the next launch.

**Launching.** With "Reopen the last folder and tabs" on, every window comes back with its place, size, tabs, front tab and panels, and the window that was in front is in front again. With it off, one window opens, as today. A folder File Trail was launched with opens in the front window. Saved tabs from before this change become the first window.

**Per window:** tabs and everything a tab keeps; folder tree, Info panel and Info Row shown or hidden; sidebar and Info panel widths; column widths (folder lists and search results; a new window starts from the widths of the window it came from, and after that they never follow each other); Reopen Closed Tab's list; the folder watch. **App-wide:** everything in Settings, column order and which columns are shown, density, favorites, the cut/copy clipboard, the Undo history, measured folder sizes, and the one file operation that can run at a time.

**File operations.** One runs at a time across the whole app. Its progress card is in the window that started it; other windows refuse new operations with the notice tabs give today, and their context menus leave write commands out. When the window running the operation is closed while others are open, the operation keeps going and its card (Stop, conflict questions, the result) moves to the front window. What the operation would have selected afterwards is not selected there.

**Dragging between windows** works like a drop from Finder: empty space and file rows take it into the folder on screen, folder rows into themselves; same disk moves, another disk copies, ⌥ copies; Undo undoes it.

**Not included:** dragging tabs between windows, reopening a closed window, opening a folder passed to a second launch (it still only brings File Trail to the front). A tab moved to another window keeps its folder, tree root and view settings but not its Back/Forward history or search.

## How it is built

### Main process: the window list
- `main/explorerWindows.ts` keeps the open explorer windows in front-to-back order (moved to the front on `focus`), each with an id that persists between launches. It answers "front explorer window" and "explorer window of this web contents".
- The store gets `windows: StoredExplorerWindow[]` (front first), each `{ id, bounds, session }`. `session` holds the window's own copies of the preference keys that belong to a window (below). The old single `window` record and the old `openTabs` read as the first window.
- **Window session keys** (`WINDOW_SESSION_PREFERENCE_KEYS`): `openTabs`, `activeTabIndex`, `treeRootPath`, `lastVisitedPath`, `lastVisitedFavoritePath`, `viewMode`, `searchViewMode`, `sortBy`, `sortDirection`, `searchResultsSortBy`, `searchResultsSortDirection`, `includeHidden`, `foldersFirst`, `favoritesExpanded`, `locationsExpanded`, `folderTreeOpen`, `propertiesOpen`, `detailRowOpen`, `treeWidth`, `inspectorWidth`, `detailColumnWidths`, `searchColumnWidths`.
- `app:getPreferences` from an explorer window answers the app's preferences overlaid with that window's session. `app:updatePreferences` writes session keys into the sender's session as well as the app's preferences (which stay the "latest" values, used by a one-window launch). Session keys are never broadcast to other windows.
- A closed window's record is dropped unless it was the last window (the app quits). Bounds are recorded per window on move/resize and at quit.
- `app:getLaunchContext` gives the launch folder only to the window that was in front at startup, and says `restoreTabs: true` to windows opened while the app runs, so they open their given tabs whatever the restore setting says.
- `app:openWindow({ tabs, activeTabIndex })` opens a window whose session is the sender's panels plus the given tabs. Used by New Window, Open in New Window and Move Tab to New Window.
- `app:mergeAllWindows` gathers every other window's saved tabs (front-to-back), closes those windows without asking, and sends them to the sender as `filetrail:addTabs`.

### Menus
- One application menu. Commands go to the focused explorer window; while Settings or Help is focused, `newWindow` still goes to the front explorer window, and the rest behaves as today.
- The menu shows the state of the focused explorer window (or the front one while another window is focused). `app:setMenuState` is kept per window.
- Merge All Windows is dimmed with one explorer window (main knows the count); Move Tab to New Window is dimmed by the renderer with one tab.

### Clipboard
- Moved to main: `app:getClipboard`, `app:setClipboard`, broadcast `filetrail:clipboardChanged` to the other explorer windows. The renderer keeps its local copy for drawing, and every change goes through `applyCopyPasteClipboardState`, which now also sends it. Only the window that ran an operation follows the clipboard through its result, as today; the others get the new clipboard from main.

### File operations
- Progress events go to every explorer window. The window that owns the operation draws its card as today; the others record a "foreign" operation (action and current item), which locks their write commands and words the busy notice.
- When the owner window is destroyed or its renderer goes away while other explorer windows are open, main gives the operation to the front explorer window (`writeOperationSenders`, owner checks for Stop and conflict answers) and sends it `filetrail:writeOperationAdopted` with the latest event. That window adopts it as its own, without the follow-ups that belong to the window that started it (selection). With no window left, the operation is cancelled as today (the app is quitting).
- A copy analysis (before the review sheet) still belongs to its window and is dropped with it.

### Folder sizes
- Each window's measuring cancels only its own earlier job; a job from another window waits in the queue behind the one that is running.

### Dragging between windows
- A drag the app started is an in-app session only in the window it started from. Another window that sees it (`ownDrag` with no session of its own) treats it as an external drop.

## Order of work
1. Store: windows list, session overlay, migration; tests.
2. Main: window list, open/close/restore, bounds, title, launch context, `app:openWindow`, `app:mergeAllWindows`; tests.
3. Menus, shortcuts table, Dock menu; tests.
4. Renderer: New Window, Open in New Window, Move Tab, Merge, `addTabs`, title; tests.
5. Clipboard in main; tests.
6. Progress broadcast, foreign lock, adoption; folder-size queue; tests.
7. Drag between windows; tests.
8. Help text; `bun run ci`; smoke tests; real-app check.
