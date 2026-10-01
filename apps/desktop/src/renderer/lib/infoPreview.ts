import type { DirectoryEntry, DirectoryEntryMetadata, ItemProperties } from "./explorerTypes";

// What the info views show for `path`: the item's full properties once they arrive, and
// until then a preview built from what the file list already knows (name, icon, kind,
// and the size, date and permissions of listed items), so switching items updates in
// place instead of blanking. `pending` marks values that are still on their way.
export function resolveInfoItem(args: {
  path: string | null;
  currentPath: string;
  entries: readonly DirectoryEntry[];
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  properties: ItemProperties | null;
}): { item: ItemProperties; pending: boolean } | null {
  const { path } = args;
  if (!path) {
    return null;
  }
  if (args.properties?.path === path) {
    return { item: args.properties, pending: false };
  }
  const entry =
    args.entries.find((candidate) => candidate.path === path) ??
    (path === args.currentPath ? folderEntryForPath(path) : null);
  if (!entry) {
    return null;
  }
  const metadata = args.metadataByPath[path] ?? null;
  return {
    item: {
      path: entry.path,
      name: entry.name,
      extension: entry.extension,
      kind: entry.kind,
      kindLabel: metadata?.kindLabel ?? fallbackKindLabel(entry),
      isHidden: entry.isHidden,
      isSymlink: entry.isSymlink,
      createdAt: metadata?.createdAt ?? null,
      modifiedAt: metadata?.modifiedAt ?? null,
      sizeBytes: metadata?.sizeBytes ?? null,
      sizeStatus: metadata?.sizeStatus ?? "deferred",
      permissionMode: metadata?.permissionMode ?? null,
    },
    pending: true,
  };
}

export function folderEntryForPath(path: string): DirectoryEntry {
  return {
    path,
    name: path.split("/").filter(Boolean).at(-1) ?? "Macintosh HD",
    extension: "",
    kind: "directory",
    isHidden: false,
    isSymlink: false,
  };
}

// The kind shown before the system's own description (from the listing or properties)
// is known.
export function fallbackKindLabel(entry: Pick<DirectoryEntry, "kind" | "extension">): string {
  switch (entry.kind) {
    case "directory":
      return "Folder";
    case "symlink_directory":
      return "Alias Folder";
    case "bundle":
      return entry.extension === "app" ? "Application" : "Package";
    case "symlink_file":
      return "Alias";
    default:
      return entry.extension ? `${entry.extension.toUpperCase()} File` : "File";
  }
}
