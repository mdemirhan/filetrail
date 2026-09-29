import { useEffect, useRef, useState } from "react";

import {
  type CopyPasteChoice,
  type WriteOperationProgressEvent,
  getRuntimeConflictChoices,
} from "@filetrail/contracts";

import { CHOICE_LABELS, formatReviewDate, leafName } from "../lib/copyPasteReview";
import { formatSize } from "../lib/formatting";

type RuntimeConflict = NonNullable<WriteOperationProgressEvent["runtimeConflict"]>;
type Fingerprint = RuntimeConflict["currentSourceFingerprint"];

// Shown when something changed on disk after the paste was reviewed. The operation is
// paused until the person answers (optionally for the rest of the operation) or stops.
export function CopyPasteRuntimeConflictDialog({
  verb,
  conflict,
  onResolve,
  onStop,
}: {
  verb: "Paste" | "Move" | "Duplicate";
  conflict: RuntimeConflict;
  onResolve: (choice: CopyPasteChoice, applyToRemaining: boolean) => void;
  onStop: () => void;
}) {
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const name = leafName(conflict.destinationPath);
  const folder = leafName(parentPath(conflict.destinationPath));
  const destinationExists = conflict.currentDestinationFingerprint.exists;
  const now = Date.now();
  const verbing = verb === "Move" ? "moving" : verb === "Duplicate" ? "duplicating" : "pasting";

  // Keep Both only means something when there is an existing item to keep.
  const choices = getRuntimeConflictChoices(conflict).filter(
    (choice) => destinationExists || choice !== "keep_both",
  );
  const primary: CopyPasteChoice = choices.includes("merge")
    ? "merge"
    : choices.includes("keep_both")
      ? "keep_both"
      : (choices[0] ?? "skip");
  const secondary = choices.filter((choice) => choice !== primary);

  const { title, message } = describeConflict(conflict, name, folder, verbing);

  useEffect(() => {
    primaryButtonRef.current?.focus();
  }, []);

  const labelFor = (choice: CopyPasteChoice) =>
    choice === "overwrite" && !destinationExists ? `${verb} Anyway` : CHOICE_LABELS[choice];

  return (
    <div className="action-notice-backdrop" role="presentation">
      <dialog
        className="copy-paste-conflict-alert"
        aria-label={title}
        aria-modal="true"
        open
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="copy-paste-conflict-alert-heading">
          <h2 className="copy-paste-sheet-title">{title}</h2>
          <p className="copy-paste-sheet-message">{message}</p>
        </div>
        <div className="copy-paste-conflict-alert-cards">
          <FingerprintCard
            label={`In “${folder}” now`}
            name={name}
            fingerprint={conflict.currentDestinationFingerprint}
            now={now}
          />
          <FingerprintCard
            label="Your copy"
            name={leafName(conflict.sourcePath)}
            fingerprint={conflict.currentSourceFingerprint}
            now={now}
          />
        </div>
        <label className="copy-paste-conflict-alert-apply">
          <input
            type="checkbox"
            checked={applyToRemaining}
            onChange={(event) => setApplyToRemaining(event.target.checked)}
          />
          Do the same for any other changes during this {verb.toLowerCase()}
        </label>
        <div className="copy-paste-conflict-alert-actions">
          <button type="button" className="tb-btn" onClick={onStop}>
            Stop {verbing[0]?.toUpperCase()}
            {verbing.slice(1)}
          </button>
          <span className="copy-paste-sheet-bar-spacer" />
          {secondary.map((choice) => (
            <button
              key={choice}
              type="button"
              className={`tb-btn${choice === "overwrite" && destinationExists ? " danger-text" : ""}`}
              onClick={() => onResolve(choice, applyToRemaining)}
            >
              {labelFor(choice)}
            </button>
          ))}
          <button
            ref={primaryButtonRef}
            type="button"
            className="tb-btn primary"
            onClick={() => onResolve(primary, applyToRemaining)}
          >
            {labelFor(primary)}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function describeConflict(
  conflict: RuntimeConflict,
  name: string,
  folder: string,
  verbing: string,
): { title: string; message: string } {
  const sourceName = leafName(conflict.sourcePath);
  switch (conflict.reason) {
    case "destination_created":
      return {
        title: `“${name}” appeared in “${folder}” while ${verbing}`,
        message:
          "Another app created it after you reviewed this. Choose what to do with your copy.",
      };
    case "destination_changed":
      return {
        title: `“${name}” in “${folder}” changed while ${verbing}`,
        message: "It's different from when you reviewed this, so it's not replaced without asking.",
      };
    case "destination_deleted":
      return {
        title: `“${name}” is no longer in “${folder}”`,
        message: "It was removed after you reviewed this. Choose how to continue.",
      };
    case "source_changed":
      return {
        title: `“${sourceName}” changed while ${verbing}`,
        message:
          "Your copy is different from when you reviewed this. Choose whether to use it now.",
      };
    case "source_deleted":
      return {
        title: `“${sourceName}” is no longer available`,
        message: "It was moved or deleted after you reviewed this, so it can only be skipped.",
      };
  }
}

function FingerprintCard({
  label,
  name,
  fingerprint,
  now,
}: {
  label: string;
  name: string;
  fingerprint: Fingerprint;
  now: number;
}) {
  const facts = !fingerprint.exists
    ? "Not there anymore"
    : [
        fingerprint.kind === "directory"
          ? "Folder"
          : fingerprint.size === null
            ? null
            : formatSize(fingerprint.size, "ready"),
        fingerprint.mtimeMs === null ? null : formatReviewDate(fingerprint.mtimeMs, now),
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <div className="copy-paste-conflict-card">
      <div className="copy-paste-conflict-card-label">{label}</div>
      <div className="copy-paste-conflict-card-name">{name}</div>
      <div className="copy-paste-conflict-card-facts">{facts}</div>
    </div>
  );
}

function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/u, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}
