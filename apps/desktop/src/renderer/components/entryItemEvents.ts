import { useMemo } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { useLatest } from "../hooks/useLatest";
import { isSelectionNarrowingClick } from "../lib/contentSelection";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type EntryDragHandler = (entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void;

export type EntryItemCallbacks = {
  /** The list's scroll area, which takes the keyboard when an item is clicked. */
  containerRef: React.RefObject<HTMLElement | null>;
  selectedCount: number;
  onSelectionGesture: (path: string, modifiers: { metaKey: boolean; shiftKey: boolean }) => void;
  onActivateEntry: (entry: DirectoryEntry, inNewTab?: boolean) => void;
  onItemContextMenu: (path: string | null, position: { x: number; y: number }) => void;
  onItemDragStart?: EntryDragHandler | undefined;
  onItemDragEnd?: ((event: React.DragEvent<HTMLElement>) => void) | undefined;
  onItemDragEnter?: EntryDragHandler | undefined;
  onItemDragOver?: EntryDragHandler | undefined;
  onItemDragLeave?: EntryDragHandler | undefined;
  onItemDrop?: EntryDragHandler | undefined;
};

// What an item of the file list does with the pointer and drags, the same in every view.
// The object stays the same from one render to the next and calls the latest callbacks,
// so a row is drawn again only when what it shows changes.
export type EntryItemEvents = ReturnType<typeof createEntryItemEvents>;

export function useEntryItemEvents(callbacks: EntryItemCallbacks): EntryItemEvents {
  const latest = useLatest(callbacks);
  return useMemo(() => createEntryItemEvents(latest), [latest]);
}

function createEntryItemEvents(latest: { readonly current: EntryItemCallbacks }) {
  return {
    pointerDown(entry: DirectoryEntry, selected: boolean, event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0) {
        return;
      }
      const { containerRef, onSelectionGesture } = latest.current;
      if (event.metaKey || event.shiftKey || !selected) {
        onSelectionGesture(entry.path, { metaKey: event.metaKey, shiftKey: event.shiftKey });
      }
      containerRef.current?.focus();
    },
    click(entry: DirectoryEntry, selected: boolean, event: React.MouseEvent<HTMLElement>) {
      const { onSelectionGesture, selectedCount } = latest.current;
      if (isSelectionNarrowingClick(event, selectedCount, selected)) {
        onSelectionGesture(entry.path, { metaKey: false, shiftKey: false });
      }
    },
    contextMenu(entry: DirectoryEntry, event: React.MouseEvent<HTMLElement>) {
      event.preventDefault();
      latest.current.containerRef.current?.focus();
      latest.current.onItemContextMenu(entry.path, { x: event.clientX, y: event.clientY });
    },
    doubleClick(entry: DirectoryEntry, event: React.MouseEvent<HTMLElement>) {
      latest.current.onActivateEntry(entry, event.metaKey);
    },
    dragStart(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
      latest.current.onItemDragStart?.(entry, event);
    },
    dragEnd(event: React.DragEvent<HTMLElement>) {
      latest.current.onItemDragEnd?.(event);
    },
    dragEnter(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
      latest.current.onItemDragEnter?.(entry, event);
    },
    dragOver(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
      latest.current.onItemDragOver?.(entry, event);
    },
    dragLeave(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
      latest.current.onItemDragLeave?.(entry, event);
    },
    drop(entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) {
      latest.current.onItemDrop?.(entry, event);
    },
  };
}

// The handlers an item's button takes. Only a folder takes drags over it and drops.
export function entryItemHandlers(
  entry: DirectoryEntry,
  selected: boolean,
  events: EntryItemEvents,
) {
  const canAcceptDrop = entry.kind === "directory" || entry.kind === "symlink_directory";
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) =>
      events.pointerDown(entry, selected, event),
    onClick: (event: React.MouseEvent<HTMLElement>) => events.click(entry, selected, event),
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => events.contextMenu(entry, event),
    onDragStart: (event: React.DragEvent<HTMLElement>) => events.dragStart(entry, event),
    onDragEnd: (event: React.DragEvent<HTMLElement>) => events.dragEnd(event),
    onDragEnter: canAcceptDrop
      ? (event: React.DragEvent<HTMLElement>) => events.dragEnter(entry, event)
      : undefined,
    onDragOver: canAcceptDrop
      ? (event: React.DragEvent<HTMLElement>) => events.dragOver(entry, event)
      : undefined,
    onDragLeave: canAcceptDrop
      ? (event: React.DragEvent<HTMLElement>) => events.dragLeave(entry, event)
      : undefined,
    onDrop: canAcceptDrop
      ? (event: React.DragEvent<HTMLElement>) => events.drop(entry, event)
      : undefined,
    onDoubleClick: (event: React.MouseEvent<HTMLElement>) => events.doubleClick(entry, event),
  };
}

// What a drag over the item shows: only a folder is a place to drop.
export function entryDropTargetState(
  entry: DirectoryEntry,
  getItemDropIndicator: ((path: string) => "valid" | "invalid" | "springing" | null) | undefined,
): "valid" | "invalid" | "springing" | "none" {
  const canAcceptDrop = entry.kind === "directory" || entry.kind === "symlink_directory";
  return canAcceptDrop ? (getItemDropIndicator?.(entry.path) ?? "none") : "none";
}
