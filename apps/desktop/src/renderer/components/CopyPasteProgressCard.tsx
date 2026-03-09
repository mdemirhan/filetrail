function CopyPasteGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="copy-paste-progress-card-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

function CancelGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="copy-paste-progress-card-cancel-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function CopyPasteProgressCard({
  title,
  progressPercent,
  progressMetaStart,
  progressMetaEnd,
  detailLabel,
  detailValue,
  onCancel,
}: {
  title: string;
  progressPercent: number;
  progressMetaStart: string;
  progressMetaEnd: string;
  detailLabel: string;
  detailValue: string;
  onCancel: () => void;
}) {
  const clampedPercent = Math.max(0, Math.min(100, progressPercent));

  return (
    <section className="copy-paste-progress-card" role="region" aria-label={title}>
      <div className="copy-paste-progress-card-top-rail" aria-hidden="true">
        <div
          className="copy-paste-progress-card-top-rail-fill"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      <div className="copy-paste-progress-card-body">
        <header className="copy-paste-progress-card-header">
          <div className="copy-paste-progress-card-heading">
            <div className="copy-paste-progress-card-icon-wrap">
              <CopyPasteGlyph />
            </div>
            <div className="copy-paste-progress-card-heading-copy">
              <div className="copy-paste-progress-card-title">{title}</div>
            </div>
          </div>
          <div
            className="copy-paste-progress-card-percent"
            aria-label={`${Math.round(clampedPercent)} percent`}
          >
            {Math.round(clampedPercent)}
            <span className="copy-paste-progress-card-percent-unit">%</span>
          </div>
        </header>

        <div className="copy-paste-progress-card-track" aria-hidden="true">
          <div
            className="copy-paste-progress-card-track-fill"
            style={{ width: `${clampedPercent}%` }}
          >
            <div className="copy-paste-progress-card-track-shimmer" />
          </div>
        </div>

        <div className="copy-paste-progress-card-meta">
          <span className="copy-paste-progress-card-meta-primary">{progressMetaStart}</span>
          <span className="copy-paste-progress-card-meta-secondary">{progressMetaEnd}</span>
        </div>

        <div className="copy-paste-progress-card-detail-panel">
          <div className="copy-paste-progress-card-detail-label">{detailLabel}</div>
          <div className="copy-paste-progress-card-detail-value">{detailValue}</div>
        </div>

        <div className="copy-paste-progress-card-actions">
          <button type="button" className="copy-paste-progress-card-cancel" onClick={onCancel}>
            <CancelGlyph />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </section>
  );
}
