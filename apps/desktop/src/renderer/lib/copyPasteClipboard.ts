import type { IpcRequest } from "@filetrail/contracts";

import { getPathLeafName } from "./explorerAppUtils";

export type ClipboardMode = IpcRequest<"copyPaste:plan">["mode"];

export type CopyPasteClipboardState =
  | {
      type: "empty";
    }
  | {
      type: "ready";
      mode: ClipboardMode;
      sourcePaths: string[];
      capturedAt: string;
    };

export const EMPTY_COPY_PASTE_CLIPBOARD: CopyPasteClipboardState = {
  type: "empty",
};

export function setCopyPasteClipboard(
  mode: ClipboardMode,
  sourcePaths: string[],
  nowIsoString: string,
): CopyPasteClipboardState {
  const normalizedPaths = Array.from(new Set(sourcePaths)).filter((path) => path.length > 0);
  if (normalizedPaths.length === 0) {
    return EMPTY_COPY_PASTE_CLIPBOARD;
  }
  return {
    type: "ready",
    mode,
    sourcePaths: normalizedPaths,
    capturedAt: nowIsoString,
  };
}

export function clearCopyPasteClipboard(): CopyPasteClipboardState {
  return EMPTY_COPY_PASTE_CLIPBOARD;
}

export function buildPasteRequest(
  clipboard: CopyPasteClipboardState,
  destinationDirectoryPath: string,
  conflictResolution: IpcRequest<"copyPaste:plan">["conflictResolution"] = "error",
): IpcRequest<"copyPaste:plan"> | null {
  if (clipboard.type !== "ready") {
    return null;
  }
  return {
    mode: clipboard.mode,
    sourcePaths: clipboard.sourcePaths,
    destinationDirectoryPath,
    conflictResolution,
    action: "paste",
  };
}

export function clearClipboardAfterSuccessfulPaste(
  clipboard: CopyPasteClipboardState,
): CopyPasteClipboardState {
  if (clipboard.type !== "ready") {
    return clipboard;
  }
  return EMPTY_COPY_PASTE_CLIPBOARD;
}

export function hasClipboardItems(clipboard: CopyPasteClipboardState): boolean {
  return clipboard.type === "ready" && clipboard.sourcePaths.length > 0;
}

export type ClipboardSummary = {
  label: string;
  tooltip: string;
};

const CLIPBOARD_TOOLTIP_NAME_LIMIT = 5;

// What the window says about the clipboard while it holds files: "3 items copied" or
// "1 item cut", with the names behind it. The items may be in a tab that is not on screen.
export function describeClipboard(clipboard: CopyPasteClipboardState): ClipboardSummary | null {
  if (clipboard.type !== "ready" || clipboard.sourcePaths.length === 0) {
    return null;
  }
  const count = clipboard.sourcePaths.length;
  const names = clipboard.sourcePaths
    .slice(0, CLIPBOARD_TOOLTIP_NAME_LIMIT)
    .map((path) => getPathLeafName(path));
  if (count > names.length) {
    names.push(`and ${count - names.length} more`);
  }
  return {
    label: `${count} ${count === 1 ? "item" : "items"} ${clipboard.mode === "cut" ? "cut" : "copied"}`,
    tooltip: `${names.join("\n")}\nPaste with ⌘V`,
  };
}
