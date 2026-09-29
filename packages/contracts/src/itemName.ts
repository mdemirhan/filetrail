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
  if (/[/\\\0]/.test(trimmed)) {
    return "Names cannot contain “/” or “\\”.";
  }
  return null;
}
