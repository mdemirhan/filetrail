import { useRef } from "react";

import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

// Names listed under the question; more are counted.
const LISTED_NAMES = 5;

// What an Undo (or Redo) asks before it starts: about items whose old names other items
// have taken since, or about items it would move to the Trash though they changed since.
// Cancel leaves everything as it is; the default answer goes ahead with both kept.
export function UndoQuestionAlert({
  question,
  names,
  direction,
  onAnswer,
}: {
  question: "nameTaken" | "changed";
  names: string[];
  direction: "undo" | "redo";
  onAnswer: (answer: "skip" | "keep_both" | "trash" | null) => void;
}) {
  const defaultButtonRef = useRef<HTMLButtonElement | null>(null);
  const one = names.length === 1 ? names[0] : null;
  const what = direction === "undo" ? "Undo" : "Redo";
  const title =
    question === "nameTaken"
      ? one !== null
        ? `An item named “${one}” is already where it would go back.`
        : `${names.length} items have names that other items have taken where they would go back.`
      : one !== null
        ? `“${one}” has been modified.`
        : `${names.length} items have been modified.`;
  const message =
    question === "nameTaken"
      ? one !== null
        ? "Keep Both puts it back with a number added to its name. Skip leaves it where it is."
        : "Keep Both puts them back with a number added to their names. Skip leaves them where they are."
      : one !== null
        ? `${what} would move it to the Trash. Skip leaves it where it is.`
        : `${what} would move them to the Trash. Skip leaves them where they are.`;
  const defaultAnswer = question === "nameTaken" ? "keep_both" : "trash";
  const listed = names.length > 1 ? names.slice(0, LISTED_NAMES) : [];
  const unlisted = names.length - listed.length - (one !== null ? 1 : 0);
  return (
    <Alert
      title={title}
      message={message}
      initialFocusRef={defaultButtonRef}
      onReturn={() => onAnswer(defaultAnswer)}
      onEscape={() => onAnswer(null)}
      // Three buttons don't fit side by side in an alert: stacked as macOS stacks them, the
      // default on top and Cancel at the bottom.
      stackedButtons
      buttons={
        <>
          <PushButton
            ref={defaultButtonRef}
            variant="default"
            onClick={() => onAnswer(defaultAnswer)}
          >
            {question === "nameTaken" ? "Keep Both" : "Move to Trash"}
          </PushButton>
          <PushButton onClick={() => onAnswer("skip")}>Skip</PushButton>
          <PushButton onClick={() => onAnswer(null)}>Cancel</PushButton>
        </>
      }
    >
      {listed.length > 0 ? (
        <ul className="copy-paste-detail-list">
          {listed.map((name) => (
            <li key={name}>{name}</li>
          ))}
          {unlisted > 0 ? <li>{`and ${unlisted.toLocaleString()} more`}</li> : null}
        </ul>
      ) : null}
    </Alert>
  );
}
