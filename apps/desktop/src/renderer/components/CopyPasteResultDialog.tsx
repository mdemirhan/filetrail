import { useEffect, useRef } from "react";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import { leafName, pluralize } from "../lib/copyPasteReview";
import { collectRetrySourcePaths } from "../lib/explorerAppUtils";

type OperationResult = NonNullable<WriteOperationProgressEvent["result"]>;
type ResultItem = OperationResult["items"][number];

const PAST_TENSE: Record<string, string> = {
  paste: "Pasted",
  move_to: "Moved",
  duplicate: "Duplicated",
};

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
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const result = event.result;
  const items = result?.items ?? [];
  const topLevelItems = items.filter((item) => !hasAncestorItem(item, items));
  const completedTopLevel = topLevelItems.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed");
  const notStarted = items.filter((item) => item.status === "cancelled");
  const skipped = items.filter((item) => item.status === "skipped");
  const retryCount = canRetry ? collectRetrySourcePaths(items).length : 0;
  const destinationName = leafName(result?.targetPath ?? "");
  const pastTense = PAST_TENSE[event.action] ?? "Finished";
  const presentVerb = event.action === "move_to" ? "moved" : "copied";

  useEffect(() => {
    doneButtonRef.current?.focus();
  }, []);

  const title =
    topLevelItems.length === 0
      ? `${pastTense.replace(/d$/u, "")} failed`
      : `${pastTense} ${completedTopLevel} of ${pluralize(topLevelItems.length, "item")}${
          destinationName ? ` into “${destinationName}”` : ""
        }`;
  const sentences = [
    failed.length > 0 ? `${pluralize(failed.length, "item")} couldn't be ${presentVerb}.` : null,
    notStarted.length > 0
      ? `${pluralize(notStarted.length, "item")} ${notStarted.length === 1 ? "wasn't" : "weren't"} started because the operation was stopped.`
      : null,
    skipped.length > 0
      ? `${pluralize(skipped.length, "item")} ${skipped.length === 1 ? "was" : "were"} skipped.`
      : null,
    event.action === "move_to" && failed.length + notStarted.length > 0
      ? "Items that weren't moved are still in their original folder."
      : null,
  ].filter(Boolean);
  const message =
    sentences.length > 0 ? sentences.join(" ") : (result?.error ?? "The operation has finished.");

  return (
    <div className="action-notice-backdrop copy-paste-sheet-backdrop" role="presentation">
      <dialog
        className="copy-paste-sheet"
        aria-label={title}
        aria-modal="true"
        open
        onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()}
      >
        <header className="copy-paste-sheet-header">
          <div className="copy-paste-sheet-heading">
            <h2 className="copy-paste-sheet-title">{title}</h2>
            <p className="copy-paste-sheet-message">{message}</p>
          </div>
        </header>
        <div className="copy-paste-sheet-list copy-paste-result-list">
          <ResultSection
            label={`Couldn't ${event.action === "move_to" ? "move" : "copy"}`}
            items={failed}
            allItems={items}
            describe={(item) => item.error ?? "Unknown error."}
            tone="danger"
          />
          <ResultSection
            label="Not started"
            items={notStarted}
            allItems={items}
            describe={() => "The operation was stopped first."}
            tone="muted"
          />
          <ResultSection
            label="Skipped"
            items={skipped}
            allItems={items}
            describe={(item) =>
              item.skipReason === "runtime_conflict_resolution"
                ? "Skipped after it changed during the operation"
                : "Already existed · you chose Skip"
            }
            tone="muted"
          />
        </div>
        <footer className="copy-paste-sheet-footer">
          <span className="copy-paste-sheet-bar-spacer" />
          {retryCount > 0 ? (
            <button type="button" className="tb-btn" onClick={onRetry}>
              Retry {pluralize(retryCount, "Item")}
            </button>
          ) : null}
          <button ref={doneButtonRef} type="button" className="tb-btn primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </dialog>
    </div>
  );
}

function ResultSection({
  label,
  items,
  allItems,
  describe,
  tone,
}: {
  label: string;
  items: ResultItem[];
  allItems: ResultItem[];
  describe: (item: ResultItem) => string;
  tone: "danger" | "muted";
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="copy-paste-result-section" aria-label={label}>
      <h3 className="copy-paste-result-section-title">{label}</h3>
      <ul className="copy-paste-result-items">
        {items.map((item, index) => (
          <li key={`${item.sourcePath ?? "item"}-${index}`} className="copy-paste-sheet-row">
            <div className="copy-paste-sheet-row-text">
              <div className="copy-paste-sheet-row-name">{displayPath(item, allItems)}</div>
              <div className={`copy-paste-sheet-row-detail is-${tone}`}>{describe(item)}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function hasAncestorItem(item: ResultItem, items: ResultItem[]): boolean {
  const path = item.sourcePath;
  return (
    typeof path === "string" &&
    items.some(
      (candidate) =>
        typeof candidate.sourcePath === "string" &&
        candidate.sourcePath !== path &&
        path.startsWith(`${candidate.sourcePath}/`),
    )
  );
}

// "photos/raw/IMG_2041.dng": the path below the folder the operation started from.
function displayPath(item: ResultItem, items: ResultItem[]): string {
  const path = item.sourcePath;
  if (typeof path !== "string") {
    return leafName(item.destinationPath ?? "");
  }
  const topLevel = items.find(
    (candidate) =>
      typeof candidate.sourcePath === "string" &&
      path.startsWith(`${candidate.sourcePath}/`) &&
      !hasAncestorItem(candidate, items),
  );
  if (!topLevel?.sourcePath) {
    return leafName(path);
  }
  const base = topLevel.sourcePath.slice(0, topLevel.sourcePath.lastIndexOf("/"));
  return path.slice(base.length + 1);
}
