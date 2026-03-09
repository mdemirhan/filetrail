import type { RefObject } from "react";

import type { IpcResponse } from "@filetrail/contracts";

type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];

export function PathSuggestionDropdown({
  suggestions,
  highlightedIndex,
  suggestionsRef,
  inputRef,
  tabSwitchesExplorerPanes = false,
  className = "pathbar-suggestions",
  refocusInputOnAccept = false,
  onPreviewSuggestion,
  onFocusSuggestion,
  onClearSuggestions,
  onAcceptSuggestion,
}: {
  suggestions: PathSuggestion[];
  highlightedIndex: number;
  suggestionsRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  tabSwitchesExplorerPanes?: boolean;
  className?: string;
  refocusInputOnAccept?: boolean;
  onPreviewSuggestion: (index: number) => void;
  onFocusSuggestion: (index: number) => void;
  onClearSuggestions: () => void;
  onAcceptSuggestion: (suggestion: PathSuggestion) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div ref={suggestionsRef} className={className} aria-label="Path suggestions">
      {suggestions.map((suggestion, index) => (
        <button
          key={suggestion.path}
          type="button"
          className={`pathbar-suggestion${highlightedIndex === index ? " active" : ""}`}
          onMouseEnter={() => onPreviewSuggestion(index)}
          onFocus={() => onPreviewSuggestion(index)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClearSuggestions();
              inputRef.current?.focus();
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const nextIndex =
                event.key === "ArrowDown"
                  ? (index + 1) % suggestions.length
                  : (index - 1 + suggestions.length) % suggestions.length;
              onFocusSuggestion(nextIndex);
              return;
            }
            if (tabSwitchesExplorerPanes && event.key === "Tab") {
              event.preventDefault();
              inputRef.current?.focus();
            }
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onAcceptSuggestion(suggestion);
            if (refocusInputOnAccept) {
              inputRef.current?.focus();
            }
          }}
          title={suggestion.path}
        >
          <span className="pathbar-suggestion-name">{suggestion.name}</span>
          <span className="pathbar-suggestion-path">{suggestion.path}</span>
        </button>
      ))}
    </div>
  );
}
