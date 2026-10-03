import { useRef } from "react";

import { Alert } from "./Alert";
import { PushButton } from "./PushButton";

// Something the user should know about before going on, with a single OK. Return and
// Escape dismiss it (see useExplorerShortcuts).
export function ActionNoticeDialog({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Alert
      title={title}
      message={message}
      initialFocusRef={buttonRef}
      buttons={
        <PushButton ref={buttonRef} variant="default" onClick={onClose}>
          OK
        </PushButton>
      }
    />
  );
}
