import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { usePathSuggestions } from "../hooks/usePathSuggestions";
import { getFocusableElements } from "../lib/focusUtils";
import { type Place, isPathQuery, rankPlaces } from "../lib/places";

type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];

// One row of the list: a folder to go to, however it was found.
type GoToRow = {
  path: string;
  name: string;
  detail: string;
  nameRanges: Array<[number, number]>;
  isFavorite: boolean;
  /** Whether ⌘⌫ can take it out of the list of opened folders. */
  canForget: boolean;
};

// The Go To box (⌘K, ⇧⌘G) and the Move To box. A few letters find a folder that has been
// opened before, or a favorite, best match and most used first. Text starting with "/" or
// "~" is a path instead and is completed folder by folder, as Go to Folder always did.
export function GoToFolderDialog({
  open,
  currentPath,
  places = [],
  selectFirstPlace = true,
  submitting,
  error,
  tabSwitchesExplorerPanes,
  title = "Go To",
  inputAriaLabel = "Folder name or path",
  submitLabel = "Open",
  browseLabel = "Browse",
  onBrowse = null,
  onClose,
  onSubmit,
  onForgetPlace,
  onRequestPathSuggestions,
}: {
  open: boolean;
  currentPath: string;
  /** Opened folders and favorites to find by name; ranked here against what is typed. */
  places?: readonly Place[];
  /**
   * Whether the top place is selected before anything is typed, so Return goes there at
   * once. Off for Move To, where Return must never act on a folder nobody chose.
   */
  selectFirstPlace?: boolean;
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
  onForgetPlace?: ((path: string) => void) | undefined;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const openRef = useRef(open);
  const focusInputAtEndRef = useRef<() => void>(() => undefined);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [browseInProgress, setBrowseInProgress] = useState(false);
  const { draftValue, suggestions, setValue, clearSuggestions } = usePathSuggestions({
    open,
    initialInput: "",
    inputRef,
    onRequestPathSuggestions,
  });
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const pathMode = isPathQuery(draftValue);
  const rows = useMemo<GoToRow[]>(() => {
    if (pathMode) {
      return suggestions.map((suggestion: PathSuggestion) => ({
        path: suggestion.path,
        name: suggestion.name,
        detail: suggestion.path,
        nameRanges: [],
        isFavorite: false,
        canForget: false,
      }));
    }
    return rankPlaces(places, draftValue).map(({ place, nameRanges }) => ({
      path: place.path,
      name: place.name,
      detail: place.displayPath,
      nameRanges,
      isFavorite: place.isFavorite,
      canForget: place.isVisited,
    }));
  }, [draftValue, pathMode, places, suggestions]);
  const hasQuery = draftValue.trim().length > 0;

  // Only a path asks the disk for completions; a name is matched against `places`.
  function changeValue(nextValue: string): void {
    setValue(nextValue, isPathQuery(nextValue));
  }

  focusInputAtEndRef.current = () => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const valueLength = input.value.length;
    input.setSelectionRange(valueLength, valueLength);
  };

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setBrowseInProgress(false);
      return;
    }
    setBrowseInProgress(false);
    setInputFocused(true);
    const input = inputRef.current;
    if (!input) {
      return;
    }
    focusInputAtEndRef.current();
    const timeoutId = window.setTimeout(() => {
      focusInputAtEndRef.current();
    }, 0);
    const frameId = window.requestAnimationFrame(() => {
      focusInputAtEndRef.current();
    });
    const secondFrameId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        focusInputAtEndRef.current();
      });
    });
    return () => {
      window.clearTimeout(timeoutId);
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [open]);

  // What is typed decides what is selected: the best place while a name is typed (and
  // before, for Go To), nothing while a path is typed until ↓ picks a completion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-evaluated when the text or the list changes, not on every selection move.
  useLayoutEffect(() => {
    if (!open || rows.length === 0 || pathMode) {
      setSelectedIndex(-1);
      return;
    }
    setSelectedIndex(hasQuery || selectFirstPlace ? 0 : -1);
  }, [open, draftValue, rows.length, pathMode, selectFirstPlace]);

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
        focusInputAtEndRef.current();
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

  const selectedRow = selectedIndex >= 0 ? (rows[selectedIndex] ?? null) : null;
  // A name needs a folder picked from the list; a path can be opened as typed.
  const canSubmit = !submitting && (pathMode ? hasQuery : selectedRow !== null);

  function submit(): void {
    if (!canSubmit) {
      return;
    }
    onSubmit(pathMode ? draftValue.trim() : (selectedRow?.path ?? ""));
  }

  async function handleBrowse(): Promise<void> {
    if (!onBrowse || browseInProgress) {
      return;
    }
    setBrowseInProgress(true);
    try {
      const pickedPath = await onBrowse(pathMode && hasQuery ? draftValue.trim() : currentPath);
      if (!pickedPath) {
        return;
      }
      setValue(pickedPath, true);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(pickedPath.length, pickedPath.length);
      });
    } finally {
      setBrowseInProgress(false);
    }
  }

  // Puts a completion into the field. With `descend` the path ends in a slash, so the
  // list moves on to the folders inside it (Tab); without, the folder itself stays listed.
  function acceptCompletion(row: GoToRow, descend: boolean): void {
    const nextValue = descend && !row.path.endsWith("/") ? `${row.path}/` : row.path;
    setValue(nextValue, true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
    });
  }

  function moveSelection(step: 1 | -1): void {
    if (rows.length === 0) {
      return;
    }
    setSelectedIndex((currentIndex) => {
      if (currentIndex < 0) {
        return step === 1 ? 0 : rows.length - 1;
      }
      return Math.max(0, Math.min(rows.length - 1, currentIndex + step));
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
          focusInputAtEndRef.current();
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
          <button type="button" className="go-to-folder-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>
        <form
          id="go-to-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
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
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input
              ref={inputRef}
              id="go-to-folder-input"
              form="go-to-folder-form"
              className="go-to-folder-input"
              aria-label={inputAriaLabel}
              placeholder="Folder name, or a path starting with / or ~"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              value={draftValue}
              onChange={(event) => changeValue(event.currentTarget.value)}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveSelection(1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveSelection(-1);
                  return;
                }
                if (event.key === "Tab" && !event.shiftKey && pathMode && rows.length > 0) {
                  // Tab completes the path with the selected folder, or the first one.
                  const row = selectedRow ?? rows[0];
                  if (row) {
                    event.preventDefault();
                    acceptCompletion(row, true);
                  }
                  return;
                }
                if (
                  event.key === "Backspace" &&
                  event.metaKey &&
                  !pathMode &&
                  selectedRow?.canForget &&
                  onForgetPlace
                ) {
                  // ⌘⌫ takes the selected folder out of the list of opened folders.
                  event.preventDefault();
                  onForgetPlace(selectedRow.path);
                  return;
                }
                if (event.key === "Enter") {
                  if (!pathMode || !selectedRow || selectedRow.path === draftValue.trim()) {
                    return;
                  }
                  // A selected completion goes into the field first; Return again opens it.
                  event.preventDefault();
                  acceptCompletion(selectedRow, false);
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
                aria-label="Clear"
                onClick={() => {
                  setValue("", false);
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
          {rows.length > 0 ? (
            <>
              <div className="go-to-folder-suggestions-label">
                <span>
                  {pathMode || hasQuery
                    ? `${rows.length} match${rows.length === 1 ? "" : "es"}`
                    : "Folders you use"}
                </span>
              </div>
              <ul
                ref={listRef}
                className="go-to-folder-suggestions-list"
                aria-label={pathMode ? "Folder suggestions" : "Folders"}
              >
                {rows.map((row, index) => {
                  const isSelected = selectedIndex === index;
                  return (
                    <li key={row.path}>
                      <button
                        type="button"
                        data-go-to-folder-index={index}
                        className={`go-to-folder-suggestion${isSelected ? " is-selected" : ""}`}
                        aria-current={isSelected ? "true" : undefined}
                        title={row.path}
                        // The field keeps the keyboard while the list is used with the mouse.
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          if (pathMode) {
                            acceptCompletion(row, false);
                            setSelectedIndex(index);
                            return;
                          }
                          onSubmit(row.path);
                        }}
                        // Only a pointer that really moved selects a row. One merely resting
                        // over the list when it appears or changes must not, or Return could
                        // act on a folder nobody chose.
                        onMouseMove={(event) => {
                          const last = lastPointerRef.current;
                          lastPointerRef.current = { x: event.clientX, y: event.clientY };
                          if (last && (last.x !== event.clientX || last.y !== event.clientY)) {
                            setSelectedIndex(index);
                          }
                        }}
                      >
                        <span className="go-to-folder-suggestion-icon" aria-hidden="true">
                          {row.isFavorite ? (
                            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                              <path d="M7 1.6l1.6 3.4 3.7.5-2.7 2.6.7 3.7L7 10l-3.3 1.8.7-3.7L1.7 5.5l3.7-.5L7 1.6z" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                              <path d="M1.5 3.5h4l1.2 1.4h5.8v6.6h-11z" />
                            </svg>
                          )}
                        </span>
                        <span className="go-to-folder-suggestion-name">
                          {renderHighlightedName(row.name, row.nameRanges)}
                        </span>
                        <span className="go-to-folder-suggestion-path">{row.detail}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="go-to-folder-empty-state">
              <span>
                {pathMode
                  ? "No folders match this path"
                  : hasQuery
                    ? "No folder you have opened has that name. Start with / or ~ to type a path."
                    : "Folders you open are listed here. Start with / or ~ to type a path."}
              </span>
            </div>
          )}
        </div>

        <div className="go-to-folder-footer">
          <div className="go-to-folder-footer-hints" aria-hidden="true">
            <kbd>↑↓</kbd>
            <span>choose</span>
            {pathMode ? (
              <>
                <kbd>⇥</kbd>
                <span>complete</span>
              </>
            ) : onForgetPlace ? (
              <>
                <kbd>⌘⌫</kbd>
                <span>forget</span>
              </>
            ) : null}
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

// The name with the letters that matched what was typed marked.
function renderHighlightedName(name: string, ranges: Array<[number, number]>) {
  if (ranges.length === 0) {
    return name;
  }
  const parts: React.ReactNode[] = [];
  let position = 0;
  for (const [start, end] of ranges) {
    if (start > position) {
      parts.push(name.slice(position, start));
    }
    parts.push(
      <mark key={start} className="go-to-folder-match">
        {name.slice(start, end)}
      </mark>,
    );
    position = end;
  }
  if (position < name.length) {
    parts.push(name.slice(position));
  }
  return parts;
}
