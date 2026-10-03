import { createContext, useContext } from "react";

import { ToolbarIcon } from "../components/ToolbarIcon";
import type { ClipboardMode } from "./copyPasteClipboard";

// Which items are on the clipboard, for the rows that show them: a copy or cut icon after
// the name for as long as they are there, and a flash at the moment they are copied or cut.
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

// How long the flash lasts; the `clipboard-flash` animation in styles.css runs this long
// (`--duration-flash`).
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

// The copy or cut icon that follows the name of an item that is on the clipboard. Icon
// view shows it as a badge on the corner of the item's picture instead.
export function ClipboardMarkIcon({
  marks,
  path,
  variant = "inline",
}: {
  marks: ClipboardMarks | null;
  path: string | null;
  variant?: "inline" | "badge";
}) {
  if (!marks || path === null || !marks.paths.has(path)) {
    return null;
  }
  return (
    <span
      className={variant === "badge" ? "clipboard-mark-badge" : "clipboard-mark-icon"}
      data-clipboard-mode={marks.mode}
      // Decorative for assistive tech: the row's own name is what it reads.
      aria-hidden="true"
    >
      <ToolbarIcon name={marks.mode === "cut" ? "cut" : "copy"} />
    </span>
  );
}
