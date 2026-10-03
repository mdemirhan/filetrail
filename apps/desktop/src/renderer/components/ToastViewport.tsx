import { useEffect, useRef } from "react";

import { offsetAboveBarsAndCard, useBottomOffset } from "../lib/bottomStack";
import type { ToastEntry, ToastKind } from "../lib/toasts";

// Solid marks in the kind's color; the sign inside is cut out in the card's own color.
function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") {
    return (
      <svg aria-hidden="true" className="toast-card-icon-svg" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path className="toast-card-icon-sign" d="M5 8.3l2.1 2.1L11.2 6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="toast-card-icon-svg" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path className="toast-card-icon-sign" d="M8 7.6v3.6" />
      <path className="toast-card-icon-sign" d="M8 4.9h.01" />
    </svg>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  progressCardShown = false,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: string) => void;
  /** A running operation's card comes and goes under the notifications. */
  progressCardShown?: boolean;
}) {
  const timersRef = useRef<Record<string, { expiresAt: number; timer: number }>>({});
  const newestToastId = toasts[toasts.length - 1]?.id ?? null;
  // Notifications rest above the path bar, the Info Row and a running operation's card, so
  // the item count, the selection's details and the progress stay readable. Measured again
  // when a notification arrives and when the card appears or goes.
  const restBottom = useBottomOffset(
    offsetAboveBarsAndCard,
    newestToastId === null ? null : `${newestToastId}:${progressCardShown}`,
  );

  useEffect(() => {
    const activeTimers = timersRef.current;
    const nextToastIds = new Set(toasts.map((toast) => toast.id));

    for (const toast of toasts) {
      const existing = activeTimers[toast.id];
      if (existing && existing.expiresAt === toast.expiresAt) {
        continue;
      }
      if (existing) {
        window.clearTimeout(existing.timer);
      }
      activeTimers[toast.id] = {
        expiresAt: toast.expiresAt,
        timer: window.setTimeout(
          () => {
            delete activeTimers[toast.id];
            onDismiss(toast.id);
          },
          Math.max(0, toast.expiresAt - Date.now()),
        ),
      };
    }

    for (const [toastId, entry] of Object.entries(activeTimers)) {
      if (nextToastIds.has(toastId)) {
        continue;
      }
      window.clearTimeout(entry.timer);
      delete activeTimers[toastId];
    }
  }, [onDismiss, toasts]);

  useEffect(() => {
    return () => {
      for (const entry of Object.values(timersRef.current)) {
        window.clearTimeout(entry.timer);
      }
      timersRef.current = {};
    };
  }, []);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="toast-viewport"
      data-testid="toast-viewport"
      style={{ bottom: `${restBottom}px` }}
    >
      {toasts.map((toast) => {
        return (
          // An <output> is a status that is read out politely; its parts are spans, as an
          // output holds only text-level content.
          <output
            key={toast.id}
            className={`toast-card toast-card-${toast.kind}`}
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="toast-card-body">
              <span className="toast-card-icon-wrap" aria-hidden="true">
                <ToastIcon kind={toast.kind} />
              </span>
              <span className="toast-card-copy">
                <span className="toast-card-title">{toast.title}</span>
                {toast.message ? <span className="toast-card-message">{toast.message}</span> : null}
              </span>
            </span>
          </output>
        );
      })}
    </div>
  );
}
