import { useEffect, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { ToolbarIcon } from "./ToolbarIcon";

type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];
const PATH_SUGGESTION_DEBOUNCE_MS = 350;

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
  const [draftPath, setDraftPath] = useState(currentPath);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const dialogRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const suggestionDebounceTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const openRef = useRef(open);
  const pendingSuggestionInputRef = useRef("");
  const [browseInProgress, setBrowseInProgress] = useState(false);
  const displayedPath = previewPath ?? draftPath;

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      if (suggestionDebounceTimeoutRef.current !== null) {
        window.clearTimeout(suggestionDebounceTimeoutRef.current);
        suggestionDebounceTimeoutRef.current = null;
      }
      setDraftPath(currentPath);
      setPreviewPath(null);
      setPathSuggestions([]);
      setHighlightedSuggestionIndex(-1);
      setBrowseInProgress(false);
      pendingSuggestionInputRef.current = "";
      return;
    }
    setDraftPath(currentPath);
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    setBrowseInProgress(false);
    pendingSuggestionInputRef.current = currentPath;
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.setSelectionRange(currentPath.length, currentPath.length);
    });
    if (enableSuggestions) {
      scheduleSuggestionsRequest(currentPath);
    }
  }, [currentPath, enableSuggestions, open]);

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

  useEffect(() => {
    if (!open || previewPath === null) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const selectionStart = getSharedPrefixLength(draftPath, previewPath);
    const selectionEnd = previewPath.length;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== input) {
        return;
      }
      input.setSelectionRange(selectionStart, selectionEnd);
    });
  }, [draftPath, open, previewPath]);

  useEffect(
    () => () => {
      if (suggestionDebounceTimeoutRef.current !== null) {
        window.clearTimeout(suggestionDebounceTimeoutRef.current);
      }
    },
    [],
  );

  function scheduleSuggestionsRequest(inputPath: string): void {
    if (!enableSuggestions) {
      return;
    }
    if (suggestionDebounceTimeoutRef.current !== null) {
      window.clearTimeout(suggestionDebounceTimeoutRef.current);
    }
    suggestionDebounceTimeoutRef.current = window.setTimeout(() => {
      suggestionDebounceTimeoutRef.current = null;
      void requestSuggestionsForInput(inputPath);
    }, PATH_SUGGESTION_DEBOUNCE_MS);
  }

  async function requestSuggestionsForInput(inputPath: string): Promise<void> {
    const requestedInput = inputPath;
    pendingSuggestionInputRef.current = requestedInput;
    const requestId = ++suggestionRequestRef.current;
    const response = await onRequestPathSuggestions(requestedInput).catch(() => null);
    if (!openRef.current) {
      return;
    }
    if (suggestionRequestRef.current !== requestId) {
      return;
    }
    if (pendingSuggestionInputRef.current !== requestedInput) {
      return;
    }
    setPreviewPath(null);
    setHighlightedSuggestionIndex(-1);
    setPathSuggestions(response?.suggestions ?? []);
  }

  function acceptSuggestion(suggestion: PathSuggestion): void {
    const acceptedPath = suggestion.path.endsWith("/") ? suggestion.path : `${suggestion.path}/`;
    pendingSuggestionInputRef.current = acceptedPath;
    setDraftPath(acceptedPath);
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    if (enableSuggestions) {
      scheduleSuggestionsRequest(acceptedPath);
    }
  }

  function previewSuggestion(index: number): void {
    const suggestion = pathSuggestions[index];
    if (!suggestion) {
      return;
    }
    const nextPreviewPath = suggestion.path.endsWith("/") ? suggestion.path : `${suggestion.path}/`;
    setHighlightedSuggestionIndex(index);
    setPreviewPath(nextPreviewPath);
  }

  function clearPathSuggestions(): void {
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
  }

  async function handleBrowse(): Promise<void> {
    if (!onBrowse || browseInProgress) {
      return;
    }
    setBrowseInProgress(true);
    try {
      const pickedPath = await onBrowse(draftPath.trim().length > 0 ? draftPath.trim() : currentPath);
      if (!pickedPath) {
        return;
      }
      pendingSuggestionInputRef.current = pickedPath;
      clearPathSuggestions();
      setDraftPath(pickedPath);
      if (enableSuggestions) {
        scheduleSuggestionsRequest(pickedPath);
      }
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(pickedPath.length, pickedPath.length);
      });
    } finally {
      setBrowseInProgress(false);
    }
  }

  function focusPathSuggestion(index: number): void {
    const button = suggestionsRef.current?.querySelectorAll<HTMLButtonElement>(".pathbar-suggestion")[
      index
    ];
    if (!button) {
      return;
    }
    previewSuggestion(index);
    button.focus();
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
              highlightedSuggestionIndex >= 0 && pathSuggestions[highlightedSuggestionIndex]
                ? pathSuggestions[highlightedSuggestionIndex].path
                : draftPath.trim();
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
              value={displayedPath}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  nextTarget instanceof Node &&
                  suggestionsRef.current &&
                  suggestionsRef.current.contains(nextTarget)
                ) {
                  return;
                }
                setPreviewPath(null);
                setHighlightedSuggestionIndex(-1);
              }}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                pendingSuggestionInputRef.current = nextValue;
                clearPathSuggestions();
                setDraftPath(nextValue);
                if (enableSuggestions) {
                  scheduleSuggestionsRequest(nextValue);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (pathSuggestions.length > 0 || previewPath !== null) {
                    clearPathSuggestions();
                    return;
                  }
                  onClose();
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  enableSuggestions &&
                  pathSuggestions.length > 0
                ) {
                  event.preventDefault();
                  const nextIndex =
                    highlightedSuggestionIndex < 0
                      ? event.key === "ArrowDown"
                        ? 0
                        : pathSuggestions.length - 1
                      : event.key === "ArrowDown"
                        ? (highlightedSuggestionIndex + 1) % pathSuggestions.length
                        : (highlightedSuggestionIndex - 1 + pathSuggestions.length) %
                          pathSuggestions.length;
                  previewSuggestion(nextIndex);
                  return;
                }
                if (
                  enableSuggestions &&
                  tabSwitchesExplorerPanes &&
                  event.key === "Tab" &&
                  pathSuggestions.length > 0
                ) {
                  event.preventDefault();
                  focusPathSuggestion(event.shiftKey ? pathSuggestions.length - 1 : 0);
                }
              }}
              placeholder={placeholder}
            />
            {enableSuggestions && pathSuggestions.length > 0 ? (
              <div
                ref={suggestionsRef}
                className="pathbar-suggestions location-sheet-suggestions"
                aria-label="Path suggestions"
              >
                {pathSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.path}
                    type="button"
                    className={`pathbar-suggestion${
                      pathSuggestions[highlightedSuggestionIndex]?.path === suggestion.path
                        ? " active"
                        : ""
                    }`}
                    onMouseEnter={() => {
                      const index = pathSuggestions.findIndex((item) => item.path === suggestion.path);
                      if (index >= 0) {
                        previewSuggestion(index);
                      }
                    }}
                    onFocus={() => {
                      const index = pathSuggestions.findIndex((item) => item.path === suggestion.path);
                      if (index >= 0) {
                        previewSuggestion(index);
                      }
                    }}
                    onKeyDown={(event) => {
                      const index = pathSuggestions.findIndex((item) => item.path === suggestion.path);
                      if (event.key === "Escape") {
                        event.preventDefault();
                        clearPathSuggestions();
                        inputRef.current?.focus();
                        return;
                      }
                      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                        event.preventDefault();
                        if (pathSuggestions.length === 0 || index < 0) {
                          return;
                        }
                        const nextIndex =
                          event.key === "ArrowDown"
                            ? (index + 1) % pathSuggestions.length
                            : (index - 1 + pathSuggestions.length) % pathSuggestions.length;
                        focusPathSuggestion(nextIndex);
                        return;
                      }
                      if (tabSwitchesExplorerPanes && event.key === "Tab") {
                        event.preventDefault();
                        inputRef.current?.focus();
                      }
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      acceptSuggestion(suggestion);
                      inputRef.current?.focus();
                    }}
                    title={suggestion.path}
                  >
                    <span className="pathbar-suggestion-name">{suggestion.name}</span>
                    <span className="pathbar-suggestion-path">{suggestion.path}</span>
                  </button>
                ))}
              </div>
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
              disabled={draftPath.trim().length === 0 || browseInProgress}
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

function getSharedPrefixLength(basePath: string, nextPath: string): number {
  const maxLength = Math.min(basePath.length, nextPath.length);
  let index = 0;
  while (index < maxLength && basePath[index] === nextPath[index]) {
    index += 1;
  }
  return index;
}

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
}
