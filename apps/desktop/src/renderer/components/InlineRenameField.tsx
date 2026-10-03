import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { splitDisplayName } from "../lib/formatting";

// The rename going on in a list, as the panes are told of it.
export type InlineRenameState = {
  path: string;
  error: string | null;
  refusalCount?: number;
  sessionId?: number;
};

export function renameDraftKey(state: InlineRenameState): string | undefined {
  return state.sessionId === undefined ? undefined : `rename-${state.sessionId}`;
}

// What has been typed into a rename, kept outside the field: the list shows only the rows
// in view and draws a row again when it moves (a re-sort, an item added before it), so the
// field can be replaced while the name is being edited. The new one carries on from here.
type RenameDraft = { value: string; selectionStart: number; selectionEnd: number };
const renameDrafts = new Map<string, RenameDraft>();
const MAX_KEPT_DRAFTS = 8;

function keepDraft(key: string, draft: RenameDraft) {
  renameDrafts.delete(key);
  renameDrafts.set(key, draft);
  while (renameDrafts.size > MAX_KEPT_DRAFTS) {
    renameDrafts.delete(renameDrafts.keys().next().value as string);
  }
}

// The name of a list item, edited in place like Finder: Return (or clicking elsewhere)
// applies the new name and Escape leaves it as it was. A file's extension starts outside
// the selection, so typing replaces the name and keeps the type.
export function InlineRenameField({
  name,
  extension,
  error,
  refusalCount = 0,
  draftKey,
  hidden = false,
  onSubmit,
  onCancel,
}: {
  name: string;
  extension: string;
  /** Why the last attempt was refused; the field stays open so the name can be fixed. */
  error: string | null;
  /**
   * Goes up with every refusal. Two names can be refused for the same reason in a row (both
   * with a "/", or while another write runs), and the field must hear of the second one too.
   */
  refusalCount?: number;
  /** One rename of one item: a field drawn again for it carries on with what was typed. */
  draftKey?: string | undefined;
  /**
   * Kept off screen while its row is scrolled out of view, so the keyboard stays in the
   * name being edited; the row's own field takes over when it is back.
   */
  hidden?: boolean;
  onSubmit: (nextName: string) => void;
  onCancel: () => void;
}) {
  const [draftName, setDraftName] = useState(() =>
    draftKey === undefined ? name : (renameDrafts.get(draftKey)?.value ?? name),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  // Set once a name has been handed over, so the blur that follows does not submit again.
  const submittedRef = useRef(false);
  // The name the last error is about; it is not sent again until it has been edited.
  const refusedNameRef = useRef<string | null>(null);
  const [errorPosition, setErrorPosition] = useState<{ left: number; top: number } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a kept draft is read once, when this field takes over the rename.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const kept = draftKey === undefined ? undefined : renameDrafts.get(draftKey);
    if (kept) {
      input.setSelectionRange(kept.selectionStart, kept.selectionEnd);
      return;
    }
    input.setSelectionRange(0, splitDisplayName(name, extension).stem.length);
  }, [extension, name]);

  function rememberDraft(input: HTMLInputElement) {
    if (draftKey === undefined) {
      return;
    }
    keepDraft(draftKey, {
      value: input.value,
      selectionStart: input.selectionStart ?? input.value.length,
      selectionEnd: input.selectionEnd ?? input.value.length,
    });
  }

  function forgetDraft() {
    if (draftKey !== undefined) {
      renameDrafts.delete(draftKey);
    }
  }

  // A refused name hands the keyboard back to the field, with the explanation under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refusalCount marks a new refusal that reads the same as the last one.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!error || !input) {
      setErrorPosition(null);
      return;
    }
    submittedRef.current = false;
    refusedNameRef.current = input.value;
    input.focus({ preventScroll: true });
    const rect = input.getBoundingClientRect();
    setErrorPosition({ left: rect.left, top: rect.bottom + 4 });
  }, [error, refusalCount]);
  useKeepInViewport(errorRef, errorPosition !== null);

  // Scrolling moves the row away from the explanation, so it is dropped until the next try.
  useEffect(() => {
    if (!errorPosition) {
      return;
    }
    const hide = () => setErrorPosition(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [errorPosition]);

  function commit(trigger: "enter" | "blur") {
    if (submittedRef.current) {
      return;
    }
    // An unchanged or emptied name means there is nothing to rename.
    if (draftName === name || draftName.trim().length === 0) {
      cancel();
      return;
    }
    if (draftName === refusedNameRef.current) {
      // Already refused: Return keeps the field open to fix it, leaving the field gives up.
      if (trigger === "blur") {
        cancel();
      }
      return;
    }
    submittedRef.current = true;
    onSubmit(draftName);
  }

  function cancel() {
    forgetDraft();
    onCancel();
  }

  return (
    <>
      <input
        ref={inputRef}
        className={`inline-rename-input${error ? " invalid" : ""}${hidden ? " offscreen" : ""}`}
        type="text"
        aria-label={`Rename ${name}`}
        aria-invalid={error ? true : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        value={draftName}
        onChange={(event) => {
          setDraftName(event.currentTarget.value);
          rememberDraft(event.currentTarget);
          setErrorPosition(null);
        }}
        onSelect={(event) => rememberDraft(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commit("enter");
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            submittedRef.current = true;
            cancel();
          }
        }}
        onBlur={() => commit("blur")}
        // The row underneath selects, opens and drags on these; the field keeps them.
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
      />
      {error && errorPosition
        ? createPortal(
            <div
              ref={errorRef}
              className="inline-rename-error"
              role="alert"
              style={{ left: `${errorPosition.left}px`, top: `${errorPosition.top}px` }}
            >
              {error}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// The item being renamed when its row is scrolled out of the rows drawn (see
// OffscreenRenameField), or null.
export function findOffscreenRenameEntry<T extends { path: string }>(
  entries: readonly T[],
  visibleEntries: readonly T[],
  inlineRename: InlineRenameState | null,
): T | null {
  if (!inlineRename || visibleEntries.some((entry) => entry.path === inlineRename.path)) {
    return null;
  }
  return entries.find((entry) => entry.path === inlineRename.path) ?? null;
}

// Only the rows in view are drawn, so scrolling away takes the row being renamed with it.
// Its name stays being edited here, off screen, with the keyboard; the row's own field
// takes over again, with what was typed, when it is scrolled back.
export function OffscreenRenameField({
  entry,
  inlineRename,
  onSubmit,
  onCancel,
}: {
  entry: { name: string; extension: string };
  inlineRename: InlineRenameState;
  onSubmit: (nextName: string) => void;
  onCancel: () => void;
}) {
  return (
    <InlineRenameField
      hidden
      name={entry.name}
      extension={entry.extension}
      error={inlineRename.error}
      refusalCount={inlineRename.refusalCount ?? 0}
      draftKey={renameDraftKey(inlineRename)}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}
