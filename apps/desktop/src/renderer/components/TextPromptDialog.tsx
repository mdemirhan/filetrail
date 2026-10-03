import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

// Asks for a name (Rename, New Folder) in an alert with a field. Return submits it, Escape
// cancels, and the name is selected (or the caret put at its end) when it opens.

export function TextPromptDialog({
  open,
  title,
  message,
  label,
  value,
  placeholder,
  submitLabel,
  selectAllOnOpen = false,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  message?: string;
  label: string;
  value: string;
  placeholder?: string;
  submitLabel: string;
  selectAllOnOpen?: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const formId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(open);
  const focusedOpenRef = useRef(open);
  const onCloseRef = useRef(onClose);
  const initialSelectionModeRef = useRef<"all" | "end" | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open) {
      setDraftValue(value);
      return;
    }
    if (wasOpen) {
      return;
    }
    setDraftValue(value);
  }, [open, value]);

  useLayoutEffect(() => {
    const wasOpen = focusedOpenRef.current;
    focusedOpenRef.current = open;
    if (!open || wasOpen) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    initialSelectionModeRef.current = selectAllOnOpen ? "all" : "end";
    input.focus({ preventScroll: true });
  }, [open, selectAllOnOpen]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape while text is being composed cancels the composition, not the dialog.
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) {
    return null;
  }

  const trimmed = draftValue.trim();
  return (
    <Alert
      title={title}
      message={message}
      initialFocusRef={inputRef}
      buttons={
        <>
          <PushButton onClick={onClose}>Cancel</PushButton>
          <PushButton type="submit" form={formId} variant="default" disabled={trimmed.length === 0}>
            {submitLabel}
          </PushButton>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length === 0) {
            return;
          }
          onSubmit(trimmed);
        }}
        className="text-prompt-form"
      >
        <input
          ref={inputRef}
          className="text-prompt-input"
          aria-label={label}
          value={draftValue}
          placeholder={placeholder}
          onFocus={(event) => {
            const selectionMode = initialSelectionModeRef.current;
            if (!selectionMode) {
              return;
            }
            initialSelectionModeRef.current = null;
            const input = event.currentTarget;
            window.setTimeout(() => {
              if (inputRef.current !== input || document.activeElement !== input) {
                return;
              }
              if (selectionMode === "all") {
                input.select();
                input.setSelectionRange(0, input.value.length);
                return;
              }
              const caretIndex = input.value.length;
              input.setSelectionRange(caretIndex, caretIndex);
            }, 0);
          }}
          onChange={(event) => setDraftValue(event.currentTarget.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {error ? <div className="text-prompt-error">{error}</div> : null}
      </form>
    </Alert>
  );
}
