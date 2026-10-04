// The window's panes and layout hooks, replaced for the App tests: each App test file
// passes these to vi.mock (which has to be called in the test file itself).

import { fireEvent } from "@testing-library/react";
import { type RefObject, useEffect, useState } from "react";

const paneLayoutMock = {
  treeWidth: 280,
  inspectorWidth: 320,
  preferredTreeWidth: 280,
  preferredInspectorWidth: 320,
  beginResize: () => () => undefined,
  restoreWidths: () => undefined,
  nudgeWidth: () => undefined,
};

export const contentPaneMock = () => ({
  ContentPane: ({
    currentPath,
    entries,
    onFocusChange,
    onClearSelection,
    onItemContextMenu,
    onItemDragStart,
    onItemDragEnd,
    onItemDragEnter,
    onItemDragOver,
    onItemDragLeave,
    onItemDrop,
    getItemDropIndicator,
    onSelectionGesture,
    onActivateEntry,
    selectedPaths,
    inlineRename,
    onInlineRenameSubmit,
    onInlineRenameCancel,
    isFocused,
    header,
    paneRef,
    statusSummary,
  }: {
    isFocused?: boolean;
    // The path bar's right-hand summary: counts, and a size when known.
    statusSummary?: string;
    // Given while the pane shows search results (the search bar).
    header?: React.ReactNode;
    paneRef?: React.RefObject<HTMLElement | null>;
    currentPath: string;
    entries: Array<{ path: string; name: string; kind: string; isSymlink?: boolean }>;
    inlineRename?: { path: string; error: string | null; refusalCount?: number } | null;
    onInlineRenameSubmit?: (nextName: string) => void;
    onInlineRenameCancel?: () => void;
    onFocusChange: (focused: boolean) => void;
    onClearSelection?: () => void;
    onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
    onItemDragStart?: (
      entry: { path: string; name: string; kind: string; isSymlink?: boolean },
      event: React.DragEvent<HTMLElement>,
    ) => void;
    onItemDragEnd?: (event: React.DragEvent<HTMLElement>) => void;
    onItemDragEnter?: (
      entry: { path: string; name: string; kind: string; isSymlink?: boolean },
      event: React.DragEvent<HTMLElement>,
    ) => void;
    onItemDragOver?: (
      entry: { path: string; name: string; kind: string; isSymlink?: boolean },
      event: React.DragEvent<HTMLElement>,
    ) => void;
    onItemDragLeave?: (
      entry: { path: string; name: string; kind: string; isSymlink?: boolean },
      event: React.DragEvent<HTMLElement>,
    ) => void;
    onItemDrop?: (
      entry: { path: string; name: string; kind: string; isSymlink?: boolean },
      event: React.DragEvent<HTMLElement>,
    ) => void;
    getItemDropIndicator?: (path: string) => "valid" | "invalid" | null;
    selectedPaths: string[];
    onSelectionGesture: (
      path: string,
      modifiers: {
        metaKey: boolean;
        shiftKey: boolean;
      },
    ) => void;
    onActivateEntry: (
      entry: {
        path: string;
        name: string;
        kind: string;
        isSymlink?: boolean;
      },
      inNewTab?: boolean,
    ) => void;
  }) =>
    header ? (
      // Search results, which the pane shows in the folder's views under the search bar.
      <div
        ref={paneRef as React.RefObject<HTMLDivElement | null>}
        data-testid="search-results-pane"
        tabIndex={-1}
      >
        <output data-testid="content-status">{statusSummary}</output>
        {/* Stands in for the filter: a text field takes the keyboard from the pane. */}
        <input aria-label="Filter results" onFocus={() => onFocusChange(false)} />
        {/* Stands in for the name field a result row shows while its item is renamed. */}
        {inlineRename ? (
          <input
            aria-label={`Rename result ${inlineRename.path.slice(inlineRename.path.lastIndexOf("/") + 1)}`}
            defaultValue={inlineRename.path.slice(inlineRename.path.lastIndexOf("/") + 1)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onInlineRenameSubmit?.(event.currentTarget.value);
              }
              if (event.key === "Escape") {
                onInlineRenameCancel?.();
              }
            }}
          />
        ) : null}
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            title={`search:${entry.path}`}
            data-selected={selectedPaths.includes(entry.path) ? "true" : "false"}
            draggable={Boolean(onItemDragStart)}
            onClick={(event) => {
              onFocusChange(true);
              onSelectionGesture(entry.path, {
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
              });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onItemContextMenu?.(entry.path, { x: 120, y: 140 });
            }}
            onDragStart={(event) => onItemDragStart?.(entry, event)}
            onDragEnd={(event) => onItemDragEnd?.(event)}
            onDoubleClick={(event) => onActivateEntry(entry, event.metaKey)}
          >
            Search {entry.name}
          </button>
        ))}
      </div>
    ) : (
      <div data-testid="content-pane" onPointerDown={() => onFocusChange(true)}>
        <output data-testid="content-current-path">{currentPath}</output>
        <output data-testid="content-entry-count">{entries.length}</output>
        <output data-testid="content-focused">{String(isFocused ?? false)}</output>
        <output data-testid="content-status">{statusSummary}</output>
        <label>
          Current folder path
          <input
            aria-label="Current folder path"
            defaultValue={currentPath}
            onFocus={() => onFocusChange(true)}
          />
        </label>
        {/* Controls of each kind, for how the Edit menu treats the focused one. */}
        <label>
          Help notes
          <input aria-label="Help notes" defaultValue="docs" />
        </label>
        <label>
          Readonly value
          <input aria-label="Readonly value" defaultValue="5" readOnly />
        </label>
        <label>
          Help scope
          <select aria-label="Help scope" defaultValue="name">
            <option value="name">Name</option>
            <option value="path">Path</option>
          </select>
        </label>
        <label>
          Help color
          <input aria-label="Help color" type="color" defaultValue="#336699" />
        </label>
        <button
          type="button"
          data-testid="content-pane-background"
          onClick={() => {
            onFocusChange(true);
            onClearSelection?.();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onFocusChange(true);
            onClearSelection?.();
            onItemContextMenu?.(null, { x: 80, y: 100 });
          }}
        >
          Background
        </button>
        {/* Stands in for the name field a list row shows while its item is renamed. */}
        {inlineRename ? (
          <output
            data-testid="inline-rename-refusal"
            data-refusal-count={inlineRename.refusalCount}
          >
            {inlineRename.error}
          </output>
        ) : null}
        {inlineRename ? (
          <input
            aria-label={`Rename ${inlineRename.path.slice(inlineRename.path.lastIndexOf("/") + 1)}`}
            defaultValue={inlineRename.path.slice(inlineRename.path.lastIndexOf("/") + 1)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onInlineRenameSubmit?.(event.currentTarget.value);
              }
              if (event.key === "Escape") {
                onInlineRenameCancel?.();
              }
            }}
          />
        ) : null}
        {entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            title={entry.path}
            data-drop-target-state={getItemDropIndicator?.(entry.path) ?? "none"}
            data-selected={selectedPaths.includes(entry.path) ? "true" : "false"}
            draggable={Boolean(onItemDragStart)}
            onClick={(event) => {
              onFocusChange(true);
              onSelectionGesture(entry.path, {
                metaKey: event.metaKey,
                shiftKey: event.shiftKey,
              });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onItemContextMenu?.(entry.path, { x: 120, y: 140 });
            }}
            onDragStart={(event) => onItemDragStart?.(entry, event)}
            onDragEnd={(event) => onItemDragEnd?.(event)}
            onDragEnter={(event) => onItemDragEnter?.(entry, event)}
            onDragOver={(event) => onItemDragOver?.(entry, event)}
            onDragLeave={(event) => onItemDragLeave?.(entry, event)}
            onDrop={(event) => onItemDrop?.(entry, event)}
            onDoubleClick={(event) => onActivateEntry(entry, event.metaKey)}
          >
            {entry.name}
          </button>
        ))}
      </div>
    ),
});

export const treePaneMock = () => ({
  TreePane: ({
    paneRef,
    isFocused,
    onFocusChange,
    onLeftPaneSubviewChange,
    onNavigate,
    onNavigateFavorite,
    onSelectFavoritesRoot,
    onClearSelection,
    onItemContextMenu,
    onItemDragEnter,
    onItemDragOver,
    onItemDrop,
    getItemDropIndicator,
    nodes,
    favorites,
    favoritesPlacement,
    activeLeftPaneSubview,
    selectedTreeItemId,
    rootPath,
  }: {
    paneRef?: RefObject<HTMLDivElement | null>;
    isFocused?: boolean;
    onFocusChange: (focused: boolean) => void;
    onLeftPaneSubviewChange: (value: "favorites" | "tree") => void;
    onNavigate: (path: string) => Promise<boolean> | undefined;
    onNavigateFavorite: (path: string) => Promise<boolean> | undefined;
    onSelectFavoritesRoot?: () => Promise<boolean> | undefined;
    onClearSelection?: () => void;
    onItemContextMenu?: (
      item: {
        id: string;
        kind: "favorite" | "filesystem";
        label: string;
        depth: number;
        path: string | null;
        parentId: string | null;
        expanded: boolean;
        canExpand: boolean;
        loading: boolean;
        error: string | null;
        isSymlink: boolean;
        childIds: string[];
        icon?: string;
      },
      subview: "favorites" | "tree",
      position: { x: number; y: number },
    ) => void;
    onItemDragEnter?: (
      item: {
        id: string;
        kind: "favorite" | "filesystem";
        label: string;
        depth: number;
        path: string | null;
        parentId: string | null;
        expanded: boolean;
        canExpand: boolean;
        loading: boolean;
        error: string | null;
        isSymlink: boolean;
        childIds: string[];
        icon?: string;
      },
      event: React.DragEvent<HTMLElement>,
      subview: "favorites" | "tree",
    ) => void;
    onItemDragOver?: (
      item: {
        id: string;
        kind: "favorite" | "filesystem";
        label: string;
        depth: number;
        path: string | null;
        parentId: string | null;
        expanded: boolean;
        canExpand: boolean;
        loading: boolean;
        error: string | null;
        isSymlink: boolean;
        childIds: string[];
        icon?: string;
      },
      event: React.DragEvent<HTMLElement>,
      subview: "favorites" | "tree",
    ) => void;
    onItemDrop?: (
      item: {
        id: string;
        kind: "favorite" | "filesystem";
        label: string;
        depth: number;
        path: string | null;
        parentId: string | null;
        expanded: boolean;
        canExpand: boolean;
        loading: boolean;
        error: string | null;
        isSymlink: boolean;
        childIds: string[];
        icon?: string;
      },
      event: React.DragEvent<HTMLElement>,
      subview: "favorites" | "tree",
    ) => void;
    getItemDropIndicator?: (
      item: {
        id: string;
        kind: "favorite" | "filesystem";
        label: string;
        depth: number;
        path: string | null;
        parentId: string | null;
        expanded: boolean;
        canExpand: boolean;
        loading: boolean;
        error: string | null;
        isSymlink: boolean;
        childIds: string[];
        icon?: string;
      },
      subview: "favorites" | "tree",
    ) => "valid" | "invalid" | null;
    nodes: Record<
      string,
      { path: string; name: string; isSymlink?: boolean; expanded?: boolean; childPaths?: string[] }
    >;
    favorites: Array<{ path: string }>;
    favoritesPlacement: "integrated" | "separate";
    activeLeftPaneSubview: "favorites" | "tree";
    selectedTreeItemId: string | null;
    rootPath: string;
  }) => (
    <div ref={paneRef} data-testid="tree-pane-shell">
      <output data-testid="tree-focused">{String(isFocused ?? false)}</output>
      <button
        type="button"
        data-testid="tree-pane"
        onClick={() => {
          onLeftPaneSubviewChange("tree");
          onFocusChange(true);
        }}
      >
        Tree
      </button>
      <button
        type="button"
        data-testid="favorites-root"
        onClick={() => {
          onLeftPaneSubviewChange(favoritesPlacement === "separate" ? "favorites" : "tree");
          onFocusChange(true);
          void onSelectFavoritesRoot?.();
        }}
      >
        Favorites
      </button>
      <output data-testid="left-pane-subview">{activeLeftPaneSubview}</output>
      <output data-testid="favorites-placement">{favoritesPlacement}</output>
      <output data-testid="tree-selection">{selectedTreeItemId ?? "none"}</output>
      <output data-testid="tree-root">{rootPath}</output>
      <button
        type="button"
        data-testid="tree-clear-selection"
        onClick={() => {
          onLeftPaneSubviewChange("tree");
          onFocusChange(true);
          onClearSelection?.();
        }}
      >
        Clear Tree Selection
      </button>
      {favorites.map((favorite) => {
        const item = {
          id: `favorite:${favorite.path}`,
          kind: "favorite" as const,
          label: favorite.path.split("/").at(-1) ?? favorite.path,
          depth: 0,
          path: favorite.path,
          parentId: null,
          expanded: false,
          canExpand: false,
          loading: false,
          error: null,
          isSymlink: false,
          childIds: [],
          icon: "folder",
        };
        return (
          <button
            key={`favorite:${favorite.path}`}
            type="button"
            title={`favorite:${favorite.path}`}
            data-drop-target-state={
              getItemDropIndicator?.(
                item,
                favoritesPlacement === "separate" ? "favorites" : "tree",
              ) ?? "none"
            }
            onClick={() => {
              onLeftPaneSubviewChange(favoritesPlacement === "separate" ? "favorites" : "tree");
              onFocusChange(true);
              void onNavigateFavorite(favorite.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onLeftPaneSubviewChange(favoritesPlacement === "separate" ? "favorites" : "tree");
              onFocusChange(true);
              onItemContextMenu?.(item, favoritesPlacement === "separate" ? "favorites" : "tree", {
                x: 120,
                y: 140,
              });
            }}
            onDragEnter={(event) =>
              onItemDragEnter?.(
                item,
                event,
                favoritesPlacement === "separate" ? "favorites" : "tree",
              )
            }
            onDragOver={(event) =>
              onItemDragOver?.(
                item,
                event,
                favoritesPlacement === "separate" ? "favorites" : "tree",
              )
            }
            onDrop={(event) =>
              onItemDrop?.(item, event, favoritesPlacement === "separate" ? "favorites" : "tree")
            }
          >
            Favorite {favorite.path}
          </button>
        );
      })}
      {Object.values(nodes).map((node) => {
        const item = {
          id: `fs:${node.path}`,
          kind: "filesystem" as const,
          label: node.name,
          depth: 0,
          path: node.path,
          parentId: null,
          expanded: Boolean(node.expanded),
          canExpand: !node.isSymlink && (node.childPaths?.length ?? 0) > 0,
          loading: false,
          error: null,
          isSymlink: Boolean(node.isSymlink),
          childIds: node.childPaths ?? [],
        };
        return (
          <button
            key={`tree:${node.path}`}
            type="button"
            title={`tree:${node.path}`}
            data-expanded={node.expanded ? "true" : "false"}
            data-children={(node.childPaths ?? []).join("\n")}
            data-drop-target-state={getItemDropIndicator?.(item, "tree") ?? "none"}
            onClick={() => {
              onLeftPaneSubviewChange("tree");
              onFocusChange(true);
              void onNavigate(node.path);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onLeftPaneSubviewChange("tree");
              onFocusChange(true);
              onItemContextMenu?.(item, "tree", { x: 120, y: 140 });
            }}
            onDragEnter={(event) => onItemDragEnter?.(item, event, "tree")}
            onDragOver={(event) => onItemDragOver?.(item, event, "tree")}
            onDrop={(event) => onItemDrop?.(item, event, "tree")}
          >
            Tree {node.name}
          </button>
        );
      })}
    </div>
  ),
});

export const getInfoPanelMock = () => ({
  // Just what the panel is showing, for tests that check it.
  InfoPanel: ({ item }: { item: { name: string } | null }) => (
    <div data-testid="info-panel">{item ? item.name : "Select a file or folder"}</div>
  ),
});

export const locationSheetMock = () => ({
  LocationSheet: ({
    open,
    title,
    label,
    currentPath,
    submitLabel,
    browseLabel,
    error,
    onBrowse,
    onClose,
    onSubmit,
  }: {
    open: boolean;
    title?: string;
    label?: string;
    currentPath: string;
    submitLabel?: string;
    browseLabel?: string;
    error: string | null;
    onBrowse?: ((path: string) => Promise<string | null>) | null;
    onClose: () => void;
    onSubmit: (path: string) => void;
  }) =>
    open ? (
      <dialog aria-label={title ?? "Location"}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            onSubmit(String(formData.get("path") ?? ""));
          }}
        >
          <label>
            {label ?? "Path"}
            <input name="path" aria-label={label ?? "Path"} defaultValue={currentPath} />
          </label>
          {error ? <div>{error}</div> : null}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {onBrowse ? (
            <button
              type="button"
              onClick={async (event) => {
                const form = event.currentTarget.closest("form");
                const input = form?.querySelector<HTMLInputElement>('input[name="path"]');
                const nextPath = await onBrowse(input?.value ?? currentPath);
                if (nextPath && input) {
                  fireEvent.change(input, {
                    target: { value: nextPath },
                  });
                }
              }}
            >
              {browseLabel ?? "Browse"}
            </button>
          ) : null}
          <button type="submit">{submitLabel ?? "Submit"}</button>
        </form>
      </dialog>
    ) : null,
});

export const goToFolderDialogMock = () => ({
  GoToFolderDialog: ({
    open,
    title,
    inputAriaLabel,
    currentPath,
    submitLabel,
    browseLabel,
    error,
    onBrowse,
    onClose,
    onSubmit,
    places,
    onForgetPlace,
  }: {
    open: boolean;
    title?: string;
    inputAriaLabel?: string;
    currentPath: string;
    places?: ReadonlyArray<{ path: string; name: string; isVisited: boolean }>;
    onForgetPlace?: (path: string) => void;
    submitLabel?: string;
    browseLabel?: string;
    error: string | null;
    onBrowse?: ((path: string) => Promise<string | null>) | null;
    onClose: () => void;
    onSubmit: (path: string) => void;
  }) => {
    const [value, setValue] = useState(currentPath);

    useEffect(() => {
      setValue(currentPath);
    }, [currentPath]);

    return open ? (
      <dialog aria-label={title ?? "Location"}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(value);
          }}
        >
          <label>
            {inputAriaLabel ?? "Path"}
            <input
              name="path"
              aria-label={inputAriaLabel ?? "Path"}
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          </label>
          {error ? <div>{error}</div> : null}
          {(places ?? []).map((place) => (
            <span key={place.path}>
              <button
                type="button"
                title={`place:${place.path}`}
                onClick={() => onSubmit(place.path)}
              >
                Go to {place.name}
              </button>
              <button
                type="button"
                title={`forget:${place.path}`}
                onClick={() => onForgetPlace?.(place.path)}
              >
                Forget {place.name}
              </button>
            </span>
          ))}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {onBrowse ? (
            <button
              type="button"
              onClick={async () => {
                const nextPath = await onBrowse(value);
                if (nextPath) {
                  setValue(nextPath);
                }
              }}
            >
              {browseLabel ?? "Browse"}
            </button>
          ) : null}
          <button type="submit">{submitLabel ?? "Open Folder"}</button>
        </form>
      </dialog>
    ) : null;
  },
});

export const toolbarIconMock = () => ({
  ToolbarIcon: () => null,
});

export const useElementSizeMock = () => ({
  useElementSize: () => ({ width: 1200, height: 800 }),
});

export const useExplorerPaneLayoutMock = () => ({
  useExplorerPaneLayout: () => paneLayoutMock,
});

// The progress card's delay, short: the App tests wait for the card, not for half a second.
export const progressCardDelayMock = () => ({
  PROGRESS_CARD_DELAY_MS: 20,
});
