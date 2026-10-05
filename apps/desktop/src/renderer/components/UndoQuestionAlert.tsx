import type { WriteOperationAction } from "@filetrail/contracts";
import { useRef } from "react";

import { type UndoQuestion, describeUndoQuestion } from "../lib/undoQuestion";
import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

// Names listed under the question; more are counted.
const LISTED_NAMES = 5;

// What an Undo (or Redo) asks before it starts, about items whose old names other items have
// taken since, or items it would move to the Trash though they changed since. Each question
// is all or nothing: the Undo goes ahead as a whole, or Cancel leaves everything as it is.
export function UndoQuestionAlert({
  question,
  direction,
  action,
  onAnswer,
}: {
  question: UndoQuestion;
  direction: "undo" | "redo";
  action: WriteOperationAction | null;
  onAnswer: (goAhead: boolean) => void;
}) {
  const defaultButtonRef = useRef<HTMLButtonElement | null>(null);
  const text = describeUndoQuestion(question, direction, action);
  const names =
    question.kind === "nameTaken" ? question.names : question.items.map((item) => item.name);
  const listed = names.length > 1 ? names.slice(0, LISTED_NAMES) : [];
  const unlisted = names.length - listed.length;
  const confirm = (
    <PushButton
      ref={text.confirmIsDefault ? defaultButtonRef : undefined}
      variant={text.confirmIsDefault ? "default" : "plain"}
      onClick={() => onAnswer(true)}
    >
      {text.confirmLabel}
    </PushButton>
  );
  const cancel = (
    <PushButton
      ref={text.confirmIsDefault ? undefined : defaultButtonRef}
      variant={text.confirmIsDefault ? "plain" : "default"}
      onClick={() => onAnswer(false)}
    >
      Cancel
    </PushButton>
  );
  return (
    <Alert
      title={text.title}
      message={text.message}
      initialFocusRef={defaultButtonRef}
      onReturn={() => onAnswer(text.confirmIsDefault)}
      onEscape={() => onAnswer(false)}
      // The default button is on the right, as in a macOS alert.
      buttons={
        text.confirmIsDefault ? (
          <>
            {cancel}
            {confirm}
          </>
        ) : (
          <>
            {confirm}
            {cancel}
          </>
        )
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
