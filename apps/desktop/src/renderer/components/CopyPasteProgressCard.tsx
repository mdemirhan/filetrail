import { offsetAboveBars, useBottomOffset } from "../lib/bottomStack";
import { PushButton } from "./PushButton";

// A file operation that is running, on the notifications' surface at the bottom right:
// what it is doing, how far along it is, the item it is on, and Stop.
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
  const roundedPercent = Math.round(clampedPercent);
  // Above the path bar and the Info Row, measured once when the operation starts.
  const bottom = useBottomOffset(offsetAboveBars, title);

  return (
    <section className="copy-paste-progress-card" aria-label={title} style={{ bottom }}>
      <header className="copy-paste-progress-card-header">
        <span className="copy-paste-progress-card-title">{title}</span>
        <span className="copy-paste-progress-card-percent" aria-label={`${roundedPercent} percent`}>
          {roundedPercent}%
        </span>
      </header>
      <div className="copy-paste-progress-card-track" aria-hidden="true">
        <div
          className="copy-paste-progress-card-track-fill"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      <div className="copy-paste-progress-card-detail" title={detailValue}>
        <span className="copy-paste-progress-card-detail-label">{detailLabel}</span>
        <span className="copy-paste-progress-card-detail-value">{detailValue}</span>
      </div>
      <footer className="copy-paste-progress-card-footer">
        <span className="copy-paste-progress-card-meta">
          {progressMetaStart} · {progressMetaEnd}
        </span>
        <PushButton className="is-small" onClick={onCancel}>
          Stop
        </PushButton>
      </footer>
    </section>
  );
}
