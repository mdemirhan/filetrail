import { useRef, useState } from "react";

import {
  type CopyPasteChoice,
  type WriteOperationProgressEvent,
  getRuntimeConflictChoices,
} from "@filetrail/contracts";

import { CHOICE_LABELS, dirnameOf, formatReviewDate, leafName } from "../lib/copyPasteReview";
import { formatSize } from "../lib/formatting";
import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

type RuntimeConflict = NonNullable<WriteOperationProgressEvent["runtimeConflict"]>;
type Fingerprint = RuntimeConflict["currentSourceFingerprint"];
type Verb = "Paste" | "Copy" | "Move" | "Duplicate";

const VERBING: Record<Verb, string> = {
  Paste: "pasting",
  Copy: "copying",
  Move: "moving",
  Duplicate: "duplicating",
};

// What the card of the item on its way is called.
const BEING: Record<Verb, string> = {
  Paste: "Being pasted",
  Copy: "Being copied",
  Move: "Being moved",
  Duplicate: "Being duplicated",
};

// Shown when something changed on disk after the paste was reviewed, or when Replace
// couldn't use the Trash. The operation is paused until the person answers (optionally for
// the rest of the operation) or stops.
export function CopyPasteRuntimeConflictDialog({
  verb,
  conflict,
  onResolve,
  onStop,
}: {
  verb: Verb;
  conflict: RuntimeConflict;
  onResolve: (choice: CopyPasteChoice, applyToRemaining: boolean) => void;
  onStop: () => void;
}) {
  const [applyToRemaining, setApplyToRemaining] = useState(false);
  // One answer per alert: a double click must not send a second one for the next conflict.
  const [answered, setAnswered] = useState(false);
  const answeredRef = useRef(false);
  const [now] = useState(() => Date.now());
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const name = leafName(conflict.destinationPath);
  const folder = leafName(dirnameOf(conflict.destinationPath));
  const destinationExists = conflict.currentDestinationFingerprint.exists;
  const trashUnavailable = conflict.reason === "trash_unavailable";
  const verbing = VERBING[verb];

  const choices = getRuntimeConflictChoices({
    reason: conflict.reason,
    conflictClass: conflict.conflictClass,
    destinationExists,
  });
  // The safe answer is the default: Merge or Keep Both when there is something to keep,
  // Skip rather than deleting permanently, and going ahead when nothing is in the way.
  const primary: CopyPasteChoice = trashUnavailable
    ? "skip"
    : choices.includes("merge")
      ? "merge"
      : choices.includes("keep_both")
        ? "keep_both"
        : (choices[0] ?? "skip");
  const secondary = choices.filter((choice) => choice !== primary);

  const described = describeConflict(conflict, name, folder, verbing);
  const title = described.title;
  // Merging can't be undone: said wherever Merge is one of the answers.
  const message = choices.includes("merge")
    ? `${described.message} Merging can’t be undone.`
    : described.message;

  const labelFor = (choice: CopyPasteChoice) => {
    if (choice !== "overwrite") {
      return CHOICE_LABELS[choice];
    }
    if (trashUnavailable) {
      return "Delete Permanently";
    }
    return destinationExists ? CHOICE_LABELS.overwrite : `${verb} Anyway`;
  };
  const isDestructive = (choice: CopyPasteChoice) => choice === "overwrite" && destinationExists;

  function answer(send: () => void) {
    if (answeredRef.current) {
      return;
    }
    answeredRef.current = true;
    setAnswered(true);
    send();
  }

  return (
    <Alert
      wide
      title={title}
      message={message}
      initialFocusRef={primaryButtonRef}
      buttons={
        <>
          <PushButton
            className="alert-button-aside"
            disabled={answered}
            onClick={() => answer(onStop)}
          >
            Stop {verbing[0]?.toUpperCase()}
            {verbing.slice(1)}
          </PushButton>
          {secondary.map((choice) => (
            <PushButton
              key={choice}
              variant={isDestructive(choice) ? "destructive" : "plain"}
              disabled={answered}
              onClick={() => answer(() => onResolve(choice, applyToRemaining))}
            >
              {labelFor(choice)}
            </PushButton>
          ))}
          <PushButton
            ref={primaryButtonRef}
            variant="default"
            disabled={answered}
            onClick={() => answer(() => onResolve(primary, applyToRemaining))}
          >
            {labelFor(primary)}
          </PushButton>
        </>
      }
    >
      <div className="copy-paste-conflict-alert-cards">
        <FingerprintCard
          label={`In “${folder}” now`}
          name={name}
          fingerprint={conflict.currentDestinationFingerprint}
          now={now}
        />
        <FingerprintCard
          label={BEING[verb]}
          name={leafName(conflict.sourcePath)}
          fingerprint={conflict.currentSourceFingerprint}
          now={now}
        />
      </div>
      <label className="copy-paste-conflict-alert-apply">
        <input
          type="checkbox"
          checked={applyToRemaining}
          disabled={answered}
          onChange={(event) => setApplyToRemaining(event.target.checked)}
        />
        {trashUnavailable
          ? `Do the same for other items that can’t be moved to the Trash while ${verbing}`
          : `Do the same for similar changes while ${verbing}`}
      </label>
    </Alert>
  );
}

function describeConflict(
  conflict: RuntimeConflict,
  name: string,
  folder: string,
  verbing: string,
): { title: string; message: string } {
  const sourceName = leafName(conflict.sourcePath);
  const isFolder = conflict.currentDestinationFingerprint.kind === "directory";
  switch (conflict.reason) {
    case "destination_created":
      return {
        title: `“${name}” appeared in “${folder}” while ${verbing}`,
        message:
          "Another app created it after you reviewed this. Choose what to do with your item.",
      };
    case "destination_changed":
      return {
        title: `“${name}” in “${folder}” changed while ${verbing}`,
        message: "It’s different from when you reviewed this, so it’s not replaced without asking.",
      };
    case "destination_deleted":
      return {
        title: `“${name}” is no longer in “${folder}”`,
        message:
          "It was removed after you reviewed this, so there’s nothing to replace or merge with. Choose whether to go on with your item.",
      };
    case "source_changed":
      return {
        title: `“${sourceName}” changed while ${verbing}`,
        message: "It’s different from when you reviewed this. Choose whether to use it now.",
      };
    case "source_deleted":
      return {
        title: `“${sourceName}” is no longer available`,
        message: "It was moved or deleted after you reviewed this, so it can only be skipped.",
      };
    case "trash_unavailable":
      return {
        title: `Couldn’t move “${name}” to the Trash`,
        message: `“${folder}” is on a volume without a Trash, so replacing the existing ${
          isFolder ? "folder" : "item"
        } means deleting it permanently. This can’t be undone.`,
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
      <div className="copy-paste-conflict-card-label" title={label}>
        {label}
      </div>
      <div className="copy-paste-conflict-card-name" title={name}>
        {name}
      </div>
      <div className="copy-paste-conflict-card-facts">{facts}</div>
    </div>
  );
}
