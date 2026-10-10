import type { Volume } from "@filetrail/contracts";
import { useRef } from "react";

import { describeEjectBusy, describeWhichVolumesQuestion } from "../lib/eject";
import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

// Finder's question for one volume of a disk that holds others. The three buttons are
// stacked, the default (Eject All) on top; Escape cancels.
export function EjectWhichVolumesAlert({
  name,
  otherNames,
  onAnswer,
}: {
  name: string;
  otherNames: readonly string[];
  onAnswer: (answer: "all" | "one" | "cancel") => void;
}) {
  const defaultButtonRef = useRef<HTMLButtonElement | null>(null);
  const text = describeWhichVolumesQuestion(name, otherNames);
  return (
    <Alert
      title={text.title}
      message={text.message}
      stackedButtons
      initialFocusRef={defaultButtonRef}
      onReturn={() => onAnswer("all")}
      onEscape={() => onAnswer("cancel")}
      buttons={
        <>
          <PushButton ref={defaultButtonRef} variant="default" onClick={() => onAnswer("all")}>
            Eject All
          </PushButton>
          <PushButton variant="plain" onClick={() => onAnswer("one")}>
            Eject
          </PushButton>
          <PushButton variant="plain" onClick={() => onAnswer("cancel")}>
            Cancel
          </PushButton>
        </>
      }
    />
  );
}

// Eject refused while a program has a file open on the disk: Try Again (the default),
// Force Eject, or Cancel.
export function EjectBusyAlert({
  volumes,
  busyPath,
  onAnswer,
}: {
  volumes: readonly Volume[];
  busyPath: string;
  onAnswer: (answer: "retry" | "force" | "cancel") => void;
}) {
  const defaultButtonRef = useRef<HTMLButtonElement | null>(null);
  const text = describeEjectBusy(volumes, busyPath);
  return (
    <Alert
      title={text.title}
      message={text.message}
      stackedButtons
      initialFocusRef={defaultButtonRef}
      onReturn={() => onAnswer("retry")}
      onEscape={() => onAnswer("cancel")}
      buttons={
        <>
          <PushButton ref={defaultButtonRef} variant="default" onClick={() => onAnswer("retry")}>
            Try Again
          </PushButton>
          <PushButton variant="destructive" onClick={() => onAnswer("force")}>
            Force Eject
          </PushButton>
          <PushButton variant="plain" onClick={() => onAnswer("cancel")}>
            Cancel
          </PushButton>
        </>
      }
    />
  );
}
