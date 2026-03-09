import { useEffect, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { usePathSuggestions } from "../hooks/usePathSuggestions";
import { getFocusableElements } from "../lib/focusUtils";
import { PathSuggestionDropdown } from "./PathSuggestionDropdown";
import { ToolbarIcon } from "./ToolbarIcon";

export function LocationSheet({
  open,
  currentPath,
  submitting,
  error,
  title = "Go to Folder",
  eyebrow = "Location",
  label = "Absolute path",
  submitLabel = "Open Folder",
  placeholder = "/Users/you",
  tabSwitchesExplorerPanes = false,
  enableSuggestions = true,
  browseLabel,
  onBrowse,
  onClose,
  onSubmit,
  onRequestPathSuggestions,
}: {
  open: boolean;
  currentPath: string;
  submitting: boolean;
  error: string | null;
  title?: string;
  eyebrow?: string;
  label?: string;
  submitLabel?: string;
  placeholder?: string;
  tabSwitchesExplorerPanes?: boolean;
  enableSuggestions?: boolean;
  browseLabel?: string;
  onBrowse?: ((currentPath: string) => Promise<string | null>) | null;
  onClose: () => void;
  onSubmit: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [browseInProgress, setBrowseInProgress] = useState(false);
  const {
    draftValue,
    displayedValue,
    suggestions,
    highlightedIndex,
    previewValue,
    suggestionsRef,
    setValue,
    clearSuggestions,
    acceptSuggestion,
    previewSuggestion,
    focusSuggestion,
  } = usePathSuggestions({
    open,
    initialInput: currentPath,
    enableSuggestions,
    inputRef,
    onRequestPathSuggestions,
  });

  useEffect(() => {
    if (!open) {
      setBrowseInProgress(false);
      return;
    }
    setBrowseInProgress(false);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.setSelectionRange(currentPath.length, currentPath.length);
    });
  }, [currentPath, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  async function handleBrowse(): Promise<void> {
    if (!onBrowse || browseInProgress) {
      return;
    }
    setBrowseInProgress(true);
    try {
      const pickedPath = await onBrowse(
        draftValue.trim().length > 0 ? draftValue.trim() : currentPath,
      );
      if (!pickedPath) {
        return;
      }
      setValue(pickedPath, enableSuggestions);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(pickedPath.length, pickedPath.length);
      });
    } finally {
      setBrowseInProgress(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="location-sheet-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="location-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.key !== "Tab" || !tabSwitchesExplorerPanes) {
            return;
          }
          const dialog = dialogRef.current;
          if (!dialog) {
            return;
          }
          const focusableElements = getFocusableElements(dialog);
          if (focusableElements.length === 0) {
            return;
          }
          const activeElement = document.activeElement;
          const currentIndex =
            activeElement instanceof HTMLElement ? focusableElements.indexOf(activeElement) : -1;
          const nextIndex = event.shiftKey
            ? currentIndex <= 0
              ? focusableElements.length - 1
              : currentIndex - 1
            : currentIndex < 0 || currentIndex >= focusableElements.length - 1
              ? 0
              : currentIndex + 1;
          event.preventDefault();
          focusableElements[nextIndex]?.focus();
        }}
      >
        <div className="location-sheet-header">
          <div>
            <div className="location-sheet-eyebrow">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="tb-btn tb-btn-icon" onClick={onClose} aria-label="Close">
            <ToolbarIcon name="close" />
          </button>
        </div>
        <form
          className="location-sheet-form"
          onSubmit={(event) => {
            event.preventDefault();
            const nextPath =
              highlightedIndex >= 0 && suggestions[highlightedIndex]
                ? suggestions[highlightedIndex].path
                : draftValue.trim();
            if (nextPath.length === 0) {
              return;
            }
            onSubmit(nextPath);
          }}
        >
          <label className="location-sheet-label" htmlFor="location-sheet-input">
            {label}
          </label>
          <div className="location-sheet-input-shell">
            <input
              ref={inputRef}
              id="location-sheet-input"
              className="location-sheet-input"
              autoComplete="off"
              autoFocus
              spellCheck={false}
              value={displayedValue}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  nextTarget instanceof Node &&
                  suggestionsRef.current &&
                  suggestionsRef.current.contains(nextTarget)
                ) {
                  return;
                }
                clearSuggestions();
              }}
              onChange={(event) => setValue(event.currentTarget.value, enableSuggestions)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (suggestions.length > 0 || previewValue !== null) {
                    clearSuggestions();
                    return;
                  }
                  onClose();
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  enableSuggestions &&
                  suggestions.length > 0
                ) {
                  event.preventDefault();
                  const nextIndex =
                    highlightedIndex < 0
                      ? event.key === "ArrowDown"
                        ? 0
                        : suggestions.length - 1
                      : event.key === "ArrowDown"
                        ? (highlightedIndex + 1) % suggestions.length
                        : (highlightedIndex - 1 + suggestions.length) % suggestions.length;
                  previewSuggestion(nextIndex);
                  return;
                }
                if (
                  enableSuggestions &&
                  tabSwitchesExplorerPanes &&
                  event.key === "Tab" &&
                  suggestions.length > 0
                ) {
                  event.preventDefault();
                  focusSuggestion(event.shiftKey ? suggestions.length - 1 : 0);
                }
              }}
              placeholder={placeholder}
            />
            {enableSuggestions ? (
              <PathSuggestionDropdown
                suggestions={suggestions}
                highlightedIndex={highlightedIndex}
                suggestionsRef={suggestionsRef}
                inputRef={inputRef}
                tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
                className="pathbar-suggestions location-sheet-suggestions"
                refocusInputOnAccept
                onPreviewSuggestion={previewSuggestion}
                onFocusSuggestion={focusSuggestion}
                onClearSuggestions={clearSuggestions}
                onAcceptSuggestion={acceptSuggestion}
              />
            ) : null}
          </div>
          <div className="location-sheet-actions">
            <button type="button" className="tb-btn" onClick={onClose}>
              Cancel
            </button>
            {onBrowse ? (
              <button
                type="button"
                className="tb-btn"
                onClick={() => void handleBrowse()}
                disabled={browseInProgress || submitting}
              >
                {browseInProgress ? `${browseLabel ?? "Browse"}...` : (browseLabel ?? "Browse")}
              </button>
            ) : null}
            <button
              type="submit"
              className="tb-btn primary"
              disabled={draftValue.trim().length === 0 || browseInProgress}
            >
              {submitting ? `${submitLabel}...` : submitLabel}
            </button>
          </div>
          {error ? <div className="location-sheet-error">{error}</div> : null}
        </form>
      </section>
    </div>
  );
}
