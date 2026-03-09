import { useEffect, useRef } from "react";

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
  primaryAction?: {
    label: string;
    onClick: () => void;
    destructive?: boolean | undefined;
  } | undefined;
  secondaryAction?: {
    label: string;
    onClick: () => void;
  } | undefined;
}) {
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, []);

  return (
    <div className="action-notice-backdrop" role="presentation">
      <dialog
        className="action-notice-dialog copy-paste-dialog"
        aria-label={title}
        open
        onMouseDown={(event) => event.stopPropagation()}
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
            <button type="button" className="tb-btn" onClick={secondaryAction.onClick}>
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
