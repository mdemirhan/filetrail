import { useEffect, useState } from "react";

import { resolveFocusedEditTarget } from "../lib/focusedEditTarget";

function isTextEditing(): boolean {
  return resolveFocusedEditTarget(document.activeElement) === "editable-text";
}

// Whether a text field has the keyboard, kept up to date as focus moves: the Edit menu's
// Undo and Redo are then the field's own.
export function useTextEditingFocus(): boolean {
  const [textEditing, setTextEditing] = useState(isTextEditing);
  useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      timer = null;
      setTextEditing(isTextEditing());
    };
    // Read once focus has settled: while "focusout" runs, the field leaving still has it.
    const schedule = () => {
      if (timer === null) {
        timer = window.setTimeout(update, 0);
      }
    };
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);
  return textEditing;
}
