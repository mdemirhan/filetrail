import { useEffect, useRef } from "react";

export function ActionNoticeDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div className="action-notice-backdrop" role="presentation" onMouseDown={onClose}>
      <dialog
        className="action-notice-dialog"
        aria-label={title}
        open
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="action-notice-title">{title}</div>
        <p className="action-notice-message">{message}</p>
        <div className="action-notice-actions">
          <button ref={buttonRef} type="button" className="tb-btn primary" onClick={onClose}>
            OK
          </button>
        </div>
      </dialog>
    </div>
  );
}
