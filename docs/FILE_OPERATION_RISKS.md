# File operations: what gets fixed, and the risks accepted

File operations should never lose what the person can't get back, and never take a destructive step they weren't shown. They should also stay simple enough to change safely. Reviews kept finding rarer and rarer cases, and the guards against them made the copy engine harder to follow and slower, so a finding now has to clear a bar before code changes for it.

## The bar

Fix a finding only when both hold:

- **It is likely.** The trigger is everyday, occasional, or rare but real: a crash, a disk unplugged, a full disk, a FAT, exFAT or SMB quirk, a cloud sync app (Dropbox, iCloud) touching files, a network share that stops answering, or the person's own action in another window or app.
- **It matters.** It loses data the Trash can't bring back, takes a destructive step the person wasn't shown, or makes an everyday flow slow. A wrong report alone is fixed only when it happens in everyday use; a cosmetic slip seen in normal use may get a cheap fix.

Below the bar, the case goes on the list below instead of into the code: a race that needs another app to act between two system calls or within a few milliseconds, an adversarial swap of a symlink or hidden item, a collision with a random hidden name, or a chain of several failures (a crash, then a reconnect, then a collision).

Every finding states its scenario, how likely it is and what it costs the person. A fix gets one verification pass; a fix that needs a second follow-up is a sign to ask whether the case is worth it. Time saved goes to checks on real disks (an exFAT stick, an SMB share, an unplug, a full disk), timing with large folders, and the wording people see.

## Accepted risks

- A change made by another app between File Trail's last check and the system call that acts on it isn't caught.
- The hidden names File Trail works under (`.name.filetrail-xxxxxxxx`) are taken to be its own: an item another app puts or swaps there may be removed or put in place as if it were the copy.
- On a volume that can't refuse to replace a name when renaming (no `RENAME_EXCL`), a check is made first, which leaves a tiny window.
- Replacing a folder on a disk with a Trash checks that it is the same folder, not what is inside it: items added to it meanwhile go to the Trash with it. Only a folder a Replace is about to delete for good is checked for items added since.
- Moving a folder to the Trash on a disk with no Trash deletes it as confirmed, with any items added inside it while the question was open: the person asked for the folder to go.
- An edit made to a moved item's new copy while the originals are being removed isn't told apart from the copy itself.
- A destination folder replaced by another of the same name while the review is open receives the paste.
- A rare read error while checking a moved original can leave the original in place with the move reported done.
- Two names that one disk keeps apart and another treats as the same (ß and ss) may be found to clash only while pasting; where ids aren't available the paste can't tell its own items apart.
- A file whose permissions deny deleting it fails to copy (nothing is lost).
- A nested failure inside a changed item may name an internal hidden path.
- Keep Both may shorten a long non-Latin name more than the disk requires.
- The Trash reached through another spelling of its path (`/System/Volumes/Data/...`, an alias) may let a paste or New Folder land inside it.
- A Favorite that is a folder alias may show a drop it then refuses.
- Move To and ⌘V started at the same instant may both cancel, writing nothing.
- An item is checked as being in the Trash once before Delete Immediately, not again right before it is deleted: a folder above it swapped for a link in that moment could lead the delete elsewhere.
- Undo of a Replace made through a name that differs only in letter case (or in how an accented letter is encoded) may bring the old item back under the new item's spelling.
- A folder moved within its disk is renamed whole, without reading what is inside it. If its destination changes between the review and the move (its name taken, or the folder now on another disk), it isn't moved or asked about; the person is told to try again.
- Batch Change Case on a disk that says it ignores case trusts that answer and each item's identity instead of reading the folder; the app's case folding may differ from the disk's for rare letters.
- Undo of a copy locked by the system (a flag only an administrator can clear) fails as locked each time and stays on the Undo list.
- Moving items with accented names off an exFAT disk on macOS 27 can leave the originals in place, with a message that says they no longer exist: the disk refuses to remove a name created in composed form by the name it lists (a macOS bug). An emptied folder with such a name can stay behind, reported as moved.
- Stop isn't taken while a finished move to another disk removes its originals: the move completes as asked.
- Batch rename gives an item one random hidden name to wait under; if another item already has it, that item fails rather than trying another name. Nothing is replaced.
- Recovery after a crash goes by path: an item whose folder was renamed or moved before File Trail opened again has to be put back by hand. A folder recovery puts in place goes without its own tags and dates.
- A crash in the moment after a folder moved to another disk took its name leaves its originals in place too, without a notice.
- A recovery that finishes on a later retry may not say so.
- The crash journal isn't flushed to the drive (that cost milliseconds for each step of a Replace or folder copy), so a power cut or kernel panic may lose its latest changes. That, or a journal that can't be read, may leave hidden items for the person to put back by hand: crash recovery is not a transaction across disks.
