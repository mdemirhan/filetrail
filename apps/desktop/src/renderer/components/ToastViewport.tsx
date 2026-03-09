import { useEffect, useRef } from "react";

import type { ToastEntry, ToastKind } from "../lib/toasts";

function ToastIcon({ kind }: { kind: ToastKind }) {
  if (kind === "success") {
    return (
      <svg
        aria-hidden="true"
        className="toast-card-icon-svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg
        aria-hidden="true"
        className="toast-card-icon-svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
    );
  }
  if (kind === "warning") {
    return (
      <svg
        aria-hidden="true"
        className="toast-card-icon-svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86 1.82 18A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="toast-card-icon-svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  offsetBottom = 16,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: string) => void;
  offsetBottom?: number | undefined;
}) {
  const timersRef = useRef<Record<string, { expiresAt: number; timer: number }>>({});

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
      style={{ bottom: `${offsetBottom}px` }}
    >
      {toasts.map((toast) => {
        const isAssertive = toast.kind === "warning" || toast.kind === "error";
        const hasMessage = typeof toast.message === "string" && toast.message.length > 0;
        return (
          <section
            key={toast.id}
            className={`toast-card toast-card-${toast.kind}${hasMessage ? "" : " toast-card-compact"}`}
            role={isAssertive ? "alert" : "status"}
            aria-live={isAssertive ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <div className="toast-card-body">
              <div className="toast-card-icon-wrap" aria-hidden="true">
                <ToastIcon kind={toast.kind} />
              </div>
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
