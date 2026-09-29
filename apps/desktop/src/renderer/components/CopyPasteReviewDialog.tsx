import { useEffect, useMemo, useRef, useState } from "react";

import type { CopyPasteChoice } from "@filetrail/contracts";

import {
  CHOICE_LABELS,
  type CopyLikeAction,
  type CopyPasteOverrides,
  type CopyPastePolicy,
  type CopyPasteReport,
  type ReviewRow,
  buildReviewRows,
  currentAllConflictsChoice,
  formatReviewSummary,
  getActionVerb,
  leafName,
  pluralize,
  policyForAllConflicts,
  summarizeReview,
} from "../lib/copyPasteReview";

// The sheet shown before a copy, move or duplicate that needs a decision: items that
// already exist at the destination (or a very large operation). Nothing is replaced
// unless the person picks Replace, and the start button says so when they do.
export function CopyPasteReviewDialog({
  action = "paste",
  report,
  policy,
  overrides,
  onChoicesChange,
  onClose,
  onStart,
}: {
  action?: CopyLikeAction;
  report: CopyPasteReport;
  policy: CopyPastePolicy;
  overrides: CopyPasteOverrides;
  onChoicesChange: (choices: { policy: CopyPastePolicy; overrides: CopyPasteOverrides }) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const [showNewItems, setShowNewItems] = useState(false);
  const [starting, setStarting] = useState(false);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const now = useMemo(() => Date.now(), []);
  const verb = getActionVerb(action, report.mode);
  const destinationName = leafName(report.destinationDirectoryPath);

  const summary = useMemo(
    () => summarizeReview({ report, policy, overrides }),
    [report, policy, overrides],
  );
  const hasConflicts = summary.conflictTopLevelCount > 0;
  const rows = useMemo(
    () =>
      buildReviewRows({
        report,
        policy,
        overrides,
        showNewItems: showNewItems || !hasConflicts,
        now,
      }),
    [report, policy, overrides, showNewItems, hasConflicts, now],
  );
  const allConflictsChoice = currentAllConflictsChoice(policy, overrides);
  const replacing = summary.replaced > 0;

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, []);

  function start() {
    if (starting) {
      return;
    }
    setStarting(true);
    onStart();
  }

  function setChoice(row: ReviewRow, choice: CopyPasteChoice) {
    const next = { ...overrides, [row.id]: choice };
    onChoicesChange({ policy, overrides: next });
  }

  const title = hasConflicts
    ? summary.topLevelCount === 1
      ? `“${leafName(report.nodes[0]?.sourcePath ?? "")}” already exists in “${destinationName}”`
      : `${summary.conflictTopLevelCount} of ${pluralize(summary.topLevelCount, "item")} already exist in “${destinationName}”`
    : `${verb} ${pluralize(summary.topLevelCount, "item")} into “${destinationName}”?`;
  const message = hasConflicts
    ? summary.newTopLevelCount > 0
      ? `Nothing is replaced unless you choose Replace. The other ${pluralize(summary.newTopLevelCount, "item")} will be added.`
      : "Nothing is replaced unless you choose Replace."
    : `This is a large operation (${pluralize(report.summary.totalNodeCount, "item")} in total).`;
  const primaryLabel = replacing ? `Replace ${summary.replaced} and ${verb}` : verb;

  return (
    <div className="action-notice-backdrop copy-paste-sheet-backdrop" role="presentation">
      <dialog
        className="copy-paste-sheet"
        aria-label={title}
        aria-modal="true"
        open
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Return starts the operation, unless it replaces something: that takes a click.
          if (
            event.key === "Enter" &&
            !replacing &&
            !(event.target instanceof HTMLSelectElement) &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            start();
          }
        }}
      >
        <header className="copy-paste-sheet-header">
          <StackGlyph />
          <div className="copy-paste-sheet-heading">
            <h2 className="copy-paste-sheet-title">{title}</h2>
            <p className="copy-paste-sheet-message">{message}</p>
          </div>
        </header>

        {hasConflicts ? (
          <div className="copy-paste-sheet-bar">
            <label className="copy-paste-sheet-bar-label" htmlFor="copy-paste-all-conflicts">
              For all conflicts:
            </label>
            <select
              id="copy-paste-all-conflicts"
              className="copy-paste-choice"
              value={allConflictsChoice ?? "mixed"}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "keep_both" || value === "overwrite" || value === "skip") {
                  onChoicesChange({ policy: policyForAllConflicts(value), overrides: {} });
                }
              }}
            >
              {allConflictsChoice === null ? (
                <option value="mixed" disabled>
                  Mixed
                </option>
              ) : null}
              <option value="keep_both">Keep Both</option>
              <option value="overwrite">Replace</option>
              <option value="skip">Skip</option>
            </select>
            {allConflictsChoice === "keep_both" && report.summary.directoryConflictCount > 0 ? (
              <span className="copy-paste-sheet-bar-note">Folders merge</span>
            ) : null}
            <span className="copy-paste-sheet-bar-spacer" />
            {summary.newTopLevelCount > 0 ? (
              <button
                type="button"
                className="copy-paste-sheet-link"
                aria-expanded={showNewItems}
                onClick={() => setShowNewItems((value) => !value)}
              >
                {showNewItems
                  ? "Hide new items"
                  : `Show ${pluralize(summary.newTopLevelCount, "new item")}`}
              </button>
            ) : null}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <ul className="copy-paste-sheet-list" aria-label="Items">
            {rows.map((row) => (
              <ReviewRowItem
                key={row.id}
                row={row}
                verb={verb}
                onChoiceChange={(choice) => setChoice(row, choice)}
              />
            ))}
          </ul>
        ) : null}

        <footer className="copy-paste-sheet-footer">
          {replacing ? (
            <p className="copy-paste-sheet-footer-note is-warning">
              <WarningGlyph />
              {summary.replaced === 1
                ? "1 existing item will be moved to the Trash"
                : `${summary.replaced} existing items will be moved to the Trash`}
            </p>
          ) : (
            <p className="copy-paste-sheet-footer-note">{formatReviewSummary(summary)}</p>
          )}
          <button type="button" className="tb-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={primaryButtonRef}
            type="button"
            className={`tb-btn ${replacing ? "danger" : "primary"}`}
            disabled={starting}
            onClick={start}
          >
            {primaryLabel}
          </button>
        </footer>
      </dialog>
    </div>
  );
}

function ReviewRowItem({
  row,
  verb,
  onChoiceChange,
}: {
  row: ReviewRow;
  verb: string;
  onChoiceChange: (choice: CopyPasteChoice) => void;
}) {
  return (
    <li
      className={`copy-paste-sheet-row is-${row.tone}${row.choice === "overwrite" ? " is-replacing" : ""}`}
      style={{ paddingLeft: `${24 + row.depth * 32}px` }}
    >
      {row.kind === "folder" ? <FolderGlyph /> : <FileGlyph />}
      <div className="copy-paste-sheet-row-text">
        <div className="copy-paste-sheet-row-name">
          {row.name}
          {row.keepBothName ? (
            <span className="copy-paste-sheet-row-rename"> → {row.keepBothName}</span>
          ) : null}
        </div>
        <div className="copy-paste-sheet-row-detail">{row.detail}</div>
      </div>
      {row.choice === null ? (
        <span className="copy-paste-sheet-row-added">{verb === "Move" ? "Moves" : "Adds"}</span>
      ) : (
        <select
          className={`copy-paste-choice${row.choice === "overwrite" ? " is-danger" : ""}`}
          aria-label={`Choice for ${row.name}`}
          value={row.choice}
          onChange={(event) => onChoiceChange(event.target.value as CopyPasteChoice)}
        >
          {row.choices.map((choice) => {
            const blocked = choice === "overwrite" && row.replaceBlockedReason !== null;
            return (
              <option key={choice} value={choice} disabled={blocked}>
                {blocked
                  ? `${CHOICE_LABELS[choice]} (${row.replaceBlockedReason})`
                  : CHOICE_LABELS[choice]}
              </option>
            );
          })}
        </select>
      )}
    </li>
  );
}

function StackGlyph() {
  return (
    <svg className="copy-paste-sheet-glyph" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="9" y="4" width="22" height="28" rx="3" className="copy-paste-glyph-sheet" />
      <rect x="4" y="9" width="22" height="28" rx="3" className="copy-paste-glyph-sheet-back" />
      <path d="M29 22l6 6-6 6" className="copy-paste-glyph-arrow" />
    </svg>
  );
}

function FolderGlyph() {
  return (
    <svg className="copy-paste-row-glyph" viewBox="0 0 20 16" aria-hidden="true">
      <path
        d="M1 3a2 2 0 0 1 2-2h4.5l2 2H17a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z"
        className="copy-paste-glyph-folder"
      />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg className="copy-paste-row-glyph" viewBox="0 0 16 20" aria-hidden="true">
      <path
        d="M2 1h8l5 5v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
        className="copy-paste-glyph-file"
      />
      <path d="M10 1v5h5" className="copy-paste-glyph-file-fold" />
    </svg>
  );
}

function WarningGlyph() {
  return (
    <svg className="copy-paste-warning-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5 15 14H1z" className="copy-paste-glyph-warning" />
      <path d="M8 6v3.6M8 11.4v.1" className="copy-paste-glyph-warning-mark" />
    </svg>
  );
}
