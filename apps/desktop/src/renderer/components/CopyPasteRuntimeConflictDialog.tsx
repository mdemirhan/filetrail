export function CopyPasteRuntimeConflictDialog({
  title,
  message,
  actions,
  onCancel,
}: {
  title: string;
  message: string;
  actions: Array<{
    label: string;
    onClick: () => void;
    destructive?: boolean;
  }>;
  onCancel: () => void;
}) {
  return (
    <div className="action-notice-backdrop" role="presentation">
      <dialog
        className="action-notice-dialog copy-paste-dialog"
        aria-label={title}
        aria-modal="true"
        open
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="action-notice-title">{title}</div>
        <p className="action-notice-message">{message}</p>
        <div className="action-notice-actions">
          <button type="button" className="tb-btn" onClick={onCancel}>
            Cancel Operation
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`tb-btn${action.destructive ? " danger" : " primary"}`}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </dialog>
    </div>
  );
}
