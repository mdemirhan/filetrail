import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { usePathSuggestions } from "../hooks/usePathSuggestions";
import { getFocusableElements } from "../lib/focusUtils";

type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];

export function GoToFolderDialog({
  open,
  currentPath,
  submitting,
  error,
  tabSwitchesExplorerPanes,
  title = "Go to Folder",
  inputAriaLabel = "Absolute path",
  submitLabel = "Open Folder",
  browseLabel = "Browse",
  onBrowse = null,
  onClose,
  onSubmit,
  onRequestPathSuggestions,
}: {
  open: boolean;
  currentPath: string;
  submitting: boolean;
  error: string | null;
  tabSwitchesExplorerPanes: boolean;
  title?: string;
  inputAriaLabel?: string;
  submitLabel?: string;
  browseLabel?: string;
  onBrowse?: ((path: string) => Promise<string | null>) | null;
  onClose: () => void;
  onSubmit: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  const [browseInProgress, setBrowseInProgress] = useState(false);
  const {
    draftValue,
    suggestions,
    setValue,
    clearSuggestions,
  } = usePathSuggestions({
    open,
    initialInput: currentPath,
    inputRef,
    onRequestPathSuggestions,
  });
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);

  function focusInputAtEnd(): void {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const valueLength = input.value.length;
    input.setSelectionRange(valueLength, valueLength);
  }

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setBrowseInProgress(false);
      return;
    }
    setBrowseInProgress(false);
    setSelectedIndex(-1);
    setInputFocused(true);
    const input = inputRef.current;
    if (!input) {
      return;
    }
    focusInputAtEnd();
    const timeoutId = window.setTimeout(() => {
      focusInputAtEnd();
    }, 0);
    const frameId = window.requestAnimationFrame(() => {
      focusInputAtEnd();
    });
    const secondFrameId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusInputAtEnd();
      });
    });
    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [currentPath, open]);

  useEffect(() => {
    if (!open) {
      setSelectedIndex(-1);
      return;
    }
    if (suggestions.length === 0) {
      setSelectedIndex(-1);
    }
  }, [open, suggestions]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const dialog = dialogRef.current;
      if (!(target instanceof Node) || !dialog || dialog.contains(target)) {
        return;
      }
      window.requestAnimationFrame(() => {
        if (!openRef.current) {
          return;
        }
        focusInputAtEnd();
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open || selectedIndex < 0) {
      return;
    }
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-go-to-folder-index="${selectedIndex}"]`,
    );
    item?.scrollIntoView?.({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open) {
    return null;
  }

  const selectedSuggestion = selectedIndex >= 0 ? suggestions[selectedIndex] ?? null : null;
  const canSubmit = draftValue.trim().length > 0 && !submitting;

  async function handleBrowse(): Promise<void> {
    if (!onBrowse || browseInProgress) {
      return;
    }
    setBrowseInProgress(true);
    try {
      const pickedPath = await onBrowse(draftValue.trim().length > 0 ? draftValue.trim() : currentPath);
      if (!pickedPath) {
        return;
      }
      setValue(pickedPath, true);
      setSelectedIndex(-1);
      clearSuggestions();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(pickedPath.length, pickedPath.length);
      });
    } finally {
      setBrowseInProgress(false);
    }
  }

  function acceptSuggestion(suggestion: PathSuggestion, nextIndex: number): void {
    setValue(suggestion.path, true);
    setSelectedIndex(nextIndex);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(suggestion.path.length, suggestion.path.length);
    });
  }

  return (
    <div
      className="go-to-folder-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <dialog
        ref={dialogRef}
        open
        className="go-to-folder-dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onCancel={(event) => {
          event.preventDefault();
          onClose();
        }}
        onFocus={(event) => {
          if (event.target !== dialogRef.current) {
            return;
          }
          focusInputAtEnd();
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented) {
            return;
          }
          if (event.key === "Tab" && tabSwitchesExplorerPanes) {
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
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="go-to-folder-header">
          <div className="go-to-folder-header-copy">
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="go-to-folder-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>
        <form
          id="go-to-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) {
              return;
            }
            onSubmit(draftValue.trim());
          }}
        />
        <div className="go-to-folder-input-section">
          <div className={`go-to-folder-input-shell${inputFocused ? " is-focused" : ""}`}>
            <svg
              className="go-to-folder-input-icon"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path d="M2 4l4-2h8v12H6l-4-2V4z" />
              <path d="M6 2v12" />
            </svg>
            <input
              ref={inputRef}
              id="go-to-folder-input"
              form="go-to-folder-form"
              className="go-to-folder-input"
              aria-label={inputAriaLabel}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              value={draftValue}
              onChange={(event) => setValue(event.currentTarget.value, true)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (suggestions.length === 0) {
                    return;
                  }
                  setSelectedIndex((currentIndex) =>
                    currentIndex < 0 ? 0 : Math.min(currentIndex + 1, suggestions.length - 1),
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (suggestions.length === 0) {
                    return;
                  }
                  setSelectedIndex((currentIndex) =>
                    currentIndex < 0 ? suggestions.length - 1 : Math.max(currentIndex - 1, 0),
                  );
                  return;
                }
                if (event.key === "Enter") {
                  if (!selectedSuggestion || selectedIndex < 0) {
                    return;
                  }
                  if (selectedSuggestion.path === draftValue.trim()) {
                    return;
                  }
                  event.preventDefault();
                  acceptSuggestion(selectedSuggestion, selectedIndex);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                }
              }}
            />
            {draftValue.length > 0 ? (
              <button
                type="button"
                className="go-to-folder-clear"
                aria-label="Clear path"
                onClick={() => {
                  setValue("", false);
                  setSelectedIndex(-1);
                  clearSuggestions();
                  window.requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M1 1l8 8M9 1l-8 8" />
                </svg>
              </button>
            ) : null}
          </div>
          {error ? <div className="go-to-folder-error">{error}</div> : null}
        </div>

        <div className="go-to-folder-suggestions-section">
          {suggestions.length > 0 ? (
            <>
              <div className="go-to-folder-suggestions-label">
                <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <circle cx="5" cy="5" r="4" />
                  <path d="M8 8l3 3" />
                </svg>
                <span>
                  {suggestions.length} match{suggestions.length === 1 ? "" : "es"}
                </span>
              </div>
              <div
                ref={listRef}
                className="go-to-folder-suggestions-list"
                role="listbox"
                aria-label="Folder suggestions"
              >
                {suggestions.map((suggestion, index) => {
                  const isSelected = selectedIndex === index;
                  return (
                    <button
                      key={suggestion.path}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-go-to-folder-index={index}
                      className={`go-to-folder-suggestion${isSelected ? " is-selected" : ""}`}
                      onClick={() => acceptSuggestion(suggestion, index)}
                      onMouseEnter={() => setSelectedIndex(index)}
                    >
                      <span className="go-to-folder-suggestion-icon" aria-hidden="true">
                        <svg viewBox="0 0 14 14" fill="none">
                          <path d="M1.5 3l3-1.5h8v10.5H4.5l-3-1.5V3z" />
                          <path d="M4.5 1.5v10.5" />
                        </svg>
                      </span>
                      <span className="go-to-folder-suggestion-name">{suggestion.name}</span>
                      <span className="go-to-folder-suggestion-path">{suggestion.path}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="go-to-folder-empty-state">
              <span>{draftValue.trim().length > 0 ? "No matches" : "Type a path to search"}</span>
            </div>
          )}
        </div>

        <div className="go-to-folder-footer">
          <div className="go-to-folder-footer-hints" aria-hidden="true">
            <kbd>↑↓</kbd>
            <span>navigate</span>
          </div>
          <div className="go-to-folder-footer-actions">
            <button
              type="button"
              className="go-to-folder-cancel"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            {onBrowse ? (
              <button
                type="button"
                className="go-to-folder-browse"
                onClick={() => void handleBrowse()}
                disabled={submitting || browseInProgress}
              >
                {browseInProgress ? `${browseLabel}...` : browseLabel}
              </button>
            ) : null}
            <button
              type="submit"
              form="go-to-folder-form"
              className="go-to-folder-submit"
              disabled={!canSubmit}
            >
              {submitting ? `${submitLabel}...` : submitLabel}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
