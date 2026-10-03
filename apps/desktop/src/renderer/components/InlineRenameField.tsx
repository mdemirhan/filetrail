import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { splitDisplayName } from "../lib/formatting";

// The name of a list item, edited in place like Finder: Return (or clicking elsewhere)
// applies the new name and Escape leaves it as it was. A file's extension starts outside
// the selection, so typing replaces the name and keeps the type.
export function InlineRenameField({
  name,
  extension,
  error,
  refusalCount = 0,
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
  onSubmit: (nextName: string) => void;
  onCancel: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  // Set once a name has been handed over, so the blur that follows does not submit again.
  const submittedRef = useRef(false);
  // The name the last error is about; it is not sent again until it has been edited.
  const refusedNameRef = useRef<string | null>(null);
  const [errorPosition, setErrorPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    input.setSelectionRange(0, splitDisplayName(name, extension).stem.length);
  }, [extension, name]);

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
      onCancel();
      return;
    }
    if (draftName === refusedNameRef.current) {
      // Already refused: Return keeps the field open to fix it, leaving the field gives up.
      if (trigger === "blur") {
        onCancel();
      }
      return;
    }
    submittedRef.current = true;
    onSubmit(draftName);
  }

  return (
    <>
      <input
        ref={inputRef}
        className={`inline-rename-input${error ? " invalid" : ""}`}
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
          setErrorPosition(null);
        }}
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
            onCancel();
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
