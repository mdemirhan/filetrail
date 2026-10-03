// APFS and HFS+ allow a name of at most 255 bytes once it is written out as UTF-8, not 255
// characters: "é" or "日" take two or three bytes, so a name of 100 such characters is
// already too long.
const MAX_ITEM_NAME_BYTES = 255;
const utf8Encoder = new TextEncoder();

// A user-supplied file or folder name must name a single entry inside its parent
// directory. Separators or dot segments would let "rename" or "new folder" write
// somewhere else entirely (e.g. "../x" moves the item up a level).
export function getItemNameError(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Enter a name.";
  }
  if (trimmed === "." || trimmed === "..") {
    return `"${trimmed}" is not a valid name.`;
  }
  // "\\" is an ordinary character on macOS (Finder allows it): only "/" separates folders.
  if (/[/\0]/.test(trimmed)) {
    return "Names can’t contain “/”.";
  }
  if (utf8Encoder.encode(trimmed).length > MAX_ITEM_NAME_BYTES) {
    return "The name is too long.";
  }
  return null;
}
