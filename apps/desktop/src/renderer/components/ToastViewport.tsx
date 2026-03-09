import { useEffect } from "react";

import type { ToastEntry } from "../lib/toasts";

export function ToastViewport({
  toasts,
  onDismiss,
  offsetBottom = 16,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: string) => void;
  offsetBottom?: number | undefined;
}) {
  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        onDismiss(toast.id);
      }, Math.max(0, toast.expiresAt - Date.now())),
    );
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [onDismiss, toasts]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-viewport" data-testid="toast-viewport" style={{ bottom: `${offsetBottom}px` }}>
      {toasts.map((toast) => {
        const isAssertive = toast.kind === "warning" || toast.kind === "error";
        return (
          <section
            key={toast.id}
            className={`toast-card toast-card-${toast.kind}`}
            role={isAssertive ? "alert" : "status"}
            aria-live={isAssertive ? "assertive" : "polite"}
            aria-atomic="true"
          >
            <div className="toast-card-title">{toast.title}</div>
            {toast.message ? <div className="toast-card-message">{toast.message}</div> : null}
          </section>
        );
      })}
    </div>
  );
}
