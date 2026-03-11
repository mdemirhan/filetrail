import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { getSharedPrefixLength } from "../lib/pathUtils";

type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];

const PATH_SUGGESTION_DEBOUNCE_MS = 350;

export function usePathSuggestions(args: {
  open: boolean;
  initialInput: string;
  enableSuggestions?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
}) {
  const { open, initialInput, enableSuggestions = true, inputRef, onRequestPathSuggestions } = args;
  const [draftValue, setDraftValue] = useState(initialInput);
  const [previewValue, setPreviewValue] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PathSuggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const debounceTimeoutRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const openRef = useRef(open);
  const enableSuggestionsRef = useRef(enableSuggestions);
  const onRequestPathSuggestionsRef = useRef(onRequestPathSuggestions);
  const pendingInputRef = useRef("");

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    enableSuggestionsRef.current = enableSuggestions;
  }, [enableSuggestions]);

  useEffect(() => {
    onRequestPathSuggestionsRef.current = onRequestPathSuggestions;
  }, [onRequestPathSuggestions]);

  const requestSuggestionsForInput = useCallback(async (inputPath: string): Promise<void> => {
    const requestedInput = inputPath;
    pendingInputRef.current = requestedInput;
    const requestId = ++requestIdRef.current;
    const response = await onRequestPathSuggestionsRef.current(requestedInput).catch(() => null);
    if (!openRef.current) {
      return;
    }
    if (requestIdRef.current !== requestId) {
      return;
    }
    if (pendingInputRef.current !== requestedInput) {
      return;
    }
    setPreviewValue(null);
    setHighlightedIndex(-1);
    setSuggestions(response?.suggestions ?? []);
  }, []);

  const scheduleSuggestionsRequest = useCallback(
    (inputPath: string): void => {
      if (!enableSuggestionsRef.current) {
        return;
      }
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
      debounceTimeoutRef.current = window.setTimeout(() => {
        debounceTimeoutRef.current = null;
        void requestSuggestionsForInput(inputPath);
      }, PATH_SUGGESTION_DEBOUNCE_MS);
    },
    [requestSuggestionsForInput],
  );

  useLayoutEffect(() => {
    if (debounceTimeoutRef.current !== null) {
      window.clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
    setDraftValue(initialInput);
    setPreviewValue(null);
    setSuggestions([]);
    setHighlightedIndex(-1);
    pendingInputRef.current = open ? initialInput : "";
    if (open && enableSuggestions) {
      scheduleSuggestionsRequest(initialInput);
    }
  }, [enableSuggestions, initialInput, open, scheduleSuggestionsRequest]);

  useEffect(() => {
    if (!open || previewValue === null) {
      return;
    }
    const input = inputRef.current;
    if (!input) {
      return;
    }
    const selectionStart = getSharedPrefixLength(draftValue, previewValue);
    const selectionEnd = previewValue.length;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== input) {
        return;
      }
      input.setSelectionRange(selectionStart, selectionEnd);
    });
  }, [draftValue, inputRef, open, previewValue]);

  useEffect(
    () => () => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
    },
    [],
  );

  function clearSuggestions(): void {
    setPreviewValue(null);
    setSuggestions([]);
    setHighlightedIndex(-1);
  }

  function setValue(nextValue: string, requestSuggestions = true): void {
    pendingInputRef.current = nextValue;
    clearSuggestions();
    setDraftValue(nextValue);
    if (requestSuggestions) {
      scheduleSuggestionsRequest(nextValue);
    }
  }

  function previewSuggestion(index: number): void {
    const suggestion = suggestions[index];
    if (!suggestion) {
      return;
    }
    const nextPreviewValue = suggestion.path.endsWith("/")
      ? suggestion.path
      : `${suggestion.path}/`;
    setHighlightedIndex(index);
    setPreviewValue(nextPreviewValue);
  }

  function acceptSuggestion(suggestion: PathSuggestion): void {
    const acceptedPath = suggestion.path.endsWith("/") ? suggestion.path : `${suggestion.path}/`;
    pendingInputRef.current = acceptedPath;
    setDraftValue(acceptedPath);
    setPreviewValue(null);
    setSuggestions([]);
    setHighlightedIndex(-1);
    if (enableSuggestions) {
      scheduleSuggestionsRequest(acceptedPath);
    }
  }

  function focusSuggestion(index: number): void {
    const button =
      suggestionsRef.current?.querySelectorAll<HTMLButtonElement>(".pathbar-suggestion")[index];
    if (!button) {
      return;
    }
    previewSuggestion(index);
    button.focus();
  }

  return {
    draftValue,
    displayedValue: previewValue ?? draftValue,
    suggestions,
    highlightedIndex,
    previewValue,
    suggestionsRef,
    setValue,
    clearSuggestions,
    previewSuggestion,
    acceptSuggestion,
    focusSuggestion,
  };
}
