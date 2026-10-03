import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { ToastEntry, ToastKind } from "../lib/toasts";
import { ClipboardItemsIcon } from "./ClipboardItemsIcon";

// Notifications rest just above the path bar, and the Info Row when it is open, so the
// item count and the selection's details under them stay readable.
const TOAST_GAP_ABOVE_BARS = 10;
// Where nothing is at the bottom of the window (search results, Help).
const TOAST_EDGE_OFFSET_BOTTOM = 12;

function restOffsetBottom(): number {
  const bars = Array.from(document.querySelectorAll<HTMLElement>(".content-pathbar-row")).find(
    (element) => element.getClientRects().length > 0,
  );
  if (!bars) {
    return TOAST_EDGE_OFFSET_BOTTOM;
  }
  const top = bars.getBoundingClientRect().top;
  return Math.max(
    TOAST_EDGE_OFFSET_BOTTOM,
    Math.round(window.innerHeight - top + TOAST_GAP_ABOVE_BARS),
  );
}

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
  if (kind === "warning") {
    return (
      <svg aria-hidden="true" className="toast-card-icon-svg" viewBox="0 0 16 16">
        <path
          d="M8 2.2 14.4 13.4H1.6Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path className="toast-card-icon-sign" d="M8 6v3.4" />
        <path className="toast-card-icon-sign" d="M8 11.6h.01" />
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
  offsetBottom,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: string) => void;
  offsetBottom?: number | undefined;
}) {
  const timersRef = useRef<Record<string, { expiresAt: number; timer: number }>>({});
  const [restBottom, setRestBottom] = useState(TOAST_EDGE_OFFSET_BOTTOM);
  const newestToastId = toasts[toasts.length - 1]?.id;

  // Measured as each notification arrives, and while they are on screen: the bars under
  // the list come and go (the Info Row, search results), and the window can be resized.
  useLayoutEffect(() => {
    if (newestToastId === undefined || offsetBottom !== undefined) {
      return;
    }
    const measure = () => setRestBottom(restOffsetBottom());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [newestToastId, offsetBottom]);

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
      style={{ bottom: `${offsetBottom ?? restBottom}px` }}
    >
      {toasts.map((toast) => {
        const isAssertive = toast.kind === "warning";
        return (
          <section
            key={toast.id}
            className={`toast-card toast-card-${toast.kind}`}
            role={isAssertive ? "alert" : "status"}
            aria-live={isAssertive ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <div className="toast-card-body">
              {toast.icon ? (
                // What was copied or cut, drawn as the file list draws it.
                <div className="toast-card-icon-wrap toast-card-item-icon" aria-hidden="true">
                  <ClipboardItemsIcon icon={toast.icon} />
                </div>
              ) : (
                <div className="toast-card-icon-wrap" aria-hidden="true">
                  <ToastIcon kind={toast.kind} />
                </div>
              )}
              <div className="toast-card-copy">
                <div className="toast-card-title">{toast.title}</div>
                {toast.message ? <div className="toast-card-message">{toast.message}</div> : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
