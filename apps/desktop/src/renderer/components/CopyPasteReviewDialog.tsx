import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { CopyPasteChoice } from "@filetrail/contracts";

import {
  ALL_CONFLICTS_LABELS,
  type AllConflictsChoice,
  CHOICE_LABELS,
  type CopyLikeAction,
  type CopyPasteOverrides,
  type CopyPastePolicy,
  type CopyPasteReport,
  type ReviewRow,
  allConflictsChoicesFor,
  buildReviewRows,
  currentAllConflictsChoice,
  describeAllConflictsChoice,
  dirnameOf,
  effectiveChoice,
  formatCount,
  formatReviewSummary,
  getActionVerb,
  leafName,
  pluralize,
  policyForAllConflicts,
  summarizeReview,
} from "../lib/copyPasteReview";
import { Alert } from "./Alert";
import { PushButton } from "./PushButton";
import { useDialogFocus } from "./useDialogFocus";

// Rows rendered before "Show all": enough to review by eye, few enough to stay fast when
// thousands of items conflict.
const INITIAL_ROW_LIMIT = 300;
// Nested rows indent up to this depth; deeper rows show their folder path instead.
const MAX_INDENT_DEPTH = 6;
const INDENT_PX = 20;

// The sheet shown before a copy, move or duplicate that needs a decision: items that
// already exist at the destination (or a very large operation). Nothing is replaced
// unless the person picks Replace, and the start button says so when they do. One item
// that already exists gets a plain alert instead, as in Finder.
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
  /**
   * Starts with the choices on screen, or with the ones given (the alert's answer).
   * Resolving to false (or rejecting) means it didn't start, and the button works again.
   */
  onStart: (choices?: {
    policy: CopyPastePolicy;
    overrides: CopyPasteOverrides;
  }) => Promise<boolean>;
}) {
  const [showNewItems, setShowNewItems] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
  const [starting, setStarting] = useState(false);
  // Guards against a second start before the state update above has rendered.
  const startingRef = useRef(false);
  const refocusAfterStartRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  const allConflictsLabelId = useId();
  const allConflictsHintId = useId();
  const [now] = useState(() => Date.now());
  const verb = getActionVerb(action, report.mode);
  const destinationName = leafName(report.destinationDirectoryPath);

  useDialogFocus(dialogRef, primaryButtonRef);

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
  const visibleRows = showAllRows ? rows : rows.slice(0, INITIAL_ROW_LIMIT);
  const hiddenRowCount = rows.length - visibleRows.length;
  const allConflictsChoice = useMemo(
    () => currentAllConflictsChoice(report, policy, overrides),
    [report, policy, overrides],
  );
  const replacing = summary.replaced > 0;

  useEffect(() => {
    if (!starting && refocusAfterStartRef.current) {
      refocusAfterStartRef.current = false;
      primaryButtonRef.current?.focus();
    }
  }, [starting]);

  async function start(choices?: { policy: CopyPastePolicy; overrides: CopyPasteOverrides }) {
    if (startingRef.current) {
      return;
    }
    startingRef.current = true;
    setStarting(true);
    let started = true;
    try {
      started = (await onStart(choices)) !== false;
    } catch {
      started = false;
    }
    if (!started) {
      // Nothing started (the error is reported elsewhere): let the person try again.
      startingRef.current = false;
      refocusAfterStartRef.current = true;
      setStarting(false);
    }
  }

  // Rows get one stable callback, so a change re-renders only the rows that changed.
  const latestChoicesRef = useRef({ policy, overrides, onChoicesChange });
  latestChoicesRef.current = { policy, overrides, onChoicesChange };
  const setChoice = useCallback((row: ReviewRow, choice: CopyPasteChoice) => {
    const latest = latestChoicesRef.current;
    const next = { ...latest.overrides };
    // A choice that matches "For all conflicts" isn't a separate choice for this item.
    if (effectiveChoice(row.node, latest.policy, {}) === choice) {
      delete next[row.id];
    } else {
      next[row.id] = choice;
    }
    latest.onChoicesChange({ policy: latest.policy, overrides: next });
  }, []);

  const conflictCount = summary.conflictTopLevelCount;
  const title = hasConflicts
    ? summary.topLevelCount === 1
      ? `“${leafName(report.nodes[0]?.sourcePath ?? "")}” already exists in “${destinationName}”`
      : `${formatCount(conflictCount)} of ${pluralize(summary.topLevelCount, "item")} already ${
          conflictCount === 1 ? "exists" : "exist"
        } in “${destinationName}”`
    : `${verb} ${pluralize(summary.topLevelCount, "item")} into “${destinationName}”?`;
  const addedVerb = verb === "Move" ? "moved" : "added";
  const message = hasConflicts
    ? summary.newTopLevelCount > 0
      ? `Nothing is replaced unless you choose Replace. ${
          summary.newTopLevelCount === 1
            ? `The other item will be ${addedVerb}.`
            : `The other ${pluralize(summary.newTopLevelCount, "item")} will be ${addedVerb}.`
        }`
      : "Nothing is replaced unless you choose Replace."
    : `This is a large operation (${pluralize(report.summary.totalNodeCount, "item")} in total).`;
  const primaryLabel = replacing ? `Replace ${formatCount(summary.replaced)} and ${verb}` : verb;

  const singleConflict = summary.topLevelCount === 1 ? report.nodes[0] : undefined;
  if (hasConflicts && singleConflict && singleConflict.conflictClass !== null) {
    const node = singleConflict;
    const isFolder = node.conflictClass === "directory_conflict";
    const choose = (choice: CopyPasteChoice) =>
      void start({ policy, overrides: { [node.id]: choice } });
    return (
      <Alert
        title={title}
        message={
          node.replaceBlockedReason === null
            ? `Replace moves the ${isFolder ? "folder" : "item"} there to the Trash.`
            : undefined
        }
        initialFocusRef={primaryButtonRef}
        onReturn={() => choose("keep_both")}
        onEscape={onClose}
        buttons={
          <>
            <PushButton className="alert-button-aside" disabled={starting} onClick={onClose}>
              Cancel
            </PushButton>
            {isFolder && report.mode !== "cut" ? (
              <PushButton disabled={starting} onClick={() => choose("merge")}>
                Add Missing
              </PushButton>
            ) : null}
            {node.replaceBlockedReason === null ? (
              <PushButton
                variant="destructive"
                disabled={starting}
                onClick={() => choose("overwrite")}
              >
                {CHOICE_LABELS.overwrite}
              </PushButton>
            ) : null}
            <PushButton
              ref={primaryButtonRef}
              variant="default"
              disabled={starting}
              aria-busy={starting}
              onClick={() => choose("keep_both")}
            >
              {CHOICE_LABELS.keep_both}
            </PushButton>
          </>
        }
      />
    );
  }

  return (
    <div className="modal-scrim is-sheet" role="presentation">
      <dialog
        ref={dialogRef}
        className="copy-paste-sheet"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        aria-modal="true"
        open
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.defaultPrevented) {
            return;
          }
          const target = event.target;
          const onPrimary = target === primaryButtonRef.current;
          // Other controls (menus, Cancel, links) handle Return themselves.
          if (
            !onPrimary &&
            target instanceof HTMLElement &&
            target.closest("button, select, input, textarea, a[href]")
          ) {
            return;
          }
          // Return starts the operation, unless it replaces something: that takes a click
          // (or Space) on the red button, so it never happens by reflex.
          event.preventDefault();
          if (!replacing) {
            void start();
          }
        }}
      >
        <header className="copy-paste-sheet-header">
          <div className="copy-paste-sheet-heading">
            <h2 id={titleId} className="copy-paste-sheet-title">
              {title}
            </h2>
            <p id={messageId} className="copy-paste-sheet-message">
              {message}
            </p>
          </div>
        </header>

        {hasConflicts ? (
          <div className="copy-paste-sheet-bar">
            <span className="copy-paste-sheet-bar-label" id={allConflictsLabelId}>
              For all conflicts:
            </span>
            <AllConflictsButtons
              labelledBy={allConflictsLabelId}
              describedBy={allConflictsHintId}
              choices={allConflictsChoicesFor(report)}
              value={allConflictsChoice}
              onChange={(choice) =>
                onChoicesChange({ policy: policyForAllConflicts(choice), overrides: {} })
              }
            />
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
            <p id={allConflictsHintId} className="copy-paste-sheet-bar-hint">
              {describeAllConflictsChoice(allConflictsChoice, report)}
            </p>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <ul className="copy-paste-sheet-list" aria-label="Items">
            {visibleRows.map((row) => (
              <ReviewRowItem key={row.id} row={row} verb={verb} onChoiceChange={setChoice} />
            ))}
            {hiddenRowCount > 0 ? (
              <li className="copy-paste-sheet-row copy-paste-sheet-more">
                <button
                  type="button"
                  className="copy-paste-sheet-link"
                  onClick={() => setShowAllRows(true)}
                >
                  Show all {formatCount(rows.length)}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        <footer className="copy-paste-sheet-footer">
          {replacing ? (
            <p className="copy-paste-sheet-footer-note is-warning">
              <WarningGlyph />
              {`${pluralize(summary.replaced, "existing item")} will be moved to the Trash`}
            </p>
          ) : (
            <p className="copy-paste-sheet-footer-note">{formatReviewSummary(summary, verb)}</p>
          )}
          <PushButton onClick={onClose}>Cancel</PushButton>
          <PushButton
            ref={primaryButtonRef}
            variant={replacing ? "destructive" : "default"}
            disabled={starting}
            aria-busy={starting}
            onClick={() => void start()}
          >
            {primaryLabel}
          </PushButton>
        </footer>
      </dialog>
    </div>
  );
}

// A segmented control: one click picks what happens to every conflict. The segments are
// radio buttons, so Tab lands on the selected one and the arrow keys move the choice.
function AllConflictsButtons({
  labelledBy,
  describedBy,
  choices,
  value,
  onChange,
}: {
  labelledBy: string;
  describedBy: string;
  choices: AllConflictsChoice[];
  value: AllConflictsChoice | null;
  onChange: (choice: AllConflictsChoice) => void;
}) {
  const name = useId();
  return (
    <div
      className="copy-paste-segmented"
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
    >
      {choices.map((choice) => (
        <label
          key={choice}
          className={`copy-paste-segment${value === choice ? " is-selected" : ""}${
            choice === "overwrite" ? " is-danger" : ""
          }`}
        >
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={choice}
            checked={value === choice}
            onChange={() => onChange(choice)}
          />
          {ALL_CONFLICTS_LABELS[choice]}
        </label>
      ))}
    </div>
  );
}

const ReviewRowItem = memo(
  function ReviewRowItem({
    row,
    verb,
    onChoiceChange,
  }: {
    row: ReviewRow;
    verb: string;
    onChoiceChange: (row: ReviewRow, choice: CopyPasteChoice) => void;
  }) {
    const indentDepth = Math.min(row.depth, MAX_INDENT_DEPTH);
    const folderHint =
      row.depth > MAX_INDENT_DEPTH ? `in ${dirnameOf(`/${row.relativePath}`).slice(1)}` : null;
    return (
      <li
        className={`copy-paste-sheet-row is-${row.tone}${row.choice === "overwrite" ? " is-replacing" : ""}`}
        style={{ paddingLeft: `${24 + indentDepth * INDENT_PX}px` }}
      >
        {row.kind === "folder" ? <FolderGlyph /> : <FileGlyph />}
        <div className="copy-paste-sheet-row-text">
          <div className="copy-paste-sheet-row-name" title={row.relativePath}>
            {row.name}
            {row.keepBothName ? (
              <span className="copy-paste-sheet-row-rename" title={row.keepBothName}>
                {" "}
                → {row.keepBothName}
              </span>
            ) : null}
          </div>
          {folderHint ? (
            <div className="copy-paste-sheet-row-path" title={folderHint}>
              {folderHint}
            </div>
          ) : null}
          <div className="copy-paste-sheet-row-detail">{row.detail}</div>
        </div>
        {row.choice === null ? (
          <span className="copy-paste-sheet-row-added">{verb === "Move" ? "Moves" : "Adds"}</span>
        ) : (
          <select
            className={`copy-paste-choice${row.choice === "overwrite" ? " is-danger" : ""}`}
            aria-label={`Choice for ${row.relativePath}`}
            value={row.choice}
            onChange={(event) => onChoiceChange(row, event.target.value as CopyPasteChoice)}
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
  },
  // Rows are rebuilt on every change; only what a row shows decides whether it re-renders.
  (previous, next) =>
    previous.verb === next.verb &&
    previous.onChoiceChange === next.onChoiceChange &&
    previous.row.node === next.row.node &&
    previous.row.depth === next.row.depth &&
    previous.row.choice === next.row.choice &&
    previous.row.detail === next.row.detail &&
    previous.row.tone === next.row.tone &&
    previous.row.keepBothName === next.row.keepBothName,
);

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
