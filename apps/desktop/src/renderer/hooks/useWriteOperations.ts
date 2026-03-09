import { useRef, useState } from "react";

import type {
  IpcRequest,
  IpcResponse,
  WriteOperationAction,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";

import {
  EMPTY_COPY_PASTE_CLIPBOARD,
  type CopyPasteClipboardState,
} from "../lib/copyPasteClipboard";
import type { ToastEntry } from "../lib/toasts";

type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
  targetPath: string | null;
  source: "browse" | "search";
  scope: "selection" | "background";
};

type CopyPastePlan = IpcResponse<"copyPaste:plan">;
type CopyPasteDialogState = {
  type: "plan";
  plan: CopyPastePlan;
  action: "paste" | "move_to" | "duplicate";
  clearClipboardOnStart: boolean;
} | null;

type WriteOperationCardState = {
  action: WriteOperationAction;
  stage: "starting" | "queued" | "running";
  targetPath: string | null;
  completedItemCount: number;
  totalItemCount: number;
  completedByteCount: number;
  totalBytes: number | null;
  currentSourcePath: string | null;
};

export function useWriteOperations() {
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [copyPasteClipboard, setCopyPasteClipboardState] = useState<CopyPasteClipboardState>(
    EMPTY_COPY_PASTE_CLIPBOARD,
  );
  const [copyPasteDialogState, setCopyPasteDialogState] = useState<CopyPasteDialogState>(null);
  const [writeOperationCardState, setWriteOperationCardState] =
    useState<WriteOperationCardState | null>(null);
  const [writeOperationProgressEvent, setWriteOperationProgressEvent] =
    useState<WriteOperationProgressEvent | null>(null);
  const [renameDialogState, setRenameDialogState] = useState<{
    sourcePath: string;
    currentName: string;
    error: string | null;
  } | null>(null);
  const [newFolderDialogState, setNewFolderDialogState] = useState<{
    parentDirectoryPath: string;
    initialName: string;
    error: string | null;
  } | null>(null);
  const [moveDialogState, setMoveDialogState] = useState<{
    sourcePaths: string[];
    currentPath: string;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const actionNoticeReturnFocusPaneRef = useRef<"tree" | "content" | null>(null);
  const activeWriteOperationIdRef = useRef<string | null>(null);
  const nextPasteAttemptIdRef = useRef(0);
  const pendingPasteAttemptRef = useRef<{
    id: number;
    phase: "planning" | "starting";
    cancelled: boolean;
  } | null>(null);
  const nextToastIdRef = useRef(0);
  const copyPasteClipboardRef = useRef<CopyPasteClipboardState>(EMPTY_COPY_PASTE_CLIPBOARD);
  const writeOperationLockedRef = useRef(false);
  const pendingPasteSelectionRef = useRef<{
    directoryPath: string;
    selectedPaths: string[];
  } | null>(null);

  return {
    contextMenuState,
    setContextMenuState,
    actionNotice,
    setActionNotice,
    toasts,
    setToasts,
    copyPasteClipboard,
    setCopyPasteClipboardState,
    copyPasteDialogState,
    setCopyPasteDialogState,
    writeOperationCardState,
    setWriteOperationCardState,
    writeOperationProgressEvent,
    setWriteOperationProgressEvent,
    renameDialogState,
    setRenameDialogState,
    newFolderDialogState,
    setNewFolderDialogState,
    moveDialogState,
    setMoveDialogState,
    actionNoticeReturnFocusPaneRef,
    activeWriteOperationIdRef,
    nextPasteAttemptIdRef,
    pendingPasteAttemptRef,
    nextToastIdRef,
    copyPasteClipboardRef,
    writeOperationLockedRef,
    pendingPasteSelectionRef,
  };
}

export type { ContextMenuState, CopyPasteDialogState, WriteOperationCardState };
