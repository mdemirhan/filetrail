import { type Dispatch, type SetStateAction, useMemo, useReducer, useRef } from "react";

import type {
  CopyPasteChoice,
  IpcRequest,
  IpcResponse,
  WriteOperationAction,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";

import type {
  ContextMenuScope,
  ContextMenuSourceSubview,
  ContextMenuSurface,
  ContextMenuTargetKind,
} from "../lib/contextMenu";
import {
  type CopyPasteClipboardState,
  EMPTY_COPY_PASTE_CLIPBOARD,
} from "../lib/copyPasteClipboard";
import type { InternalMoveSourceSurface } from "../lib/internalDragAndDrop";
import type { ToastEntry } from "../lib/toasts";
import type { UndoQuestion } from "../lib/undoQuestion";

type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
  targetPath: string | null;
  surface: ContextMenuSurface;
  targetKind: ContextMenuTargetKind;
  sourceSubview: ContextMenuSourceSubview;
  scope: ContextMenuScope;
  folderExpansionLabel: "Expand" | "Collapse" | null;
};

type CopyPasteAnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
type CopyPastePolicy = {
  file: "overwrite" | "skip" | "keep_both";
  directory: "overwrite" | "merge" | "skip" | "keep_both";
  mismatch: "overwrite" | "skip" | "keep_both";
} | null;
type CopyPasteDialogState =
  | {
      type: "analysis";
      analysisId: string;
      action: "paste" | "copy_to" | "move_to" | "duplicate";
      clearsCutClipboard: string | null;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
    }
  | {
      type: "review";
      report: CopyPasteAnalysisReport;
      policy: NonNullable<CopyPastePolicy>;
      // Per-item choices made in the review, by analysis node id.
      overrides: Readonly<Record<string, CopyPasteChoice>>;
      action: "paste" | "copy_to" | "move_to" | "duplicate";
      // The cut (by when it was made) the move clears once it moves something: the one
      // pasted, never one made while the sheet is open. Null for none.
      clearsCutClipboard: string | null;
      sourceSurface?: InternalMoveSourceSurface | null;
      pendingTreeSelectionPath?: string | null;
    }
  | {
      type: "confirmTrash";
      paths: string[];
      itemLabel: string;
    }
  | {
      type: "confirmDeleteImmediately";
      paths: string[];
      itemLabel: string;
    }
  | {
      type: "confirmEmptyTrash";
    }
  | {
      // Asked after Move to Trash found items on a disk with no Trash, as Finder asks.
      type: "confirmDeleteWithoutTrash";
      paths: string[];
      itemLabel: string;
    }
  | {
      // Asked before a rename or new folder whose name begins with a dot would hide it.
      type: "confirmDotName";
      request: DotNameRequest;
    }
  | {
      // Asked before an Undo (or Redo): items whose old names are taken now, or items that
      // would go to the Trash though they changed since.
      type: "undoQuestion";
      question: UndoQuestion;
      direction: "undo" | "redo";
      action: WriteOperationAction | null;
    }
  | null;

// A rename or new folder waiting on the dot-name question, with all it needs to go ahead.
type DotNameRequest =
  | { kind: "rename"; sourcePath: string; name: string }
  | {
      kind: "newFolder";
      parentDirectoryPath: string;
      name: string;
      selectInTreeOnSuccess: boolean;
      // A suggested name: the next free one is taken when it isn't free.
      nextFreeName?: boolean;
    };

type WriteOperationCardState = {
  action: WriteOperationAction;
  stage: "starting" | "queued" | "running" | "analyzing" | "awaiting_resolution";
  targetPath: string | null;
  completedItemCount: number;
  totalItemCount: number;
  completedByteCount: number;
  totalBytes: number | null;
  currentSourcePath: string | null;
};

type ActionNoticeState = {
  title: string;
  message: string;
} | null;

type RenameDialogState = {
  sourcePath: string;
  currentName: string;
  error: string | null;
  // How many names were refused so far. The same reason given twice in a row is still a new
  // refusal, and the name field needs to hear of it to take the keyboard back.
  refusalCount: number;
  // Items in the file list are renamed in their row; anything else (a tree folder, a
  // search result) is renamed in a dialog.
  inline: boolean;
  // Tells this rename from earlier ones of the same item (see InlineRenameField's drafts).
  sessionId: number;
} | null;

type NewFolderDialogState = {
  parentDirectoryPath: string;
  initialName: string;
  error: string | null;
  selectInTreeOnSuccess: boolean;
} | null;

type MoveDialogState = {
  sourcePaths: string[];
  currentPath: string;
  submitting: boolean;
  error: string | null;
} | null;

// An operation another window is running. One runs at a time in the whole app, so while it
// runs this window starts none.
export type ForeignWriteOperation = {
  operationId: string;
  action: WriteOperationProgressEvent["action"];
};

type WriteOperationsState = {
  contextMenuState: ContextMenuState | null;
  actionNotice: ActionNoticeState;
  toasts: ToastEntry[];
  copyPasteClipboard: CopyPasteClipboardState;
  copyPasteDialogState: CopyPasteDialogState;
  writeOperationCardState: WriteOperationCardState | null;
  writeOperationProgressEvent: WriteOperationProgressEvent | null;
  foreignWriteOperation: ForeignWriteOperation | null;
  renameDialogState: RenameDialogState;
  newFolderDialogState: NewFolderDialogState;
  moveDialogState: MoveDialogState;
};

type WriteOperationsAction = {
  [K in keyof WriteOperationsState]: {
    key: K;
    value: SetStateAction<WriteOperationsState[K]>;
  };
}[keyof WriteOperationsState];

export const INITIAL_WRITE_OPERATIONS_STATE: WriteOperationsState = {
  contextMenuState: null,
  actionNotice: null,
  toasts: [],
  copyPasteClipboard: EMPTY_COPY_PASTE_CLIPBOARD,
  copyPasteDialogState: null,
  writeOperationCardState: null,
  writeOperationProgressEvent: null,
  foreignWriteOperation: null,
  renameDialogState: null,
  newFolderDialogState: null,
  moveDialogState: null,
};

// Single reducer over all dialog and write-operation state. Each action patches
// one field with useState-compatible updater semantics, so the exposed setters
// behave exactly like their former useState counterparts.
export function writeOperationsReducer(
  state: WriteOperationsState,
  action: WriteOperationsAction,
): WriteOperationsState {
  const previous = state[action.key];
  const next =
    typeof action.value === "function"
      ? // None of the state fields store functions, so a function value is
        // always an updater.
        (action.value as (current: typeof previous) => typeof previous)(previous)
      : action.value;
  if (Object.is(previous, next)) {
    return state;
  }
  return { ...state, [action.key]: next };
}

export function useWriteOperations() {
  const [state, dispatch] = useReducer(writeOperationsReducer, INITIAL_WRITE_OPERATIONS_STATE);
  const {
    contextMenuState,
    actionNotice,
    toasts,
    copyPasteClipboard,
    copyPasteDialogState,
    writeOperationCardState,
    writeOperationProgressEvent,
    foreignWriteOperation,
    renameDialogState,
    newFolderDialogState,
    moveDialogState,
  } = state;
  // Stable per-field setters with the same identities for the lifetime of the
  // component; dispatch never changes.
  const setters = useMemo(
    () => ({
      setContextMenuState: ((value) => dispatch({ key: "contextMenuState", value })) as Dispatch<
        SetStateAction<ContextMenuState | null>
      >,
      setActionNotice: ((value) => dispatch({ key: "actionNotice", value })) as Dispatch<
        SetStateAction<ActionNoticeState>
      >,
      setToasts: ((value) => dispatch({ key: "toasts", value })) as Dispatch<
        SetStateAction<ToastEntry[]>
      >,
      setCopyPasteClipboardState: ((value) =>
        dispatch({ key: "copyPasteClipboard", value })) as Dispatch<
        SetStateAction<CopyPasteClipboardState>
      >,
      setCopyPasteDialogState: ((value) =>
        dispatch({ key: "copyPasteDialogState", value })) as Dispatch<
        SetStateAction<CopyPasteDialogState>
      >,
      setWriteOperationCardState: ((value) =>
        dispatch({ key: "writeOperationCardState", value })) as Dispatch<
        SetStateAction<WriteOperationCardState | null>
      >,
      setWriteOperationProgressEvent: ((value) =>
        dispatch({ key: "writeOperationProgressEvent", value })) as Dispatch<
        SetStateAction<WriteOperationProgressEvent | null>
      >,
      setForeignWriteOperation: ((value) =>
        dispatch({ key: "foreignWriteOperation", value })) as Dispatch<
        SetStateAction<ForeignWriteOperation | null>
      >,
      setRenameDialogState: ((value) => dispatch({ key: "renameDialogState", value })) as Dispatch<
        SetStateAction<RenameDialogState>
      >,
      setNewFolderDialogState: ((value) =>
        dispatch({ key: "newFolderDialogState", value })) as Dispatch<
        SetStateAction<NewFolderDialogState>
      >,
      setMoveDialogState: ((value) => dispatch({ key: "moveDialogState", value })) as Dispatch<
        SetStateAction<MoveDialogState>
      >,
    }),
    [],
  );
  const {
    setContextMenuState,
    setActionNotice,
    setToasts,
    setCopyPasteClipboardState,
    setCopyPasteDialogState,
    setWriteOperationCardState,
    setWriteOperationProgressEvent,
    setForeignWriteOperation,
    setRenameDialogState,
    setNewFolderDialogState,
    setMoveDialogState,
  } = setters;
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
  // The operation another window runs, as soon as its progress arrives (the state follows
  // on the next render), and the item it is on, for the notice when a drag is refused.
  const foreignWriteOperationRef = useRef<
    (ForeignWriteOperation & { currentSourcePath: string | null }) | null
  >(null);
  // An operation this window took over from one that closed: what it leaves selected
  // belonged to that window.
  const adoptedWriteOperationIdRef = useRef<string | null>(null);
  const pendingPasteSelectionRef = useRef<{
    directoryPath: string;
    selectedPaths: string[];
  } | null>(null);
  const pendingTreeSelectionPathRef = useRef<string | null>(null);
  // The tab the running file operation was started from. What follows the operation in the
  // list (selecting what arrived, moving the tree selection) is only done in that tab.
  const writeOperationTabIdRef = useRef<string | null>(null);

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
    foreignWriteOperation,
    setForeignWriteOperation,
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
    foreignWriteOperationRef,
    adoptedWriteOperationIdRef,
    pendingPasteSelectionRef,
    pendingTreeSelectionPathRef,
    writeOperationTabIdRef,
  };
}

export type {
  ContextMenuState,
  CopyPasteDialogState,
  DotNameRequest,
  WriteOperationCardState,
  WriteOperationsState,
};
