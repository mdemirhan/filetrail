# File Trail Architecture Log

## 2026-03-06

- File Trail is intentionally macOS-only. Path handling, titlebar behavior, keyboard shortcuts, and shell integration are allowed to be macOS-specific.
- Browsing is live-scan only. There is no app-managed search index or SQLite metadata cache in MVP.
- The Electron main process stays thin. Filesystem work runs through a long-lived worker thread and narrow, Zod-validated IPC contracts.
- The renderer shell follows Code Trail's titlebar/toolbar pattern and token-driven theming, but uses denser, utility-oriented explorer panels instead of message-driven layouts.
- Direct path entry is provided through a toolbar-native location sheet rather than a persistent breadcrumb/address bar. This preserves the required capability without forcing visible chrome that conflicts with the Code Trail-derived shell.
- Folder size remains deferred in MVP UI, but the contract surface is reserved for async job-based computation so the feature can be added without breaking properties APIs later.

## 2026-10-05

- Undo and Redo for file operations. Each operation hands the main process a log of the steps it really took (renamed or moved, made, moved to the Trash with its place there), or why it can't be undone (a merge, a move to another disk, anything deleted for good, copies onto a disk without a Trash). The history is kept in memory for as long as the app runs.
- An Undo plays the reverse steps, newest first, as an ordinary write operation in the one write slot. Every step is checked on disk just before it runs (file id, the folder it goes back into, a free name) and skipped with its reason when it doesn't fit; moves never replace anything, and what an operation made goes to the Trash, never deleted. The log is a list of hints, never trusted.
- Moving to the Trash goes through NSFileManager (nativeTrashItem) rather than Electron's shell.trashItem, which doesn't say where the item went.
- Edit › Undo and Redo are menu commands, not the "undo" and "redo" roles: the window sends them to a text field that has the keyboard, and to the files otherwise.
- Nothing writes to the user's files in parallel: crash-recovery retries take the write slot too (runWriteAlone).
