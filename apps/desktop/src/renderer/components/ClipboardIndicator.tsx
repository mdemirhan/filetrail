import type { ClipboardSummary } from "../lib/copyPasteClipboard";

// Says what is on the clipboard while it holds files. With tabs, the items that were
// copied or cut are often in a tab that is no longer on screen.
export function ClipboardIndicator({ summary }: { summary: ClipboardSummary }) {
  return (
    <span className="clipboard-indicator" title={summary.tooltip}>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="clipboard-indicator-icon">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </svg>
      {summary.label}
    </span>
  );
}
