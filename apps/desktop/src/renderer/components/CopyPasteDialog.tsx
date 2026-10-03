import { useRef } from "react";

import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

export function CopyPasteDialog({
  title,
  message,
  detailLines = [],
  progressLabel = null,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  message: string;
  detailLines?: string[];
  progressLabel?: string | null | undefined;
  primaryAction?:
    | {
        label: string;
        onClick: () => void;
        destructive?: boolean | undefined;
        irreversible?: boolean | undefined;
        /** False when the other button is the default, as for a question best answered no. */
        isDefault?: boolean | undefined;
      }
    | undefined;
  secondaryAction?:
    | {
        label: string;
        onClick: () => void;
      }
    | undefined;
}) {
  const secondaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);

  // Confirmations that cannot be undone (e.g. delete immediately), and questions whose
  // default is no, make the other button the default, so a stray Return or Space cannot
  // confirm them. The default button is the one drawn in the accent, and the one Return
  // presses, as in a macOS alert.
  const primaryIsDefault =
    primaryAction !== undefined &&
    primaryAction.irreversible !== true &&
    primaryAction.isDefault !== false;
  const defaultAction = primaryIsDefault ? primaryAction : secondaryAction;

  return (
    <Alert
      title={title}
      message={message}
      initialFocusRef={primaryIsDefault ? primaryButtonRef : secondaryButtonRef}
      onReturn={defaultAction ? () => defaultAction.onClick() : undefined}
      buttons={
        <>
          {secondaryAction ? (
            <PushButton
              ref={secondaryButtonRef}
              variant={primaryIsDefault ? "plain" : "default"}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </PushButton>
          ) : null}
          {primaryAction ? (
            <PushButton
              ref={primaryButtonRef}
              variant={
                primaryIsDefault ? "default" : primaryAction.destructive ? "destructive" : "plain"
              }
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </PushButton>
          ) : null}
        </>
      }
    >
      {progressLabel || detailLines.length > 0 ? (
        <>
          {progressLabel ? <p className="copy-paste-progress">{progressLabel}</p> : null}
          {detailLines.length > 0 ? (
            <ul className="copy-paste-detail-list">
              {detailLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Alert>
  );
}
