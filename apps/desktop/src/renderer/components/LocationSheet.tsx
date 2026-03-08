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
  onClose,
  onSubmit,
  onRequestPathSuggestions,
}: {
  open: boolean;
  currentPath: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
}) {
  const [draftPath, setDraftPath] = useState(currentPath);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const suggestionDebounceTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const openRef = useRef(open);
  const pendingSuggestionInputRef = useRef("");
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
      pendingSuggestionInputRef.current = "";
      return;
    }
    setDraftPath(currentPath);
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    pendingSuggestionInputRef.current = currentPath;
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.setSelectionRange(currentPath.length, currentPath.length);
    });
    scheduleSuggestionsRequest(currentPath);
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
    scheduleSuggestionsRequest(acceptedPath);
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

  if (!open) {
    return null;
  }

  return (
    <div className="location-sheet-backdrop" role="presentation">
      <section className="location-sheet" role="dialog" aria-modal="true" aria-label="Go to folder">
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
            Absolute path
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
                setPreviewPath(null);
                setPathSuggestions([]);
                setHighlightedSuggestionIndex(-1);
                setDraftPath(nextValue);
                scheduleSuggestionsRequest(nextValue);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
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
                if (event.key === "Tab" && pathSuggestions.length > 0) {
                  const highlightedSuggestion =
                    highlightedSuggestionIndex >= 0
                      ? pathSuggestions[highlightedSuggestionIndex]
                      : null;
                  if (highlightedSuggestion) {
                    event.preventDefault();
                    acceptSuggestion(highlightedSuggestion);
                  }
                }
              }}
              placeholder="/Users/you"
            />
            {pathSuggestions.length > 0 ? (
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

function getSharedPrefixLength(basePath: string, nextPath: string): number {
  const maxLength = Math.min(basePath.length, nextPath.length);
  let index = 0;
  while (index < maxLength && basePath[index] === nextPath[index]) {
    index += 1;
  }
  return index;
}
