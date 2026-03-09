export function CopyPasteProgressCard({
  title,
  message,
  progressLabel,
  detailLines = [],
  onCancel,
}: {
  title: string;
  message: string;
  progressLabel: string | null;
  detailLines?: string[];
  onCancel: () => void;
}) {
  return (
    <section className="copy-paste-progress-card" role="region" aria-label={title}>
      <div className="copy-paste-progress-card-title">{title}</div>
      <p className="copy-paste-progress-card-message">{message}</p>
      {progressLabel ? <p className="copy-paste-progress-card-label">{progressLabel}</p> : null}
      {detailLines.length > 0 ? (
        <ul className="copy-paste-progress-card-details">
          {detailLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="copy-paste-progress-card-actions">
        <button type="button" className="tb-btn" onClick={onCancel}>
          Cancel Operation
        </button>
      </div>
    </section>
  );
}
