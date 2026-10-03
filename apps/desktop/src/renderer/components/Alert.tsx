import { type ReactNode, type RefObject, useId, useRef } from "react";

import { useDialogFocus } from "./useDialogFocus";

// A macOS alert: a bold title and a short message, centered on a compact panel over the
// window, with the buttons across the bottom (the default on the right). No icon: the
// window it belongs to says which app is asking.
// The wide form keeps the same panel for alerts that show more (a comparison, a choice
// for the rest of the operation), with the buttons in a row on the right.
//
// The window behind is dimmed but not blurred, and a click outside does nothing: an alert
// is answered with one of its buttons, Return (the default button) or Escape.
export function Alert({
  title,
  message,
  wide = false,
  stackedButtons = false,
  initialFocusRef,
  onReturn,
  onEscape,
  children,
  buttons,
  className,
}: {
  title: string;
  message?: ReactNode;
  wide?: boolean;
  /** Three or more buttons are stacked, each as wide as the panel. */
  stackedButtons?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** What Return does when no button, menu or field has taken the key. */
  onReturn?: (() => void) | undefined;
  /** Escape and ⌘. — left to the window's shortcuts when not given. */
  onEscape?: (() => void) | undefined;
  /** Shown under the message: a field, a comparison, a checkbox. */
  children?: ReactNode;
  buttons: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  useDialogFocus(dialogRef, initialFocusRef);

  return (
    <div className="modal-scrim" role="presentation">
      <dialog
        ref={dialogRef}
        open
        className={`alert${wide ? " is-wide" : ""}${className ? ` ${className}` : ""}`}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        tabIndex={-1}
        onCancel={(event) => {
          event.preventDefault();
          onEscape?.();
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === "Escape" && onEscape) {
            event.preventDefault();
            onEscape();
            return;
          }
          if (event.key !== "Enter" || !onReturn) {
            return;
          }
          const target = event.target;
          // Buttons, menus, links and fields (which submit their own form) keep Return.
          if (
            target instanceof HTMLElement &&
            target !== dialogRef.current &&
            target.closest("button, select, textarea, input, a[href]")
          ) {
            return;
          }
          event.preventDefault();
          onReturn();
        }}
      >
        <h2 id={titleId} className="alert-title">
          {title}
        </h2>
        {message ? (
          <p id={messageId} className="alert-message">
            {message}
          </p>
        ) : null}
        {children ? <div className="alert-accessory">{children}</div> : null}
        <div className={`alert-buttons${stackedButtons ? " is-stacked" : ""}`}>{buttons}</div>
      </dialog>
    </div>
  );
}
