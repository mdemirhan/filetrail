import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";

import type { IpcRequest } from "@filetrail/contracts";

import type { ExplorerViewMode } from "../../shared/appPreferences";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { parentDirectoryPath } from "../lib/explorerNavigation";
import { ToolbarIcon } from "./ToolbarIcon";
import { InfoPanel } from "./GetInfoPanel";
import { SearchWorkspace } from "./SearchWorkspace";
import { TreePane } from "./TreePane";

type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type TreePaneProps = ComponentProps<typeof TreePane>;
type SearchWorkspaceProps = ComponentProps<typeof SearchWorkspace>;
type InfoPanelProps = ComponentProps<typeof InfoPanel>;

export function ExplorerWorkspace({
  preferencesReady,
  restoredPaneWidths,
  treeWidth,
  inspectorWidth,
  beginResize,
  infoPanelOpen,
  toolbarRef,
  treePaneProps,
  searchWorkspaceProps,
  infoPanelProps,
  currentPath,
  explorerToolbarLayout,
  canGoBack,
  canGoForward,
  focusedPane,
  selectedEntryExists,
  goBack,
  goForward,
  navigateToParentFolder,
  navigateDownAction,
  refreshDirectory,
  viewMode,
  onViewModeChange,
  sortBy,
  sortDirection,
  onSortChange,
  searchShellRef,
  searchPopoverOpen,
  onSearchShellBlur,
  searchPointerIntentRef,
  onSearchShellPointerIntent,
  onSearchSubmit,
  searchInputRef,
  searchDraftQuery,
  onSearchInputFocus,
  onSearchDraftQueryChange,
  onSearchInputEscape,
  onClearSearchDraft,
  searchPatternMode,
  onSearchPatternModeChange,
  searchMatchScope,
  onSearchMatchScopeChange,
  searchRecursive,
  onSearchRecursiveChange,
  searchIncludeHidden,
  onSearchIncludeHiddenChange,
  onPaneResizeKey,
}: {
  preferencesReady: boolean;
  restoredPaneWidths: { treeWidth: number; inspectorWidth: number } | null;
  treeWidth: number;
  inspectorWidth: number;
  beginResize: (pane: "tree" | "inspector") => (event: React.PointerEvent<HTMLDivElement>) => void;
  infoPanelOpen: boolean;
  toolbarRef: React.RefObject<HTMLElement | null>;
  treePaneProps: TreePaneProps;
  searchWorkspaceProps: SearchWorkspaceProps;
  infoPanelProps: InfoPanelProps;
  currentPath: string;
  explorerToolbarLayout: string;
  canGoBack: boolean;
  canGoForward: boolean;
  focusedPane: "tree" | "content" | null;
  selectedEntryExists: boolean;
  goBack: () => void;
  goForward: () => void;
  navigateToParentFolder: () => void;
  navigateDownAction: () => void;
  refreshDirectory: () => Promise<void>;
  viewMode: ExplorerViewMode;
  onViewModeChange: (value: ExplorerViewMode) => void;
  sortBy: SortBy;
  sortDirection: "asc" | "desc";
  onSortChange: (value: SortBy) => void;
  searchShellRef: React.RefObject<HTMLDivElement | null>;
  searchPopoverOpen: boolean;
  onSearchShellBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  searchPointerIntentRef: MutableRefObject<boolean>;
  onSearchShellPointerIntent: () => void;
  onSearchSubmit: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchDraftQuery: string;
  onSearchInputFocus: () => void;
  onSearchDraftQueryChange: (value: string) => void;
  onSearchInputEscape: () => void;
  onClearSearchDraft: () => void;
  searchPatternMode: SearchPatternMode;
  onSearchPatternModeChange: (value: SearchPatternMode) => void;
  searchMatchScope: SearchMatchScope;
  onSearchMatchScopeChange: (value: SearchMatchScope) => void;
  searchRecursive: boolean;
  onSearchRecursiveChange: (value: boolean) => void;
  searchIncludeHidden: boolean;
  onSearchIncludeHiddenChange: (value: boolean) => void;
  onPaneResizeKey: (pane: "tree" | "inspector", event: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <section className="workspace explorer-workspace">
      <header ref={toolbarRef} className="window-toolbar">
        <div className="window-toolbar-brand">
          <span className="window-toolbar-title">File Trail</span>
        </div>
        <div className="titlebar-actions" data-layout={explorerToolbarLayout}>
          <div className="toolbar-group toolbar-group-nav">
            <button
              type="button"
              className="tb-btn tb-btn-icon toolbar-btn-muted"
              disabled={!canGoBack}
              onClick={goBack}
              title="Back (Cmd+Left)"
              aria-label="Back"
            >
              <ToolbarIcon name="back" />
            </button>
            <button
              type="button"
              className="tb-btn tb-btn-icon toolbar-btn-muted"
              disabled={!canGoForward}
              onClick={goForward}
              title="Forward (Cmd+Right)"
              aria-label="Forward"
            >
              <ToolbarIcon name="forward" />
            </button>
            {explorerToolbarLayout !== "minimal" ? (
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={!parentDirectoryPath(currentPath)}
                onClick={navigateToParentFolder}
                title="Enclosing Folder (Cmd+Up)"
                aria-label="Enclosing Folder"
              >
                <ToolbarIcon name="up" />
              </button>
            ) : null}
            {explorerToolbarLayout !== "minimal" ? (
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={focusedPane !== "tree" && !selectedEntryExists}
                onClick={navigateDownAction}
                title="Open selected item (Cmd+Down)"
                aria-label="Open selected item"
              >
                <ToolbarIcon name="down" />
              </button>
            ) : null}
          </div>
          {explorerToolbarLayout !== "minimal" ? (
            <>
              <span className="titlebar-divider" aria-hidden />
              <div className="toolbar-group">
                <button
                  type="button"
                  className="tb-btn tb-btn-icon"
                  onClick={() => void refreshDirectory()}
                  title="Refresh current folder (Cmd+R)"
                  aria-label="Refresh current folder"
                >
                  <ToolbarIcon name="refresh" />
                </button>
              </div>
            </>
          ) : null}
          <span className="titlebar-divider" aria-hidden />
          <div className="toolbar-group toolbar-group-view">
            <fieldset className="toolbar-segmented">
              <legend className="sr-only">View mode</legend>
              <button
                type="button"
                className={viewMode === "list" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
                onClick={() => onViewModeChange("list")}
                title="List view"
                aria-label="List view"
              >
                <ToolbarIcon name="list" />
              </button>
              <button
                type="button"
                className={
                  viewMode === "details" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
                }
                onClick={() => onViewModeChange("details")}
                title="Details view"
                aria-label="Details view"
              >
                <ToolbarIcon name="details" />
              </button>
            </fieldset>
          </div>
          {explorerToolbarLayout !== "minimal" ? (
            <>
              <span className="titlebar-divider" aria-hidden />
              <div className="toolbar-group">
                <fieldset className="toolbar-select-group">
                  <legend className="sr-only">Sorting controls</legend>
                  <button
                    type="button"
                    className="tb-btn tb-btn-icon"
                    onClick={() => onSortChange(sortBy)}
                    title={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
                    aria-label={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
                  >
                    <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
                  </button>
                  <select
                    className="toolbar-select"
                    value={sortBy}
                    onChange={(event) => onSortChange(event.currentTarget.value as SortBy)}
                    title="Sort by"
                    aria-label="Sort by"
                  >
                    <option value="name">Name</option>
                    <option value="size">Size</option>
                    <option value="modified">Date Modified</option>
                    <option value="kind">Kind</option>
                  </select>
                </fieldset>
              </div>
            </>
          ) : null}
          <div className="toolbar-search-slot">
            <div
              ref={searchShellRef}
              className={`toolbar-search-shell${searchPopoverOpen ? " active" : ""}`}
              onBlurCapture={onSearchShellBlur}
            >
              <form
                className="toolbar-search"
                aria-label="Find files in current folder"
                onMouseDownCapture={(event) => {
                  const target = event.target;
                  if (!(target instanceof HTMLElement)) {
                    return;
                  }
                  if (target.closest(".toolbar-search-clear") !== null) {
                    return;
                  }
                  searchPointerIntentRef.current = true;
                  onSearchShellPointerIntent();
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  onSearchSubmit();
                }}
              >
                <div className="toolbar-search-row">
                  <span className="toolbar-search-icon">
                    <ToolbarIcon name="search" />
                  </span>
                  <input
                    ref={searchInputRef}
                    className="toolbar-search-input"
                    type="text"
                    value={searchDraftQuery}
                    onFocus={onSearchInputFocus}
                    onChange={(event) => onSearchDraftQueryChange(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      onSearchInputEscape();
                    }}
                    placeholder="Find files…"
                    spellCheck={false}
                  />
                  {searchDraftQuery.trim().length > 0 ? (
                    <button
                      type="button"
                      className="toolbar-search-clear"
                      aria-label="Clear file search"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={onClearSearchDraft}
                    >
                      <ToolbarIcon name="close" />
                    </button>
                  ) : (
                    <span className="toolbar-search-shortcut" aria-hidden="true">
                      ⌘F
                    </span>
                  )}
                </div>
              </form>
              {searchPopoverOpen ? (
                <div className="toolbar-search-popover">
                  <div className="toolbar-search-options">
                    <div className="toolbar-search-option-row toolbar-search-option-row-primary">
                      <label className="toolbar-search-listbox">
                        <span className="toolbar-search-listbox-label">Pattern</span>
                        <select
                          className="toolbar-search-select"
                          value={searchPatternMode}
                          onChange={(event) =>
                            onSearchPatternModeChange(
                              event.currentTarget.value as SearchPatternMode,
                            )
                          }
                          aria-label="Search pattern mode"
                        >
                          <option value="regex">Regex</option>
                          <option value="glob">Glob</option>
                        </select>
                      </label>
                      <label className="toolbar-search-listbox">
                        <span className="toolbar-search-listbox-label">Match</span>
                        <select
                          className="toolbar-search-select"
                          value={searchMatchScope}
                          onChange={(event) =>
                            onSearchMatchScopeChange(event.currentTarget.value as SearchMatchScope)
                          }
                          aria-label="Search match scope"
                        >
                          <option value="name">Name</option>
                          <option value="path">Path</option>
                        </select>
                      </label>
                    </div>
                    <div className="toolbar-search-option-row toolbar-search-option-row-secondary">
                      <button
                        type="button"
                        className={
                          searchRecursive ? "toolbar-search-pill active" : "toolbar-search-pill"
                        }
                        onClick={() => onSearchRecursiveChange(!searchRecursive)}
                        aria-pressed={searchRecursive}
                      >
                        Recursive
                      </button>
                      <button
                        type="button"
                        className={
                          searchIncludeHidden ? "toolbar-search-pill active" : "toolbar-search-pill"
                        }
                        onClick={() => onSearchIncludeHiddenChange(!searchIncludeHidden)}
                        aria-pressed={searchIncludeHidden}
                      >
                        Hidden
                      </button>
                    </div>
                  </div>
                  <div className="toolbar-search-meta">
                    <span className="toolbar-search-status">Press Enter to search</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>
      {!preferencesReady ||
      (restoredPaneWidths !== null &&
        (treeWidth !== restoredPaneWidths.treeWidth ||
          inspectorWidth !== restoredPaneWidths.inspectorWidth)) ? (
        <section className="workspace-body workspace-loading" />
      ) : (
        <section
          className="workspace-body tomorrow-night-layout"
          style={{
            gridTemplateColumns: `${treeWidth}px ${EXPLORER_LAYOUT.resizerWidth}px minmax(0, 1fr)${
              infoPanelOpen ? ` ${EXPLORER_LAYOUT.resizerWidth}px ${inspectorWidth}px` : ""
            }`,
          }}
        >
          <TreePane {...treePaneProps} />
          <div
            className="pane-resizer"
            onPointerDown={beginResize("tree")}
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize folders pane"
            onKeyDown={(event) => onPaneResizeKey("tree", event)}
          />
          <SearchWorkspace {...searchWorkspaceProps} />
          {infoPanelOpen ? (
            <>
              <div
                className="pane-resizer"
                onPointerDown={beginResize("inspector")}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize Info Panel pane"
                onKeyDown={(event) => onPaneResizeKey("inspector", event)}
              />
              <InfoPanel {...infoPanelProps} />
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}
