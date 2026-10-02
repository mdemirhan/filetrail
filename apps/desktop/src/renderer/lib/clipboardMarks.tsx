import { createContext, useContext } from "react";

import { ToolbarIcon } from "../components/ToolbarIcon";
import type { ClipboardMode } from "./copyPasteClipboard";

// Which items are on the clipboard, for the rows that show them: a "Copied" or "Cut" tag
// for as long as they are there, and a flash at the moment they are copied or cut.
export type ClipboardMarks = {
  paths: ReadonlySet<string>;
  mode: ClipboardMode;
  /** True for a moment after a copy or cut. */
  flashing: boolean;
};

// The folder tree and the file list are switched on and off separately in Settings; a pane
// that is switched off, or an empty clipboard, has no marks.
export type ClipboardMarksBySurface = {
  tree: ClipboardMarks | null;
  content: ClipboardMarks | null;
};

// How long the flash lasts; the `clipboard-flash` animation in styles.css runs this long.
export const CLIPBOARD_FLASH_MS = 700;

const NO_CLIPBOARD_MARKS: ClipboardMarksBySurface = { tree: null, content: null };

const ClipboardMarksContext = createContext<ClipboardMarksBySurface>(NO_CLIPBOARD_MARKS);

export const ClipboardMarksProvider = ClipboardMarksContext.Provider;

export function useClipboardMarks(surface: keyof ClipboardMarksBySurface): ClipboardMarks | null {
  return useContext(ClipboardMarksContext)[surface];
}

// The classes a row adds to its own when its item is on the clipboard (with a leading
// space), or nothing.
export function clipboardMarkClassName(marks: ClipboardMarks | null, path: string | null): string {
  if (!marks || path === null || !marks.paths.has(path)) {
    return "";
  }
  return ` clipboard-marked${marks.mode === "cut" ? " clipboard-cut" : ""}${
    marks.flashing ? " clipboard-flash" : ""
  }`;
}

// "Copied" or "Cut" on the row of an item that is on the clipboard. Icon view has no room
// for the word and shows the icon alone, on the corner of the item's picture.
export function ClipboardMarkTag({
  marks,
  path,
  variant = "tag",
}: {
  marks: ClipboardMarks | null;
  path: string | null;
  variant?: "tag" | "badge";
}) {
  if (!marks || path === null || !marks.paths.has(path)) {
    return null;
  }
  const cut = marks.mode === "cut";
  return (
    <span
      className={variant === "badge" ? "clipboard-mark-badge" : "clipboard-mark-tag"}
      // Decorative for assistive tech: the row's own name is what it reads.
      aria-hidden="true"
    >
      <ToolbarIcon name={cut ? "cut" : "copy"} />
      {variant === "badge" ? null : (
        // Its own element, so the word can drop out when the row is too narrow for it.
        <span className="clipboard-mark-word">{cut ? "Cut" : "Copied"}</span>
      )}
    </span>
  );
}
