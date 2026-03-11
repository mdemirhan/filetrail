export function CopyPasteRuntimeConflictDialog({
  title,
  summary,
  sourcePath,
  sourceDetail,
  destinationPath,
  destinationDetail,
  changeExplanation,
  actions,
  cancelLabel,
  onCancel,
}: {
  title: string;
  summary: string;
  sourcePath: string;
  sourceDetail: string;
  destinationPath: string;
  destinationDetail: string;
  changeExplanation: string;
  actions: Array<{
    label: string;
    description: string;
    onClick: () => void;
    destructive?: boolean;
  }>;
  cancelLabel: string;
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
        <p className="action-notice-message">{summary}</p>
        <div className="copy-paste-runtime-conflict-body">
          <RuntimeConflictSection label="Source" path={sourcePath} detail={sourceDetail} />
          <RuntimeConflictSection
            label="Destination"
            path={destinationPath}
            detail={destinationDetail}
          />
          <div>
            <div className="action-notice-title copy-paste-runtime-conflict-section-title">
              What Changed
            </div>
            <p className="action-notice-message copy-paste-runtime-conflict-section-message">
              {changeExplanation}
            </p>
          </div>
          <div>
            <div className="action-notice-title copy-paste-runtime-conflict-section-title">
              Continue With
            </div>
            <div className="copy-paste-runtime-conflict-actions">
              {actions.map((action) => (
                <div key={action.label} className="copy-paste-runtime-conflict-action-row">
                  <button
                    type="button"
                    className={`tb-btn${action.destructive ? " danger" : " primary"}`}
                    onClick={action.onClick}
                  >
                    {action.label}
                  </button>
                  <p className="action-notice-message copy-paste-runtime-conflict-action-description">
                    {action.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="action-notice-actions copy-paste-runtime-conflict-footer">
          <button type="button" className="tb-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function RuntimeConflictSection({
  label,
  path,
  detail,
}: {
  label: string;
  path: string;
  detail: string;
}) {
  return (
    <div>
      <div className="action-notice-title copy-paste-runtime-conflict-section-title">
        {label}
      </div>
      <p className="action-notice-message copy-paste-runtime-conflict-path">{path}</p>
      <p className="action-notice-message copy-paste-runtime-conflict-detail">
        {detail}
      </p>
    </div>
  );
}
