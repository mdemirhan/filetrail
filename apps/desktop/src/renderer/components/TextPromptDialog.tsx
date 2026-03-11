import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { getFocusableElements } from "../lib/focusUtils";

export function TextPromptDialog({
  open,
  title,
  message,
  label,
  value,
  placeholder,
  submitLabel,
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
  error: string | null;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(open);
  const focusedOpenRef = useRef(open);
  const onCloseRef = useRef(onClose);

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
    input.focus({ preventScroll: true });
    const caretIndex = input.value.length;
    input.setSelectionRange(caretIndex, caretIndex);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
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

  return (
    <div className="action-notice-backdrop" role="presentation">
      <dialog
        ref={dialogRef}
        open
        className="action-notice-dialog copy-paste-dialog"
        aria-label={title}
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          onCloseRef.current();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.key !== "Tab") {
            return;
          }
          const dialog = dialogRef.current;
          if (!dialog) {
            return;
          }
          const focusableElements = getFocusableElements(dialog);
          if (focusableElements.length === 0) {
            return;
          }
          const activeElement = document.activeElement;
          const currentIndex =
            activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1;
          const nextIndex = event.shiftKey
            ? currentIndex <= 0
              ? focusableElements.length - 1
              : currentIndex - 1
            : currentIndex < 0 || currentIndex >= focusableElements.length - 1
              ? 0
              : currentIndex + 1;
          event.preventDefault();
          focusableElements[nextIndex]?.focus();
        }}
      >
        <div className="action-notice-title">{title}</div>
        {message ? <p className="action-notice-message">{message}</p> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const nextValue = draftValue.trim();
            if (nextValue.length === 0) {
              return;
            }
            onSubmit(nextValue);
          }}
          style={{ display: "grid", gap: "10px" }}
        >
          <label
            htmlFor="text-prompt-dialog-input"
            style={{ fontSize: "12px", color: "var(--text-secondary, #8a8e9c)" }}
          >
            {label}
          </label>
          <input
            ref={inputRef}
            id="text-prompt-dialog-input"
            value={draftValue}
            placeholder={placeholder}
            onChange={(event) => setDraftValue(event.currentTarget.value)}
            spellCheck={false}
            autoComplete="off"
            style={{
              width: "100%",
              height: "34px",
              padding: "0 10px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              color: "inherit",
              fontSize: "13px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {error ? (
            <div
              style={{
                fontSize: "12px",
                color: "#ff8d8d",
                lineHeight: "1.4",
              }}
            >
              {error}
            </div>
          ) : null}
          <div className="action-notice-actions">
            <button type="button" className="tb-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="tb-btn primary"
              disabled={draftValue.trim().length === 0}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
