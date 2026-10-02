import type { ClipboardIcon } from "../lib/copyPasteClipboard";
import type { DirectoryEntry } from "../lib/explorerTypes";
import { FileIcon } from "../lib/fileIcons";

// Entries that draw the plain folder and the plain document icon the file list uses.
const GENERIC_FOLDER: DirectoryEntry = {
  path: "/folder",
  name: "folder",
  extension: "",
  kind: "directory",
  isHidden: false,
  isSymlink: false,
};
const GENERIC_FILE: DirectoryEntry = {
  path: "/file",
  name: "file",
  extension: "",
  kind: "file",
  isHidden: false,
  isSymlink: false,
  isExecutable: false,
};

// The icon for what is on the clipboard. One item has the icon the file list shows for
// it. Several are two of those icons, one behind the other: folders, files, or a folder
// behind a file when there are both.
export function ClipboardItemsIcon({ icon }: { icon: ClipboardIcon }) {
  if (icon.type === "item") {
    return <FileIcon entry={icon.entry} />;
  }
  return (
    <span className="clipboard-items-icon" aria-hidden="true">
      <FileIcon entry={icon.contains === "files" ? GENERIC_FILE : GENERIC_FOLDER} />
      <FileIcon entry={icon.contains === "folders" ? GENERIC_FOLDER : GENERIC_FILE} />
    </span>
  );
}
