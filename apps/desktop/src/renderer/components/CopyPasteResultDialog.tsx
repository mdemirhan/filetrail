import { useId, useMemo, useRef } from "react";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import { dirnameOf, formatCount, leafName, pluralize } from "../lib/copyPasteReview";
import { collectRetrySourcePaths, selectTopLevelItems } from "../lib/explorerAppUtils";
import { DEFAULT_SHORTCUT_DISPLAY } from "../lib/shortcutDisplay";
import { PushButton } from "./PushButton";
import { useDialogFocus } from "./useDialogFocus";

type OperationResult = NonNullable<WriteOperationProgressEvent["result"]>;
type ResultItem = OperationResult["items"][number];

const PAST_TENSE: Record<string, string> = {
  undo: "Undid",
  redo: "Redid",
  paste: "Pasted",
  copy_to: "Copied",
  move_to: "Moved",
  duplicate: "Duplicated",
  batch_rename: "Renamed",
};

const FAILED_TITLE: Record<string, string> = {
  undo: "Couldn’t Undo",
  redo: "Couldn’t Redo",
  paste: "Paste failed",
  copy_to: "Copy failed",
  move_to: "Move failed",
  duplicate: "Duplicate failed",
  batch_rename: "Rename failed",
};

// Rows listed per section; a result with tens of thousands of problems lists the first
// ones and says how many more there are.
const SECTION_ROW_LIMIT = 200;

// A folder whose only problem is that some items inside it failed. It was copied, just not
// completely, and the items inside are listed (and counted) on their own.
function isFolderWithFailuresInside(item: ResultItem): boolean {
  return item.status === "failed" && item.error === null && (item.childFailureCount ?? 0) > 0;
}

// The sheet shown when a copy-like operation finished with problems: every failed,
// unstarted and skipped item with its reason, and a retry for the ones worth retrying.
export function CopyPasteResultDialog({
  event,
  canRetry,
  onRetry,
  onClose,
}: {
  event: WriteOperationProgressEvent;
  canRetry: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const messageId = useId();
  const result = event.result;
  const renaming = event.action === "batch_rename";
  // An Undo's items are each on their own, each with what was found about it.
  const undoing = event.action === "undo" || event.action === "redo";
  const destinationName = leafName(result?.targetPath ?? "");
  const pastTense = PAST_TENSE[event.action] ?? "Finished";
  const presentVerb = undoing
    ? event.action === "undo"
      ? "undone"
      : "redone"
    : renaming
      ? "renamed"
      : event.action === "move_to"
        ? "moved"
        : "copied";
  // Renamed items stay in their folder; copies and moves go into one.
  const place = destinationName ? ` ${renaming ? "in" : "into"} “${destinationName}”` : "";

  useDialogFocus(dialogRef, doneButtonRef);

  const outcome = useMemo(
    () =>
      summarizeResultItems(result?.items ?? [], {
        eachOnItsOwn: renaming || undoing,
        // An item put back is named by where it went, not by its name in the Trash.
        namedByDestination: undoing,
      }),
    [result, renaming, undoing],
  );
  const retryCount = canRetry ? outcome.retryCount : 0;

  // A folder copied without some of its items counts as copied here; the message says what
  // is missing from it.
  const copiedTopLevel = outcome.completedTopLevel + outcome.partialTopLevel.length;
  const title =
    outcome.topLevelCount === 0 || (undoing && copiedTopLevel === 0)
      ? (FAILED_TITLE[event.action] ?? "Failed")
      : `${pastTense} ${formatCount(copiedTopLevel)} of ${pluralize(outcome.topLevelCount, "item")}${place}`;
  const onlyPartial = outcome.partialTopLevel.length === 1 ? outcome.partialTopLevel[0] : null;
  const failedCount = outcome.failedOutside + outcome.failedInside;
  const notStartedCount = outcome.notStarted.length;
  const stoppedCount = outcome.stoppedPartWay.length;
  const onlyStopped = stoppedCount === 1 ? outcome.stoppedPartWay[0] : null;
  const skippedCount = outcome.skipped.length;
  const sentences = [
    outcome.failedOutside > 0
      ? `${pluralize(outcome.failedOutside, "item")} couldn’t be ${presentVerb}.`
      : null,
    outcome.failedInside > 0
      ? `${pluralize(outcome.failedInside, "item")} inside ${
          onlyPartial?.sourcePath ? `“${leafName(onlyPartial.sourcePath)}”` : "folders"
        } couldn’t be ${presentVerb}.`
      : null,
    // A folder stopped part way isn't "not started": some of it is at the destination.
    stoppedCount > 0
      ? `${
          onlyStopped?.sourcePath
            ? `“${leafName(onlyStopped.sourcePath)}” was`
            : `${pluralize(stoppedCount, "folder")} were`
        } stopped part way: some of what is inside was ${presentVerb}${
          destinationName ? ` into “${destinationName}”` : ""
        }, the rest wasn't.`
      : null,
    notStartedCount > 0
      ? `${pluralize(notStartedCount, "item")} ${notStartedCount === 1 ? "wasn't" : "weren't"} started because the operation was stopped.`
      : null,
    skippedCount > 0
      ? `${pluralize(skippedCount, "item")} ${skippedCount === 1 ? "was" : "were"} skipped.`
      : null,
    event.action === "move_to" && failedCount + notStartedCount + stoppedCount > 0
      ? "Items that weren't moved are still in their original folder."
      : null,
  ].filter(Boolean);
  // An Undo says what it left, and that the part it did can be taken back. What was skipped
  // can't be undone (it is gone, or something else is in its place), but nothing is lost;
  // what failed (no permission, say) is still on the list, and the same command tries it
  // again.
  const leftCount = outcome.failed.length + skippedCount;
  if (undoing) {
    sentences.length = 0;
    if (leftCount > 0) {
      sentences.push(
        `${pluralize(leftCount, "item")} ${leftCount === 1 ? "was left as it is" : "were left as they are"}.`,
      );
    }
    if (leftCount > 0 && copiedTopLevel > 0) {
      sentences.push(
        event.action === "undo"
          ? `${DEFAULT_SHORTCUT_DISPLAY.mention("redo")} redoes what was undone.`
          : `${DEFAULT_SHORTCUT_DISPLAY.mention("undo")} undoes what was redone.`,
      );
    }
    if (outcome.failed.length > 0) {
      sentences.push(
        event.action === "undo"
          ? `${DEFAULT_SHORTCUT_DISPLAY.mention("undo")} tries again what couldn’t be undone.`
          : `${DEFAULT_SHORTCUT_DISPLAY.mention("redo")} tries again what couldn’t be redone.`,
      );
    }
  }
  const message =
    sentences.length > 0 ? sentences.join(" ") : (result?.error ?? "The operation has finished.");

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
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
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
        <div className="copy-paste-sheet-list copy-paste-result-list">
          <ResultSection
            label={`Couldn’t ${
              undoing
                ? event.action
                : renaming
                  ? "rename"
                  : event.action === "move_to"
                    ? "move"
                    : "copy"
            }`}
            items={outcome.failed}
            displayPaths={outcome.displayPaths}
            describe={(item) =>
              isFolderWithFailuresInside(item)
                ? `${pluralize(item.childFailureCount ?? 0, "item")} inside couldn’t be ${presentVerb}`
                : (item.error ?? "Unknown error.")
            }
            tone="danger"
          />
          <ResultSection
            label="Stopped part way"
            items={outcome.stoppedPartWay}
            displayPaths={outcome.displayPaths}
            describe={() => `Some of what is inside was ${presentVerb} before the stop.`}
            tone="muted"
          />
          <ResultSection
            label="Not started"
            items={outcome.notStarted}
            displayPaths={outcome.displayPaths}
            // A rename's item put back under another name says which.
            describe={(item) =>
              renaming && item.destinationPath !== null && item.error
                ? item.error
                : "The operation was stopped first."
            }
            tone="muted"
          />
          <ResultSection
            label={undoing ? "Left as it is" : "Skipped"}
            items={outcome.skipped}
            displayPaths={outcome.displayPaths}
            describe={(item) =>
              undoing
                ? (item.error ?? "Left as it is")
                : renaming
                  ? (item.error ?? "Its new name was taken")
                  : item.skipReason === "runtime_conflict_resolution"
                    ? "Skipped after it changed during the operation"
                    : "Already existed · you chose Skip"
            }
            tone="muted"
          />
        </div>
        <footer className="copy-paste-sheet-footer">
          <span className="copy-paste-sheet-bar-spacer" />
          {retryCount > 0 || (renaming && outcome.skipped.length > 0 && canRetry) ? (
            // A rename is tried again from the sheet, with its names worked out anew.
            <PushButton onClick={onRetry}>
              {renaming ? "Try Again…" : `Retry ${pluralize(retryCount, "Item")}`}
            </PushButton>
          ) : null}
          <PushButton ref={doneButtonRef} variant="default" onClick={onClose}>
            Done
          </PushButton>
        </footer>
      </dialog>
    </div>
  );
}

function ResultSection({
  label,
  items,
  displayPaths,
  describe,
  tone,
}: {
  label: string;
  items: ResultItem[];
  displayPaths: Map<ResultItem, string>;
  describe: (item: ResultItem) => string;
  tone: "danger" | "muted";
}) {
  if (items.length === 0) {
    return null;
  }
  const shown = items.slice(0, SECTION_ROW_LIMIT);
  const moreCount = items.length - shown.length;
  return (
    <section className="copy-paste-result-section" aria-label={label}>
      <h3 className="copy-paste-result-section-title">{label}</h3>
      <ul className="copy-paste-result-items">
        {shown.map((item, index) => {
          const path = displayPaths.get(item) ?? "";
          return (
            <li key={`${item.sourcePath ?? "item"}-${index}`} className="copy-paste-sheet-row">
              <div className="copy-paste-sheet-row-text">
                <div className="copy-paste-sheet-row-name" title={path}>
                  {path}
                </div>
                <div className={`copy-paste-sheet-row-detail is-${tone}`}>{describe(item)}</div>
              </div>
            </li>
          );
        })}
        {moreCount > 0 ? (
          <li className="copy-paste-sheet-row copy-paste-result-more">
            and {formatCount(moreCount)} more
          </li>
        ) : null}
      </ul>
    </section>
  );
}

type ResultOutcome = {
  topLevelCount: number;
  completedTopLevel: number;
  /** Top-level folders copied without some of the items inside. */
  partialTopLevel: ResultItem[];
  /** Items that failed themselves, outside / inside folders with failures inside. */
  failedOutside: number;
  failedInside: number;
  failed: ResultItem[];
  /** Top-level folders stopped with some of what is inside already done. */
  stoppedPartWay: ResultItem[];
  notStarted: ResultItem[];
  skipped: ResultItem[];
  retryCount: number;
  displayPaths: Map<ResultItem, string>;
};

// Top-level items come from a set lookup of each item's ancestors (a handful of lookups per
// item), so results with tens of thousands of items stay fast. With `eachOnItsOwn` (a rename
// of several), every item is one of those asked for, even one inside a folder renamed too.
function summarizeResultItems(
  items: ResultItem[],
  options: { eachOnItsOwn: boolean; namedByDestination?: boolean },
): ResultOutcome {
  const topLevel = options.eachOnItsOwn ? items : selectTopLevelItems(items);
  const topLevelSet = new Set(topLevel);
  const topLevelPaths = new Set<string>();
  for (const item of topLevel) {
    if (typeof item.sourcePath === "string") {
      topLevelPaths.add(item.sourcePath);
    }
  }
  const partialPaths = new Set<string>();
  for (const item of items) {
    if (typeof item.sourcePath === "string" && isFolderWithFailuresInside(item)) {
      partialPaths.add(item.sourcePath);
    }
  }

  const outcome: ResultOutcome = {
    topLevelCount: topLevel.length,
    completedTopLevel: 0,
    partialTopLevel: [],
    failedOutside: 0,
    failedInside: 0,
    failed: [],
    stoppedPartWay: [],
    notStarted: [],
    skipped: [],
    retryCount: collectRetrySourcePaths(items).length,
    displayPaths: new Map(),
  };
  // Top-level folders with something done inside them (by the items listed from inside).
  const startedFolders = new Set<string>();
  for (const item of options.eachOnItsOwn ? [] : items) {
    if (item.status === "completed" && typeof item.sourcePath === "string") {
      const folder = findAncestor(item.sourcePath, topLevelPaths);
      if (folder !== null) {
        startedFolders.add(folder);
      }
    }
  }
  const stoppedPartWay = new Set<ResultItem>();
  for (const item of topLevel) {
    if (item.status === "completed") {
      outcome.completedTopLevel += 1;
    } else if (isFolderWithFailuresInside(item)) {
      outcome.partialTopLevel.push(item);
    } else if (
      item.status === "cancelled" &&
      typeof item.sourcePath === "string" &&
      startedFolders.has(item.sourcePath)
    ) {
      stoppedPartWay.add(item);
      outcome.stoppedPartWay.push(item);
    }
  }
  for (const item of items) {
    const path = item.sourcePath;
    outcome.displayPaths.set(
      item,
      options.eachOnItsOwn
        ? leafName(
            (options.namedByDestination ? item.destinationPath : null) ??
              path ??
              item.destinationPath ??
              "",
          )
        : displayPath(item, topLevelSet.has(item), topLevelPaths),
    );
    if (item.status === "failed") {
      outcome.failed.push(item);
      if (!isFolderWithFailuresInside(item)) {
        if (typeof path === "string" && findAncestor(path, partialPaths) !== null) {
          outcome.failedInside += 1;
        } else {
          outcome.failedOutside += 1;
        }
      }
    } else if (item.status === "cancelled" && !stoppedPartWay.has(item)) {
      outcome.notStarted.push(item);
    } else if (item.status === "skipped") {
      outcome.skipped.push(item);
    }
  }
  // When the failed items inside aren't listed, the folders' own counts say how many.
  if (outcome.failedInside === 0) {
    for (const folder of outcome.partialTopLevel) {
      outcome.failedInside += folder.childFailureCount ?? 0;
    }
  }
  return outcome;
}

// "photos/raw/IMG_2041.dng": the path below the folder the operation started from.
function displayPath(
  item: ResultItem,
  isTopLevel: boolean,
  topLevelPaths: ReadonlySet<string>,
): string {
  const path = item.sourcePath;
  if (typeof path !== "string") {
    return leafName(item.destinationPath ?? "");
  }
  const topLevelAncestor = isTopLevel ? null : findAncestor(path, topLevelPaths);
  if (topLevelAncestor === null) {
    return leafName(path);
  }
  const base = dirnameOf(topLevelAncestor).replace(/\/$/u, "");
  return path.slice(base.length + 1);
}

// The nearest folder above `path` that is in `candidates`, or null.
function findAncestor(path: string, candidates: ReadonlySet<string>): string | null {
  let current = path;
  let parent = dirnameOf(current);
  while (parent !== current) {
    if (candidates.has(parent)) {
      return parent;
    }
    current = parent;
    parent = dirnameOf(current);
  }
  return null;
}
