import { useEffect, useRef, useState } from "react";

import { ToolbarIcon } from "./ToolbarIcon";

export function LocationSheet({
  open,
  currentPath,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  currentPath: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (path: string) => void;
}) {
  const [draftPath, setDraftPath] = useState(currentPath);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraftPath(currentPath);
      inputRef.current?.focus();
    }
  }, [currentPath, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="location-sheet-backdrop" role="presentation">
      <section className="location-sheet" aria-label="Go to folder">
        <div className="location-sheet-header">
          <div>
            <div className="location-sheet-eyebrow">Location</div>
            <h2>Go to Folder</h2>
          </div>
          <button type="button" className="tb-btn tb-btn-icon" onClick={onClose} aria-label="Close">
            <ToolbarIcon name="close" />
          </button>
        </div>
        <form
          className="location-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(draftPath);
          }}
        >
          <label className="location-sheet-label" htmlFor="location-sheet-input">
            Absolute path
          </label>
          <input
            ref={inputRef}
            id="location-sheet-input"
            className="location-sheet-input"
            spellCheck={false}
            value={draftPath}
            onChange={(event) => setDraftPath(event.currentTarget.value)}
            placeholder="/Users/you"
          />
          <div className="location-sheet-actions">
            <button type="button" className="tb-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="tb-btn primary"
              disabled={draftPath.trim().length === 0}
            >
              {submitting ? "Opening..." : "Open Folder"}
            </button>
          </div>
          {error ? <div className="location-sheet-error">{error}</div> : null}
        </form>
      </section>
    </div>
  );
}
