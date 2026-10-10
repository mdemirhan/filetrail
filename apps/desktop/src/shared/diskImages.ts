// The disk images macOS mounts when one is opened: the extensions DiskImageMounter opens.
// File Trail mounts them itself and opens the disk in a tab, where macOS would open a Finder
// window on it.
const DISK_IMAGE_EXTENSIONS = new Set([
  "dmg",
  "udif",
  "img",
  "toast",
  "dvdr",
  "cdr",
  "dmgpart",
  "iso",
  "sparseimage",
  "asif",
  "sparsebundle",
  "backupbundle",
]);

export function isDiskImagePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && DISK_IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

// The alert for a disk image that couldn't be opened, with hdiutil's reason as Finder's
// alert gives DiskImageMounter's ("no mountable file systems").
export function describeDiskImageFailure(
  path: string,
  reason: string | null,
): { title: string; message: string } {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  const title = `The disk image “${name}” couldn’t be opened.`;
  const trimmed = reason?.trim().replace(/\.$/u, "") ?? "";
  if (trimmed.length === 0) {
    return { title, message: "An unexpected error occurred." };
  }
  return { title, message: `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.` };
}
