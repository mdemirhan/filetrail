import type { MutableRefObject, RefObject } from "react";
import { useCallback, useMemo } from "react";

import type { useAppPreferences } from "../hooks/useAppPreferences";
import type { useExplorerNavigation } from "../hooks/useExplorerNavigation";
import type { useExplorerPaneLayout } from "../hooks/useExplorerPaneLayout";
import type { useSearchSession } from "../hooks/useSearchSession";
import type { useWriteOperations } from "../hooks/useWriteOperations";
import {
  type ContentSelectionState,
  setSingleContentSelection as createSingleContentSelection,
} from "../lib/contentSelection";
import type { DirectoryEntry } from "../lib/explorerTypes";
import type { useFiletrailClient } from "../lib/filetrailClient";

// Domain store shapes. Each store is the bag returned by its state hook; the
// controller hooks subscribe to whole stores instead of receiving every field
// as an individual parameter.
export type PreferencesStore = ReturnType<typeof useAppPreferences>;
export type NavigationStore = ReturnType<typeof useExplorerNavigation>;
export type SearchStore = ReturnType<typeof useSearchSession>;
export type WriteOperationsStore = ReturnType<typeof useWriteOperations>;

// Long-lived, render-independent dependencies: the IPC client, pane layout
// controller, and the DOM/timer refs shared across controllers.
export type ExplorerServices = {
  client: ReturnType<typeof useFiletrailClient>;
  panes: ReturnType<typeof useExplorerPaneLayout>;
  treePaneRef: RefObject<HTMLElement | null>;
  contentPaneRef: RefObject<HTMLElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchShellRef: RefObject<HTMLDivElement | null>;
  typeaheadTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  typeaheadQueryRef: MutableRefObject<string>;
  typeaheadPaneRef: MutableRefObject<"tree" | "content" | null>;
};

export function useExplorerServices(args: {
  client: ReturnType<typeof useFiletrailClient>;
  panes: ReturnType<typeof useExplorerPaneLayout>;
  treePaneRef: RefObject<HTMLElement | null>;
  contentPaneRef: RefObject<HTMLElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchShellRef: RefObject<HTMLDivElement | null>;
  typeaheadTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  typeaheadQueryRef: MutableRefObject<string>;
  typeaheadPaneRef: MutableRefObject<"tree" | "content" | null>;
}): ExplorerServices {
  const {
    client,
    panes,
    treePaneRef,
    contentPaneRef,
    searchInputRef,
    searchShellRef,
    typeaheadTimeoutRef,
    typeaheadQueryRef,
    typeaheadPaneRef,
  } = args;
  return useMemo(
    () => ({
      client,
      panes,
      treePaneRef,
      contentPaneRef,
      searchInputRef,
      searchShellRef,
      typeaheadTimeoutRef,
      typeaheadQueryRef,
      typeaheadPaneRef,
    }),
    [
      client,
      panes,
      treePaneRef,
      contentPaneRef,
      searchInputRef,
      searchShellRef,
      typeaheadTimeoutRef,
      typeaheadQueryRef,
      typeaheadPaneRef,
    ],
  );
}

export type SelectionActions = {
  applyContentSelection: (selection: ContentSelectionState, entries: DirectoryEntry[]) => void;
  setSingleContentSelection: (path: string) => void;
  clearTypeahead: () => void;
  focusContentPane: () => void;
};

// Selection and focus actions shared by every controller. These were formerly
// per-render "bridge" closures in App; they are referentially stable because
// they only touch refs and stable setters from the navigation store.
export function useSelectionActions(args: {
  navigation: NavigationStore;
  services: ExplorerServices;
}): SelectionActions {
  const { navigation, services } = args;
  const {
    activeContentEntriesRef,
    selectedEntryRef,
    selectedPathsInViewOrderRef,
    setContentSelection,
    setFocusedPane,
    setTypeaheadPane,
    setTypeaheadQuery,
  } = navigation;
  const { contentPaneRef, typeaheadPaneRef, typeaheadQueryRef, typeaheadTimeoutRef } = services;

  const applyContentSelection = useCallback(
    (selection: ContentSelectionState, entries: DirectoryEntry[]) => {
      selectedPathsInViewOrderRef.current = entries
        .filter((entry) => selection.paths.includes(entry.path))
        .map((entry) => entry.path);
      selectedEntryRef.current =
        entries.find((entry) => entry.path === selection.leadPath) ??
        entries.find((entry) => selection.paths.includes(entry.path)) ??
        null;
      setContentSelection(selection);
    },
    [selectedEntryRef, selectedPathsInViewOrderRef, setContentSelection],
  );

  const setSingleContentSelection = useCallback(
    (path: string) => {
      applyContentSelection(createSingleContentSelection(path), activeContentEntriesRef.current);
    },
    [activeContentEntriesRef, applyContentSelection],
  );

  const clearTypeahead = useCallback(() => {
    if (typeaheadTimeoutRef.current) {
      clearTimeout(typeaheadTimeoutRef.current);
      typeaheadTimeoutRef.current = null;
    }
    typeaheadQueryRef.current = "";
    typeaheadPaneRef.current = null;
    setTypeaheadQuery("");
    setTypeaheadPane(null);
  }, [
    setTypeaheadPane,
    setTypeaheadQuery,
    typeaheadPaneRef,
    typeaheadQueryRef,
    typeaheadTimeoutRef,
  ]);

  const focusContentPane = useCallback(() => {
    setFocusedPane("content");
    clearTypeahead();
    window.requestAnimationFrame(() => {
      contentPaneRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        contentPaneRef.current?.focus({ preventScroll: true });
      });
    });
  }, [clearTypeahead, contentPaneRef, setFocusedPane]);

  return useMemo(
    () => ({
      applyContentSelection,
      setSingleContentSelection,
      clearTypeahead,
      focusContentPane,
    }),
    [applyContentSelection, setSingleContentSelection, clearTypeahead, focusContentPane],
  );
}
