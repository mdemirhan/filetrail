# Undo and Redo for file operations: implementation plan

Status: built and merged on 2026-10-05 (Phases 0–5); changed after review on 2026-10-08 (see "Changed after review" at the end). Decisions agreed on 2026-10-05. The phases below are kept as they were planned; where building or review changed them, the sections that say so win.

## What Undo covers

| Operation | Undo does | Redo does |
|---|---|---|
| Rename | Renames it back | Renames it again |
| Batch rename | Renames every item back, as one batch | Renames them again |
| Move on the same disk (paste after Cut, Move To, drag) | Moves it back | Moves it again |
| Move to Trash | Puts it back from the Trash | Moves it to the Trash again |
| New Folder | Moves the folder to the Trash | Puts it back |
| Copy, Duplicate, copy by drag | Moves the copies to the Trash | Puts them back |
| Replace inside a copy or same-disk move | Moves the new item away (to the Trash, or back to where it came from), then puts the replaced item back from the Trash | Does both again |

**Can't Undo.** These operations empty both lists, and the Edit menu then reads "Can't Undo" (greyed out):

- Delete Immediately and Empty Trash.
- A paste that merges a folder (Add Missing), including a Replace inside the merged folder.
- A paste whose Replace deleted an item for good (a disk with no Trash).
- A copy onto a disk with no Trash, and a New Folder made on one.
- A move to another disk (out of scope for now).

One such item makes the whole operation Can't Undo. Undo never reverses only part of an operation.

**Rules that apply everywhere:**

- The disk is the only truth. Each step is checked just before it runs. A step that no longer fits is skipped and reported; it is never forced.
- Undo only renames without replacing (`renameExclusive`) and uses the Trash. It never overwrites or deletes anything.
- Undo and Redo are ordinary write operations. They get the same single write slot, progress card, Stop button, quit-while-busy question and follow-ups.
- The history lives in the main process, in memory only, and is cleared at quit. (Changed after review: it is capped at about a million item steps; see the end.)
- ⌘Z in a text field (rename field, search, location sheet, Settings) stays the text field's own undo.

## One write at a time

Rule: the app never makes two changes to the user's files at once. The app's own files (settings, logs, the write journal) aren't covered by this rule.

**How it works today:**

- One write slot in the coordinator (`activeWriteOperationId`, `writeOperations.ts:135`) covers every operation, enforced in main:
  - paste, copy, move, Duplicate
  - rename, batch rename, New Folder
  - Trash, Delete Immediately
  - Empty Trash (`prepareWithReservedSlot`, 1157)
- Checks that come before a write hold the slot as well (`prepareWithReservedSlot`, 365).
- Inside one operation, every write is awaited before the next. The copy engine, the Trash loop and batch rename have no parallel writes; the only parallel calls are two `lstat`s in batch rename (333).
- The final event is sent only after the last write and its cleanup (`copyPasteExecution.ts:202-233`). The slot is freed on that event.
- Crash recovery at startup finishes before the coordinator exists (`bootstrap.ts:150`).
- Search, folder sizes and listings only read.

**The one gap:** `retryRecovery` (`writeJournal.ts:132`, wired at `bootstrap.ts:163`). It checks `isBusy()` before each try, but doesn't hold the slot while it runs, so an operation started meanwhile runs alongside it. It only touches the journal's paths and moves with `moveExclusive`, so it can't overwrite anything. It still breaks the rule.

**What Undo adds:**

- Undo and Redo take the same slot. `undo:prepare` is refused while an operation runs, and `undo:start` is refused if the history's `generation` moved.
- The history is updated in the same synchronous step that frees the slot, before it is freed: in `emitLocalWriteOperationEvent` (479) and the copy terminal handler (205). The next operation can then never be recorded ahead of the one before it.
- Inside an Undo, steps are awaited one at a time. Each step is a single rename or a single Trash move, so a crash mid-Undo leaves nothing under a hidden name, only an Undo partly done. No journal is needed.
- `undo` and `redo` go in `WRITE_STARTING_SHORTCUTS` (no key repeat) and are blocked while a dialog is open (`copyPasteModalOpen`).
- An open review sheet whose paste is waiting: Undo can change what it checked, and the paste's existing re-check asks about it.
- Finder and other apps can always write at the same time. That is why every step is checked on disk just before it runs.

## Phase 0: Crash-recovery retries take the write slot

This fixes an existing gap and is separate from Undo.

- `retryRecovery` first checks whether each entry's disk answers (`answersWithin`), without holding the slot, because it can wait on a network disk.
- It then runs the write part through a new coordinator method, `runWriteAlone(write)`, built on `prepareWithReservedSlot`. If the slot is busy, that entry is put off (`deferred`) until the next minute.
- An operation the user starts during that short write is refused like any busy case. That should be very rare.

**Tests:**
- In `writeJournal.test.ts`, starting an operation while a retry is writing is refused.
- A retry never runs while an operation holds the slot, including one that starts during the reachability check.

## Phase 1: Moving to the Trash returns where the item went

Electron's `shell.trashItem` returns nothing, so the app can't find a trashed item again. This phase changes nothing the user sees.

- Add `packages/native-fs/src/native_trash.m`:
  - `nativeTrashItem(path) -> Promise<string>`: calls `-[NSFileManager trashItemAtURL:resultingItemURL:error:]` and returns the item's path inside the Trash. macOS may rename it there, for example "a 2.txt".
  - (Dropped: asking macOS for a disk's Trash without creating it says "none" for a disk whose Trash hasn't been made yet. A network disk is treated as having no Trash instead; see Phase 2.)
  - Use napi async work, following the `native_package.m` pattern. The addon is built without ARC, so release objects by hand and wrap the work in `@autoreleasepool`.
  - Errors: use the POSIX error under the NSError when there is one; otherwise map the Cocoa codes (no permission to EACCES, feature unsupported to ENOTSUP).
- Register it in five places: `binding.gyp`, an `extern` declaration and a call in `init()` in `native_copyfile.c`, `index.js`, `index.d.ts`, and the addon type in `apps/desktop/src/main/originalFileSystem.ts`.
- `bootstrap.ts:140`: `createTrashItem` gets `trash: nativeTrashItem` instead of `shell.trashItem`. Keep its error sorting (locked item, no-Trash disk). Check while building that Electron's `trashItem` calls the same macOS method, so behavior doesn't change.
- Change the `trash` type from `Promise<void>` to `Promise<string>` in two places:
  - `WriteServiceFileSystem.trash` (`packages/core/src/fs/writeServiceTypes.ts:118`)
  - `WriteOperationFs.trash` (`writeOperations.ts:51`)

  Update the test doubles: `MockWriteServiceFileSystem.enableTrash` returns a path, and `nativeFileSystemWithTrash` returns its `N-name` path.

**Tests:**
- Native: trash a file and then a folder on a test disk image. Check the returned path exists, holds the same item (same ino), and that a clash gets a new name.
- If a `-nobrowse` image at a temp path has no Trash, mark these tests skipped. Never fill the user's real Trash in tests.

## Phase 2: Recording what each operation did

Operation results don't contain enough to undo: they have no file IDs, no Trash locations, and nothing about merges or which disk each item went to. And the analysis report is deleted after the run. So each operation also produces a step log, which stays in the main process and is never sent to the window.

### Types

The types go in `packages/core/src/fs/writeServiceTypes.ts`, because the copy engine produces them.

```ts
type ItemId = { dev: number; ino: number };

type UndoStep =
  // A rename or same-disk move. `parentId` is the folder `from` was in, so Undo only
  // moves the item back into that same folder. `fromTrash` marks a put back: its
  // reverse is a fresh Trash, not a rename into the Trash folder.
  | { kind: "moved"; from: string; to: string; id: ItemId; parentId: ItemId; fromTrash?: boolean }
  // An item the operation made: a copy, a duplicate, or a new folder. `stamp` is how
  // the item looked right after it was made (kind, size, modified time; for a folder,
  // its own modified time and number of entries).
  | { kind: "created"; path: string; id: ItemId; stamp: ItemStamp }
  // An item moved to the Trash: the operation's target, or an item a Replace pushed out.
  | { kind: "trashed"; from: string; trashPath: string; id: ItemId; parentId: ItemId }
  // A batch rename, undone as one batch so swaps and chains are handled for us.
  | { kind: "batchRenamed"; items: Array<{ from: string; to: string; id: ItemId }> };

// The steps for one top-level item, undone together in reverse order. If one step is
// skipped, the steps after it in the same unit are skipped too.
type UndoUnit = { steps: UndoStep[] };

type UndoLog =
  | { undoable: true; units: UndoUnit[] }
  | { undoable: false; reason: "merge" | "deleted_for_good" | "no_trash" | "other_disk_move" };
```

### Where the steps are recorded

**Simple operations** (`apps/desktop/src/main/bootstrap/writeOperations.ts`):
- `executeRenameOperation` (601): one `moved`.
- `executeBatchRenameOperation` (728): one `batchRenamed`, built from the completed items `runBatchRename` returns, using each item's final path.
- `executeCreateFolderOperation` (820): one `created`.
- `executeTrashOperation` (913): one `trashed` per item, using the path from Phase 1.
- `executeDeleteImmediatelyOperation` (1032): `undoable: false`.

**Copy engine** (`packages/core/src/fs/copyPasteExecution.ts`). Steps are recorded per top-level item as it finishes:

- **Created or Keep Both (copy):** `created` for the top-level path, with the item's ino after it is made. This also covers a partly copied folder, because the folder exists.
- **Same-disk move** (`tryRenameForCut`, 1485): `moved`.
- **Move whose rename failed across disks** (EXDEV fallback at 592): `undoable: false, "other_disk_move"`.
- **Replace** (`executeReplace`, 891):
  - `trashed` for the item pushed out (from `removeReplacedItem`, 1165, which now returns the Trash path),
  - then `created` (copy) or `moved` (same-disk move) for the new item, at its real final path. That includes the visible "copy" name used when the last rename fails (1054–1073).
  - If the item was removed with `rm` because there was no Trash (1213): `"deleted_for_good"`.
  - A Replace as part of a move to another disk: `"other_disk_move"`.
- **Merge** (any node with action `merge`): `"merge"`.
- **A copy onto a disk with no Trash:** `"no_trash"`. A network disk (not local in the mount table) counts as having no Trash. If a local disk turns out to have none, Undo can't trash the copy and says so in a dialog; it never deletes it.

The engine hands the log to the coordinator next to the result (`CopyPasteOperationResult.undoLog`). The coordinator passes every finished operation's log to its `recordUndo(finished)` option, before it frees the write slot; Phase 3 plugs the history into it. Whether a disk has a Trash comes from `createDiskHasTrash` (`bootstrap/diskHasTrash.ts`), which reads the mount table. It is not added to the contract schema, so it never goes over IPC. The coordinator receives it in the copy terminal handler (`writeOperations.ts:205`) and in `emitLocalWriteOperationEvent` (479).

**Not recorded:**
- An operation that finished nothing (all items skipped or failed). It leaves the history as it was.
- Empty Trash (`writeOperations.ts:1157`). It counts as `undoable: false`.

**Tests:**
- Engine: extend `copyPasteExecution.test.ts` (mock disk) and `copyPasteExecution.realfs.test.ts`. Cover every row above, including cancelled and partly failed operations, where the log must match exactly what happened.
- Coordinator: add tests to `writeOperations.test.ts`.

## Phase 3: The history and the Undo engine

This phase adds three new files in `apps/desktop/src/main/bootstrap/`. Add all three to the coverage include list in `vitest.config.ts`.

### `undoHistory.ts`: the two lists

- `record(action, log, label)`: an undoable log goes on the Undo list and empties the Redo list. A Can't Undo log empties both lists and sets `cantUndo` (cleared by the next undoable operation).
- `top(direction)`: the record to undo or redo, plus its menu label.
- `finish(direction, done, leftover)`:
  - The steps actually reversed go onto the other list.
  - Units left over because Undo was stopped stay on top, so ⌘Z continues where it stopped.
  - Units skipped because they no longer fit are dropped.
  - (Changed after review: units whose rename or Trash failed stay on top too.)
- `generation`: a counter that goes up on every change. A prepared Undo started after the history moved on is refused.

**Menu labels:**

| Operation | Label |
|---|---|
| Rename | "Undo Rename" |
| Batch rename | "Undo Rename of 12 Items" |
| Move | "Undo Move of “a.txt”" / "Undo Move of 3 Items" |
| Copy | "Undo Copy of …" |
| Duplicate | "Undo Duplicate of …" |
| New Folder | "Undo New Folder" |
| Move to Trash | "Undo Move to Trash of …" |

Redo uses the same wording ("Redo Move of …"). An empty list reads "Undo". After a Can't Undo operation it reads "Can't Undo".

### `undoPlan.ts`: reversing and checking, without touching the disk

**Reversing steps:**

| Step | Reverse |
|---|---|
| `moved(a→b)` | `moved(b→a)` |
| `moved(trash→a, fromTrash)` | `trashed(a)` |
| `created(p)` | `trashed(p)` |
| `trashed(a, t)` | `moved(t→a, fromTrash)` |
| `batchRenamed` | the same batch with `from` and `to` swapped |

Units are reversed in reverse order, and so are the steps inside each unit.

**Checks** (`check(step, fs)` returns `ok`, or a reason with what to tell the person):

- **The item is where expected:** something exists at the path, and its dev and ino match. Before moving or renaming back, one relaxed case is allowed: the same kind of item at the exact path but with a new ino (an app saved it by replacing the file). That can't lose anything. Trashing a copy and putting back from the Trash always need an exact match.
- **The folder is the same folder:** the place it goes back to has the recorded `parentId`. If the folder is gone, the item is skipped; the folder is never recreated.
- **The name is free:** if not, the answer to "name taken" decides (Skip, or Keep Both with "name 2").
- **Changed since (only before trashing a copy or new folder):** a file whose size or modified time differs, a folder whose entry count differs (not its date: that changes with every item added or taken out, so moving a file into a new folder and undoing that would make the folder look changed), or a New Folder that is no longer empty. Only the folder's own date is checked, not items deep inside it, so walking big copies isn't needed (agreed: the copy goes to the Trash anyway).
- **Disk:** a dev change shows up as "the item isn't where it was". After ejecting and reconnecting a disk, the device number usually changes, so that disk's items are skipped with "its disk was disconnected". Disk-image clones share a volume UUID, so the UUID can't be used to recognize a disk.

### `undoExecution.ts`: running it

1. **`undo:prepare {direction}`.** This doesn't take the write slot. It checks every step and returns:
   - `{ ticket, generation, questions }`. The questions are at most two:
     - "name taken", asked once for all items: Skip or Keep Both.
     - "changed since", listing the items: Move to Trash or Skip Those.
   - or a refusal: empty, busy, or Can't Undo.
2. **`undo:start {ticket, answers}`.** It refuses if `generation` moved, then runs as a local write operation through `queueLocalWriteOperation`, with action `"undo"` or `"redo"`. Every step is checked again just before it runs, because things may have changed since the prepare.
   - **Moves:** `renameExclusive`. When only the case changes, `rename` instead, as in `executeRenameOperation`. For Keep Both, if the name is taken, try "name 2", "name 3"…
   - **Trash:** `fs.trash`, keeping the Trash path it returns.
   - **Batch renames:** `runBatchRename` with the reversed items, which handles swaps, chains and folders before their contents. `onConflict` is `skip`, or `number` for Keep Both. Items whose ino no longer matches are left out first.
   - **Inside a unit:** a skipped step skips the rest of the unit. For example, if the new item from a Replace can't be moved away, the replaced item isn't put back on top of it.
   - **Stop:** checked between steps. Only finished steps count as done.
3. **The result** uses the existing `WriteOperationResult` shape, so the window's follow-ups work:
   - a move is `sourcePath → destinationPath`;
   - a Trash is `destinationPath: null`, the same as trash results today;
   - a put back is a move from the Trash path.

   The coordinator calls `clearResponseCaches(changedPaths, removedItems)`. Items it trashed are passed in `removedItems` with `itemSize` and `intoHomeTrash`, as the Trash operation does, so measured folder sizes are adjusted rather than forgotten.
4. **Contracts** (`packages/contracts/src/ipc.ts`):
   - add `"undo"` and `"redo"` to `writeOperationActionSchema`;
   - add the `undo:prepare` and `undo:start` requests;
   - register them in `bootstrap.ts` next to the other write handlers.

### Tests

- **`undoPlan.test.ts`:** every reverse and every check, using `MockWriteServiceFileSystem`.
- **`undoExecution.test.ts`:**
  - each operation's round trip;
  - Replace in both orders and each failure between its two steps;
  - stopping halfway, then ⌘Z again;
  - a ticket refused after the history moved;
  - Keep Both numbering.
- **`undo.fuzz.test.ts`**, following `batchRenameExecution.fuzz.test.ts` (seeded, a reproduce command on failure). Built on a real temp folder rather than the in-memory test disk, through the coordinator and the real copy engine; 60 cases by default (about 2 seconds), `UNDO_FUZZ_CASES` for more. 3,000 cases were run while building it; they found a Replace on a disk that ignores case putting the old item back under the new item's spelling (fixed, with its own test).
  - **Round trip:** random runs of rename, move, copy, new folder, trash and Replace, then undo everything. Every path, kind and ino must be as at the start, ignoring what is in the Trash. Redo everything must give the end state.
  - **Outside changes:** between steps, randomly delete, rename, move or edit items, add items under taken names, remove folders, and empty the Trash. Three invariants must hold:
    1. No item is ever lost: every ino that existed is still somewhere, in its place or in the Trash, unless an outside change removed it.
    2. Nothing is overwritten (every rename was exclusive).
    3. Every skipped step was reported.
  - **Failures:** random EACCES, EEXIST, ENOENT and EPERM on single steps, plus stops at random points.
- **Real disks:** `undo.realfs.test.ts` on test disk images:
  - put back from a disk's own `.Trashes`;
  - a case-only rename back on case-insensitive APFS;
  - Keep Both on a case-sensitive disk;
  - a locked item.

### What changed while building Phase 3

- Menu labels are worked out from what an entry holds, not stored: after a stopped Undo of 3 items the menu says "of 2 Items".
- Move and rename steps also record the item's kind (file or folder), for the rule that a file an app saved under a new id can still be renamed or moved back.
- "Changed since" compares a folder by how many items it holds only, not its date.
- The old item of a Replace is recorded under the name it really has on disk.

## Phase 4: Menu, keyboard and window

### Menu (`apps/desktop/src/main/appMenu.ts:184`)

- Replace `{ role: "undo" }` and `{ role: "redo" }` with `command("undo", label)` and `command("redo", label)`.
- Add both to `NATIVE_EDIT_COMMANDS`, so the Settings and Help windows keep their text undo.
- Electron can't change a label in place, so rebuild the menu with `buildApplicationMenu` (`main.ts:713`) whenever the history's label changes (after an operation ends, at most once per operation).
- Enabled when the list isn't empty, there's no "Can't Undo", and the window's `writeOperationLocked` is off. Add `undo` and `redo` to `WRITE_LOCKED_RENDERER_COMMANDS`.

### Keyboard and focus

- Add `undo` and `redo` to `RENDERER_COMMAND_TYPES`, with their focus-bucket entries in `shortcutPolicy.ts`.
- Handle them like Paste, through `runGenericEditCommand` (`useExplorerShortcuts.ts:943`):
  - if `resolveFocusedEditTarget` reports editable text, call `system:performEditAction {action: "undo" | "redo"}` (add both to `nativeEditActionSchema`, `ipc.ts:179`, and to `systemHandlers.ts:206`);
  - otherwise start a file Undo.

### Starting an Undo (`useExplorerActions.ts`)

New `startUndo(direction)`:
- calls `undo:prepare`;
- shows its questions with `CopyPasteDialog` and `Alert` (Cancel is the default);
- calls `undo:start` and adopts the operation id the way local operations do (`applyWriteOperationCardState`).

### What happens when an Undo ends

Go through each follow-up so `"undo"` and `"redo"` are handled from the items, not from the action:

- `followClipboardThroughWrite` (`renderer/lib/copyPasteClipboard.ts:147`): copied items follow moves and come off when trashed; a cut is cancelled if any of its items change.
- `queueWriteOperationSelection` (`useExplorerActions.ts:2250`): selects restored items in the folder on screen. It already skips this if the selection changed or the operation started in another tab. It never changes folders.
- `resolveWriteOperationRefreshPath`, `resolveWriteOperationTreeReloadPaths` (`explorerAppUtils.ts:330`, `:408`) and `resolveCompletedTreeSelectionPath`.
- Tabs following moved folders, and stale tabs (`useExplorerTabs.ts:717-798`).
- `useFolderSizeCache` and `useTrashState`.
- Restarting a search that is on screen.

### Feedback after an Undo

- Anything skipped or failed: a dialog, extending `shouldRenderCopyPasteResultDialog`. It names each item with its reason, for example "“a.txt” is no longer in Documents", or "its disk was disconnected".
- A notification only when nothing it changed is in the folder on screen, for example "Undid Move of “a.txt”" in the existing one-line card. No notification otherwise.
- No confirmation before an Undo starts.

### Tests

These go in a new `App.undo.test.tsx`, using `appHarness`:
- ⌘Z with focus in the rename field, the search field and the location sheet does text undo; in the list it starts a file Undo.
- Menu labels and enabled state in `menuStates`, including "Can't Undo" and while busy.
- Questions shown and answered.
- Selection, clipboard, tabs and refresh after an Undo.
- Dialog vs notification.

Menu tests go in `appMenu.test.ts`.

### What changed while building Phase 4

- ⌘Z only ever reaches the window through the menu (fixed keys aren't in the window's own key table). So the window tells the menu whether a text field has the keyboard (`textEditing` in the menu state, kept by `useTextEditingFocus`). While one does, Undo and Redo stay on and say just "Undo" and "Redo", and the window sends them to the field (`system:performEditAction`). Otherwise they name the operation, and are on only when the history has something and nothing runs.
- The menu is built again only when the words of Undo or Redo change: after an operation, when a text field gains or loses the keyboard, and when another window (Settings, Help) takes it.
- `undo:prepare` also returns the label, for the notification ("Undone", then "Move of “a.txt”").
- The questions are one alert each (Cancel · Skip · Keep Both, and Cancel · Skip · Move to Trash), listing up to five names.

## Phase 5: Can't Undo, and the warnings

Wording to settle when building:

- **Review sheet** (`CopyPasteReviewDialog.tsx`): when Add Missing is chosen, for all or on any row, the footer adds "Merging can't be undone." This sits next to the existing "… will be moved to the Trash".
- **Runtime conflict dialog** (`CopyPasteRuntimeConflictDialog.tsx`): a merge chosen while the paste runs gets the same line. The `trash_unavailable` text (199–205, "This can't be undone.") adds that the whole paste then can't be undone.
- **Unchanged:** the Delete Immediately, Empty Trash and no-Trash questions (`AppDialogs.tsx:325-391`) already say "You can't undo this action."
- **Rule (agreed):** only conflict choices warn. A plain operation, with no conflict asked about, never says "can't be undone" in a dialog; only the Edit menu shows "Can't Undo" afterwards.
  - So there's no warning for a copy onto a disk with no Trash.
  - And none for a move to another disk, including a Move To or ⌘-drag across disks.
  - A warning appears only next to the choice that causes Can't Undo: Add Missing, or Delete Permanently on a disk with no Trash. A move to another disk can't be undone whatever is chosen, so its conflict choices don't warn. A warning on just one of them would suggest the others can be undone.

**Tests:** the review sheet footer for each choice, the runtime dialog text, and the history emptied after each Can't Undo case (main-process tests).

### Changed after trying it (2026-10-05)

- Undo's questions are all or nothing. Skip is gone: it left an Undo half done (the operation dropped off the history while an item stayed, a Replace's old item left in the Trash). A name taken: Keep Both (the default) or Cancel. Changed work: Move to Trash or Cancel (the default). Cancel leaves everything as it is, and the operation stays on top.
- The changed-work question names the operation: "“1 copy.kt” was changed after it was duplicated. Undoing the duplicate moves this copy to the Trash, along with your changes. The original isn’t affected." (and the same for copies, New Folder, Replace, and items put back).

### What changed while building Phase 5

- Keep All merges folders too (it adds a folder's files into the existing one under "copy" names), and it is offered for moves. So the review sheet warns whenever its choices merge any folder (Add Missing, Keep All, or Merge on a row): the footer adds "Merging can’t be undone". It says nothing when nothing merges.
- The dialog shown during a paste adds "Merging can’t be undone." wherever Merge is one of its answers. The no-Trash Replace question already said "This can’t be undone."

## Phase 6: Checking in the real app, and docs

- Run the app on a test folder.
  - Round trips: rename, batch rename with a swap, move, Trash, New Folder, copy, Duplicate, Replace (copy and move), and a chain of three. Take one screenshot of the Edit menu label.
  - Outside changes: rename an item in Finder before ⌘Z, and empty the Trash in Finder before ⌘Z.
- Docs:
  - Add an `ARCHITECTURE_LOG.md` entry.
  - The Help window and README may say there is no Undo. Show proposed README changes before making them.

## Order and size

Each phase is its own commit and passes `bun run ci` before the next starts.

- **Phase 0:** a small fix that stands on its own; can ship first.
- **Phases 1–2:** no visible change, low risk.
- **Phase 3:** the core of the work, with most of the tests.
- **Phase 4:** spread across many files, with the most renderer risk: follow-ups that assume an action name.
- **Phase 5:** small.

## Settled during planning

- **Changed since** for a copied folder checks only the folder itself.
- **Can't Undo warnings** appear only on conflict choices that cause it (Add Missing, Delete Permanently on a disk with no Trash), never on a plain copy or move.
- **After a disk is ejected and reconnected**, Undo usually skips that disk's items, because the device number changes. It says the disk was disconnected. Volume UUIDs aren't used, because disk-image clones share them.

## Changed after review (2026-10-08)

**Decisions (the user's):**

- **A write that fails stays on the Undo list.** Before, any step that wasn't done dropped its unit, so a failed Undo took the operation off the list and the next ⌘Z quietly undid an older one. Now there are two kinds:
  - Skipped by the disk check, because something changed outside the app (the item is gone, renamed, replaced; its folder is gone; another app took the name just then): dropped, as agreed before. The rest is undone, and a dialog says what was left and why.
  - The rename or the Trash failed (no permission, a locked folder, the Trash refusing): the step and the steps before it in its unit stay on top of the Undo list, the whole operation when nothing was done. The next ⌘Z tries them again. What was done goes to Redo as before. The result dialog adds "⌘Z tries again what couldn’t be undone", and Help says so.
  - A disk with no Trash won't have one the next time either: it counts as a change the check finds. The item is skipped and reported ("…because its disk has no Trash."), and the operation leaves the list, so older ones can still be undone. (Decided 2026-10-08.)
- **A copy of a locked item is unlocked to go to the Trash.** Copies keep the lock, and the Trash refuses a locked item, so undoing a copy of a locked item always failed. A Trash step for an item the operation made, whose id matched, now clears the user lock (`unlockForMove`), moves it to the Trash without asking, and locks it again there. Putting an item back from the Trash does the same, so Redo brings the copy back locked. A system lock is still refused.

**Fixes:**

- The folder an item goes back to is identified with `stat` (links followed) when recorded and when checked (`readFolderId`): the app keeps a link's path when it opens a folder through one, and `lstat` found the link, so Undo said the folder no longer existed.
- The name-taken question goes by what is really in the way: a place a step before empties is found by the id of the item that leaves (so "x.txt" finds the "X.TXT" a Replace moves away first, and the same for accent encodings), and a place a step before fills counts as taken. It was a path comparison, which asked about a Replace spelled differently and missed two put-backs to one name.
- `undo:start` works out the questions again and refuses ("“a copy.txt” was changed after Undo was chosen. Choose Undo again.") when there is one that wasn't asked: a copy edited while the name-taken alert was open went to the Trash without the changed-work question.
- A batch rename records every item that moved, also one left as "b 2" or under its hidden name when another item had taken its old name meanwhile. Both places that build the record share `movedItemsOf`.
- A batch Undo that failed part way records exactly where it left each item (second review, replacing `wasAt` and the joined Redo parts of the first one): an item that moved goes on the other list from where it was to where it is now, and an item not yet back is left on this list from where it is now. An item that took a number only because the name it goes back to is still held by an item of the batch that failed (two that swap names, one of them locked) is renamed straight back, so both are left where they were and tried again together; only if that rename fails does it wait under the number, recorded both ways. Each try is its own Redo entry. The old way left an item under a number that only the leftover knew about, so pressing Redo, or Undo of older operations, found it misplaced; a fuzz test that takes turns between Undo and Redo through failures found it.
- The progress card counts steps, and each item of a batch, for both the total and what is done ("5 of 3 items" before).
- A paste whose Replace was stopped between its two steps is still named a Move (the entry keeps `moves`).
- When the Trash takes an item but doesn't say where (no resulting URL), `nativeTrashItem` resolves with null: the item counts as trashed, and the operation can't be undone (`trash_location_unknown`); an Undo that does this counts it as done, with nothing to redo.
- An item put back from the Trash on a disk without usable ids (FAT, exFAT) must look as it did when it went (`stamp` on the `trashed` step): kind and size, or for a folder its number of items.
- Before an Undo starts, up to 16 units are checked at once (`mapAtMost`), in their order.
- A New Folder made on a disk with no Trash can't be undone (`no_trash`), as a copy there can't: undoing it would mean deleting it. When the mount table can't be read, the disk counts as having no Trash.
- Whether a disk has a Trash follows the path through symlinks first (its nearest part that exists), and compares it with every mount in the mount table (`nativeListMounts`), not only those under /Volumes, ignoring case: a share reached as ~/NAS, typed in another case, or mounted elsewhere counted as having a Trash.

## Changed after the second review (2026-10-08)

- **Failed writes sorted one way** (`classifyUndoWriteError`), for renames, the Trash, unlocking and batch items alike: an item gone or a name taken just then is a change outside the app (skipped and dropped, as the disk check does); what would fail every time is dropped and said (no Trash, a read-only disk, another disk, a lock only the system can clear); anything else stays on the list. "No Trash" counts only when it is known: macOS said the Trash isn't supported there, or the disk is a network share (`diskHasTrash`). A Trash that failed without a reason on a local disk is tried again.
- **Locked copies:** an item put back from the Trash locked is recorded so (`locked` on its `moved` step), and goes back to the Trash unlocked and locked again, so Undo → Redo → Undo of a copy of a locked item works. An item the person locked after it was put back is still refused. A lock that can't be put back is said in the result ("…couldn't be locked again"), the move counting as done.
- **Tickets:** each `undo:prepare` gets its own ticket, with what it asked, so two windows looking at one Undo each start it with their own answers.
- **What the start compares:** the items asked about and the taken names carry their paths, and `undo:start` compares by path. Its last look is given 10 seconds (`UNDO_CHECK_WITHIN_MS`); a disk that doesn't answer refuses the Undo and frees the write slot. An item that changes once the Undo has started, without being asked about, is left (kept, as a failed write) and the next Undo asks.
- **Finder's own files** (`.DS_Store`, `._name`) don't count in a folder's number of items, so a new folder Finder opened isn't "changed".
- **Case-only renames back** use the rename's rule: names that match ignoring case and accent encoding, the same id or none to go by, and no entry spelled exactly so. An empty file on FAT renamed back in another case is renamed, not given a number; a hard link to the item under its old name is another item (Keep Both).
- **A stop as the last item finishes** stops nothing: no empty "Rename of 0 Items" is left, and `runBatchRename` reports a stop only when an item wasn't reached. The history ignores a log with no units.
- **An Undo that throws unexpectedly** keeps its whole entry on the list; an item of a batch that went away during it is skipped, not failed.
- **A disk ejected and connected again:** an item (or folder) with its old file id on another device number is said to be on a disk that was disconnected since, rather than "another item".
- **A unit whose Undo the Trash didn't say where it put** has nothing on Redo: redoing only the rest of a Replace would leave its place empty.
- **Speed:** a move back uses the check's id and kind, and each folder's id is read once per run: undoing and redoing 5,000 moves went from about 810 ms to 600 ms (lstat 25,000 → 20,000, stat 15,000 → 10,000, the start's last look included). An Undo's result items are added one by one (spreading 130,000 into `push` overflowed the stack).
- **The history's size:** the Undo and Redo lists together keep at most `UNDO_HISTORY_MAX_ITEM_STEPS` (1,000,000) item steps, a batch's items counted one by one. Past it, the oldest operations are let go, from the bottom of the Undo list first; never the operation just recorded, or what an Undo just did and left, even when that alone is larger. Help says so.
- `finish` for an entry no longer on top throws (the coordinator logs it) rather than losing what was done quietly; Undo's progress and the batch label count items with one `itemStepCount`.
