import { useEffect, useRef } from "react";

import { getFocusableElements } from "../lib/focusUtils";

export function CopyPasteDialog({
  title,
  message,
  detailLines = [],
  progressLabel = null,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  message: string;
  detailLines?: string[];
  progressLabel?: string | null | undefined;
  primaryAction?:
    | {
        label: string;
        onClick: () => void;
        destructive?: boolean | undefined;
      }
    | undefined;
  secondaryAction?:
    | {
        label: string;
        onClick: () => void;
      }
    | undefined;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const secondaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const target = primaryButtonRef.current ?? secondaryButtonRef.current ?? dialogRef.current;
    target?.focus();
  }, []);

  return (
    <div className="action-notice-backdrop" role="presentation">
      <dialog
        ref={dialogRef}
        className="action-notice-dialog copy-paste-dialog"
        aria-label={title}
        aria-modal="true"
        open
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === "Enter" && primaryAction) {
            const target = event.target;
            if (!(target instanceof HTMLElement) || target === dialogRef.current) {
              event.preventDefault();
              primaryAction.onClick();
            }
            return;
          }
          if (event.key !== "Tab") {
            return;
          }
          const dialog = dialogRef.current;
          if (!dialog) {
            return;
          }
          const focusableElements = getFocusableElements(dialog, { includeLinks: true });
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
        <p className="action-notice-message">{message}</p>
        {progressLabel ? <p className="copy-paste-progress">{progressLabel}</p> : null}
        {detailLines.length > 0 ? (
          <ul className="copy-paste-detail-list">
            {detailLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="action-notice-actions">
          {secondaryAction ? (
            <button
              ref={secondaryButtonRef}
              type="button"
              className="tb-btn"
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </button>
          ) : null}
          {primaryAction ? (
            <button
              ref={primaryButtonRef}
              type="button"
              className={`tb-btn${primaryAction.destructive ? " danger" : " primary"}`}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
