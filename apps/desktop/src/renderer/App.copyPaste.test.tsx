// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type RefObject, useEffect, useState } from "react";

import {
  type CopyPasteProgressEvent,
  type IpcChannel,
  type IpcRequestInput,
  type IpcResponse,
  type WriteOperationProgressEvent,
  ipcContractSchemas,
} from "@filetrail/contracts";

import { DEFAULT_APP_PREFERENCES } from "../shared/appPreferences";
vi.mock("./components/ContentPane", () => ({
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
  }: {
    isFocused?: boolean;
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
  }) => (
    <div data-testid="content-pane" onPointerDown={() => onFocusChange(true)}>
      <output data-testid="content-current-path">{currentPath}</output>
      <output data-testid="content-entry-count">{entries.length}</output>
      <output data-testid="content-focused">{String(isFocused ?? false)}</output>
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
        <output data-testid="inline-rename-refusal" data-refusal-count={inlineRename.refusalCount}>
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
}));
vi.mock("./components/TreePane", () => ({
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
}));
vi.mock("./components/SearchResultsPane", () => ({
  SEARCH_RESULT_ROW_HEIGHT: 32,
  SearchResultsPane: ({
    results,
    selectedPaths,
    onFocusChange,
    onSelectionGesture,
    onActivateResult,
    onItemContextMenu,
    onItemDragStart,
    onItemDragEnd,
    inlineRename,
    onInlineRenameSubmit,
    onInlineRenameCancel,
  }: {
    inlineRename?: { path: string; error: string | null; refusalCount?: number } | null;
    onInlineRenameSubmit?: (nextName: string) => void;
    onInlineRenameCancel?: () => void;
    results: Array<{
      path: string;
      name: string;
      kind: string;
      extension: string;
      isHidden: boolean;
      isSymlink: boolean;
      relativeParentPath: string;
    }>;
    selectedPaths: string[];
    onFocusChange: (focused: boolean) => void;
    onSelectionGesture: (
      path: string,
      modifiers: {
        metaKey: boolean;
        shiftKey: boolean;
      },
    ) => void;
    onActivateResult: (item: { path: string; name: string }) => void;
    onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
    onItemDragStart?: (
      item: {
        path: string;
        name: string;
        kind: string;
        extension: string;
        isHidden: boolean;
        isSymlink: boolean;
        relativeParentPath: string;
      },
      event: React.DragEvent<HTMLElement>,
    ) => void;
    onItemDragEnd?: (event: React.DragEvent<HTMLElement>) => void;
  }) => (
    <div data-testid="search-results-pane">
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
      {results.map((result) => (
        <button
          key={result.path}
          type="button"
          title={`search:${result.path}`}
          data-selected={selectedPaths.includes(result.path) ? "true" : "false"}
          draggable={Boolean(onItemDragStart)}
          onClick={(event) => {
            onFocusChange(true);
            onSelectionGesture(result.path, {
              metaKey: event.metaKey,
              shiftKey: event.shiftKey,
            });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onItemContextMenu?.(result.path, { x: 120, y: 140 });
          }}
          onDragStart={(event) => onItemDragStart?.(result, event)}
          onDragEnd={(event) => onItemDragEnd?.(event)}
          onDoubleClick={() => onActivateResult(result)}
        >
          Search {result.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./components/GetInfoPanel", () => ({
  // Just what the panel is showing, for tests that check it.
  InfoPanel: ({ item }: { item: { name: string } | null }) => (
    <div data-testid="info-panel">{item ? item.name : "Select a file or folder"}</div>
  ),
}));
vi.mock("./components/LocationSheet", () => ({
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
}));
vi.mock("./components/GoToFolderDialog", () => ({
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
}));

vi.mock("./components/ToolbarIcon", () => ({
  ToolbarIcon: () => null,
}));
vi.mock("./hooks/useElementSize", () => ({
  useElementSize: () => ({ width: 1200, height: 800 }),
}));
const paneLayoutMock = {
  treeWidth: 280,
  inspectorWidth: 320,
  preferredTreeWidth: 280,
  preferredInspectorWidth: 320,
  beginResize: () => () => undefined,
  restoreWidths: () => undefined,
  nudgeWidth: () => undefined,
};
vi.mock("./hooks/useExplorerPaneLayout", () => ({
  useExplorerPaneLayout: () => paneLayoutMock,
}));

import { App } from "./App";
import { type FiletrailClient, FiletrailClientProvider } from "./lib/filetrailClient";

type RendererCommand = Parameters<Parameters<FiletrailClient["onCommand"]>[0]>[0];
type TestProgressEvent =
  | (Omit<CopyPasteProgressEvent, "action"> & {
      action?: CopyPasteProgressEvent["action"];
    })
  | WriteOperationProgressEvent;

// Requests the window sent that the main process's checks would refuse (see the harness).
const refusedRequests: string[] = [];

afterEach(() => {
  const refused = refusedRequests.splice(0);
  expect(refused, "requests the main process would refuse").toEqual([]);
});

describe("App copy/paste integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies on the first command press without a notification or a change of focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCopy = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCopy);
  });

  it("keeps showing the folder's info in the Info panel after the folder reloads", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info Panel" }));
    });
    await waitFor(() => expect(screen.getByTestId("info-panel")).toHaveTextContent("demo"));
    const propertyRequests = () =>
      harness.invocations.filter((call) => call.channel === "item:getProperties").length;
    await waitFor(() => expect(propertyRequests()).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const requestsBefore = propertyRequests();

    await act(async () => {
      harness.emitCommand({ type: "refreshOrApplySearchSort" });
    });

    // Asked again after the reload, rather than left blank until the selection changes.
    await waitFor(() => expect(propertyRequests()).toBeGreaterThan(requestsBefore));
    expect(screen.getByTestId("info-panel")).toHaveTextContent("demo");
  });

  it("clears the active content location when the tree selection is cleared", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    expect(screen.getByTestId("tree-selection")).not.toHaveTextContent("none");

    await act(async () => {
      fireEvent.click(screen.getByTestId("tree-clear-selection"));
    });

    expect(screen.getByTestId("tree-selection")).toHaveTextContent("none");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
    expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
  });

  it("does not auto-select the first item after content navigation opens a folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [
            createDirectoryEntry("/Users/demo/Folder/inside-a.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder/inside-b.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.doubleClick(await screen.findByRole("button", { name: "Folder" }));
    });

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/Folder",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-a.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-b.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("does not auto-select the first item after tree navigation opens a folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [
            createDirectoryEntry("/Users/demo/Folder/inside-a.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder/inside-b.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("tree:/Users/demo/Folder"));
    });

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/Folder",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-a.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-b.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("does not auto-select the first item after favorite navigation opens a folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [
            createDirectoryEntry("/Users/demo/Documents/inside-a.txt", "file"),
            createDirectoryEntry("/Users/demo/Documents/inside-b.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("favorite:/Users/demo/Documents"));
    });

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/Documents",
    );
    expect(screen.getByTitle("/Users/demo/Documents/inside-a.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.getByTitle("/Users/demo/Documents/inside-b.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("cuts without a notification or a change of focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCut = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCut);
  });

  it("counts the items on the clipboard button when several are copied", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source-a.txt", "file"),
            createDirectoryEntry("/Users/demo/source-b.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByRole("button", { name: "source-a.txt" });
    const sourceBButton = await screen.findByRole("button", { name: "source-b.txt" });
    await act(async () => {
      fireEvent.click(sourceAButton);
      fireEvent.click(sourceBButton, { metaKey: true });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 2 items copied");
  });

  it("switches to icon view from the View menu and back to the list from the toolbar", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByRole("button", { name: "source.txt" });
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");

    await act(async () => {
      harness.emitCommand({ type: "viewAsIcons" });
    });
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "View as List" })).not.toHaveClass("active");
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)).toMatchObject({ viewMode: "icons" });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "View as Compact List" }));
    });
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)).toMatchObject({ viewMode: "list" });
    });
  });

  it("tells the application menu which commands can run and what is shown", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "source.txt" });
    const menuState = () => {
      const state = harness.menuStates.at(-1);
      if (!state) {
        throw new Error("No menu state reported.");
      }
      return state;
    };
    // Nothing selected, nowhere to go back to.
    await vi.waitFor(() => {
      expect(menuState().disabledCommands).toEqual(
        expect.arrayContaining(["renameSelection", "trashSelection", "goBack", "goForward"]),
      );
    });
    expect(menuState().disabledCommands).not.toContain("newTab");
    expect(menuState()).toMatchObject({ viewMode: "details", hiddenFilesShown: false });

    await selectItem("/Users/demo/source.txt");
    await vi.waitFor(() => {
      expect(menuState().disabledCommands).not.toContain("renameSelection");
    });
    // A file is not a folder to open in a tab or keep as a favorite.
    expect(menuState().disabledCommands).toEqual(
      expect.arrayContaining(["openSelectionInNewTab", "toggleFavorite"]),
    );

    await act(async () => {
      harness.emitCommand({ type: "viewAsList" });
      harness.emitCommand({ type: "toggleHiddenFiles" });
      harness.emitCommand({ type: "toggleInfoRow" });
    });
    await vi.waitFor(() => {
      expect(menuState()).toMatchObject({
        viewMode: "list",
        hiddenFilesShown: true,
        infoRowOpen: true,
      });
    });

    // Keyboard Shortcuts opens Help in its own window, on that page; the files stay usable.
    await act(async () => {
      harness.emitCommand({ type: "openKeyboardShortcuts" });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "app:openHelpWindow")?.payload,
      ).toEqual({ topic: "shortcuts" });
    });
    expect(menuState().disabledCommands).not.toContain("openHelp");
    expect(menuState().disabledCommands).not.toContain("newTab");
  });

  it("asks the main process to open the Settings window on Command-comma", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:openSettingsWindow")).toBe(
        true,
      );
    });
    expect(screen.getByTestId("content-pane")).toBeInTheDocument();
  });

  it("routes generic edit menu commands to native text editing for the toolbar search input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText("Search");
    await act(async () => {
      searchInput.focus();
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editCut" });
      harness.emitCommand({ type: "editPaste" });
      harness.emitCommand({ type: "editSelectAll" });
    });

    expectNativeEditActions(harness, ["copy", "cut", "paste", "selectAll"]);
    expectNoFileClipboardActions(harness);
    expect(clipboardButton()).toBeNull();
    expect(clipboardButton()).toBeNull();
  });

  it("does not trigger explorer file actions when keyboard copy, cut, or paste are pressed in a text input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText("Search");
    await act(async () => {
      searchInput.focus();
      fireEvent.keyDown(searchInput, { key: "c", metaKey: true });
      fireEvent.keyDown(searchInput, { key: "x", metaKey: true });
      fireEvent.keyDown(searchInput, { key: "v", metaKey: true });
    });

    expectNoFileClipboardActions(harness);
    expect(clipboardButton()).toBeNull();
    expect(clipboardButton()).toBeNull();
  });

  it("does not treat the current folder as an implicit selection for copy or cut", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await clearContentSelection();

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    const copyToastViewport = await screen.findByTestId("toast-viewport");
    expect(
      within(copyToastViewport).getByText("Select at least one item to copy."),
    ).toBeInTheDocument();
    expect(clipboardButton()).toBeNull();
    expectNoFileClipboardActions(harness);

    await act(async () => {
      harness.emitCommand({ type: "editCut" });
    });

    const cutToastViewport = await screen.findByTestId("toast-viewport");
    expect(
      within(cutToastViewport).getByText("Select at least one item to cut."),
    ).toBeInTheDocument();
    expect(clipboardButton()).toBeNull();
    expectNoFileClipboardActions(harness);
  });

  it("does nothing for selection commands when content has no selection", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await clearContentSelection();

    await act(async () => {
      harness.emitCommand({ type: "copyPath" });
      harness.emitCommand({ type: "openSelection" });
      harness.emitCommand({ type: "editSelection" });
      harness.emitCommand({ type: "moveSelection" });
      harness.emitCommand({ type: "renameSelection" });
      harness.emitCommand({ type: "duplicateSelection" });
      harness.emitCommand({ type: "trashSelection" });
    });

    expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
    expect(harness.invocations.some((call) => call.channel === "system:openPath")).toBe(false);
    expect(
      harness.invocations.some((call) => call.channel === "system:openPathsWithApplication"),
    ).toBe(false);
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
    expect(screen.queryByText("Move To")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Move")).not.toBeInTheDocument();
  });

  it("selects the first content item when arrow navigation starts with no selection", async () => {
    const harness = createAppHarness({
      preferences: {
        foldersFirst: false,
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/alpha.txt", "file"),
            createDirectoryEntry("/Users/demo/beta.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await clearContentSelection();

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });

    expect(screen.getByTitle("/Users/demo/alpha.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/beta.txt")).toHaveAttribute("data-selected", "false");
  });

  it("routes generic edit commands to native editing for path, location, and rename inputs", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const pathInput = await screen.findByLabelText("Current folder path");
    await act(async () => {
      pathInput.focus();
      harness.emitCommand({ type: "editCopy" });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    const locationInput = await screen.findByLabelText("Path");
    await act(async () => {
      locationInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });
    const locationDialog = document.querySelector('dialog[aria-label="Location"]');
    if (!(locationDialog instanceof HTMLDialogElement)) {
      throw new Error("Missing location dialog.");
    }
    await act(async () => {
      fireEvent.click(within(locationDialog).getByText("Cancel"));
    });

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      harness.emitCommand({ type: "renameSelection" });
    });
    // A list item is renamed in its row, not in a dialog.
    const renameInput = await screen.findByLabelText("Rename source.txt");
    expect(screen.queryByRole("dialog", { name: /^Rename “/u })).not.toBeInTheDocument();
    await act(async () => {
      renameInput.focus();
      harness.emitCommand({ type: "editSelectAll" });
    });
    await act(async () => {
      fireEvent.keyDown(renameInput, { key: "Escape" });
    });
    expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();

    expectNativeEditActions(harness, ["copy", "paste", "selectAll"]);
    expectNoFileClipboardActions(harness);
  });

  it("uses copy and select all for readonly text inputs but ignores cut and paste", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const readonlyInput = await screen.findByLabelText("Readonly value");
    await act(async () => {
      readonlyInput.focus();
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editSelectAll" });
      harness.emitCommand({ type: "editCut" });
      harness.emitCommand({ type: "editPaste" });
    });

    expectNativeEditActions(harness, ["copy", "selectAll"]);
    expectNoFileClipboardActions(harness);
  });

  it("does not treat non-text controls as native text editors", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchScopeSelect = await screen.findByLabelText("Help scope");
    const accentColorInput = await screen.findByLabelText("Help color");

    await act(async () => {
      searchScopeSelect.focus();
      harness.emitCommand({ type: "editCopy" });
      accentColorInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });

    // A menu or a color well has no text to copy or paste into; in the file browser the
    // commands are the files' own, so nothing is done natively.
    expectNativeEditActions(harness, []);
  });

  it("keeps generic edit commands working for text inputs beside the file list", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const helpInput = await screen.findByLabelText("Help notes");
    await act(async () => {
      helpInput.focus();
      harness.emitCommand({ type: "editCopy" });
    });

    await act(async () => {
      helpInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });

    expectNativeEditActions(harness, ["copy", "paste"]);
    expectNoFileClipboardActions(harness);
  });

  it("falls back to explorer copy and select all when the content pane is focused", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editSelectAll" });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
    expectNativeEditActions(harness, []);
  });

  it("falls back to explorer paste when the content pane is focused", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");

    const invocationCountBeforePaste = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    ).length;

    await act(async () => {
      harness.emitCommand({ type: "editPaste" });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        invocationCountBeforePaste + 1,
      );
    });
    expectNativeEditActions(harness, []);
  });

  it("starts at home when the last session is not reopened", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: false,
        treeRootPath: "/Users/demo/projects",
        lastVisitedPath: "/Users/demo/projects/filetrail",
        lastVisitedFavoritePath: "/Users/demo/projects/filetrail",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    const startupSnapshotCall = harness.invocations.find(
      (call) => call.channel === "directory:getSnapshot",
    );
    expect(startupSnapshotCall?.payload).toMatchObject({
      path: "/Users/demo",
    });
  });

  it("restores the saved explorer sort on startup", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        lastVisitedPath: "/Users/demo",
        sortBy: "modified",
        sortDirection: "desc",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    const startupSnapshotCall = harness.invocations.find(
      (call) => call.channel === "directory:getSnapshot",
    );
    expect(startupSnapshotCall?.payload).toMatchObject({
      path: "/Users/demo",
      sortBy: "modified",
      sortDirection: "desc",
    });
  });

  it("restores favorite tree selection when the remembered location is a favorite root", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        treeRootPath: "/Users/demo",
        lastVisitedPath: "/Users/demo/Documents",
        lastVisitedFavoritePath: "/Users/demo/Documents",
        favorites: [
          { path: "/Users/demo", icon: "home" },
          { path: "/Users/demo/Documents", icon: "documents" },
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [createTreeChild("/Users/demo/Documents", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    expect(screen.getByTestId("tree-selection")).toHaveTextContent(
      "favorite:/Users/demo/Documents",
    );
    expect(screen.getByTitle("tree:/Users/demo/Documents")).toBeInTheDocument();
  });

  it("restores the favorites subview in separate placement when the remembered location is a favorite root", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        treeRootPath: "/",
        lastVisitedPath: "/Users/demo/Documents",
        lastVisitedFavoritePath: "/Users/demo/Documents",
        favoritesPlacement: "separate",
        favorites: [
          { path: "/Users/demo", icon: "home" },
          { path: "/Users/demo/Documents", icon: "documents" },
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/": [createTreeChild("/Users", "directory")],
        "/Users": [createTreeChild("/Users/demo", "directory")],
        "/Users/demo": [createTreeChild("/Users/demo/Documents", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    expect(screen.getByTestId("favorites-placement")).toHaveTextContent("separate");
    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
    expect(screen.getByTestId("tree-selection")).toHaveTextContent(
      "favorite:/Users/demo/Documents",
    );
    expect(screen.getByTitle("favorite:/Users/demo/Documents")).toBeInTheDocument();
    expect(screen.getByTitle("tree:/")).toBeInTheDocument();
  });

  it("reroots the tree at slash when tree navigation moves above home", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users": {
          path: "/Users",
          parentPath: "/",
          entries: [createDirectoryEntry("/Users/demo", "directory")],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [createTreeChild("/Users/demo/Folder", "directory")],
        "/": [createTreeChild("/Users", "directory")],
        "/Users": [createTreeChild("/Users/demo", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await focusTreePane();

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    });

    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: {
          treeRootPath: "/",
          lastVisitedPath: "/Users",
        },
      });
    });
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users");
  });

  it("opens the selected item with a configured application from the context menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Visual Studio Code" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/Applications/Visual Studio Code.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("shows the selected item in Finder from the context menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Library/CoreServices/Finder.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("uses the Other menu item as a one-off picker without updating preferences", async () => {
    const harness = createAppHarness({
      pickApplicationResponse: {
        canceled: false,
        appPath: "/Applications/Ghostty.app",
        appName: "Ghostty",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    // Wait for the initial debounced preferences write so it cannot land
    // between the before/after counts below.
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:updatePreferences")).toBe(
        true,
      );
    });
    const preferenceUpdateCountBeforeAction = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    ).length;
    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Other…" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:pickApplication"),
      ).toBeTruthy();
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/Applications/Ghostty.app",
        paths: ["/Users/demo/source.txt"],
      });
    });

    const preferenceUpdateCountAfterAction = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    ).length;
    expect(preferenceUpdateCountAfterAction).toBe(preferenceUpdateCountBeforeAction);
  });

  it("edits files on double click when file activation is set to edit", async () => {
    const harness = createAppHarness({
      preferences: {
        fileActivationAction: "edit",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.doubleClick(sourceButton);
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Applications/TextEdit.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("runs the Edit command against the selected files only", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      harness.emitCommand({ type: "editSelection" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Applications/TextEdit.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("duplicates the selected files with Cmd+D", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo",
        conflictResolution: "error",
        action: "duplicate",
      });
    });
    expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
  });

  it("opens Move To and plans a move with Cmd+Shift+M", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    expect(await screen.findByText("Move")).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        action: "move_to",
      });
    });
  });

  it("fills the Move To path from Browse", async () => {
    const harness = createAppHarness({
      pickDirectoryResponse: {
        canceled: false,
        path: "/Users/demo/Folder",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.click(screen.getByText("Choose…"));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:pickDirectory")?.payload,
      ).toEqual({
        defaultPath: "/Users/demo",
      });
    });
    expect(screen.getByLabelText("Destination folder")).toHaveValue("/Users/demo/Folder");
  });

  it("expands ~ when submitting Move To", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "~/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("keeps Move To open and shows an inline error for an invalid destination path", async () => {
    const harness = createAppHarness({
      itemPropertiesByPath: {
        "/Users/demo/DoesNotExist": "missing",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/DoesNotExist" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByText("Destination must be an existing folder.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(false);
  });

  it("keeps Move To open and shows an inline error when the destination is not a folder", async () => {
    const harness = createAppHarness({
      itemPropertiesByPath: {
        "/Users/demo/source.txt": {
          path: "/Users/demo/source.txt",
          name: "source.txt",
          extension: "txt",
          kind: "file",
          kindLabel: "File",
          isHidden: false,
          isSymlink: false,
          createdAt: null,
          modifiedAt: null,
          sizeBytes: null,
          sizeStatus: "ready",
          permissionMode: null,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/source.txt" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByText("Destination must be an existing folder.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(false);
  });

  it("keeps Move To open when analysis reports same-path issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "same_path",
            message: "Cannot paste /Users/demo/source.txt onto itself.",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/source.txt",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    // Issues name the items they are about.
    expect(await screen.findByText("“source.txt” is already in “demo”.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps Move To open when analysis reports missing sources", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "source_missing",
            message: "Source does not exist: /Users/demo/source.txt",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByText("“source.txt” no longer exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps Move To open when analysis reports parent-into-child issues", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/testParent", "directory"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/testParent"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "parent_into_child",
            message: "Cannot paste /Users/demo/testParent into its own descendant.",
            sourcePath: "/Users/demo/testParent",
            destinationPath: "/Users/demo/testParent/child",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
          skippedConflictCount: 0,
        },
        canExecute: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceFolder = await screen.findByRole("button", { name: "testParent" });
    await act(async () => {
      fireEvent.click(sourceFolder);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(
      await screen.findByText("“testParent” can't be moved into a folder inside itself."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps Move To open and shows an inline error when start is rejected as busy", async () => {
    const harness = createAppHarness({
      copyPasteStartError: new Error("Another write operation is already running."),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(
      await screen.findByText(
        "Another file operation is running. Wait for it to finish, or stop it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(screen.queryByText("Move couldn’t start")).not.toBeInTheDocument();
  });

  it("blocks content-pane shortcuts while Move To is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "copyPaste:plan" &&
          (call.payload as IpcRequestInput<"copyPaste:plan">).action === "duplicate",
      ),
    ).toBeUndefined();
  });

  it("blocks content-pane shortcuts while Rename is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F2" });
    });

    await screen.findByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "copyPaste:plan" &&
          (call.payload as IpcRequestInput<"copyPaste:plan">).action === "duplicate",
      ),
    ).toBeUndefined();
  });

  it("blocks content-pane shortcuts while New Folder is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    // A folder made inside another folder (from that folder's menu) asks for its name first.
    await openNewFolderFromFolderMenu("/Users/demo/Folder");

    await screen.findByRole("dialog", { name: "New Folder" });
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "copyPaste:plan" &&
          (call.payload as IpcRequestInput<"copyPaste:plan">).action === "duplicate",
      ),
    ).toBeUndefined();
  });

  it("renames the selected item with F2", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F2" });
    });

    const renameInput = await screen.findByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
      ).toEqual({
        sourcePath: "/Users/demo/source.txt",
        destinationName: "renamed.txt",
      });
    });
  });

  it("selects the renamed item after rename completes in the current directory", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F2" });
    });
    const renameInput = await screen.findByLabelText("Rename source.txt");

    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/renamed.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-rename",
        action: "rename",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/renamed.txt",
        result: {
          operationId: "write-op-rename",
          action: "rename",
          status: "completed",
          targetPath: "/Users/demo/renamed.txt",
          startedAt: "2026-03-09T10:00:00.000Z",
          finishedAt: "2026-03-09T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/renamed.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/renamed.txt")).toHaveAttribute("data-selected", "true");
    });
  });

  it("makes a new folder in the folder on screen at once with Cmd+Shift+N, as Finder does", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    // No name is asked for: the folder is made with a free name, then renamed in its row.
    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("selects the new folder once it is made, and edits its name in its row", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-folder",
        action: "new_folder",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: "/Users/demo/untitled folder",
        result: {
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          targetPath: "/Users/demo/untitled folder",
          startedAt: "2026-03-09T10:00:00.000Z",
          finishedAt: "2026-03-09T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: null,
              destinationPath: "/Users/demo/untitled folder",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/untitled folder")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
    // Its name is then edited in its row.
    expect(await screen.findByLabelText("Rename untitled folder")).toBeInTheDocument();
  });

  it("finishes a new folder whose completion arrives before its start request returns", async () => {
    const harness = createAppHarness();
    const invoke = harness.client.invoke.bind(harness.client);
    harness.client.invoke = (async (channel: string, payload: unknown) => {
      if (channel === "writeOperation:createFolder") {
        // The folder is made and announced before the reply to the request arrives.
        harness.setDirectoryEntries("/Users/demo", [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/Folder", "directory"),
          createDirectoryEntry("/Users/demo/untitled folder", "directory"),
        ]);
        harness.emitProgress({
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          completedItemCount: 1,
          totalItemCount: 1,
          completedByteCount: 0,
          totalBytes: null,
          currentSourcePath: null,
          currentDestinationPath: "/Users/demo/untitled folder",
          result: {
            operationId: "write-op-folder",
            action: "new_folder",
            status: "completed",
            targetPath: "/Users/demo/untitled folder",
            startedAt: "2026-03-09T10:00:00.000Z",
            finishedAt: "2026-03-09T10:00:01.000Z",
            summary: {
              topLevelItemCount: 1,
              totalItemCount: 1,
              completedItemCount: 1,
              failedItemCount: 0,
              skippedItemCount: 0,
              cancelledItemCount: 0,
              completedByteCount: 0,
              totalBytes: null,
            },
            items: [
              {
                sourcePath: null,
                destinationPath: "/Users/demo/untitled folder",
                status: "completed",
                error: null,
              },
            ],
            error: null,
          },
        });
      }
      return invoke(channel as never, payload as never);
    }) as typeof harness.client.invoke;

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/untitled folder")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
    // The operation is over, so the next one isn't refused as busy (once the new folder's
    // name, which opened for editing, is left as it is).
    const renameInput = await screen.findByLabelText("Rename untitled folder");
    await act(async () => {
      fireEvent.keyDown(renameInput, { key: "Escape" });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("content-pane-background"));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "writeOperation:createFolder"),
      ).toHaveLength(2);
    });
  });

  // Like Finder: a selected folder isn't where ⇧⌘N goes, so two New Folders in a row
  // don't nest the second inside the first (which is selected once made).
  it("makes a new folder in the folder on screen with Cmd+Shift+N, even with a folder selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("makes a new folder inside a folder from that folder's menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openNewFolderFromFolderMenu("/Users/demo/Folder");

    expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
      "In “Folder”",
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Folder name"), {
        target: { value: "Nested Folder" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo/Folder",
        folderName: "Nested Folder",
      });
    });
  });

  it("enables New Folder on background context and targets the current directory", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.contextMenu(backgroundButton);
    });

    const newFolderButton = screen.getByRole("button", { name: "New Folder⇧⌘N" });
    expect(newFolderButton).toHaveAttribute("aria-disabled", "false");
    await act(async () => {
      fireEvent.click(newFolderButton);
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("offers only current-folder actions on background context, all of them enabled", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.contextMenu(backgroundButton);
    });

    const menu = document.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    const labels = Array.from(menu?.querySelectorAll(".context-menu-item-label") ?? []).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      "New Folder",
      "Show Info",
      "Paste",
      "Copy Path",
      "Open in Terminal",
      "Show in Finder",
    ]);
    // Nothing is on the clipboard, so Paste is the one item that cannot run.
    expect(
      Array.from(menu?.querySelectorAll(".context-menu-item.disabled") ?? []).map(
        (item) => item.querySelector(".context-menu-item-label")?.textContent,
      ),
    ).toEqual(["Paste"]);
  });

  it("runs background context actions on the current folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    const openBackgroundMenu = async () => {
      await act(async () => {
        fireEvent.contextMenu(backgroundButton);
      });
      const menu = document.querySelector(".context-menu");
      if (!(menu instanceof HTMLElement)) {
        throw new Error("Missing background context menu.");
      }
      return within(menu);
    };

    await act(async () => {
      fireEvent.click((await openBackgroundMenu()).getByRole("button", { name: /^Copy Path/ }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:copyText")?.payload,
      ).toEqual({ text: "/Users/demo" });
    });

    await act(async () => {
      fireEvent.click((await openBackgroundMenu()).getByRole("button", { name: "Show in Finder" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Library/CoreServices/Finder.app",
        paths: ["/Users/demo"],
      });
    });

    await act(async () => {
      fireEvent.click(
        (await openBackgroundMenu()).getByRole("button", { name: /^Open in Terminal/ }),
      );
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
      ).toEqual(expect.objectContaining({ path: "/Users/demo" }));
    });

    await act(async () => {
      fireEvent.click((await openBackgroundMenu()).getByRole("button", { name: /^Show Info/ }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "item:getProperties" &&
            (call.payload as { path: string }).path === "/Users/demo",
        ),
      ).toBe(true);
    });
  });

  it("creates the folder in the folder on screen with Cmd+Shift+N when a file is selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    // A file cannot hold the new folder, so it goes next to it.
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("creates the folder in the folder on screen when several items are selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
    });
    expect(sourceButton).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
    // The menu bar command behaves like the shortcut.
    await act(async () => {
      harness.emitCommand({ type: "newFolder" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("shows Add to Favorites for non-favorite folders and persists the change", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });

    const addToFavoritesButton = screen.getByRole("button", { name: "Add to Favorites" });
    expect(addToFavoritesButton).toHaveAttribute("aria-disabled", "false");

    await act(async () => {
      fireEvent.click(addToFavoritesButton);
    });

    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: {
          favorites: expect.arrayContaining([{ path: "/Users/demo/Folder", icon: "folder" }]),
        },
      });
    });
  });

  it("shows Remove from Favorites for existing favorites and persists removal", async () => {
    const harness = createAppHarness({
      preferences: {
        favorites: [{ path: "/Users/demo/Folder", icon: "folder" }],
        favoritesExpanded: true,
        favoritesInitialized: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });

    const removeFromFavoritesButton = screen.getByRole("button", {
      name: "Remove from Favorites",
    });
    expect(removeFromFavoritesButton).toHaveAttribute("aria-disabled", "false");

    await act(async () => {
      fireEvent.click(removeFromFavoritesButton);
    });

    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: {
          favorites: [],
        },
      });
    });
  });

  it("keeps a tree symlink selected until content navigation moves into a child", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Alias": {
          path: "/Volumes/Shared/RealFolder",
          parentPath: "/Volumes/Shared",
          entries: [createDirectoryEntry("/Volumes/Shared/RealFolder/Child", "directory")],
        },
        "/Volumes/Shared/RealFolder/Child": {
          path: "/Volumes/Shared/RealFolder/Child",
          parentPath: "/Volumes/Shared/RealFolder",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/Alias", "symlink_directory", { isSymlink: true }),
        ],
        "/": [createTreeChild("/Volumes", "directory")],
        "/Volumes": [createTreeChild("/Volumes/Shared", "directory")],
        "/Volumes/Shared": [createTreeChild("/Volumes/Shared/RealFolder", "directory")],
        "/Volumes/Shared/RealFolder": [
          createTreeChild("/Volumes/Shared/RealFolder/Child", "directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    await act(async () => {
      fireEvent.click(await screen.findByTitle("tree:/Users/demo/Alias"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Alias");
    });
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path === "/Users/demo/Alias",
      ),
    ).toBe(true);
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "tree:getChildren" &&
          (call.payload as IpcRequestInput<"tree:getChildren">).path ===
            "/Volumes/Shared/RealFolder",
      ),
    ).toBe(false);

    await act(async () => {
      fireEvent.doubleClick(await screen.findByTitle("/Volumes/Shared/RealFolder/Child"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent(
        "fs:/Volumes/Shared/RealFolder/Child",
      );
    });
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "tree:getChildren" &&
          (call.payload as IpcRequestInput<"tree:getChildren">).path ===
            "/Volumes/Shared/RealFolder",
      ),
    ).toBe(true);
  });

  it("moves the selected items to Trash with Cmd+Backspace", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.click(folderButton, { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/source.txt", "/Users/demo/Folder"],
      });
    });
  });

  it("renames the single selected item on Return like Finder", async () => {
    const harness = createAppHarness();
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source-a.txt", "file"),
    ]);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByTitle("/Users/demo/source-a.txt");
    await act(async () => {
      fireEvent.click(sourceAButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    await screen.findByLabelText("Rename source-a.txt");
    expect(harness.invocations.some((call) => call.channel === "system:openPath")).toBe(false);
  });

  it("opens the selected paths on Return when the Return key is set to open", async () => {
    const harness = createAppHarness({ preferences: { returnKeyAction: "open" } });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source-a.txt", "file"),
      createDirectoryEntry("/Users/demo/source-b.txt", "file"),
    ]);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByTitle("/Users/demo/source-a.txt");
    const sourceBButton = await screen.findByTitle("/Users/demo/source-b.txt");
    await act(async () => {
      fireEvent.click(sourceAButton);
      fireEvent.click(sourceBButton, { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    const openPathCalls = harness.invocations.filter((call) => call.channel === "system:openPath");
    expect(openPathCalls.slice(-2).map((call) => call.payload)).toEqual([
      { path: "/Users/demo/source-a.txt" },
      { path: "/Users/demo/source-b.txt" },
    ]);
  });

  it("disables Edit in the context menu for folders and mixed selections", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    const folderButton = await screen.findByTitle("/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(folderButton);
      fireEvent.contextMenu(folderButton);
    });
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.mouseDown(document.body);
    });

    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.click(folderButton, { metaKey: true });
      fireEvent.contextMenu(folderButton);
    });
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");
  });

  it("shows a notice when Open exceeds the configured item limit", async () => {
    const harness = createAppHarness({
      preferences: {
        openItemLimit: 1,
      },
    });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source-a.txt", "file"),
      createDirectoryEntry("/Users/demo/source-b.txt", "file"),
    ]);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByTitle("/Users/demo/source-a.txt");
    const sourceBButton = await screen.findByTitle("/Users/demo/source-b.txt");
    await act(async () => {
      fireEvent.click(sourceAButton);
      fireEvent.click(sourceBButton, { metaKey: true });
    });
    await act(async () => {
      harness.emitCommand({ type: "openSelection" });
    });

    expect(await screen.findByRole("dialog", { name: "Open" })).toHaveTextContent(
      "Open is limited to 1 item at a time.",
    );
    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "system:openPath" &&
          (call.payload as IpcRequestInput<"system:openPath">).path === "/Users/demo/source-a.txt",
      ),
    ).toBeUndefined();
  });

  it("shows an action notice when open with launch fails", async () => {
    const harness = createAppHarness({
      openPathsWithApplicationError: new Error("Application not found"),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Visual Studio Code" }));
    });

    expect(
      await screen.findByRole("dialog", { name: "Open With Visual Studio Code" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Application not found/)).toBeInTheDocument();
  });

  it("pastes into the right-clicked folder in the content pane", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  // Like Finder: ⌘V goes into the folder on screen, never out of sight into a selected
  // folder (often the one just pasted). A folder's own menu pastes into it.
  it("pastes into the folder on screen with Cmd+V, even with a folder selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo",
      });
    });
  });

  it("pastes into a folder from that folder's menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("pastes immediately after copy without reading an empty clipboard state", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    const folderButton = await screen.findByTitle("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
      fireEvent.click(folderButton);
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
      });
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("pastes into the right-clicked tree folder target", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.findLast((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("pastes a copied folder back into the current directory when it is selected in content", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/Folder",
            destinationPath: "/Users/demo/Folder copy",
            kind: "directory",
            status: "ready",
            sizeBytes: null,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: null,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.findLast((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
      });
    });
  });

  it("pastes into the right-clicked favorite target in both integrated and separate layouts", async () => {
    for (const favoritesPlacement of ["integrated", "separate"] as const) {
      const harness = createAppHarness({
        preferences: {
          favoritesPlacement,
        },
        directorySnapshots: {
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            parentPath: "/Users/demo",
            entries: [],
          },
        },
      });

      const { unmount } = render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );

      await selectItem("/Users/demo/source.txt");
      await act(async () => {
        fireEvent.keyDown(window, { key: "c", metaKey: true });
      });

      const favoriteButton = await screen.findByTitle("favorite:/Users/demo/Documents");
      await act(async () => {
        fireEvent.contextMenu(favoriteButton);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Paste" }));
      });

      await vi.waitFor(() => {
        const planCall = harness.invocations.findLast((call) => call.channel === "copyPaste:plan");
        expect(planCall?.payload).toMatchObject({
          destinationDirectoryPath: "/Users/demo/Documents",
        });
      });

      unmount();
    }
  });

  it("shows tree-safe shortcut badges for right-clicked tree and favorite targets even when Favorites is selected", async () => {
    for (const targetTitle of ["tree:/Users/demo/Folder", "favorite:/Users/demo/Documents"]) {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            parentPath: "/Users/demo",
            entries: [],
          },
        },
      });

      const { unmount } = render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );

      const favoritesRootButton = await screen.findByTestId("favorites-root");
      await act(async () => {
        fireEvent.click(favoritesRootButton);
      });
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");

      const targetButton = await screen.findByTitle(targetTitle);
      await act(async () => {
        fireEvent.contextMenu(targetButton);
      });

      expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();

      unmount();
    }
  });

  it("keeps tree and favorite context menus on tree-safe shortcut badges after a disabled menu click", async () => {
    for (const targetTitle of ["tree:/Users/demo/Folder", "favorite:/Users/demo/Documents"]) {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            parentPath: "/Users/demo",
            entries: [],
          },
        },
      });

      const { unmount } = render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );

      const targetButton = await screen.findByTitle(targetTitle);
      await act(async () => {
        fireEvent.contextMenu(targetButton);
      });

      const disabledButton =
        screen.queryByRole("button", { name: "Paste" }) ??
        screen.queryByRole("button", { name: "Paste" });
      expect(disabledButton).not.toBeNull();
      if (!disabledButton) {
        throw new Error("Disabled Paste button missing.");
      }

      await act(async () => {
        fireEvent.click(disabledButton);
      });

      expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
      if (targetTitle.startsWith("tree:")) {
        expect(screen.getByRole("button", { name: "Copy⌘C" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cut⌘X" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "RenameF2" })).toBeNull();
      } else {
        expect(screen.getByRole("button", { name: "Paste" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Paste⌘V" })).toBeNull();
        expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New Folder⇧⌘N" })).toBeNull();
      }

      unmount();
    }
  });

  it("asks for confirmation before trashing a tree folder from the context menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    expect(
      await screen.findByRole("dialog", { name: "Move “Folder” to the Trash?" }),
    ).toHaveTextContent("It stays in the Trash until the Trash is emptied.");
    expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/Folder"],
      });
    });
  });

  it("closes the tree trash confirmation dialog immediately after confirming with the button", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" }));
    });

    const dialog = await screen.findByRole("dialog", { name: "Move “Folder” to the Trash?" });
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Move “Folder” to the Trash?" }),
      ).not.toBeInTheDocument();
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/Folder"],
      });
    });
  });

  it("closes the tree trash confirmation dialog immediately after confirming with Enter", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" }));
    });

    const dialog = await screen.findByRole("dialog", { name: "Move “Folder” to the Trash?" });
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Move “Folder” to the Trash?" }),
      ).not.toBeInTheDocument();
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/Folder"],
      });
    });
  });

  it("reselects the parent tree folder after trashing the selected filesystem node", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(treeFolderButton);
    });
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-trash",
        action: "trash",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: null,
        result: {
          operationId: "write-op-trash",
          action: "trash",
          status: "completed",
          targetPath: null,
          startedAt: "2026-03-10T10:00:00.000Z",
          finishedAt: "2026-03-10T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/Folder",
              destinationPath: null,
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
    });
  });

  it("reselects the renamed filesystem tree folder after the write completes", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Renamed Folder": {
          path: "/Users/demo/Renamed Folder",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/Renamed Folder", "directory"),
        ],
        "/Users/demo/Renamed Folder": [],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(treeFolderButton);
    });
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    });

    expect(await screen.findByRole("dialog", { name: /^Rename “/u })).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("New name"), {
        target: { value: "Renamed Folder" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-rename",
        action: "rename",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: "/Users/demo/Renamed Folder",
        result: {
          operationId: "write-op-rename",
          action: "rename",
          status: "completed",
          targetPath: "/Users/demo/Renamed Folder",
          startedAt: "2026-03-10T10:00:00.000Z",
          finishedAt: "2026-03-10T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/Folder",
              destinationPath: "/Users/demo/Renamed Folder",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent(
        "fs:/Users/demo/Renamed Folder",
      );
    });
  });

  it("reveals a separate favorite in the filesystem tree", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesPlacement: "separate",
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Documents", "directory"),
          createTreeChild("/Users/demo/Folder", "directory"),
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const favoriteButton = await screen.findByTitle("favorite:/Users/demo/Documents");
    await act(async () => {
      fireEvent.contextMenu(favoriteButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal in Tree" }));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("tree");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Documents");
    });
  });

  it("goes Home and roots the tree there with Cmd+Shift+H", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Volumes/Shared/Project", "directory"),
          ],
        },
        "/Volumes/Shared/Project": {
          path: "/Volumes/Shared/Project",
          parentPath: "/Volumes/Shared",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/": [createTreeChild("/Users", "directory"), createTreeChild("/Volumes", "directory")],
        "/Volumes": [createTreeChild("/Volumes/Shared", "directory")],
        "/Volumes/Shared": [createTreeChild("/Volumes/Shared/Project", "directory")],
        "/Users/demo": [createTreeChild("/Users/demo/Folder", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Volumes/Shared/Project");
    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/");
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "H", metaKey: true, shiftKey: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
      expect(screen.getByTitle("/Users/demo/source.txt")).toBeInTheDocument();
    });
  });

  it("roots the tree at the folder on screen, then falls back once a folder outside it opens", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      harness.emitCommand({ type: "rootTreeAtSelection" });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo/Folder");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Folder");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: { treeRootPath: "/Users/demo/Folder" },
      });
    });

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    });
  });

  it("offers Root Tree Here for a folder in the file list, but not for a file", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.contextMenu(sourceButton);
    });
    expect(screen.getByRole("button", { name: /^Copy Path/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Root Tree Here/ })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Root Tree Here/ }));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo/Folder");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
  });

  it("clears the content pane when the integrated Favorites root is selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    expect(screen.getByTitle("/Users/demo/source.txt")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("favorites-root"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
      expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
      expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
    });
  });

  it("keeps the separate favorites subview active and clears content when Favorites is selected", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesPlacement: "separate",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorites-root"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
      expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
    });
  });

  it("copies the tree's folder with Cmd+C in tree focus, not a stale selection in the list", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("cuts the tree's folder with Cmd+X in tree focus, not a stale selection in the list", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("pastes into the tree's selected folder with Cmd+V in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");
    await focusTreePane();
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("does not paste from the tree when the Favorites root is selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorites-root"));
    });
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
      harness.emitCommand({ type: "editPaste" });
    });

    expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(false);
  });

  it("pastes into the folder on screen when no pane has focus, even with a folder selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    // Focusing the search field takes focus away from both panes.
    await act(async () => {
      fireEvent.focus(screen.getByPlaceholderText("Search"));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
    });
  });

  it("blocks Cmd+Shift+N in tree focus even when content still has a stale selection", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
  });

  it("allows Cmd+Option+C in tree focus for the selected tree folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyC", metaKey: true, altKey: true });
    });

    expect(harness.invocations.find((call) => call.channel === "system:copyText")?.payload).toEqual(
      { text: "/Users/demo" },
    );
  });

  it("copies the tree's folder from the Copy menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "editCopy" });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("cuts the tree's folder from the Cut menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "editCut" });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("pastes into the tree's selected folder from the Paste menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "editPaste" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo/Folder" });
    });
    expectNativeEditActions(harness, []);
  });

  it("blocks the New Folder menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "newFolder" });
    });

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
  });

  it("allows the Copy Path menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "copyPath" });
    });

    expect(harness.invocations.find((call) => call.channel === "system:copyText")?.payload).toEqual(
      { text: "/Users/demo" },
    );
  });

  it("keeps dangerous renderer commands blocked in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();

    const commands: Array<{
      command: RendererCommand["type"];
      assertNoSideEffect: () => void;
    }> = [
      {
        command: "editSelection",
        assertNoSideEffect: () => {
          expect(
            harness.invocations.some((call) => call.channel === "system:openPathsWithApplication"),
          ).toBe(false);
        },
      },
      {
        command: "moveSelection",
        assertNoSideEffect: () => {
          expect(screen.queryByText("Move")).not.toBeInTheDocument();
        },
      },
      {
        command: "renameSelection",
        assertNoSideEffect: () => {
          expect(screen.queryByRole("dialog", { name: /^Rename “/u })).not.toBeInTheDocument();
        },
      },
      {
        command: "duplicateSelection",
        assertNoSideEffect: () => {
          expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(false);
        },
      },
      {
        command: "newFolder",
        assertNoSideEffect: () => {
          expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
        },
      },
      {
        command: "trashSelection",
        assertNoSideEffect: () => {
          expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
            false,
          );
        },
      },
    ];

    for (const { command, assertNoSideEffect } of commands) {
      await act(async () => {
        harness.emitCommand({ type: command });
      });
      assertNoSideEffect();
    }
  });

  it("keeps global tree-focus shortcuts working", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText("Search")).toBe(document.activeElement);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    expect(await screen.findByLabelText("Path")).toBeInTheDocument();
  });

  it("remembers the folders that are opened and offers them in the Go To box", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      visitedFolders: [{ path: "/Users/demo/Old", visitCount: 3, lastVisitedAt: 1 }],
    });
    const visits = () =>
      harness.invocations
        .filter((call) => call.channel === "places:recordVisit")
        .map((call) => (call.payload as IpcRequestInput<"places:recordVisit">).path);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");

    // ⌘K opens the box with the folders opened before.
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    await screen.findByTitle("place:/Users/demo/Old");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/Users/demo/Folder" } });
      fireEvent.click(screen.getByText("Open Folder"));
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
    // Going there counted as a visit.
    expect(visits()).toContain("/Users/demo/Folder");
    const visitsAfterGoing = visits().length;

    // Back does not count, and neither does the folder shown at launch.
    await act(async () => {
      fireEvent.keyDown(window, { key: "[", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    });
    expect(visits()).toHaveLength(visitsAfterGoing);

    // ⇧⌘G opens the same box; the folder just visited is now offered, the one on screen
    // is not, and a folder can be taken off the list.
    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    await screen.findByTitle("place:/Users/demo/Folder");
    expect(screen.queryByTitle("place:/Users/demo")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTitle("forget:/Users/demo/Old"));
    });
    expect(screen.queryByTitle("place:/Users/demo/Old")).toBeNull();
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "places:forget" &&
          (call.payload as IpcRequestInput<"places:forget">).path === "/Users/demo/Old",
      ),
    ).toBe(true);
  });

  it("drops a remembered folder that can no longer be opened", async () => {
    const harness = createAppHarness({
      visitedFolders: [{ path: "/Users/demo/Gone", visitCount: 3, lastVisitedAt: 1 }],
      itemPropertiesByPath: { "/Users/demo/Gone": "missing" },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("place:/Users/demo/Gone"));
    });

    await vi.waitFor(() => {
      expect(screen.queryByTitle("place:/Users/demo/Gone")).toBeNull();
    });
    // The box stays open, on the folder that was on screen.
    expect(screen.getByLabelText("Path")).toBeInTheDocument();
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("expands ~ when submitting Go to Folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });

    const input = await screen.findByLabelText("Path");
    await act(async () => {
      fireEvent.change(input, { target: { value: "~/Folder" } });
      fireEvent.click(screen.getByText("Open Folder"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
  });

  it("allows Cmd+Option+T in tree focus for the selected tree folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyT", metaKey: true, altKey: true });
    });

    expect(
      harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
    ).toEqual({ path: "/Users/demo" });
  });

  it("allows Cmd+Option+T and Cmd+Option+C for favorites in the separate favorites pane", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesPlacement: "separate",
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Documents", "directory"),
          createTreeChild("/Users/demo/Folder", "directory"),
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const favoriteButton = await screen.findByTitle("favorite:/Users/demo/Documents");
    await act(async () => {
      fireEvent.click(favoriteButton);
    });

    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyT", metaKey: true, altKey: true });
      fireEvent.keyDown(window, { code: "KeyC", metaKey: true, altKey: true });
    });

    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
    expect(
      harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
    ).toEqual({ path: "/Users/demo/Documents" });
    expect(
      harness.invocations.findLast((call) => call.channel === "system:copyText")?.payload,
    ).toEqual({ text: "/Users/demo/Documents" });
  });

  it("moves to the file list on a key given to Focus File List", async () => {
    // Tab is the way between the panes; the focus commands have no key until one is given.
    const harness = createAppHarness({
      preferences: { shortcutOverrides: { focusContentPane: ["Cmd+Option+2"] } },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", code: "Digit2", metaKey: true, altKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "a", metaKey: true });
    });

    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
  });

  it("switches from tree to content with Tab through the raw shortcut registry", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    const activeElement = document.activeElement;
    expect(activeElement).not.toBeNull();
    if (!activeElement) {
      throw new Error("Missing active element for pane tab switch.");
    }

    await act(async () => {
      fireEvent.keyDown(activeElement, { key: "Tab" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "a", metaKey: true });
    });

    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
  });

  it("starts non-conflicting cut/paste without a confirmation dialog", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(screen.queryByRole("dialog", { name: "Confirm Cut/Paste" })).not.toBeInTheDocument();
  });

  it("reloads the visible source tree branch after a folder move completes", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/Source Folder"],
        destinationDirectoryPath: "/Users/demo/Target",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/Source Folder",
            destinationPath: "/Users/demo/Target/Source Folder",
            kind: "directory",
            status: "ready",
            sizeBytes: 0,
          },
          {
            sourcePath: "/Users/demo/Source Folder/nested.txt",
            destinationPath: "/Users/demo/Target/Source Folder/nested.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 2,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/Source Folder", "directory"),
            createDirectoryEntry("/Users/demo/Target", "directory"),
          ],
        },
        "/Users/demo/Target": {
          path: "/Users/demo/Target",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Source Folder", "directory"),
          createTreeChild("/Users/demo/Target", "directory"),
        ],
        "/Users/demo/Target": [],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Source Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await openDirectory("/Users/demo/Target");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    const sourceParentReloadCountBeforeCompletion = harness.invocations.filter(
      (call) =>
        call.channel === "tree:getChildren" &&
        (call.payload as IpcRequestInput<"tree:getChildren">).path === "/Users/demo",
    ).length;

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "completed",
        completedItemCount: 2,
        totalItemCount: 2,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: "/Users/demo/Source Folder",
        currentDestinationPath: "/Users/demo/Target/Source Folder",
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Target",
          startedAt: "2026-03-11T10:00:00.000Z",
          finishedAt: "2026-03-11T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 2,
            completedItemCount: 2,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/Source Folder",
              destinationPath: "/Users/demo/Target/Source Folder",
              status: "completed",
              error: null,
            },
            {
              sourcePath: "/Users/demo/Source Folder/nested.txt",
              destinationPath: "/Users/demo/Target/Source Folder/nested.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      const sourceParentReloadCountAfterCompletion = harness.invocations.filter(
        (call) =>
          call.channel === "tree:getChildren" &&
          (call.payload as IpcRequestInput<"tree:getChildren">).path === "/Users/demo",
      ).length;
      expect(sourceParentReloadCountAfterCompletion).toBeGreaterThan(
        sourceParentReloadCountBeforeCompletion,
      );
    });
  });

  it("shows a modal dialog for non-recoverable planning issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "same_path",
            message: "Cannot paste an item onto itself.",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 0,
          totalBytes: 0,
          skippedConflictCount: 0,
        },
        canExecute: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Paste couldn’t start")).toBeInTheDocument();
    expect(screen.getByText("“source.txt” is already in “Folder”.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste Requires Review" })).not.toBeInTheDocument();
  });

  it("shows a warning toast for empty clipboard without opening a paste dialog", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(folderButton);
    });
    const activeElementBeforePasteWarning = document.activeElement;
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Paste/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforePasteWarning);
  });

  it("keeps search options for the session without saving them over the Settings defaults", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:updatePreferences")).toBe(
        true,
      );
    });
    const optionsButton = screen.getAllByRole("button", { name: "Search options" })[0];
    if (!optionsButton) {
      throw new Error("Search options button not found.");
    }
    const subfoldersItem = () =>
      screen.getByRole("menuitemcheckbox", { name: "Search Subfolders" });

    fireEvent.click(optionsButton, { detail: 1 });
    const before = subfoldersItem().getAttribute("aria-checked");
    fireEvent.click(subfoldersItem());
    // Reopening the menu later in the same run shows what was chosen.
    fireEvent.click(optionsButton, { detail: 1 });
    expect(subfoldersItem().getAttribute("aria-checked")).toBe(
      before === "true" ? "false" : "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });

    // Another preference change forces a save; the search options are not part of any save.
    await act(async () => {
      fireEvent.keyDown(window, { key: "i", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "app:updatePreferences" &&
            (call.payload as IpcRequestInput<"app:updatePreferences">).preferences.detailRowOpen !==
              undefined,
        ),
      ).toBe(true);
    });
    for (const call of harness.invocations.filter(
      (entry) => entry.channel === "app:updatePreferences",
    )) {
      const saved = (call.payload as IpcRequestInput<"app:updatePreferences">).preferences;
      for (const key of [
        "searchPatternMode",
        "searchMatchScope",
        "searchRecursive",
        "searchSkipGitFolders",
        "searchSkipGitIgnored",
      ] as const) {
        expect(saved[key]).toBeUndefined();
      }
    }
  });

  it("searches hidden files exactly when the file list shows them, and again when that changes", async () => {
    const harness = createAppHarness();
    // The folder reload that follows ⇧⌘. arrives after the search has restarted, as it
    // does in the app (a real listing is slower than starting a search).
    let delaySnapshots = false;
    const client: FiletrailClient = {
      ...harness.client,
      invoke: (async (channel: IpcChannel, payload: unknown) => {
        if (delaySnapshots && channel === "directory:getSnapshot") {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return harness.client.invoke(channel as never, payload as never);
      }) as FiletrailClient["invoke"],
    };

    render(
      <FiletrailClientProvider value={client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchInput = screen.getAllByPlaceholderText("Search")[0];
    if (!searchInput) {
      throw new Error("Search field not found.");
    }
    const searchStarts = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).includeHidden);
    const snapshotCount = () =>
      harness.invocations.filter((call) => call.channel === "directory:getSnapshot").length;

    await act(async () => {
      fireEvent.focus(searchInput);
      fireEvent.change(searchInput, { target: { value: "source" } });
      fireEvent.submit(searchInput);
    });
    await vi.waitFor(() => {
      expect(searchStarts()).toEqual([false]);
    });
    await screen.findByTestId("search-results-pane");

    // ⇧⌘. shows hidden files in the list; the results on screen are searched again with them.
    const snapshotsBefore = snapshotCount();
    delaySnapshots = true;
    await act(async () => {
      fireEvent.keyDown(window, { key: ".", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(searchStarts()).toEqual([false, true]);
    });
    // The folder reloads underneath, but the results stay on screen.
    await vi.waitFor(() => {
      expect(snapshotCount()).toBeGreaterThan(snapshotsBefore);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
  });

  it("debounces preference persists so a burst of changes writes one latest snapshot", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    // Let the initial post-hydration persist settle before counting writes.
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:updatePreferences")).toBe(
        true,
      );
    });
    const baselinePersistCount = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    ).length;

    vi.useFakeTimers();
    for (let press = 0; press < 3; press += 1) {
      await act(async () => {
        fireEvent.keyDown(window, { key: "i", metaKey: true, shiftKey: true });
      });
    }

    // No write is issued while the debounce window is still open.
    expect(
      harness.invocations.filter((call) => call.channel === "app:updatePreferences").length,
    ).toBe(baselinePersistCount);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const persistCalls = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    );
    expect(persistCalls.length).toBe(baselinePersistCount + 1);
    // Three toggles collapse into a single write carrying the final value.
    expect(
      (persistCalls.at(-1)?.payload as IpcRequestInput<"app:updatePreferences">).preferences
        .detailRowOpen,
    ).toBe(true);
  });

  it("requires confirmation before starting Replace Folder from the review dialog", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/Folder",
            destinationPath: "/Users/demo/Folder",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        conflicts: [
          {
            sourcePath: "/Users/demo/Folder",
            destinationPath: "/Users/demo/Folder",
            reason: "destination_exists",
          },
        ],
        issues: [],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: null,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    await screen.findByRole("dialog", { name: "“Folder” already exists in “demo”" });
    // Keep Both is the default; replacing takes a click on the red button.
    expect(screen.getByRole("button", { name: "Keep Both" })).toHaveFocus();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "duplicate",
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "overwrite" }],
    });
  });

  it("shows structured details for live directory conflicts", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "paste",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: "/Users/demo/Folder",
        runtimeConflict: {
          conflictId: "runtime-1",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/Folder",
          destinationPath: "/Users/demo/Folder",
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          reason: "destination_changed",
          sourceFingerprint: createNodeFingerprint("directory"),
          destinationFingerprint: createNodeFingerprint("directory"),
          currentSourceFingerprint: createNodeFingerprint("directory"),
          currentDestinationFingerprint: createNodeFingerprint("directory"),
        },
        result: null,
      });
    });

    expect(
      await screen.findByRole("dialog", {
        name: "“Folder” in “demo” changed while pasting",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("In “demo” now")).toBeInTheDocument();
    expect(screen.getByText("Being pasted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Keep Both" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Pasting" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    });

    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-1",
      resolution: "overwrite",
    });
  });

  it("offers only skip for runtime conflicts when the source item is missing", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "move_to",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        runtimeConflict: {
          conflictId: "runtime-missing",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/source.txt",
          destinationPath: "/Users/demo/Folder/source.txt",
          sourceKind: "file",
          destinationKind: "missing",
          conflictClass: "file_conflict",
          reason: "source_deleted",
          sourceFingerprint: createNodeFingerprint("file"),
          destinationFingerprint: createNodeFingerprint("missing"),
          currentSourceFingerprint: createNodeFingerprint("missing"),
          currentDestinationFingerprint: createNodeFingerprint("missing"),
        },
        result: null,
      });
    });

    expect(
      await screen.findByRole("dialog", { name: /is no longer available$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/so it can only be skipped/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Moving" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep Both" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    });

    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-missing",
      resolution: "skip",
    });
  });

  it("shows an immediate preparing progress card before copyPaste:plan resolves", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.getByText(/· Preparing…$/u)).toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("locks write actions immediately while paste planning is in flight, but not Copy and Cut", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    // Filter out background folder-size probe calls (probeOnly) which are
    // fire-and-forget and don't count as user-initiated write operations.
    const nonProbeInvocations = () =>
      harness.invocations.filter(
        (inv) =>
          !(
            inv.channel === "folderSize:start" &&
            (inv.payload as { probeOnly?: boolean })?.probeOnly
          ),
      );

    const invocationCountBeforeBlockedPaste = nonProbeInvocations().length;
    // Cut only fills the clipboard, so the operation under way does not hold it back.
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    expect(nonProbeInvocations()).toHaveLength(invocationCountBeforeBlockedPaste);

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(nonProbeInvocations()).toHaveLength(invocationCountBeforeBlockedPaste);

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.contextMenu(sourceButton);
    });

    expect(await screen.findByRole("button", { name: "Paste" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Rename" })).toHaveAttribute("aria-disabled", "true");
    for (const name of ["Copy", "Cut", "Copy Path"]) {
      expect(screen.getByRole("button", { name })).not.toHaveAttribute("aria-disabled", "true");
    }

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("cancels a planning-phase paste immediately and keeps the clipboard available", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
      harness.resolveCopyPastePlan();
    });
  });

  it("stops the paste when Cancel is clicked while checking, even if the analysis then finishes", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    });
    await act(async () => {
      harness.resolveCopyPastePlan();
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
  });

  it("keeps the clipboard when paste planning fails", async () => {
    const harness = createAppHarness({
      copyPastePlanError: new Error("planner unavailable"),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Paste couldn’t start")).toBeInTheDocument();
    expect(screen.getByText("planner unavailable")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    await selectItem("/Users/demo/Folder");

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("keeps the clipboard when paste planning returns issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "destination_missing",
            message: "Destination folder is unavailable.",
            sourcePath: null,
            destinationPath: "/Users/demo/Folder",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Paste couldn’t start")).toBeInTheDocument();
    expect(screen.getByText("The folder “Folder” no longer exists.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    await selectItem("/Users/demo/Folder");

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("shows a dialog when analysis finishes with an error before paste starts", async () => {
    const harness = createAppHarness({
      analysisUpdateResponse: {
        analysisId: "analysis-1",
        status: "error",
        done: true,
        report: null,
        error: "Planner unavailable.",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Paste couldn’t start")).toBeInTheDocument();
    expect(screen.getByText("Planner unavailable.")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("does not show a failure notice when analysis is explicitly cancelled before paste starts", async () => {
    const harness = createAppHarness({
      analysisUpdateResponse: {
        analysisId: "analysis-1",
        status: "cancelled",
        done: true,
        report: null,
        error: null,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "copyPaste:analyzeGetUpdate"),
      ).toBe(true);
    });
    expect(screen.queryByText("Paste couldn’t start")).not.toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps cut items on the clipboard when a cancelled move moved nothing", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "running",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        result: null,
      });
    });

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      fireEvent.click(stopButton);
    });

    await vi.waitFor(() => {
      expect(harness.invocations).toContainEqual({
        channel: "writeOperation:cancel",
        payload: { operationId: "copy-op-1" },
      });
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "cancelled",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "cancelled",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 1,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "cancelled",
              error: "User cancelled the operation.",
            },
          ],
          error: "User cancelled the operation.",
        },
      });
    });

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("clears the starting progress card if copyPaste:start is rejected as busy", async () => {
    const harness = createAppHarness({
      copyPasteStartError: new Error("Another write operation is already running."),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Paste couldn’t start")).toBeInTheDocument();
    expect(
      screen.getByText("Another file operation is running. Wait for it to finish, or stop it."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
  });

  it("shows streamed progress and dispatches cancel requests", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.queryByText("Pasting into Folder")).not.toBeInTheDocument();

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "running",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        result: null,
      });
    });

    expect(screen.getByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Pasting…" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations).toContainEqual({
        channel: "writeOperation:cancel",
        payload: { operationId: "copy-op-1" },
      });
    });
  });

  it("selects pasted items in the current view after paste finishes", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");
    harness.setDirectoryEntries("/Users/demo/Folder", [
      createDirectoryEntry("/Users/demo/Folder/source.txt", "file"),
    ]);

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/Folder/source.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
  });

  it("shows copy-path success as a toast and failures as a modal dialog without changing focus", async () => {
    const successHarness = createAppHarness();

    const { unmount } = render(
      <FiletrailClientProvider value={successHarness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCopyPath = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true, altKey: true });
    });

    const toastViewport = await screen.findByTestId("toast-viewport");
    expect(within(toastViewport).getByText("Copied path")).toBeInTheDocument();
    expect(within(toastViewport).getByText("source.txt")).toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCopyPath);

    unmount();

    const failureHarness = createAppHarness({
      copyTextError: new Error("clipboard unavailable"),
    });

    render(
      <FiletrailClientProvider value={failureHarness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const failedSourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(failedSourceButton);
    });
    const activeElementBeforeCopyPathError = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true, altKey: true });
    });

    const errorDialog = await screen.findByRole("dialog", {
      name: "Unable to copy the selected path(s)",
    });
    expect(errorDialog).toBeInTheDocument();
    expect(document.activeElement).not.toBe(activeElementBeforeCopyPathError);
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("fills the clipboard without a notification", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(document.querySelectorAll(".toast-card")).toHaveLength(0);
  });

  it("lists the clipboard from the menu command, and takes items off it there", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    // Nothing to show while the clipboard is empty.
    await screen.findByTestId("content-pane");
    await act(async () => {
      harness.emitCommand({ type: "showClipboard" });
    });
    expect(screen.queryByRole("menu", { name: "Clipboard" })).toBeNull();

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    // Copying does not open the list by itself.
    expect(screen.queryByRole("menu", { name: "Clipboard" })).toBeNull();

    await act(async () => {
      harness.emitCommand({ type: "showClipboard" });
    });
    const menu = screen.getByRole("menu", { name: "Clipboard" });
    expect(within(menu).getByRole("menuitem", { name: "source.txt" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("button", { name: "Remove source.txt from the clipboard" }),
      );
    });
    expect(clipboardButton()).toBeNull();
    expect(screen.queryByRole("menu", { name: "Clipboard" })).toBeNull();
  });

  it("empties the clipboard from the menu command", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");

    await act(async () => {
      harness.emitCommand({ type: "clearClipboard" });
    });
    expect(clipboardButton()).toBeNull();

    // With nothing left to paste, Paste does nothing.
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expectNoFileClipboardActions(harness);
  });

  it("suppresses notifications entirely when the preference is disabled", async () => {
    const harness = createAppHarness({
      preferences: {
        notificationsEnabled: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(document.querySelectorAll(".toast-card")).toHaveLength(0);
  });

  it("copies on the first command press after selecting an item", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("/Users/demo/Folder"));
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("keeps copied items on the clipboard after a paste so it can be repeated", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    const updatedToastViewport = await screen.findByTestId("toast-viewport");
    const pastedToastTitle = within(updatedToastViewport).getByText("Pasted into Folder");
    const pastedToast = pastedToastTitle.closest(".toast-card");
    expect(pastedToast).not.toBeNull();
    expect(within(pastedToast as HTMLElement).getByText("“source.txt”")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /^Pasted \d+ of/ })).not.toBeInTheDocument();

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("keeps copied items on the clipboard after a skip-conflicts paste without opening a modal", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "partial",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "partial",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 0,
            skippedItemCount: 1,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "skipped",
              error: "Destination already exists.",
              skipReason: "planned_conflict_policy",
            },
          ],
          error: null,
        },
      });
    });
    const toastViewport = await screen.findByTestId("toast-viewport");
    const skipToastTitle = within(toastViewport).getByText("Nothing pasted");
    const skipToast = skipToastTitle.closest(".toast-card");
    expect(skipToast).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: /^Pasted \d+ of/ })).not.toBeInTheDocument();
    expect(
      within(skipToast as HTMLElement).getByText("Skipped 1 item that already exists."),
    ).toBeInTheDocument();

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("keeps cut items on the clipboard when a failed move moved nothing", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "failed",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "failed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 1,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "failed",
              error: "Permission denied",
            },
          ],
          error: "Permission denied",
        },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    });

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length + 1,
      );
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("clears cut items from the clipboard once the move moved them", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length,
      );
    });
    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
  });
  it("offers retry for failed items from the result dialog", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "failed",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "failed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 1,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "failed",
              error: "Disk full",
            },
          ],
          error: "Disk full",
        },
      });
    });

    expect(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });

    await vi.waitFor(() => {
      const retryPlanCalls = harness.invocations.filter(
        (call) => call.channel === "copyPaste:plan",
      );
      expect(retryPlanCalls).toHaveLength(2);
      expect(retryPlanCalls[1]?.payload).toEqual({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        action: "paste",
      });
    });
  });

  it("lets retry planning be cancelled before the retry starts", async () => {
    const harness = createAppHarness({
      deferCopyPastePlanCalls: [2],
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "failed",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "failed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 1,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "failed",
              error: "Disk full",
            },
          ],
          error: "Disk full",
        },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    const startCallsBeforeCancel = harness.invocations.filter(
      (call) => call.channel === "copyPaste:start",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
        startCallsBeforeCancel.length,
      );
    });
  });

  it("does not add a completion toast when the paste result dialog is shown", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(screen.queryByText("Pasting into Folder")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(0);

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    expect(screen.queryByRole("dialog", { name: /^Pasted \d+ of/ })).not.toBeInTheDocument();
    const updatedToastViewport = await screen.findByTestId("toast-viewport");
    const pastedToastTitle = within(updatedToastViewport).getByText("Pasted into Folder");
    const pastedToast = pastedToastTitle.closest(".toast-card");
    expect(pastedToast).not.toBeNull();
    expect(within(pastedToast as HTMLElement).getByText("“source.txt”")).toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(1);
  });

  it("moves a content selection to the tree with drag and drop", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    const dataTransfer = await dragBetween(sourceButton, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
    });
    expect(dataTransfer.setDragImage).toHaveBeenCalledTimes(1);
  });

  it("moves a content selection to a favorite with drag and drop", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesInitialized: true,
        favorites: [{ path: "/Users/demo/Folder", icon: "folder" }],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const favoriteTarget = await screen.findByTitle("favorite:/Users/demo/Folder");
    await dragBetween(sourceButton, favoriteTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
  });

  it("shows a toast when drag and drop move planning is blocked before start", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "source_missing",
            message: "Source does not exist: /Users/demo/source.txt",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: false,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(sourceButton, treeTarget);

    expect(await screen.findByText("Move couldn’t start")).toBeInTheDocument();
    expect(screen.getByText("“source.txt” no longer exists.")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("auto-starts drag moves when the only review signal is a large batch warning", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "large_batch", message: "This operation will write 200 items." }],
        requiresConfirmation: {
          largeBatch: true,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 200,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(sourceButton, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: /already exists? in/ })).not.toBeInTheDocument();
  });

  it("keeps the full content selection when dragging one selected item", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/second.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const firstSource = await screen.findByRole("button", { name: "source.txt" });
    const secondSource = await screen.findByRole("button", { name: "second.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(firstSource);
      fireEvent.click(secondSource, { metaKey: true });
    });
    await dragBetween(firstSource, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt", "/Users/demo/second.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
  });

  it("moves a content selection onto another folder row in the content pane", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const folderButton = await screen.findByRole("button", { name: "Folder" });
    await dragBetween(sourceButton, folderButton);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
  });

  it("requires review for pure folder collisions during move drag and drop", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
      },
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceFolder = await screen.findByRole("button", { name: "test3_1" });
    const targetFolder = await screen.findByRole("button", { name: "test2" });
    await dragBetween(sourceFolder, targetFolder);

    expect(await screen.findByRole("dialog", { name: /already exists? in/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Move To")).toBeNull();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    // One folder that already exists: a plain alert, with no Add Missing for a move.
    expect(screen.queryByRole("button", { name: "Add Missing" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep Both" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/test3_1"],
      destinationDirectoryPath: "/Users/demo/test2",
      // The answer is for that one item; everything else stays safe.
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "keep_both" }],
    });
  });

  it("shows the same move review for cut/paste folder collisions", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
        "/Users/demo/test2": {
          path: "/Users/demo/test2",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/test3_1");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await openDirectory("/Users/demo/test2");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("dialog", { name: /already exists? in/ })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    // One folder that already exists: a plain alert, with no Add Missing for a move.
    expect(screen.queryByRole("button", { name: "Add Missing" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep Both" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/test3_1"],
      destinationDirectoryPath: "/Users/demo/test2",
      // The answer is for that one item; everything else stays safe.
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "keep_both" }],
    });
  });

  it("shows the same move review for Move To folder collisions", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
          skippedConflictCount: 0,
        },
        canExecute: true,
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/test3_1");
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/test2" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByRole("dialog", { name: /already exists? in/ })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    // One folder that already exists: a plain alert, with no Add Missing for a move.
    expect(screen.queryByRole("button", { name: "Add Missing" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep Both" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/test3_1"],
      destinationDirectoryPath: "/Users/demo/test2",
      // The answer is for that one item; everything else stays safe.
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "keep_both" }],
    });
  });

  it("moves a search selection to the tree and reruns the active search after completion", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const searchResult = await screen.findByTitle("search:/Users/demo/source.txt");
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(searchResult, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });

      await vi.waitFor(() => {
        expect(harness.invocations.filter((call) => call.channel === "search:start")).toHaveLength(
          2,
        );
      });
    });
  });

  it("clears the search field when Escape hides results and restores it with the cached results", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    expect(searchInput.value).toBe("source");

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await vi.waitFor(() => {
      expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    });
    expect(searchInput.value).toBe("");

    await act(async () => {
      fireEvent.focus(searchInput);
    });
    await screen.findByTestId("search-results-pane");
    expect(searchInput.value).toBe("source");
  });

  it("filters the file list while typing and brings it back with Escape", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/Android", "directory"),
            createDirectoryEntry("/Users/demo/Documents", "directory"),
            createDirectoryEntry("/Users/demo/my doc.txt", "file"),
            createDirectoryEntry("/Users/demo/notes.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const contentPane = await screen.findByTestId("content-pane");
    const shownCount = () => screen.getByTestId("content-entry-count").textContent;
    const isSelected = (path: string) => screen.getByTitle(path).getAttribute("data-selected");
    const press = async (key: string) => {
      await act(async () => {
        fireEvent.keyDown(window, { key });
      });
    };
    await vi.waitFor(() => expect(shownCount()).toBe("4"));
    await act(async () => {
      fireEvent.pointerDown(contentPane);
    });

    // "d" is in three names; the one that starts with it is selected, not the first.
    await press("d");
    expect(shownCount()).toBe("3");
    expect(screen.queryByTitle("/Users/demo/notes.txt")).toBeNull();
    expect(isSelected("/Users/demo/Documents")).toBe("true");
    expect(isSelected("/Users/demo/Android")).toBe("false");

    await press("o");
    expect(shownCount()).toBe("2");
    // Space right after a character is part of the text ("my doc"), not Quick Look.
    await press("c");
    await press("Backspace");
    await press("Backspace");
    await press("Backspace");
    await press("y");
    await press(" ");
    await press("d");
    expect(shownCount()).toBe("1");
    expect(isSelected("/Users/demo/my doc.txt")).toBe("true");
    expect(harness.invocations.some((call) => call.channel === "system:quickLook")).toBe(false);

    // Text nothing matches empties the list; Backspace takes a character back.
    await press("z");
    expect(shownCount()).toBe("0");
    await press("Backspace");
    expect(shownCount()).toBe("1");

    // Escape shows the whole folder again and keeps what was found selected.
    await press("Escape");
    expect(shownCount()).toBe("4");
    expect(isSelected("/Users/demo/my doc.txt")).toBe("true");

    // With no filter, Space is Quick Look again and Backspace does nothing to the list.
    await press(" ");
    expect(harness.invocations.some((call) => call.channel === "system:quickLook")).toBe(true);
    await press("Backspace");
    expect(shownCount()).toBe("4");
  });

  it("carries the filter text into search with ⌘F", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const contentPane = await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.pointerDown(contentPane);
    });
    for (const key of ["s", "o", "u"]) {
      await act(async () => {
        fireEvent.keyDown(window, { key });
      });
    }
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    expect(searchInput.value).toBe("sou");
    await screen.findByTestId("search-results-pane");
    expect(
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query),
    ).toEqual(["sou"]);
  });

  it("searches as you type once the keyboard rests, from two characters", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    const type = async (value: string, restMs: number) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await new Promise((resolve) => setTimeout(resolve, restMs));
      });
    };

    await act(async () => {
      searchInput.focus();
    });
    // One character is not searched on its own.
    await type("s", 480);
    expect(searchQueries()).toEqual([]);
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();

    // Keys in quick succession make one search, for the text the typing stopped at.
    await type("so", 60);
    await type("sou", 60);
    expect(searchQueries()).toEqual([]);
    await type("sour", 480);
    expect(searchQueries()).toEqual(["sour"]);
    await screen.findByTestId("search-results-pane");
    expect(
      (
        harness.invocations.find((call) => call.channel === "search:start")?.payload as
          | IpcRequestInput<"search:start">
          | undefined
      )?.patternMode,
    ).toBe("text");
    // The field keeps the keyboard, so typing can go on.
    expect(document.activeElement).toBe(searchInput);

    // Return keeps what typing found and moves into the results, starting at the first.
    const form = searchInput.closest("form");
    if (!form) {
      throw new Error("Missing search form.");
    }
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(searchQueries()).toEqual(["sour"]);
    await vi.waitFor(() => {
      expect(screen.getByTitle("search:/Users/demo/source.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });

    // Text too short to search shows the folder again.
    await type("s", 60);
    await vi.waitFor(() => {
      expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    });
    expect(searchInput.value).toBe("s");
  });

  it("narrows what a search found as more is typed, without searching again", async () => {
    const harness = createAppHarness({
      searchJobs: (query) => ({
        names: ["source.txt", "sonar.txt", "notes.txt"].filter((name) => name.includes(query)),
      }),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    const resultNames = () =>
      screen
        .queryAllByTitle(/^search:/u)
        .map((row) => row.title.replace("search:/Users/demo/", ""));
    const type = async (value: string, restMs = 0) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await new Promise((resolve) => setTimeout(resolve, restMs));
      });
    };

    await act(async () => {
      searchInput.focus();
    });
    await type("so", 480);
    expect(searchQueries()).toEqual(["so"]);
    await vi.waitFor(() => expect(resultNames()).toEqual(["sonar.txt", "source.txt"]));

    // Longer text is covered by the search that ran: it is applied at once, with no wait
    // and no new search.
    await type("sou");
    expect(resultNames()).toEqual(["source.txt"]);
    // Text with no match empties the list straight away.
    await type("soup");
    expect(resultNames()).toEqual([]);
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    // Taking characters back, down to what was searched for, brings the results back.
    await type("so");
    expect(resultNames()).toEqual(["sonar.txt", "source.txt"]);
    await type("son", 480);
    expect(resultNames()).toEqual(["sonar.txt"]);
    expect(searchQueries()).toEqual(["so"]);

    // Text the search does not cover is searched for, once the typing stops.
    await type("on", 480);
    expect(searchQueries()).toEqual(["so", "on"]);
    await vi.waitFor(() => expect(resultNames()).toEqual(["sonar.txt"]));
  });

  it("never shows the results of one search under the text of another", async () => {
    const harness = createAppHarness({
      searchJobs: (query) =>
        // The second search finds nothing and takes its time over it.
        query === "zz" ? { names: [], running: true } : { names: ["source.txt", "sonar.txt"] },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const type = async (value: string, restMs = 0) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await new Promise((resolve) => setTimeout(resolve, restMs));
      });
    };
    await act(async () => {
      searchInput.focus();
    });
    await type("so", 480);
    await vi.waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));

    // Unrelated text: once its search starts, the old results are gone, although the new
    // search is still running and has found nothing.
    await type("zz", 480);
    expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(0);
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();

    // Putting the results away stops the search that was still running.
    const cancelsBefore = harness.invocations.filter(
      (call) => call.channel === "search:cancel",
    ).length;
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Escape" });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "search:cancel").length,
      ).toBeGreaterThan(cancelsBefore);
    });
    expect(
      harness.invocations.filter((call) => call.channel === "search:cancel").at(-1)?.payload,
    ).toEqual({ jobId: "search-job-2" });
  });

  it("searches for the longer text itself when the search it would narrow stopped at its limit", async () => {
    const harness = createAppHarness({
      searchJobs: (query) =>
        query === "so"
          ? { names: ["source.txt", "sonar.txt"], truncated: true }
          : { names: ["source.txt", "sound.txt"] },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    const type = async (value: string, restMs = 0) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await new Promise((resolve) => setTimeout(resolve, restMs));
      });
    };
    await act(async () => {
      searchInput.focus();
    });
    await type("so", 480);
    await vi.waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));

    // A search that stopped at its limit may have missed matches, so it cannot simply be
    // narrowed: the longer text is searched for, and found once each.
    await type("sou", 480);
    expect(searchQueries()).toEqual(["so", "sou"]);
    await vi.waitFor(() => {
      expect(screen.queryAllByTitle(/^search:/u).map((row) => row.title)).toEqual([
        "search:/Users/demo/sound.txt",
        "search:/Users/demo/source.txt",
      ]);
    });
  });

  it("forgets text typed in the search field when Escape or the ✕ is used before it is searched", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchCount = () =>
      harness.invocations.filter((call) => call.channel === "search:start").length;

    // Escape while the search is still waiting for the typing to stop.
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "source" } });
      fireEvent.keyDown(searchInput, { key: "Escape" });
      await new Promise((resolve) => setTimeout(resolve, 480));
    });
    expect(searchCount()).toBe(0);
    expect(searchInput.value).toBe("");
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();

    // The ✕ after a search: the field empties and stays empty.
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "source" } });
      await new Promise((resolve) => setTimeout(resolve, 480));
    });
    await screen.findByTestId("search-results-pane");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear file search" }));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(searchInput.value).toBe("");
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    expect(searchInput).toHaveFocus();
  });

  it("ends the search with Escape in the search field", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "source" } });
      await new Promise((resolve) => setTimeout(resolve, 480));
    });
    await screen.findByTestId("search-results-pane");

    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Escape" });
    });
    await vi.waitFor(() => {
      expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    });
    expect(searchInput.value).toBe("");
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("rejects dropping a search selection onto search results", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const searchResult = await screen.findByTitle("search:/Users/demo/source.txt");
    await dragBetween(searchResult, searchResult);

    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("rejects invalid drag targets like symlink folders and Trash favorites", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
            createDirectoryEntry("/Users/demo/Link", "symlink_directory", { isSymlink: true }),
          ],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/Link", "symlink_directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const symlinkTarget = await screen.findByRole("button", { name: "Link" });
    await dragBetween(sourceButton, symlinkTarget);
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );

    const trashFavorite = await screen.findByTitle("favorite:/Users/demo/.Trash");
    await dragBetween(sourceButton, trashFavorite);
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
  });

  it("recursively reloads expanded source branches after a move remaps the current path", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/tmp", "directory"),
            createDirectoryEntry("/Users/demo/tmp2", "directory"),
          ],
        },
        "/Users/demo/tmp": {
          path: "/Users/demo/tmp",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/tmp/test1", "directory")],
        },
        "/Users/demo/tmp/test1": {
          path: "/Users/demo/tmp/test1",
          parentPath: "/Users/demo/tmp",
          entries: [createDirectoryEntry("/Users/demo/tmp/test1/kotlin", "directory")],
        },
        "/Users/demo/tmp/test1/kotlin": {
          path: "/Users/demo/tmp/test1/kotlin",
          parentPath: "/Users/demo/tmp/test1",
          entries: [
            createDirectoryEntry("/Users/demo/tmp/test1/kotlin/composetest1", "directory"),
            createDirectoryEntry("/Users/demo/tmp/test1/kotlin/eza", "directory"),
          ],
        },
        "/Users/demo/tmp/test1/kotlin/composetest1": {
          path: "/Users/demo/tmp/test1/kotlin/composetest1",
          parentPath: "/Users/demo/tmp/test1/kotlin",
          entries: [],
        },
        "/Users/demo/tmp2": {
          path: "/Users/demo/tmp2",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/tmp2/test1", "directory")],
        },
        "/Users/demo/tmp2/test1": {
          path: "/Users/demo/tmp2/test1",
          parentPath: "/Users/demo/tmp2",
          entries: [createDirectoryEntry("/Users/demo/tmp2/test1/kotlin", "directory")],
        },
        "/Users/demo/tmp2/test1/kotlin": {
          path: "/Users/demo/tmp2/test1/kotlin",
          parentPath: "/Users/demo/tmp2/test1",
          entries: [
            createDirectoryEntry("/Users/demo/tmp2/test1/kotlin/composetest1", "directory"),
          ],
        },
        "/Users/demo/tmp2/test1/kotlin/composetest1": {
          path: "/Users/demo/tmp2/test1/kotlin/composetest1",
          parentPath: "/Users/demo/tmp2/test1/kotlin",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/tmp", "directory"),
          createTreeChild("/Users/demo/tmp2", "directory"),
        ],
        "/Users/demo/tmp": [createTreeChild("/Users/demo/tmp/test1", "directory")],
        "/Users/demo/tmp/test1": [createTreeChild("/Users/demo/tmp/test1/kotlin", "directory")],
        "/Users/demo/tmp/test1/kotlin": [
          createTreeChild("/Users/demo/tmp/test1/kotlin/composetest1", "directory"),
          createTreeChild("/Users/demo/tmp/test1/kotlin/eza", "directory"),
        ],
        "/Users/demo/tmp2": [createTreeChild("/Users/demo/tmp2/test1", "directory")],
        "/Users/demo/tmp2/test1": [createTreeChild("/Users/demo/tmp2/test1/kotlin", "directory")],
        "/Users/demo/tmp2/test1/kotlin": [
          createTreeChild("/Users/demo/tmp2/test1/kotlin/composetest1", "directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Users/demo/tmp");
    await openDirectory("/Users/demo/tmp/test1");
    await openDirectory("/Users/demo/tmp/test1/kotlin");
    await openDirectory("/Users/demo/tmp/test1/kotlin/composetest1");

    expect(screen.getByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/tmp/test1/kotlin/composetest1",
    );

    const treeLoadCountBeforeMove = harness.invocations.filter(
      (call) => call.channel === "tree:getChildren",
    ).length;

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "move_to",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: {
          operationId: "copy-op-1",
          action: "move_to",
          status: "completed",
          targetPath: "/Users/demo/tmp2",
          startedAt: "2026-03-11T00:00:00.000Z",
          finishedAt: "2026-03-11T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/tmp/test1",
              destinationPath: "/Users/demo/tmp2/test1",
              status: "completed",
              error: null,
              skipReason: null,
            },
          ],
          error: null,
        },
      } satisfies WriteOperationProgressEvent);
    });

    await vi.waitFor(() => {
      const treeLoadsAfterMove = harness.invocations
        .slice(treeLoadCountBeforeMove)
        .filter((call) => call.channel === "tree:getChildren")
        .map((call) => (call.payload as IpcRequestInput<"tree:getChildren">).path);
      expect(treeLoadsAfterMove).toEqual(
        expect.arrayContaining([
          "/Users/demo/tmp",
          "/Users/demo/tmp/test1",
          "/Users/demo/tmp/test1/kotlin",
        ]),
      );
    });
  });
});

describe("App copy/paste dialogs and destinations", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const reviewSheetName = "“Folder” already exists in “demo”";

  async function openFolderReviewSheet(
    harnessArgs: Parameters<typeof createAppHarness>[0] = {},
  ): Promise<{ harness: ReturnType<typeof createAppHarness>; sheet: HTMLElement }> {
    const harness = createAppHarness({ planResponse: folderConflictPlan(), ...harnessArgs });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });
    const sheet = await screen.findByRole("dialog", { name: reviewSheetName });
    return { harness, sheet };
  }

  // fireEvent returns false when a listener called preventDefault.
  function expectKeysReachDialog(element: HTMLElement) {
    element.focus();
    expect(element).toHaveFocus();
    for (const key of ["Tab", "Enter", " "]) {
      expect(fireEvent.keyDown(element, { key })).toBe(true);
    }
  }

  it("lets Tab, Return and Space through inside the review sheet", async () => {
    const { sheet } = await openFolderReviewSheet();

    expectKeysReachDialog(within(sheet).getByRole("button", { name: "Cancel" }));
    // Keys aimed at the explorer behind the sheet are still swallowed.
    expect(fireEvent.keyDown(window, { key: "ArrowDown" })).toBe(false);
  });

  it("closes the conflict alert with Escape while a button has focus", async () => {
    const { sheet, harness } = await openFolderReviewSheet();

    const keepBoth = within(sheet).getByRole("button", { name: "Keep Both" });
    keepBoth.focus();
    await act(async () => {
      fireEvent.keyDown(keepBoth, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog", { name: reviewSheetName })).not.toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("closes the review sheet with Cmd+. like Escape", async () => {
    const { sheet } = await openFolderReviewSheet();

    const cancelButton = within(sheet).getByRole("button", { name: "Cancel" });
    cancelButton.focus();
    await act(async () => {
      fireEvent.keyDown(cancelButton, { key: ".", metaKey: true });
    });

    expect(screen.queryByRole("dialog", { name: reviewSheetName })).not.toBeInTheDocument();
  });

  it("starts a reviewed operation once even when the start button is clicked twice", async () => {
    const { sheet, harness } = await openFolderReviewSheet({ deferCopyPasteStart: true });

    const startButton = within(sheet).getByRole("button", { name: "Keep Both" });
    await act(async () => {
      fireEvent.click(startButton);
      fireEvent.click(startButton);
    });
    await act(async () => {
      harness.resolveCopyPasteStart();
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: reviewSheetName })).not.toBeInTheDocument();
    });
    expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
      1,
    );
  });

  // Stop pressed while the start request was on its way did nothing, and the paste ran to
  // the end.
  it("stops an operation whose Stop came while it was being started", async () => {
    const { sheet, harness } = await openFolderReviewSheet({ deferCopyPasteStart: true });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Keep Both" }));
    });
    const card = await screen.findByRole("region", { name: /Duplicating/ }, { timeout: 2_000 });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Stop|Cancel/ }));
    });
    expect(harness.invocations.some((call) => call.channel === "writeOperation:cancel")).toBe(
      false,
    );

    await act(async () => {
      harness.resolveCopyPasteStart();
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:cancel")).toBe(
        true,
      );
    });
  });

  it("keeps the review sheet usable when the start fails", async () => {
    const { sheet } = await openFolderReviewSheet({
      copyPasteStartError: new Error("The analysis expired. Paste again to recheck."),
    });

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Keep Both" }));
    });

    expect(await screen.findByText("Duplicate couldn’t start")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: reviewSheetName })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(within(sheet).getByRole("button", { name: "Keep Both" })).not.toBeDisabled();
    });
  });

  it("lets keys through inside the runtime conflict alert and sends apply-to-remaining", async () => {
    const harness = createAppHarness();
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "paste",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: "/Users/demo/Folder",
        runtimeConflict: {
          conflictId: "runtime-1",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/Folder",
          destinationPath: "/Users/demo/Folder",
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          reason: "destination_changed",
          sourceFingerprint: createNodeFingerprint("directory"),
          destinationFingerprint: createNodeFingerprint("directory"),
          currentSourceFingerprint: createNodeFingerprint("directory"),
          currentDestinationFingerprint: createNodeFingerprint("directory"),
        },
        result: null,
      });
    });
    const alert = await screen.findByRole("dialog", {
      name: "“Folder” in “demo” changed while pasting",
    });

    expectKeysReachDialog(within(alert).getByRole("button", { name: "Stop Pasting" }));

    await act(async () => {
      fireEvent.click(within(alert).getByRole("checkbox"));
    });
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Keep Both" }));
    });

    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-1",
      resolution: "keep_both",
      applyToRemaining: true,
    });
  });

  it("lets keys through inside the result dialog", async () => {
    const harness = createAppHarness();
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await pasteSourceIntoFolder(harness, "c");
    await act(async () => {
      harness.emitProgress(
        failedResultEvent("copy", [
          { sourcePath: "/Users/demo/source.txt", status: "failed", error: "Disk full" },
        ]),
      );
    });

    const retryButton = await screen.findByRole("button", { name: /^Retry \d+ Items?$/ });
    expectKeysReachDialog(retryButton);
  });

  it("retries a failed folder copy without duplicating the files that already arrived", async () => {
    const harness = createAppHarness();
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await pasteSourceIntoFolder(harness, "c");
    await act(async () => {
      harness.emitProgress(
        failedResultEvent("copy", [
          { sourcePath: "/Users/demo/photos", status: "failed", error: "Disk full" },
          { sourcePath: "/Users/demo/photos/a.jpg", status: "completed", error: null },
          { sourcePath: "/Users/demo/photos/b.jpg", status: "failed", error: "Disk full" },
        ]),
      );
    });
    const startCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:start",
    ).length;

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
        startCallsBeforeRetry + 1,
      );
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
    ).toMatchObject({ sourcePaths: ["/Users/demo/photos"] });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({ policy: { file: "skip", directory: "merge", mismatch: "skip" } });
  });

  it("clears the cut items from the clipboard once a retried move moved them", async () => {
    const harness = createAppHarness({
      planResponse: cutPlan(["/Users/demo/source.txt"], "/Users/demo/Folder"),
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await pasteSourceIntoFolder(harness, "x");
    await act(async () => {
      harness.emitProgress(
        failedResultEvent("cut", [
          { sourcePath: "/Users/demo/source.txt", status: "failed", error: "Permission denied" },
        ]),
      );
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
        2,
      );
    });
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("cut", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
  });

  it("pastes into the current folder when several items are selected", async () => {
    const harness = createAppHarness();
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    // The folder is the lead item of a two-item selection.
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
    });
  });

  it("never pastes into a symlinked folder, from the keyboard or the context menu", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
            createDirectoryEntry("/Users/demo/Linked", "symlink_directory", { isSymlink: true }),
          ],
        },
      },
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Linked");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
    });

    // Let the first paste finish so the next one is not blocked as busy.
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("copy", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });
    const planCallCount = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    ).length;
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/Linked"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallCount + 1,
      );
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
    ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
  });

  it("does nothing, silently, when cut items are pasted into the folder they are in", async () => {
    const harness = createAppHarness({
      planResponse: cutPlan(["/Users/demo/source.txt"], "/Users/demo", [
        sameFolderIssue("/Users/demo/source.txt"),
      ]),
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await clearContentSelection();
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Move couldn’t start")).not.toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("still moves the other cut items when some are already in the destination folder", async () => {
    const harness = createAppHarness({
      analysisReportForRequest: (request) =>
        toAnalysisReport(
          request.sourcePaths.includes("/Users/demo/source.txt")
            ? cutPlan(request.sourcePaths, request.destinationDirectoryPath, [
                sameFolderIssue("/Users/demo/source.txt"),
              ])
            : cutPlan(request.sourcePaths, request.destinationDirectoryPath),
        ),
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await clearContentSelection();
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(
      harness.invocations
        .filter((call) => call.channel === "copyPaste:plan")
        .map((call) => (call.payload as { sourcePaths: string[] }).sourcePaths),
    ).toEqual([["/Users/demo/source.txt", "/Users/demo/Folder"], ["/Users/demo/Folder"]]);
    expect(screen.queryByText("Move couldn’t start")).not.toBeInTheDocument();
  });
});

async function pasteSourceIntoFolder(
  harness: ReturnType<typeof createAppHarness>,
  clipboardKey: "c" | "x",
): Promise<void> {
  await selectItem("/Users/demo/source.txt");
  await act(async () => {
    fireEvent.keyDown(window, { key: clipboardKey, metaKey: true });
  });
  await selectItem("/Users/demo/Folder");
  await act(async () => {
    fireEvent.keyDown(window, { key: "v", metaKey: true });
  });
  await vi.waitFor(() => {
    expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
  });
}

type TestResultItem = {
  sourcePath: string;
  status: "completed" | "failed" | "cancelled";
  error: string | null;
};

function failedResultEvent(mode: "copy" | "cut", items: TestResultItem[]): TestProgressEvent {
  return finishedResultEvent(mode, "failed", items);
}

function finishedResultEvent(
  mode: "copy" | "cut",
  status: "completed" | "failed",
  items: TestResultItem[],
): TestProgressEvent {
  const count = (itemStatus: TestResultItem["status"]) =>
    items.filter((item) => item.status === itemStatus).length;
  const summary = {
    topLevelItemCount: 1,
    totalItemCount: items.length,
    completedItemCount: count("completed"),
    failedItemCount: count("failed"),
    skippedItemCount: 0,
    cancelledItemCount: count("cancelled"),
    completedByteCount: 0,
    totalBytes: 5,
  };
  return {
    operationId: "copy-op-1",
    mode,
    status,
    completedItemCount: summary.completedItemCount,
    totalItemCount: items.length,
    completedByteCount: 0,
    totalBytes: 5,
    currentSourcePath: null,
    currentDestinationPath: null,
    result: {
      operationId: "copy-op-1",
      mode,
      status,
      destinationDirectoryPath: "/Users/demo/Folder",
      startedAt: "2026-03-09T00:00:00.000Z",
      finishedAt: "2026-03-09T00:00:01.000Z",
      summary,
      items: items.map((item) => ({
        sourcePath: item.sourcePath,
        destinationPath: `/Users/demo/Folder/${item.sourcePath.split("/").at(-1)}`,
        status: item.status,
        error: item.error,
      })),
      error: status === "failed" ? (items.find((item) => item.error)?.error ?? null) : null,
    },
  };
}

function sameFolderIssue(sourcePath: string): IpcResponse<"copyPaste:plan">["issues"][number] {
  return {
    code: "same_path",
    message: `Cannot paste ${sourcePath} onto itself.`,
    sourcePath,
    destinationPath: sourcePath,
  };
}

function cutPlan(
  sourcePaths: string[],
  destinationDirectoryPath: string,
  issues: IpcResponse<"copyPaste:plan">["issues"] = [],
): IpcResponse<"copyPaste:plan"> {
  const issuePaths = new Set(issues.map((issue) => issue.sourcePath));
  const items = sourcePaths
    .filter((sourcePath) => !issuePaths.has(sourcePath))
    .map((sourcePath) => ({
      sourcePath,
      destinationPath: `${destinationDirectoryPath}/${sourcePath.split("/").at(-1)}`,
      kind: "file" as const,
      status: "ready" as const,
      sizeBytes: 5,
    }));
  return {
    mode: "cut",
    sourcePaths,
    destinationDirectoryPath,
    conflictResolution: "error",
    items,
    conflicts: [],
    issues,
    warnings: [],
    requiresConfirmation: { largeBatch: false, cutDelete: false },
    summary: {
      topLevelItemCount: sourcePaths.length,
      totalItemCount: items.length,
      totalBytes: items.length * 5,
      skippedConflictCount: 0,
    },
    canExecute: issues.length === 0,
  };
}

function folderConflictPlan(): IpcResponse<"copyPaste:plan"> {
  return {
    mode: "copy",
    sourcePaths: ["/Users/demo/Folder"],
    destinationDirectoryPath: "/Users/demo",
    conflictResolution: "error",
    items: [
      {
        sourcePath: "/Users/demo/Folder",
        destinationPath: "/Users/demo/Folder",
        kind: "directory",
        status: "conflict",
        sizeBytes: null,
      },
    ],
    conflicts: [
      {
        sourcePath: "/Users/demo/Folder",
        destinationPath: "/Users/demo/Folder",
        reason: "destination_exists",
      },
    ],
    issues: [],
    warnings: [],
    requiresConfirmation: { largeBatch: false, cutDelete: false },
    summary: {
      topLevelItemCount: 1,
      totalItemCount: 1,
      totalBytes: null,
      skippedConflictCount: 0,
    },
    canExecute: true,
  };
}

function createAppHarness(
  args: {
    planResponse?: IpcResponse<"copyPaste:plan">;
    analysisUpdateResponse?: IpcResponse<"copyPaste:analyzeGetUpdate">;
    // Builds the finished analysis from the request, for tests where it depends on the
    // items being analyzed.
    analysisReportForRequest?: (
      request: IpcRequestInput<"copyPaste:analyzeStart">,
    ) => NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
    preferences?: Partial<IpcResponse<"app:getPreferences">["preferences"]>;
    directorySnapshots?: Record<string, IpcResponse<"directory:getSnapshot">>;
    treeChildrenByPath?: Record<string, IpcResponse<"tree:getChildren">["children"]>;
    itemPropertiesByPath?: Record<
      string,
      "missing" | NonNullable<IpcResponse<"item:getProperties">["item"]>
    >;
    copyTextError?: Error;
    pickApplicationResponse?: IpcResponse<"system:pickApplication">;
    pickDirectoryResponse?: IpcResponse<"system:pickDirectory">;
    visitedFolders?: IpcResponse<"places:list">["folders"];
    // Scripts the searches by the text searched for: the names found in /Users/demo, whether
    // the search is still running, and whether it stopped at its limit.
    searchJobs?: (query: string) => { names: string[]; running?: boolean; truncated?: boolean };
    // Reading this folder's subfolders for the tree waits until `releaseTreeChildren`.
    holdTreeChildrenFor?: string;
    // Which disk the folders under each path are on (the longest matching path wins).
    diskIds?: Record<string, number>;
    // Answers about a scripted search wait until `releaseSearchUpdates`.
    holdSearchUpdates?: boolean;
    copyPastePlanError?: Error;
    deferCopyPastePlan?: boolean;
    deferCopyPastePlanCalls?: number[];
    deferCopyPasteStart?: boolean;
    copyPasteStartError?: Error;
    openPathsWithApplicationError?: Error;
    // Thrown by the next rename requests, one each, as the main process would refuse them.
    renameErrors?: Error[];
    createFolderError?: Error;
    resolveConflictError?: Error;
    clearCachesError?: Error;
    // What a search that is not scripted finds, instead of the one source.txt.
    searchResultItems?: IpcResponse<"search:getUpdate">["items"];
    // What the Trash holds, as far as the main process can tell (null: it can't).
    trashEmpty?: boolean | null;
  } = {},
): {
  client: FiletrailClient;
  invocations: Array<{ channel: IpcChannel; payload: unknown }>;
  menuStates: Array<IpcRequestInput<"app:setMenuState">["state"]>;
  emitCommand: (command: RendererCommand) => void;
  emitProgress: (event: TestProgressEvent) => void;
  setDirectoryEntries: (
    path: string,
    entries: IpcResponse<"directory:getSnapshot">["entries"],
  ) => void;
  // The folder is gone from disk: reading it fails from now on.
  removeDirectory: (path: string) => void;
  // Holds back the listings of `path` until the returned function is called.
  holdDirectorySnapshot: (path: string) => () => void;
  releaseTreeChildren: () => void;
  releaseSearchUpdates: () => void;
  resolveCopyPastePlan: () => void;
  resolveCopyPasteStart: () => void;
} {
  let preferences = {
    ...DEFAULT_APP_PREFERENCES,
    viewMode: "details" as const,
    propertiesOpen: false,
    detailRowOpen: false,
    treeRootPath: "/Users/demo",
    lastVisitedPath: "/Users/demo",
    ...args.preferences,
  } as IpcResponse<"app:getPreferences">["preferences"];
  let visitedFolders = args.visitedFolders ?? [];
  let searchJobCount = 0;
  const searchJobQueries = new Map<string, string>();
  const directorySnapshots: Record<string, IpcResponse<"directory:getSnapshot">> = {
    "/Users/demo": {
      path: "/Users/demo",
      parentPath: "/Users",
      entries: [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ],
    },
    "/Users/demo/Folder": {
      path: "/Users/demo/Folder",
      parentPath: "/Users/demo",
      entries: [],
    },
    ...args.directorySnapshots,
  };
  const treeChildrenByPath: Record<string, IpcResponse<"tree:getChildren">["children"]> = {
    "/Users/demo": [createTreeChild("/Users/demo/Folder", "directory")],
    ...args.treeChildrenByPath,
  };
  const invocations: Array<{ channel: IpcChannel; payload: unknown }> = [];
  // What the window reports to the application menu; kept apart from the calls tests count.
  const menuStates: Array<IpcRequestInput<"app:setMenuState">["state"]> = [];
  const heldSnapshots = new Map<string, Promise<void>>();
  let releaseTreeChildren: () => void = () => undefined;
  const heldTreeChildren = new Promise<void>((resolve) => {
    releaseTreeChildren = resolve;
  });
  let releaseSearchUpdates: () => void = () => undefined;
  const heldSearchUpdates = args.holdSearchUpdates
    ? new Promise<void>((resolve) => {
        releaseSearchUpdates = resolve;
      })
    : Promise.resolve();
  // Like the worker, a search that has reported its end keeps no results to hand out again.
  const finishedSearchJobs = new Set<string>();
  let commandListener: ((command: RendererCommand) => void) | null = null;
  // Several parts of the window listen (the operation itself, folder sizes), as in the app.
  const writeOperationProgressListeners = new Set<(event: WriteOperationProgressEvent) => void>();
  let copyPasteProgressListener: ((event: WriteOperationProgressEvent) => void) | null = null;
  const resolveCopyPastePlanPromises: Array<() => void> = [];
  let copyPastePlanCallCount = 0;
  let resolveCopyPasteStartPromise: (() => void) | null = null;
  const copyPasteStartPromise =
    args.deferCopyPasteStart === true
      ? new Promise<void>((resolve) => {
          resolveCopyPasteStartPromise = resolve;
        })
      : null;
  const analysisReport = args.planResponse
    ? toAnalysisReport(args.planResponse)
    : toAnalysisReport(defaultPlanResponse());
  let lastAnalyzeRequest: IpcRequestInput<"copyPaste:analyzeStart"> | null = null;

  const client: FiletrailClient = {
    async invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>) {
      // What the main process accepts, checked as it checks it: a request it would refuse
      // fails the test instead of passing here.
      const checked = ipcContractSchemas[channel].request.safeParse(payload);
      if (!checked.success) {
        // The window catches failed requests itself, so the test hears of it afterwards.
        refusedRequests.push(`${channel}: ${checked.error.message}`);
        throw new Error(`The main process would refuse this ${channel} request.`);
      }
      if (channel === "app:setMenuState") {
        menuStates.push((payload as IpcRequestInput<"app:setMenuState">).state);
        return { ok: true } as IpcResponse<C>;
      }
      const recordedPayload =
        channel === "copyPaste:start" && "analysisId" in (payload as Record<string, unknown>)
          ? {
              ...(payload as object),
              sourcePaths: analysisReport.sourcePaths,
              destinationDirectoryPath: analysisReport.destinationDirectoryPath,
            }
          : payload;
      invocations.push({ channel, payload: recordedPayload });
      if (channel === "app:getPreferences") {
        return { preferences } as IpcResponse<C>;
      }
      if (channel === "app:getHomeDirectory") {
        return { path: "/Users/demo" } as IpcResponse<C>;
      }
      if (channel === "app:getLaunchContext") {
        return { startupFolderPath: null } as IpcResponse<C>;
      }
      if (channel === "app:updatePreferences") {
        preferences = mergePreferences(
          preferences,
          (payload as IpcRequestInput<"app:updatePreferences">).preferences,
        );
        return { preferences } as IpcResponse<C>;
      }
      if (channel === "tree:getChildren") {
        if ((payload as IpcRequestInput<"tree:getChildren">).path === args.holdTreeChildrenFor) {
          await heldTreeChildren;
        }
        return {
          path: (payload as IpcRequestInput<"tree:getChildren">).path,
          children: treeChildrenByPath[(payload as IpcRequestInput<"tree:getChildren">).path] ?? [],
        } satisfies IpcResponse<"tree:getChildren"> as IpcResponse<C>;
      }
      if (channel === "directory:getSnapshot") {
        const snapshotPath = (payload as IpcRequestInput<"directory:getSnapshot">).path;
        await heldSnapshots.get(snapshotPath);
        return directorySnapshots[snapshotPath] as IpcResponse<C>;
      }
      if (channel === "directory:getMetadataBatch") {
        return {
          directoryPath: (payload as IpcRequestInput<"directory:getMetadataBatch">).directoryPath,
          items: [],
        } satisfies IpcResponse<"directory:getMetadataBatch"> as IpcResponse<C>;
      }
      if (channel === "item:getProperties") {
        const targetPath = (payload as IpcRequestInput<"item:getProperties">).path;
        if (Object.prototype.hasOwnProperty.call(args.itemPropertiesByPath ?? {}, targetPath)) {
          const item =
            (
              (args.itemPropertiesByPath ?? {}) as Record<
                string,
                "missing" | NonNullable<IpcResponse<"item:getProperties">["item"]>
              >
            )[targetPath] ?? "missing";
          return {
            item: item === "missing" ? null : item,
          } as IpcResponse<C>;
        }
        const entry =
          Object.values(directorySnapshots)
            .flatMap((snapshot) => snapshot.entries)
            .find((candidate) => candidate.path === targetPath) ??
          Object.values(treeChildrenByPath)
            .flat()
            .find((candidate) => candidate.path === targetPath);
        const kind = entry?.kind ?? (targetPath === "/Users/demo" ? "directory" : "directory");
        const name = targetPath.split("/").at(-1) ?? targetPath;
        return {
          item: {
            path: targetPath,
            name,
            extension: kind === "file" ? (name.split(".").at(-1) ?? "") : "",
            kind,
            kindLabel: kind === "directory" ? "Folder" : "File",
            isHidden: false,
            isSymlink: entry?.isSymlink ?? false,
            createdAt: null,
            modifiedAt: null,
            sizeBytes: null,
            sizeStatus: "ready",
            permissionMode: null,
          },
        } satisfies IpcResponse<"item:getProperties"> as IpcResponse<C>;
      }
      if (channel === "copyPaste:plan") {
        copyPastePlanCallCount += 1;
        if (
          args.deferCopyPastePlan === true ||
          args.deferCopyPastePlanCalls?.includes(copyPastePlanCallCount)
        ) {
          await new Promise<void>((resolve) => {
            resolveCopyPastePlanPromises.push(resolve);
          });
        }
        // Explicit thrown planner failures intentionally win over canned terminal updates.
        if (args.copyPastePlanError) {
          throw args.copyPastePlanError;
        }
        return (args.planResponse ?? defaultPlanResponse()) as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeStart") {
        lastAnalyzeRequest = payload as IpcRequestInput<"copyPaste:analyzeStart">;
        invocations.push({
          channel: "copyPaste:plan",
          payload: {
            mode: (payload as IpcRequestInput<"copyPaste:analyzeStart">).mode,
            sourcePaths: (payload as IpcRequestInput<"copyPaste:analyzeStart">).sourcePaths,
            destinationDirectoryPath: (payload as IpcRequestInput<"copyPaste:analyzeStart">)
              .destinationDirectoryPath,
            conflictResolution: "error",
            action: (payload as IpcRequestInput<"copyPaste:analyzeStart">).action,
          },
        });
        return { analysisId: "analysis-1", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeGetUpdate") {
        copyPastePlanCallCount += 1;
        if (
          args.deferCopyPastePlan === true ||
          args.deferCopyPastePlanCalls?.includes(copyPastePlanCallCount)
        ) {
          await new Promise<void>((resolve) => {
            resolveCopyPastePlanPromises.push(resolve);
          });
        }
        if (args.copyPastePlanError) {
          throw args.copyPastePlanError;
        }
        return (args.analysisUpdateResponse ?? {
          analysisId: "analysis-1",
          status: "complete",
          done: true,
          report:
            args.analysisReportForRequest && lastAnalyzeRequest
              ? args.analysisReportForRequest(lastAnalyzeRequest)
              : analysisReport,
          error: null,
        }) as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeCancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "copyPaste:start") {
        if (copyPasteStartPromise) {
          await copyPasteStartPromise;
        }
        if (args.copyPasteStartError) {
          throw args.copyPasteStartError;
        }
        return { operationId: "copy-op-1", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "copyPaste:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "copyPaste:resolveConflict") {
        if (args.resolveConflictError) {
          throw args.resolveConflictError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "writeOperation:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "writeOperation:createFolder") {
        if (args.createFolderError) {
          throw args.createFolderError;
        }
        return { operationId: "write-op-folder", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "writeOperation:rename") {
        const renameError = args.renameErrors?.shift();
        if (renameError) {
          throw renameError;
        }
        return { operationId: "write-op-rename", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "writeOperation:trash") {
        return { operationId: "write-op-trash", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "system:getTrashState") {
        return { empty: args.trashEmpty ?? null } as IpcResponse<C>;
      }
      if (channel === "writeOperation:deleteImmediately") {
        return { operationId: "write-op-delete", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "path:resolve") {
        return {
          inputPath: (payload as IpcRequestInput<"path:resolve">).path,
          resolvedPath: (payload as IpcRequestInput<"path:resolve">).path,
        } satisfies IpcResponse<"path:resolve"> as IpcResponse<C>;
      }
      if (channel === "path:getSuggestions") {
        return {
          inputPath: (payload as IpcRequestInput<"path:getSuggestions">).inputPath,
          basePath: null,
          suggestions: [],
        } satisfies IpcResponse<"path:getSuggestions"> as IpcResponse<C>;
      }
      if (channel === "search:start") {
        const request = payload as IpcRequestInput<"search:start">;
        searchJobCount += 1;
        const jobId = args.searchJobs ? `search-job-${searchJobCount}` : "search-job-1";
        searchJobQueries.set(jobId, request.query);
        return { jobId, status: "running" } as IpcResponse<C>;
      }
      if (channel === "search:getUpdate" && args.searchJobs) {
        // A scripted search: which names it finds, and whether it has finished.
        const { jobId, cursor = 0 } = payload as IpcRequestInput<"search:getUpdate">;
        const job = args.searchJobs(searchJobQueries.get(jobId) ?? "");
        const items =
          cursor === 0 && !finishedSearchJobs.has(jobId)
            ? job.names.map((name) => createSearchResult(name))
            : [];
        const running = job.running === true;
        if (!running) {
          finishedSearchJobs.add(jobId);
        }
        await heldSearchUpdates;
        return {
          jobId,
          status: running ? "running" : job.truncated ? "truncated" : "complete",
          items,
          nextCursor: cursor + items.length,
          done: !running,
          truncated: job.truncated === true,
          error: null,
        } satisfies IpcResponse<"search:getUpdate"> as IpcResponse<C>;
      }
      if (channel === "search:getUpdate") {
        return {
          jobId: "search-job-1",
          status: "complete",
          items: args.searchResultItems ?? [
            {
              path: "/Users/demo/source.txt",
              name: "source.txt",
              extension: "txt",
              kind: "file",
              isHidden: false,
              isSymlink: false,
              parentPath: "/Users/demo",
              relativeParentPath: ".",
            },
          ],
          nextCursor: args.searchResultItems?.length ?? 1,
          done: true,
          truncated: false,
          error: null,
        } satisfies IpcResponse<"search:getUpdate"> as IpcResponse<C>;
      }
      if (channel === "search:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "system:openPath") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:pickApplication") {
        return (args.pickApplicationResponse ?? {
          canceled: false,
          appPath: "/Applications/Other.app",
          appName: "Other",
        }) as IpcResponse<C>;
      }
      if (channel === "system:pickDirectory") {
        return (args.pickDirectoryResponse ?? {
          canceled: false,
          path: "/Users/demo/Folder",
        }) as IpcResponse<C>;
      }
      if (channel === "system:openPathsWithApplication") {
        if (args.openPathsWithApplicationError) {
          throw args.openPathsWithApplicationError;
        }
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:openInTerminal") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:copyText") {
        if (args.copyTextError) {
          throw args.copyTextError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "system:performEditAction") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "app:clearCaches") {
        if (args.clearCachesError) {
          throw args.clearCachesError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "places:list") {
        return { folders: visitedFolders } as IpcResponse<C>;
      }
      if (channel === "places:recordVisit") {
        const { path } = payload as IpcRequestInput<"places:recordVisit">;
        const existing = visitedFolders.find((folder) => folder.path === path);
        visitedFolders = [
          { path, visitCount: (existing?.visitCount ?? 0) + 1, lastVisitedAt: Date.now() },
          ...visitedFolders.filter((folder) => folder.path !== path),
        ];
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "places:forget") {
        const { path } = payload as IpcRequestInput<"places:forget">;
        visitedFolders = visitedFolders.filter((folder) => folder.path !== path);
        return { folders: visitedFolders } as IpcResponse<C>;
      }
      if (channel === "app:writeLog") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "system:emptyTrash") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:getDiskIds") {
        // Which disk each folder is on: as given, else the disk its path names.
        const { paths } = payload as IpcRequestInput<"system:getDiskIds">;
        return {
          ids: paths.map(
            (path) =>
              Object.entries(args.diskIds ?? {})
                .filter(([root]) => path === root || path.startsWith(`${root}/`))
                .sort(([left], [right]) => right.length - left.length)[0]?.[1] ??
              /^\/Volumes\/[^/]+/.exec(path)?.[0].length ??
              1,
          ),
        } as IpcResponse<C>;
      }
      throw new Error(`Unhandled channel in test harness: ${channel}`);
    },
    async log() {
      return undefined;
    },
    onCommand(listener) {
      commandListener = listener;
      return () => {
        if (commandListener === listener) {
          commandListener = null;
        }
      };
    },
    onWriteOperationProgress(listener) {
      writeOperationProgressListeners.add(listener);
      return () => {
        writeOperationProgressListeners.delete(listener);
      };
    },
    onCopyPasteProgress(listener) {
      copyPasteProgressListener = listener;
      return () => {
        if (copyPasteProgressListener === listener) {
          copyPasteProgressListener = null;
        }
      };
    },
  };

  return {
    client,
    invocations,
    menuStates,
    emitCommand(command) {
      commandListener?.(command);
    },
    emitProgress(event) {
      if ("mode" in event) {
        const action = event.action ?? (event.mode === "cut" ? "move_to" : "paste");
        const normalizedEvent: WriteOperationProgressEvent = {
          operationId: event.operationId,
          action,
          status: event.status,
          completedItemCount: event.completedItemCount,
          totalItemCount: event.totalItemCount,
          completedByteCount: event.completedByteCount,
          totalBytes: event.totalBytes,
          currentSourcePath: event.currentSourcePath,
          currentDestinationPath: event.currentDestinationPath,
          result: event.result
            ? {
                operationId: event.result.operationId,
                action,
                status: event.result.status,
                targetPath: event.result.destinationDirectoryPath,
                startedAt: event.result.startedAt,
                finishedAt: event.result.finishedAt,
                summary: event.result.summary,
                items: event.result.items,
                error: event.result.error,
              }
            : null,
        };
        for (const listener of writeOperationProgressListeners) {
          listener(normalizedEvent);
        }
        copyPasteProgressListener?.(normalizedEvent);
        return;
      }
      for (const listener of writeOperationProgressListeners) {
        listener(event);
      }
    },
    setDirectoryEntries(path, entries) {
      const snapshot = directorySnapshots[path];
      if (!snapshot) {
        throw new Error(`Unknown directory snapshot path: ${path}`);
      }
      directorySnapshots[path] = {
        ...snapshot,
        entries,
      };
    },
    removeDirectory(path) {
      delete directorySnapshots[path];
    },
    holdDirectorySnapshot(path) {
      let release: () => void = () => undefined;
      heldSnapshots.set(
        path,
        new Promise<void>((resolve) => {
          release = () => {
            heldSnapshots.delete(path);
            resolve();
          };
        }),
      );
      return () => release();
    },
    releaseTreeChildren() {
      releaseTreeChildren();
    },
    releaseSearchUpdates() {
      releaseSearchUpdates();
    },
    resolveCopyPastePlan() {
      resolveCopyPastePlanPromises.shift()?.();
    },
    resolveCopyPasteStart() {
      resolveCopyPasteStartPromise?.();
    },
  };
}

async function selectItem(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.click(button);
  });
}

// New Folder inside another folder: from that folder's own menu (⇧⌘N makes it in the
// folder on screen).
async function openNewFolderFromFolderMenu(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.contextMenu(button);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^New Folder/ }));
  });
}

function createMockDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((format?: string) => {
      if (format) {
        store.delete(format);
        return;
      }
      store.clear();
    }),
    getData: vi.fn((format: string) => store.get(format) ?? ""),
    setData: vi.fn((format: string, value: string) => {
      store.set(format, value);
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

async function dragBetween(source: HTMLElement, target: HTMLElement): Promise<DataTransfer> {
  const dataTransfer = createMockDataTransfer();
  await act(async () => {
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragEnd(source, { dataTransfer });
  });
  return dataTransfer;
}

async function focusTreePane(): Promise<void> {
  const treePane = await screen.findByTestId("tree-pane");
  await act(async () => {
    fireEvent.click(treePane);
  });
}

async function clearContentSelection(): Promise<void> {
  const backgroundButton = await screen.findByTestId("content-pane-background");
  await act(async () => {
    fireEvent.click(backgroundButton);
  });
}

async function openDirectory(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.doubleClick(button);
  });
  await vi.waitFor(() => {
    expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
  });
}

async function openSearchResults(): Promise<void> {
  const searchInput = await screen.findByPlaceholderText("Search");
  const form = searchInput.closest("form");
  if (!form) {
    throw new Error("Missing search form.");
  }
  await act(async () => {
    fireEvent.change(searchInput, { target: { value: "source" } });
    fireEvent.submit(form);
  });
  await screen.findByTestId("search-results-pane");
}

function expectNativeEditActions(
  harness: ReturnType<typeof createAppHarness>,
  actions: Array<"cut" | "copy" | "paste" | "selectAll">,
): void {
  expect(
    harness.invocations
      .filter((call) => call.channel === "system:performEditAction")
      .map((call) => (call.payload as IpcRequestInput<"system:performEditAction">).action),
  ).toEqual(actions);
}

// The toolbar's clipboard button is there exactly while files or folders wait to be pasted.
function clipboardButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^Clipboard: / });
}

// The names the clipboard's list shows, as the Show Clipboard command opens it.
async function expectClipboardListing(
  harness: ReturnType<typeof createAppHarness>,
  names: string[],
): Promise<void> {
  await act(async () => {
    harness.emitCommand({ type: "showClipboard" });
  });
  const menu = screen.getByRole("menu", { name: "Clipboard" });
  for (const name of names) {
    expect(within(menu).getByText(name)).toBeInTheDocument();
  }
  expect(within(menu).queryByText("source.txt")).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
}

function expectNoFileClipboardActions(harness: ReturnType<typeof createAppHarness>): void {
  expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(false);
  expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
}

function createSearchResult(name: string): IpcResponse<"search:getUpdate">["items"][number] {
  const dotIndex = name.lastIndexOf(".");
  return {
    path: `/Users/demo/${name}`,
    name,
    extension: dotIndex > 0 ? name.slice(dotIndex + 1) : "",
    kind: "file",
    isHidden: false,
    isSymlink: false,
    parentPath: "/Users/demo",
    relativeParentPath: ".",
  };
}

function createDirectoryEntry(
  path: string,
  kind: IpcResponse<"directory:getSnapshot">["entries"][number]["kind"],
  options: {
    isSymlink?: boolean;
  } = {},
): IpcResponse<"directory:getSnapshot">["entries"][number] {
  const name = path.split("/").at(-1) ?? path;
  const extension =
    kind === "file"
      ? (() => {
          const dotIndex = name.lastIndexOf(".");
          return dotIndex > 0 ? name.slice(dotIndex + 1) : "";
        })()
      : "";
  return {
    path,
    name,
    extension,
    kind,
    isHidden: false,
    isSymlink: options.isSymlink ?? false,
  };
}

function defaultPlanResponse(): IpcResponse<"copyPaste:plan"> {
  return {
    mode: "copy",
    sourcePaths: ["/Users/demo/source.txt"],
    destinationDirectoryPath: "/Users/demo/Folder",
    conflictResolution: "error",
    items: [
      {
        sourcePath: "/Users/demo/source.txt",
        destinationPath: "/Users/demo/Folder/source.txt",
        kind: "file",
        status: "ready",
        sizeBytes: 5,
      },
    ],
    conflicts: [],
    issues: [],
    warnings: [],
    requiresConfirmation: {
      largeBatch: false,
      cutDelete: false,
    },
    summary: {
      topLevelItemCount: 1,
      totalItemCount: 1,
      totalBytes: 5,
      skippedConflictCount: 0,
    },
    canExecute: true,
  };
}

function toAnalysisReport(
  plan: IpcResponse<"copyPaste:plan">,
): NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]> {
  const fileConflictCount = plan.items.filter(
    (item) => item.status === "conflict" && item.kind !== "directory",
  ).length;
  const directoryConflictCount = plan.items.filter(
    (item) => item.status === "conflict" && item.kind === "directory",
  ).length;
  return {
    analysisId: "analysis-1",
    mode: plan.mode,
    sourcePaths: plan.sourcePaths,
    destinationDirectoryPath: plan.destinationDirectoryPath,
    nodes: plan.items.map((item, index) => ({
      id: `item-${index + 1}`,
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      sourceKind: item.kind,
      destinationKind:
        item.status === "conflict"
          ? item.kind === "directory"
            ? "directory"
            : item.kind
          : "missing",
      disposition: item.status === "ready" ? "new" : item.status,
      conflictClass:
        item.status === "conflict"
          ? item.kind === "directory"
            ? "directory_conflict"
            : "file_conflict"
          : null,
      sourceFingerprint: {
        exists: true,
        kind: item.kind,
        size: item.sizeBytes,
        mtimeMs: 1,
        mode: 0o644,
        ino: null,
        dev: null,
        symlinkTarget: null,
      },
      destinationFingerprint: {
        exists: item.status === "conflict",
        kind:
          item.status === "conflict"
            ? item.kind === "directory"
              ? "directory"
              : item.kind
            : "missing",
        size: item.status === "conflict" ? item.sizeBytes : null,
        mtimeMs: item.status === "conflict" ? 1 : null,
        mode: item.status === "conflict" ? 0o644 : null,
        ino: null,
        dev: null,
        symlinkTarget: null,
      },
      children: [],
      issueCode: null,
      issueMessage: null,
      totalNodeCount: 1,
      conflictNodeCount: item.status === "conflict" ? 1 : 0,
      destinationTotalNodeCount: item.status === "conflict" && item.kind === "directory" ? 0 : null,
      keepBothDestinationPath: null,
      destinationOnly: null,
      replaceBlockedReason: null,
    })),
    issues: plan.issues,
    warnings: plan.warnings,
    summary: {
      topLevelItemCount: plan.summary.topLevelItemCount,
      totalNodeCount: plan.summary.totalItemCount,
      totalBytes: plan.summary.totalBytes,
      fileConflictCount,
      directoryConflictCount,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

function createNodeFingerprint(kind: "missing" | "file" | "directory" | "symlink"): {
  exists: boolean;
  kind: "missing" | "file" | "directory" | "symlink";
  size: number | null;
  mtimeMs: number | null;
  mode: number | null;
  ino: number | null;
  dev: number | null;
  symlinkTarget: string | null;
} {
  return {
    exists: kind !== "missing",
    kind,
    size: kind === "file" ? 5 : null,
    mtimeMs: kind === "missing" ? null : 1,
    mode: kind === "missing" ? null : 0o755,
    ino: null,
    dev: null,
    symlinkTarget: null,
  };
}

describe("App tabs", () => {
  const tabLabels = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);
  const activeTabLabel = () =>
    screen.queryAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")
      ?.textContent;

  async function renderApp(harness: ReturnType<typeof createAppHarness>) {
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByRole("button", { name: "source.txt" });
  }

  async function pressKey(init: KeyboardEventInit) {
    await act(async () => {
      fireEvent.keyDown(window, init);
    });
  }

  it("shows no tab strip with a single view, and one once a second tab opens", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    await pressKey({ key: "t", metaKey: true });

    expect(tabLabels()).toEqual(["demo", "demo"]);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");

    await pressKey({ key: "w", metaKey: true });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("closes the window with Cmd+W when a single view is left", async () => {
    const harness = createAppHarness();
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => undefined);
    await renderApp(harness);

    await pressKey({ key: "w", metaKey: true });

    expect(closeWindow).toHaveBeenCalledTimes(1);
    closeWindow.mockRestore();
  });

  it("gives each tab its own folder, selection and history", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "t", metaKey: true });
    // The new tab starts on the same folder with nothing selected and nowhere to go back to.
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "false");
    await openDirectory("/Users/demo/Folder");
    expect(tabLabels()).toEqual(["demo", "Folder"]);

    await pressKey({ key: "Tab", ctrlKey: true });

    expect(activeTabLabel()).toBe("demo");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    expect(await screen.findByTitle("/Users/demo/source.txt")).toHaveAttribute(
      "data-selected",
      "true",
    );

    await pressKey({ key: "Tab", ctrlKey: true, shiftKey: true });

    expect(activeTabLabel()).toBe("Folder");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    // Back leads to the folder the tab was opened on.
    await pressKey({ key: "[", metaKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    expect(tabLabels()).toEqual(["demo", "demo"]);
  });

  it("gives the keyboard back to the pane each tab had it in", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    const focusedPane = () =>
      screen.getByTestId("tree-focused").textContent === "true"
        ? "tree"
        : screen.getByTestId("content-focused").textContent === "true"
          ? "content"
          : null;
    // The first tab is left with the keyboard in the folder tree, the second in the list.
    await focusTreePane();
    await pressKey({ key: "t", metaKey: true });
    await selectItem("/Users/demo/source.txt");
    expect(focusedPane()).toBe("content");

    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(focusedPane()).toBe("tree"));

    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(focusedPane()).toBe("content"));
  });

  it("keeps a navigation that is still filling in the tree out of a tab opened meanwhile", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/Folder/Deep", "directory")],
        },
        "/Users/demo/Folder/Deep": {
          path: "/Users/demo/Folder/Deep",
          parentPath: "/Users/demo/Folder",
          entries: [],
        },
      },
      holdTreeChildrenFor: "/Users/demo/Folder",
    });
    await renderApp(harness);
    const currentPath = () => screen.getByTestId("content-current-path").textContent;
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder"));
    });
    await waitFor(() => expect(currentPath()).toBe("/Users/demo/Folder"));

    // The folder is on screen; the tree is still waiting for the folders above it.
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder/Deep"));
    });
    await waitFor(() => expect(currentPath()).toBe("/Users/demo/Folder/Deep"));
    await pressKey({ key: "t", metaKey: true });
    await act(async () => {
      harness.releaseTreeChildren();
    });

    // The new tab has no history of its own to go back through.
    expect(tabLabels()).toEqual(["Deep", "Deep"]);
    await pressKey({ key: "[", metaKey: true });
    expect(currentPath()).toBe("/Users/demo/Folder/Deep");

    // The tab that navigated kept its history: Back leads to the folder it came from.
    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(activeTabLabel()).toBe("Deep"));
    await pressKey({ key: "[", metaKey: true });
    await waitFor(() => expect(currentPath()).toBe("/Users/demo/Folder"));
  });

  it("reads a tab's folder again when the tab comes back on screen", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");

    // Something else changes the first tab's folder while it is in the background.
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/arrived.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    });

    expect(await screen.findByTitle("/Users/demo/arrived.txt")).toBeInTheDocument();
  });

  it("keeps hidden files and Folders First for each tab", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    const folderReads = () =>
      harness.invocations
        .filter((call) => call.channel === "directory:getSnapshot")
        .map((call) => call.payload as IpcRequestInput<"directory:getSnapshot">);
    const treeReads = () =>
      harness.invocations
        .filter((call) => call.channel === "tree:getChildren")
        .map((call) => call.payload as IpcRequestInput<"tree:getChildren">);

    // The second tab shows hidden files; the first tab never did.
    await pressKey({ key: ".", metaKey: true, shiftKey: true });
    await waitFor(() =>
      expect(folderReads().at(-1)).toMatchObject({
        path: "/Users/demo/Folder",
        includeHidden: true,
      }),
    );
    const foldersBefore = folderReads().length;
    const treesBefore = treeReads().length;
    await pressKey({ key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(folderReads().slice(foldersBefore)).toContainEqual(
        expect.objectContaining({ path: "/Users/demo", includeHidden: false }),
      ),
    );
    expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/);
    // Its tree was read without hidden files, and is not read again with them.
    expect(
      treeReads()
        .slice(treesBefore)
        .some((request) => request.includeHidden),
    ).toBe(false);

    // Back in the second tab, hidden files show again.
    const foldersAfter = folderReads().length;
    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() =>
      expect(folderReads().slice(foldersAfter)).toContainEqual(
        expect.objectContaining({ path: "/Users/demo/Folder", includeHidden: true }),
      ),
    );
  });

  it("starts a new tab with the hidden files and Folders First of the tab it came from", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: ".", metaKey: true, shiftKey: true });
    await waitFor(() =>
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "directory:getSnapshot" &&
            (call.payload as IpcRequestInput<"directory:getSnapshot">).includeHidden,
        ),
      ).toBe(true),
    );

    await pressKey({ key: "t", metaKey: true });
    const reads = harness.invocations.length;
    await openDirectory("/Users/demo/Folder");

    expect(
      harness.invocations
        .slice(reads)
        .filter((call) => call.channel === "directory:getSnapshot")
        .at(-1)?.payload,
    ).toMatchObject({ path: "/Users/demo/Folder", includeHidden: true, foldersFirst: true });
  });

  it("opens the nearest folder that still exists when a tab's folder is gone", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openDirectory("/Users/demo/Folder");
    await pressKey({ key: "t", metaKey: true });
    await pressKey({ key: "ArrowUp", metaKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    expect(tabLabels()).toEqual(["Folder", "demo"]);

    // The first tab's folder is removed while the tab is in the background.
    harness.removeDirectory("/Users/demo/Folder");
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
    ]);
    await pressKey({ key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    expect(tabLabels()).toEqual(["demo", "demo"]);
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("pastes into one tab what was copied in another", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    expect(clipboardButton()).toBeNull();
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });

    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    // The copied item is in the other tab; the toolbar still says it is there to paste.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    await clearContentSelection();
    await pressKey({ key: "v", metaKey: true });

    await waitFor(() =>
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
      }),
    );
  });

  it("shows a running operation in every tab and selects what arrived only where it started", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    // Two tabs on the same folder; the paste is started in the second.
    await pressKey({ key: "t", metaKey: true });
    await clearContentSelection();
    await pressKey({ key: "v", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await pressKey({ key: "Tab", ctrlKey: true });

    expect(activeTabLabel()).toBe("Folder");
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();

    harness.setDirectoryEntries("/Users/demo/Folder", [
      createDirectoryEntry("/Users/demo/Folder/source.txt", "file"),
    ]);
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("copy", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });

    // The tab on screen shows what arrived, but its selection is left alone.
    expect(await screen.findByTitle("/Users/demo/Folder/source.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
  });

  it("keeps a tab's search while another tab is in front", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openSearchResults();
    await waitFor(() => expect(screen.getByTestId("search-results-pane")).toBeInTheDocument());

    await pressKey({ key: "t", metaKey: true });

    // The new tab shows the folder, with an empty search field.
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("");
    expect(tabLabels()).toEqual(["“source” in demo", "demo"]);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    });

    expect(await screen.findByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("source");
    expect(harness.invocations.filter((call) => call.channel === "search:cancel")).toHaveLength(0);
  });

  it("notices when a search finishes in a background tab, and has its results on return", async () => {
    let finished = false;
    const harness = createAppHarness({
      searchJobs: () =>
        finished ? { names: ["source.txt", "sonar.txt"] } : { names: [], running: true },
    });
    await renderApp(harness);
    await openSearchResults();
    await pressKey({ key: "t", metaKey: true });
    const searchingTabs = () => document.querySelectorAll(".tab-strip-search.searching").length;
    expect(tabLabels()).toEqual(["“source” in demo", "demo"]);
    expect(searchingTabs()).toBe(1);
    const updatesBefore = harness.invocations.filter(
      (call) => call.channel === "search:getUpdate",
    ).length;

    // The search ends while its tab is in the background.
    finished = true;
    await waitFor(() => expect(searchingTabs()).toBe(0), { timeout: 3000 });

    // Once it has ended there is nothing left to ask about.
    const updatesWhenDone = harness.invocations.filter(
      (call) => call.channel === "search:getUpdate",
    ).length;
    expect(updatesWhenDone).toBeGreaterThan(updatesBefore);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(harness.invocations.filter((call) => call.channel === "search:getUpdate")).toHaveLength(
      updatesWhenDone,
    );

    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));
    expect(harness.invocations.filter((call) => call.channel === "search:start")).toHaveLength(1);
  });

  it("searches again when the last answer of a search was lost by leaving its tab", async () => {
    const harness = createAppHarness({
      searchJobs: () => ({ names: ["source.txt", "sonar.txt"] }),
      holdSearchUpdates: true,
    });
    await renderApp(harness);
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "so" } });
      fireEvent.submit(searchInput.closest("form") as HTMLFormElement);
    });
    await waitFor(() =>
      expect(harness.invocations.map((call) => call.channel)).toContain("search:getUpdate"),
    );

    // The tab is left while the answer that carries the results is on its way. The worker
    // has let go of them by the time the tab is back.
    await act(async () => {
      harness.emitCommand({ type: "newTab" });
    });
    await act(async () => {
      harness.releaseSearchUpdates();
    });
    await act(async () => {
      harness.emitCommand({ type: "selectNextTab" });
    });

    await waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));
    expect(harness.invocations.filter((call) => call.channel === "search:start")).toHaveLength(2);
  });

  it("searches for what was being typed when the tab was left, once the tab is back", async () => {
    const harness = createAppHarness({
      searchJobs: () => ({ names: ["source.txt"] }),
    });
    await renderApp(harness);
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "sou" } });
    });

    // Another tab is opened before the keyboard has rested: nothing is searched there.
    await act(async () => {
      harness.emitCommand({ type: "newTab" });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(searchQueries()).toEqual([]);

    await act(async () => {
      harness.emitCommand({ type: "selectNextTab" });
    });
    expect(searchInput.value).toBe("sou");
    await waitFor(() => expect(searchQueries()).toEqual(["sou"]), { timeout: 2000 });
  });

  it("closes a background tab from its close button and keeps the tab on screen", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close demo" }));
    });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
  });

  const savedTab = (path: string) => ({
    path,
    treeRootPath: "/Users/demo",
    favoritePath: null,
    viewMode: "details" as const,
    sortBy: "name" as const,
    sortDirection: "asc" as const,
    includeHidden: false,
    foldersFirst: true,
  });

  it("reopens the tabs that were open, reading each folder when its tab is shown", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 0,
      },
    });
    await renderApp(harness);

    expect(tabLabels()).toEqual(["demo", "Folder"]);
    expect(activeTabLabel()).toBe("demo");
    // The tab in the background has not been read.
    const snapshotRequests = () =>
      harness.invocations
        .filter((call) => call.channel === "directory:getSnapshot")
        .map((call) => (call.payload as { path: string }).path);
    expect(snapshotRequests()).not.toContain("/Users/demo/Folder");

    await pressKey({ key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(snapshotRequests()).toContain("/Users/demo/Folder");
    // Restoring a tab is not a visit for the Go To box.
    expect(
      harness.invocations.filter((call) => call.channel === "places:recordVisit"),
    ).toHaveLength(0);
  });

  it("keeps the tab on screen until the window has read its first folder", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 0,
      },
      holdTreeChildrenFor: "/Users/demo",
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await waitFor(() =>
      expect(harness.invocations.map((call) => call.channel)).toContain("tree:getChildren"),
    );

    // The startup is still filling in the first tab: the shortcut does nothing yet.
    await pressKey({ key: "Tab", ctrlKey: true });
    await act(async () => {
      harness.releaseTreeChildren();
    });

    await screen.findByRole("button", { name: "source.txt" });
    expect(activeTabLabel()).toBe("demo");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/);
    await pressKey({ key: "Tab", ctrlKey: true });
    expect(activeTabLabel()).toBe("Folder");
  });

  it("drops a restored tab whose folder no longer exists", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Gone")],
        activeTabIndex: 0,
      },
      itemPropertiesByPath: { "/Users/demo/Gone": "missing" },
    });
    await renderApp(harness);

    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument());
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("opens a single view at home when the last session is not reopened", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: false,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 1,
      },
    });
    await renderApp(harness);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("hands the open tabs over to be saved", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");

    await waitFor(() => {
      const saved: Record<string, unknown> = Object.assign(
        {},
        ...harness.invocations
          .filter((call) => call.channel === "app:updatePreferences")
          .map((call) => (call.payload as { preferences: Record<string, unknown> }).preferences),
      );
      expect(saved.activeTabIndex).toBe(1);
      expect(saved.openTabs).toEqual([
        { ...savedTab("/Users/demo") },
        { ...savedTab("/Users/demo/Folder") },
      ]);
    });
  });

  it("opens a folder in a new tab with Cmd-double-click and from its menu", async () => {
    const harness = createAppHarness();
    await renderApp(harness);

    // Tabs carry their folder as a tooltip too, so the folder is looked up in the list.
    const listItem = (path: string) => within(screen.getByTestId("content-pane")).getByTitle(path);
    await act(async () => {
      fireEvent.doubleClick(listItem("/Users/demo/Folder"), { metaKey: true });
    });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(tabLabels()).toEqual(["demo", "Folder"]);
    expect(activeTabLabel()).toBe("Folder");
    // Opening a folder in a new tab is a visit, like opening it in place.
    expect(
      harness.invocations.findLast((call) => call.channel === "places:recordVisit")?.payload,
    ).toEqual({ path: "/Users/demo/Folder" });

    // Back in the first tab, the folder's menu offers the same; a file's menu does not.
    await pressKey({ key: "Tab", ctrlKey: true });
    await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.contextMenu(listItem("/Users/demo/source.txt"));
    });
    expect(screen.queryByRole("button", { name: "Open in New Tab" })).not.toBeInTheDocument();
    await pressKey({ key: "Escape" });
    await act(async () => {
      fireEvent.contextMenu(listItem("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in New Tab" }));
    });

    await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder", "Folder"]));
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("reopens the tab that was closed last, at its folder", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    await pressKey({ key: "w", metaKey: true });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    await pressKey({ key: "T", metaKey: true, shiftKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(tabLabels()).toEqual(["demo", "Folder"]);
    expect(activeTabLabel()).toBe("Folder");
    // There is nothing more to bring back.
    await pressKey({ key: "T", metaKey: true, shiftKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("closes the other tabs and duplicates a tab from the tab's menu", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    const openTabMenu = async (index: number) => {
      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[index] as HTMLElement);
      });
    };

    await openTabMenu(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Tab" }));
    });

    // The copy sits next to the tab it was made from and is on screen.
    await waitFor(() => expect(tabLabels()).toEqual(["demo", "demo", "Folder"]));
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );

    await openTabMenu(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Close Other Tabs" }));
    });

    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument());
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
  });

  it("moves what is dropped on a tab into that tab's folder", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    await pressKey({ key: "Tab", ctrlKey: true });
    const source = await within(screen.getByTestId("content-pane")).findByTitle(
      "/Users/demo/source.txt",
    );
    const [ownTab, folderTab] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];

    // The tab of the folder the item is already in does not take it.
    await dragBetween(source, ownTab);
    expect(harness.invocations.map((call) => call.channel)).not.toContain("copyPaste:analyzeStart");

    await dragBetween(source, folderTab);

    await waitFor(() =>
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
      }),
    );
  });

  it("leaves the tab on screen alone while a dialog is open", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await act(async () => {
      harness.emitCommand({ type: "openLocationSheet" });
    });

    await act(async () => {
      harness.emitCommand({ type: "selectNextTab" });
      harness.emitCommand({ type: "newTab" });
      harness.emitCommand({ type: "closeTab" });
    });

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });
});

describe("App keyboard shortcuts", () => {
  async function renderApp(harness: ReturnType<typeof createAppHarness>) {
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByRole("button", { name: "source.txt" });
  }

  async function pressKey(init: KeyboardEventInit, target: Window | Element = window) {
    await act(async () => {
      fireEvent.keyDown(target, init);
    });
  }

  it("runs a command on the key it was given in Settings, and no longer on the old one", async () => {
    const harness = createAppHarness({
      preferences: { shortcutOverrides: { newTab: ["Cmd+Option+N"] } },
    });
    await renderApp(harness);

    await pressKey({ key: "t", metaKey: true });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    await pressKey({ key: "˜", code: "KeyN", metaKey: true, altKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // The button that does the same names the new key.
    expect(screen.getByRole("button", { name: "New Tab" })).toHaveAttribute(
      "title",
      "New Tab (⌥⌘N)",
    );
    expect(screen.getAllByTitle("Close Tab (⌘W)").length).toBe(2);
  });

  it("runs a command on a key given in Settings, and one on its alternate key", async () => {
    const harness = createAppHarness({
      preferences: {
        shortcutOverrides: { viewAsIcons: ["Cmd+4"], viewAsList: ["Cmd+J", "F6"] },
      },
    });
    await renderApp(harness);
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");

    await pressKey({ key: "4", metaKey: true });
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveAttribute(
      "title",
      "View as Icons (⌘4)",
    );

    await pressKey({ key: "F6" });
    expect(screen.getByRole("button", { name: "View as Compact List" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");
  });

  it("gives a reassigned key to its new command only", async () => {
    const harness = createAppHarness({
      preferences: {
        shortcutOverrides: { newFolder: ["Cmd+Shift+N", "Cmd+D"], duplicateSelection: [] },
      },
    });
    await renderApp(harness);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "source.txt" }));
    });

    await pressKey({ key: "d", metaKey: true });

    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(true);
    });
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "copyPaste:plan" &&
          (call.payload as IpcRequestInput<"copyPaste:plan">).action === "duplicate",
      ),
    ).toBe(false);
  });

  it("opens Help on the key it was given, and no longer on ?", async () => {
    const harness = createAppHarness({
      preferences: { shortcutOverrides: { openHelp: ["F1"] } },
    });
    await renderApp(harness);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "source.txt" }));
    });

    const helpOpened = () =>
      harness.invocations.filter((call) => call.channel === "app:openHelpWindow").length;
    await pressKey({ key: "?", shiftKey: true });
    expect(helpOpened()).toBe(0);

    await pressKey({ key: "F1" });
    expect(helpOpened()).toBe(1);
  });

  it("leaves a caret key to a text field when the menu hears it too", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    const opened = () =>
      harness.invocations.filter(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path === "/Users",
      ).length;
    const searchField = screen.getByPlaceholderText("Search");
    await act(async () => {
      searchField.focus();
    });

    // ⌘↑ moves the caret; the menu's Enclosing Folder, sent for the same key press, waits.
    await pressKey({ key: "ArrowUp", metaKey: true }, searchField);
    await act(async () => {
      harness.emitCommand({ type: "goEnclosingFolder" });
    });
    expect(opened()).toBe(0);

    // Chosen from the menu with the pointer, it goes up.
    await pressKey({ key: "Shift", shiftKey: true }, searchField);
    await act(async () => {
      harness.emitCommand({ type: "goEnclosingFolder" });
    });
    await waitFor(() => expect(opened()).toBeGreaterThan(0));
  });
});

describe("App test harness", () => {
  it("routes write and copy-paste progress to their matching listeners only", () => {
    const harness = createAppHarness();
    const handleWriteProgress = vi.fn<(event: WriteOperationProgressEvent) => void>();
    const handleCopyPasteProgress = vi.fn<(event: WriteOperationProgressEvent) => void>();

    harness.client.onWriteOperationProgress(handleWriteProgress);
    harness.client.onCopyPasteProgress(handleCopyPasteProgress);

    harness.emitProgress({
      operationId: "copy-op-1",
      mode: "copy",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 5,
      totalBytes: 5,
      currentSourcePath: "/Users/demo/source.txt",
      currentDestinationPath: "/Users/demo/Folder/source.txt",
      result: null,
    } satisfies TestProgressEvent);

    expect(handleCopyPasteProgress).toHaveBeenCalledTimes(1);
    expect(handleWriteProgress).toHaveBeenCalledTimes(1);

    harness.emitProgress({
      operationId: "write-op-rename",
      action: "rename",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: "/Users/demo/source.txt",
      currentDestinationPath: "/Users/demo/renamed.txt",
      result: null,
    } satisfies WriteOperationProgressEvent);

    expect(handleWriteProgress).toHaveBeenCalledTimes(2);
    expect(handleCopyPasteProgress).toHaveBeenCalledTimes(1);
  });
});

function createTreeChild(
  path: string,
  kind: IpcResponse<"tree:getChildren">["children"][number]["kind"],
  options: {
    isSymlink?: boolean;
  } = {},
): IpcResponse<"tree:getChildren">["children"][number] {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    kind,
    isHidden: false,
    isSymlink: options.isSymlink ?? false,
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function mergePreferences(
  current: IpcResponse<"app:getPreferences">["preferences"],
  patch: IpcRequestInput<"app:updatePreferences">["preferences"],
): IpcResponse<"app:getPreferences">["preferences"] {
  return Object.assign(
    {},
    current,
    stripUndefined(patch),
  ) as IpcResponse<"app:getPreferences">["preferences"];
}

// jsdom has no DragEvent, so drag events would carry no modifier keys. This one is a mouse
// event, which keeps Option and Command; the data transfer is added by Testing Library.
function installDragEventWithModifiers(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, "DragEvent");
  class TestDragEvent extends MouseEvent {}
  Object.defineProperty(window, "DragEvent", {
    configurable: true,
    writable: true,
    value: TestDragEvent,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(window, "DragEvent", descriptor);
    } else {
      Reflect.deleteProperty(window, "DragEvent");
    }
  };
}

type DragKeys = { altKey?: boolean; metaKey?: boolean };

// Drags `source` over `target`, once per entry of `hovers` (the keys held at that moment),
// and drops it with the keys of `drop`. Returns the cursor shown after each hover.
async function dragWithKeys(
  source: HTMLElement,
  target: HTMLElement,
  hovers: DragKeys[],
  drop: DragKeys | null = hovers.at(-1) ?? {},
): Promise<{ dataTransfer: DataTransfer; cursors: string[] }> {
  const dataTransfer = createMockDataTransfer();
  const cursors: string[] = [];
  await act(async () => {
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(target, { dataTransfer, ...hovers[0] });
    for (const keys of hovers) {
      fireEvent.dragOver(target, { dataTransfer, ...keys });
      cursors.push(dataTransfer.dropEffect);
    }
    if (drop) {
      fireEvent.drop(target, { dataTransfer, ...drop });
    }
    fireEvent.dragEnd(source, { dataTransfer });
  });
  return { dataTransfer, cursors };
}

function analyzeRequests(
  harness: ReturnType<typeof createAppHarness>,
): Array<IpcRequestInput<"copyPaste:analyzeStart">> {
  return harness.invocations
    .filter((call) => call.channel === "copyPaste:analyzeStart")
    .map((call) => call.payload as IpcRequestInput<"copyPaste:analyzeStart">);
}

function missingSourceIssue(sourcePath: string): IpcResponse<"copyPaste:plan">["issues"][number] {
  return {
    code: "source_missing",
    message: `Source does not exist: ${sourcePath}`,
    sourcePath,
    destinationPath: null,
  };
}

// A plan for the request, with `issuesFor` saying which of its items have a problem.
function planForRequest(
  request: IpcRequestInput<"copyPaste:analyzeStart">,
  issuesFor: (sourcePath: string) => IpcResponse<"copyPaste:plan">["issues"][number] | null,
): NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]> {
  const issues = request.sourcePaths.flatMap((path) => {
    const issue = issuesFor(path);
    return issue ? [issue] : [];
  });
  const plan = cutPlan(request.sourcePaths, request.destinationDirectoryPath, issues);
  return toAnalysisReport({ ...plan, mode: request.mode });
}

function finishedWriteEvent(args: {
  operationId: string;
  action: WriteOperationProgressEvent["action"];
  targetPath: string | null;
  items: Array<{ sourcePath: string | null; destinationPath: string | null }>;
}): WriteOperationProgressEvent {
  const count = args.items.length;
  return {
    operationId: args.operationId,
    action: args.action,
    status: "completed",
    completedItemCount: count,
    totalItemCount: count,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: {
      operationId: args.operationId,
      action: args.action,
      status: "completed",
      targetPath: args.targetPath,
      startedAt: "2026-10-03T10:00:00.000Z",
      finishedAt: "2026-10-03T10:00:01.000Z",
      summary: {
        topLevelItemCount: count,
        totalItemCount: count,
        completedItemCount: count,
        failedItemCount: 0,
        skippedItemCount: 0,
        cancelledItemCount: 0,
        completedByteCount: 0,
        totalBytes: null,
      },
      items: args.items.map((item) => ({ ...item, status: "completed" as const, error: null })),
      error: null,
    },
  };
}

function renderApp(harness: ReturnType<typeof createAppHarness>): void {
  render(
    <FiletrailClientProvider value={harness.client}>
      <App />
    </FiletrailClientProvider>,
  );
}

async function pressKey(init: KeyboardEventInit & { key: string }): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, init);
  });
}

async function renameSelectionTo(currentName: string, nextName: string): Promise<void> {
  await pressKey({ key: "F2" });
  const renameInput = await screen.findByLabelText(`Rename ${currentName}`);
  await act(async () => {
    fireEvent.change(renameInput, { target: { value: nextName } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
  });
}

describe("App file operations like Finder", () => {
  describe("drag and drop moves on the same disk and copies to another", () => {
    let restoreDragEvent: () => void = () => undefined;
    beforeEach(() => {
      restoreDragEvent = installDragEventWithModifiers();
    });
    afterEach(() => {
      restoreDragEvent();
    });

    const backupFavorite: Parameters<typeof createAppHarness>[0] = {
      preferences: {
        favoritesInitialized: true,
        favorites: [{ path: "/Volumes/Backup", icon: "drive" }],
      },
    };

    it("moves to a folder on the same disk, showing the move cursor", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("tree:/Users/demo/Folder");
      const { dataTransfer, cursors } = await dragWithKeys(source, target, [{}]);

      expect(dataTransfer.effectAllowed).toBe("copyMove");
      expect(cursors).toEqual(["move"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "cut",
            action: "move_to",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Users/demo/Folder",
          }),
        ]);
      });
    });

    // Disks can be mounted anywhere: a network share under /net is another disk, and a
    // plain drag there must copy, not delete the originals once copied.
    it("copies to a disk mounted outside /Volumes, as the disk says", async () => {
      const harness = createAppHarness({
        preferences: {
          favoritesInitialized: true,
          favorites: [{ path: "/net/share", icon: "drive" }],
        },
        diskIds: { "/Users": 1, "/net/share": 7 },
      });
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/net/share");
      await dragWithKeys(source, target, [{}]);

      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "copy",
            action: "copy_to",
            destinationDirectoryPath: "/net/share",
          }),
        ]);
      });
    });

    // The startup disk can also be reached as /Volumes/Macintosh HD: still the same disk.
    it("moves to the startup disk reached through /Volumes, as the disk says", async () => {
      const harness = createAppHarness({
        preferences: {
          favoritesInitialized: true,
          favorites: [{ path: "/Volumes/Macintosh HD/Users/demo/Folder", icon: "folder" }],
        },
        diskIds: { "/Users": 1, "/Volumes/Macintosh HD": 1 },
      });
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/Volumes/Macintosh HD/Users/demo/Folder");
      await dragWithKeys(source, target, [{}]);

      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "cut",
            action: "move_to",
            destinationDirectoryPath: "/Volumes/Macintosh HD/Users/demo/Folder",
          }),
        ]);
      });
    });

    it("copies to a folder on another disk, showing the copy cursor", async () => {
      const harness = createAppHarness(backupFavorite);
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/Volumes/Backup");
      const { cursors } = await dragWithKeys(source, target, [{}]);

      expect(cursors).toEqual(["copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "copy",
            action: "copy_to",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Volumes/Backup",
          }),
        ]);
      });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });

      // Named for the copy it is, not for the paste it works like.
      await act(async () => {
        harness.emitProgress({
          operationId: "copy-op-1",
          action: "copy_to",
          mode: "copy",
          status: "completed",
          completedItemCount: 1,
          totalItemCount: 1,
          completedByteCount: 5,
          totalBytes: 5,
          currentSourcePath: null,
          currentDestinationPath: null,
          result: {
            operationId: "copy-op-1",
            mode: "copy",
            status: "completed",
            destinationDirectoryPath: "/Volumes/Backup",
            startedAt: "2026-03-09T00:00:00.000Z",
            finishedAt: "2026-03-09T00:00:01.000Z",
            summary: {
              topLevelItemCount: 1,
              totalItemCount: 1,
              completedItemCount: 1,
              failedItemCount: 0,
              skippedItemCount: 0,
              cancelledItemCount: 0,
              completedByteCount: 5,
              totalBytes: 5,
            },
            items: [
              {
                sourcePath: "/Users/demo/source.txt",
                destinationPath: "/Volumes/Backup/source.txt",
                status: "completed",
                error: null,
              },
            ],
            error: null,
          },
        });
      });
      const toasts = await screen.findByTestId("toast-viewport");
      expect(within(toasts).getByText("Copied to Backup")).toBeInTheDocument();
      expect(within(toasts).queryByText(/Pasted/)).not.toBeInTheDocument();
    });

    it("copies on the same disk with Option held", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("tree:/Users/demo/Folder");
      const { cursors } = await dragWithKeys(source, target, [{ altKey: true }]);

      expect(cursors).toEqual(["copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({ mode: "copy", destinationDirectoryPath: "/Users/demo/Folder" }),
        ]);
      });
    });

    it("moves to another disk with Command held", async () => {
      const harness = createAppHarness(backupFavorite);
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/Volumes/Backup");
      const { cursors } = await dragWithKeys(source, target, [{ metaKey: true }]);

      expect(cursors).toEqual(["move"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "cut",
            action: "move_to",
            destinationDirectoryPath: "/Volumes/Backup",
          }),
        ]);
      });
    });

    it("changes the cursor as Option is pressed and let go, and drops as it shows", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("tree:/Users/demo/Folder");
      const { cursors } = await dragWithKeys(source, target, [
        {},
        { altKey: true },
        {},
        {
          altKey: true,
        },
      ]);

      expect(cursors).toEqual(["move", "copy", "move", "copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([expect.objectContaining({ mode: "copy" })]);
      });
    });

    it("duplicates with Option onto the items' own folder, and does nothing without it", async () => {
      const harness = createAppHarness({
        preferences: {
          favoritesInitialized: true,
          favorites: [{ path: "/Users/demo", icon: "home" }],
        },
      });
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const ownFolder = await screen.findByTitle("favorite:/Users/demo");

      const plain = await dragWithKeys(source, ownFolder, [{}]);
      expect(plain.cursors).toEqual(["none"]);
      expect(analyzeRequests(harness)).toEqual([]);

      const withOption = await dragWithKeys(source, ownFolder, [{ altKey: true }]);
      expect(withOption.cursors).toEqual(["copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "copy",
            action: "copy_to",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Users/demo",
          }),
        ]);
      });
      expect(screen.queryByText(/couldn't start/)).not.toBeInTheDocument();
    });
  });

  it("moves the rest of a search selection when some items are already in the folder", async () => {
    const searchItem = (path: string, parentPath: string) => ({
      path,
      name: path.split("/").at(-1) ?? path,
      extension: "txt",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath,
      relativeParentPath: parentPath === "/Users/demo" ? "." : "Folder",
    });
    const harness = createAppHarness({
      searchResultItems: [
        searchItem("/Users/demo/source.txt", "/Users/demo"),
        searchItem("/Users/demo/Folder/source-inside.txt", "/Users/demo/Folder"),
      ],
      analysisReportForRequest: (request) =>
        planForRequest(request, (path) =>
          path.startsWith(`${request.destinationDirectoryPath}/`) ? sameFolderIssue(path) : null,
        ),
    });
    renderApp(harness);

    await openSearchResults();
    const first = await screen.findByTitle("search:/Users/demo/source.txt");
    const second = await screen.findByTitle("search:/Users/demo/Folder/source-inside.txt");
    await act(async () => {
      fireEvent.click(first);
      fireEvent.click(second, { metaKey: true });
    });
    await dragBetween(first, await screen.findByTitle("tree:/Users/demo/Folder"));

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(analyzeRequests(harness).map((request) => [...request.sourcePaths].sort())).toEqual([
      ["/Users/demo/Folder/source-inside.txt", "/Users/demo/source.txt"],
      ["/Users/demo/source.txt"],
    ]);
    expect(screen.queryByText("Move couldn’t start")).not.toBeInTheDocument();
  });

  describe("the clipboard follows what the app does to its items", () => {
    it("follows a renamed item", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "c", metaKey: true });
      await renameSelectionTo("source.txt", "renamed.txt");
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
          true,
        );
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/renamed.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "write-op-rename",
            action: "rename",
            targetPath: "/Users/demo/renamed.txt",
            items: [
              { sourcePath: "/Users/demo/source.txt", destinationPath: "/Users/demo/renamed.txt" },
            ],
          }),
        );
      });
      await screen.findByTitle("/Users/demo/renamed.txt");

      await selectItem("/Users/demo/Folder");
      await pressKey({ key: "v", metaKey: true });

      await vi.waitFor(() => {
        expect(analyzeRequests(harness).at(-1)?.sourcePaths).toEqual(["/Users/demo/renamed.txt"]);
      });
    });

    it("follows an item moved by a drag", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "c", metaKey: true });
      await dragBetween(
        await screen.findByTitle("/Users/demo/source.txt"),
        await screen.findByTitle("tree:/Users/demo/Folder"),
      );
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "copy-op-1",
            action: "move_to",
            targetPath: "/Users/demo/Folder",
            items: [
              {
                sourcePath: "/Users/demo/source.txt",
                destinationPath: "/Users/demo/Folder/source.txt",
              },
            ],
          }),
        );
      });
      await vi.waitFor(() => {
        expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
      });

      await clearContentSelection();
      await pressKey({ key: "v", metaKey: true });

      await vi.waitFor(() => {
        expect(analyzeRequests(harness).at(-1)).toMatchObject({
          sourcePaths: ["/Users/demo/Folder/source.txt"],
          destinationDirectoryPath: "/Users/demo",
        });
      });
    });

    it("drops an item put in the Trash", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
      });
      await pressKey({ key: "c", metaKey: true });
      expect(clipboardButton()).toHaveAccessibleName("Clipboard: 2 items copied");

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "Backspace", metaKey: true });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
          true,
        );
      });
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "write-op-trash",
            action: "trash",
            targetPath: null,
            items: [{ sourcePath: "/Users/demo/source.txt", destinationPath: null }],
          }),
        );
      });

      await vi.waitFor(() => {
        expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
      });
    });
  });

  describe("pasting items that no longer exist", () => {
    const withGoneFile = {
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/gone.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
      analysisReportForRequest: (request: IpcRequestInput<"copyPaste:analyzeStart">) =>
        planForRequest(request, (path) =>
          path === "/Users/demo/gone.txt" ? missingSourceIssue(path) : null,
        ),
    };

    async function copyThenPaste(paths: string[], key: "c" | "x"): Promise<void> {
      await selectItem(paths[0] as string);
      for (const path of paths.slice(1)) {
        await act(async () => {
          fireEvent.click(screen.getByTitle(path), { metaKey: true });
        });
      }
      await pressKey({ key, metaKey: true });
      await selectItem("/Users/demo/Folder");
      await pressKey({ key: "v", metaKey: true });
    }

    it.each([
      ["copied", "c"],
      ["cut", "x"],
    ] as const)("pastes the rest of %s items and names the one that is gone", async (_, key) => {
      const harness = createAppHarness(withGoneFile);
      renderApp(harness);

      await copyThenPaste(["/Users/demo/source.txt", "/Users/demo/gone.txt"], key);

      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      expect(analyzeRequests(harness).map((request) => request.sourcePaths)).toEqual([
        ["/Users/demo/source.txt", "/Users/demo/gone.txt"],
        ["/Users/demo/source.txt"],
      ]);
      // A cut is a move, and said as one.
      const verb = key === "x" ? "moved" : "pasted";
      const notice = await screen.findByRole("dialog", { name: `An item couldn’t be ${verb}` });
      expect(notice).toHaveTextContent(
        `“gone.txt” couldn’t be ${verb} because it no longer exists.`,
      );
      if (key === "c") {
        // What is gone is taken off the clipboard; the rest stays for more pastes.
        expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
      }
    });

    it("pastes nothing when every item is gone, and says so", async () => {
      const harness = createAppHarness(withGoneFile);
      renderApp(harness);

      await copyThenPaste(["/Users/demo/gone.txt"], "c");

      const notice = await screen.findByRole("dialog", { name: "Paste couldn’t start" });
      expect(notice).toHaveTextContent(
        "“gone.txt” couldn’t be pasted because it no longer exists.",
      );
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
      expect(clipboardButton()).toBeNull();
    });
  });

  describe("New Folder suggests a free name", () => {
    it("in another folder, not only the folder on screen", async () => {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Folder": {
            path: "/Users/demo/Folder",
            parentPath: "/Users/demo",
            entries: [createDirectoryEntry("/Users/demo/Folder/untitled folder", "directory")],
          },
        },
      });
      renderApp(harness);

      await openNewFolderFromFolderMenu("/Users/demo/Folder");

      expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
        "In “Folder”",
      );
      expect(screen.getByLabelText("Folder name")).toHaveValue("untitled folder 2");
    });

    it("comparing names without regard to case, as the disk does", async () => {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo": {
            path: "/Users/demo",
            parentPath: "/Users",
            entries: [
              createDirectoryEntry("/Users/demo/Untitled Folder", "directory"),
              createDirectoryEntry("/Users/demo/UNTITLED FOLDER 2", "directory"),
            ],
          },
        },
      });
      renderApp(harness);

      await clearContentSelection();
      await pressKey({ key: "n", metaKey: true, shiftKey: true });

      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:createFolder")
            ?.payload,
        ).toEqual({
          parentDirectoryPath: "/Users/demo",
          folderName: "untitled folder 3",
          nextFreeName: true,
        });
      });
    });
  });

  describe("another write running", () => {
    const busyError = () => new Error("Another write operation is already running.");

    async function startPasteThatKeepsRunning(
      harness: ReturnType<typeof createAppHarness>,
    ): Promise<void> {
      await pasteSourceIntoFolder(harness, "c");
      await screen.findByRole("region", { name: "Pasting…" });
    }

    async function expectBusyDialog(title: string): Promise<void> {
      const dialog = await screen.findByRole("dialog", { name: title });
      expect(dialog).toHaveTextContent(
        "Another file operation is running. Wait for it to finish, or stop it.",
      );
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
      });
    }

    it("says the same thing in a dialog for Trash, Duplicate and Paste", async () => {
      const harness = createAppHarness();
      renderApp(harness);
      await startPasteThatKeepsRunning(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "Backspace", metaKey: true });
      await expectBusyDialog("Move to Trash couldn’t start");
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        false,
      );

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "d", metaKey: true });
      await expectBusyDialog("Duplicate couldn’t start");

      await pressKey({ key: "v", metaKey: true });
      await expectBusyDialog("Paste couldn’t start");
      expect(screen.queryByTestId("toast-viewport")?.textContent ?? "").not.toContain(
        "Wait for the current write",
      );
    });

    it("says it in a dialog when the main process refuses a rename", async () => {
      const harness = createAppHarness({ renameErrors: [busyError()] });
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", "renamed.txt");

      await expectBusyDialog("Rename couldn’t start");
      // The name field does not stay open waiting.
      expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Renaming…" })).not.toBeInTheDocument();
    });

    it("says it in a dialog when the main process refuses a new folder", async () => {
      const harness = createAppHarness({ createFolderError: busyError() });
      renderApp(harness);

      await clearContentSelection();
      await pressKey({ key: "n", metaKey: true, shiftKey: true });

      await expectBusyDialog("New Folder couldn’t start");
      expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    });

    it("sends one Trash request for a quick double Command-Delete", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await act(async () => {
        fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
        fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
      });

      await expectBusyDialog("Move to Trash couldn’t start");
      expect(
        harness.invocations.filter((call) => call.channel === "writeOperation:trash"),
      ).toHaveLength(1);
    });
  });

  it("gives the rename field each refusal, even one that reads the same as the last", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await selectItem("/Users/demo/source.txt");
    await renameSelectionTo("source.txt", "a/b.txt");
    const refusal = await screen.findByTestId("inline-rename-refusal");
    const firstReason = refusal.textContent;
    expect(refusal).toHaveAttribute("data-refusal-count", "1");

    const renameInput = screen.getByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "c/d.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
    });

    expect(screen.getByTestId("inline-rename-refusal")).toHaveTextContent(firstReason ?? "");
    expect(screen.getByTestId("inline-rename-refusal")).toHaveAttribute("data-refusal-count", "2");
    expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
      false,
    );
  });

  it("pastes into the folder on screen from the menu of a folder that is on the clipboard", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await selectItem("/Users/demo/Folder");
    await pressKey({ key: "c", metaKey: true });
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });

    await vi.waitFor(() => {
      expect(analyzeRequests(harness).at(-1)).toMatchObject({
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
      });
    });
    expect(screen.queryByText(/couldn't start/)).not.toBeInTheDocument();
  });

  describe("names that begin with a dot", () => {
    const question = "Are you sure you want to use a name that begins with a dot (“.”)?";

    it("asks before a rename would hide the item, and renames on Use “.”", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", ".source.txt");

      const dialog = await screen.findByRole("dialog", { name: question });
      expect(dialog).toHaveTextContent(
        "These names are reserved for the system. If you continue, the item will be hidden.",
      );
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
        false,
      );

      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Use “.”" }));
      });
      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
        ).toEqual({ sourcePath: "/Users/demo/source.txt", destinationName: ".source.txt" });
      });
      expect(screen.queryByRole("dialog", { name: question })).not.toBeInTheDocument();
    });

    it("leaves the name as it was on Cancel", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", ".source.txt");
      const dialog = await screen.findByRole("dialog", { name: question });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      });

      expect(screen.queryByRole("dialog", { name: question })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
      expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
        false,
      );
    });

    it("asks before a new folder would be hidden", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      // Inside another folder, where the name is asked for before the folder is made.
      await openNewFolderFromFolderMenu("/Users/demo/Folder");
      await screen.findByRole("dialog", { name: "New Folder" });
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: ".config" } });
        fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));
      });

      const dialog = await screen.findByRole("dialog", { name: question });
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(false);
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Use “.”" }));
      });
      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:createFolder")
            ?.payload,
        ).toEqual({ parentDirectoryPath: "/Users/demo/Folder", folderName: ".config" });
      });
    });

    it("does not ask while hidden files are shown", async () => {
      const harness = createAppHarness({ preferences: { includeHidden: true } });
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", ".source.txt");

      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
        ).toEqual({ sourcePath: "/Users/demo/source.txt", destinationName: ".source.txt" });
      });
      expect(screen.queryByRole("dialog", { name: question })).not.toBeInTheDocument();
    });
  });

  describe("selecting what Duplicate made", () => {
    it("selects the copy in the file list", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "d", metaKey: true });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/source copy.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "copy-op-1",
            action: "duplicate",
            targetPath: "/Users/demo",
            items: [
              {
                sourcePath: "/Users/demo/source.txt",
                destinationPath: "/Users/demo/source copy.txt",
              },
            ],
          }),
        );
      });

      await vi.waitFor(() => {
        expect(screen.getByTitle("/Users/demo/source copy.txt")).toHaveAttribute(
          "data-selected",
          "true",
        );
      });
      expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "false");
    });

    it("selects the copy in the tree when a tree folder is duplicated", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const treeFolder = await screen.findByTitle("tree:/Users/demo/Folder");
      await act(async () => {
        fireEvent.contextMenu(treeFolder);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Duplicate/ }));
      });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
        createDirectoryEntry("/Users/demo/Folder copy", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "copy-op-1",
            action: "duplicate",
            targetPath: "/Users/demo",
            items: [
              { sourcePath: "/Users/demo/Folder", destinationPath: "/Users/demo/Folder copy" },
            ],
          }),
        );
      });

      await vi.waitFor(() => {
        expect(screen.getByTestId("tree-selection")).toHaveTextContent(
          "fs:/Users/demo/Folder copy",
        );
      });
    });
  });

  it("keeps the conflict question when its answer cannot be sent", async () => {
    const harness = createAppHarness({ resolveConflictError: new Error("IPC closed") });
    renderApp(harness);

    await pasteSourceIntoFolder(harness, "c");
    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "paste",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        runtimeConflict: {
          conflictId: "runtime-1",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/source.txt",
          destinationPath: "/Users/demo/Folder/source.txt",
          sourceKind: "file",
          destinationKind: "file",
          conflictClass: "file_conflict",
          reason: "destination_changed",
          sourceFingerprint: createNodeFingerprint("file"),
          destinationFingerprint: createNodeFingerprint("file"),
          currentSourceFingerprint: createNodeFingerprint("file"),
          currentDestinationFingerprint: createNodeFingerprint("file"),
        },
        result: null,
      });
    });
    const replaceButton = await screen.findByRole("button", { name: "Replace" });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await act(async () => {
        fireEvent.click(replaceButton);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:resolveConflict")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("still reads the folder again when the caches cannot be cleared", async () => {
    const harness = createAppHarness({ clearCachesError: new Error("IPC closed") });
    renderApp(harness);

    await screen.findByTitle("/Users/demo/source.txt");
    const snapshotReads = () =>
      harness.invocations.filter(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path === "/Users/demo",
      ).length;
    const readsBefore = snapshotReads();
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/new.txt", "file"),
    ]);

    await act(async () => {
      harness.emitCommand({ type: "refreshOrApplySearchSort" });
    });

    await vi.waitFor(() => {
      expect(snapshotReads()).toBeGreaterThan(readsBefore);
    });
    expect(await screen.findByTitle("/Users/demo/new.txt")).toBeInTheDocument();
  });
});

describe("what stays on screen when an operation finishes", () => {
  const sourceCopied = [
    { sourcePath: "/Users/demo/source.txt", status: "completed" as const, error: null },
  ];

  async function copySourceAndPasteHere(harness: ReturnType<typeof createAppHarness>) {
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await pressKey({ key: "v", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
  }

  function finishPasteOfCopy(harness: ReturnType<typeof createAppHarness>) {
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/source copy.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    return act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "copy-op-1",
          action: "paste",
          targetPath: "/Users/demo",
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/source copy.txt",
            },
          ],
        }),
      );
    });
  }

  it("selects what a paste made when nothing else was picked meanwhile", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    await finishPasteOfCopy(harness);

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/source copy.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
  });

  // Jumping to the copy would make the next ⌘⌫ trash an item the person never chose.
  it("keeps what the person picked while the paste ran, and acts on that next", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    await selectItem("/Users/demo/Folder");
    await finishPasteOfCopy(harness);
    await screen.findByTitle("/Users/demo/source copy.txt");

    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/source copy.txt")).not.toHaveAttribute(
      "data-selected",
      "true",
    );
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({ paths: ["/Users/demo/Folder"] });
    });
  });

  it("keeps the selection when an operation into another folder finishes", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    // Pasted into Folder from its own menu, while source.txt stays selected here.
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    await selectItem("/Users/demo/source.txt");
    const readsBefore = harness.invocations.filter(
      (call) => call.channel === "directory:getSnapshot",
    ).length;

    await act(async () => {
      harness.emitProgress(finishedResultEvent("copy", "completed", sourceCopied));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "directory:getSnapshot").length,
      ).toBeGreaterThan(readsBefore);
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    });
  });

  it("keeps search results that were opened while a paste ran", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    await openSearchResults();
    await act(async () => {
      harness.emitProgress(finishedResultEvent("copy", "completed", sourceCopied));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("source");
  });

  it("keeps the search results a drag was made from", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await openSearchResults();
    const searchResult = await screen.findByTitle("search:/Users/demo/source.txt");
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(searchResult, treeTarget);
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    const searchesBefore = harness.invocations.filter(
      (call) => call.channel === "search:start",
    ).length;
    await act(async () => {
      harness.emitProgress(finishedResultEvent("cut", "completed", sourceCopied));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("source");
    // Found again, so the moved item shows where it is now.
    expect(harness.invocations.filter((call) => call.channel === "search:start").length).toBe(
      searchesBefore + 1,
    );
  });

  it("selects a renamed item while the list is filtered", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const contentPane = await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.pointerDown(contentPane);
    });
    await pressKey({ key: "s" });
    await pressKey({ key: "o" });
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");

    await renameSelectionTo("source.txt", "zeta.txt");
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
        true,
      );
    });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/zeta.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "write-op-rename",
          action: "rename",
          targetPath: "/Users/demo",
          items: [
            { sourcePath: "/Users/demo/source.txt", destinationPath: "/Users/demo/zeta.txt" },
          ],
        }),
      );
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/zeta.txt")).toHaveAttribute("data-selected", "true");
    });
  });

  // Reading the old folder again would replace the one being opened and send them back.
  it("lets a folder the person is opening win over reading the folder again", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    const release = harness.holdDirectorySnapshot("/Users/demo/Folder");
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder"));
    });
    await finishPasteOfCopy(harness);
    await act(async () => {
      release();
    });

    await vi.waitFor(() => {
      expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
  });
});

describe("a rename refused after leaving its folder", () => {
  // Clicking another folder ends the name field (it is submitted) and opens that folder;
  // the refusal comes back with no field to show it under.
  it("says why in a dialog, and leaves the keyboard working", async () => {
    const harness = createAppHarness({
      renameErrors: [new Error("An item named “Folder” already exists.")],
    });
    renderApp(harness);

    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "F2" });
    const renameInput = await screen.findByLabelText("Rename source.txt");
    const treeFolder = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "Folder" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
      fireEvent.click(treeFolder);
    });

    const dialog = await screen.findByRole("dialog", { name: "Rename couldn’t start" });
    expect(dialog).toHaveTextContent("An item named “Folder” already exists.");
    expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });

    const tabsBefore = screen.queryAllByRole("tab").length;
    await pressKey({ key: "t", metaKey: true });
    await vi.waitFor(() => {
      expect(screen.queryAllByRole("tab").length).toBeGreaterThan(tabsBefore);
    });
  });

  it("closes the name field when another folder is opened, and the keyboard works there", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "F2" });
    await screen.findByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("tree:/Users/demo/Folder"));
    });

    await vi.waitFor(() => {
      expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
    });
    expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
      false,
    );
    const tabsBefore = screen.queryAllByRole("tab").length;
    await pressKey({ key: "t", metaKey: true });
    await vi.waitFor(() => {
      expect(screen.queryAllByRole("tab").length).toBeGreaterThan(tabsBefore);
    });
  });
});

describe("what finished operations are called", () => {
  const withTrashFolder = {
    directorySnapshots: {
      "/Users/demo": {
        path: "/Users/demo",
        parentPath: "/Users",
        entries: [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/b.txt", "file"),
          createDirectoryEntry("/Users/demo/.Trash", "directory"),
        ],
      },
      "/Users/demo/.Trash": {
        path: "/Users/demo/.Trash",
        parentPath: "/Users/demo",
        entries: [createDirectoryEntry("/Users/demo/.Trash/old.txt", "file")],
      },
    },
  };

  it("calls a finished Delete Immediately “Deleted”, never “Pasted”", async () => {
    const harness = createAppHarness(withTrashFolder);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/old.txt"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Delete Immediately/ }));
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “old.txt”?",
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
      ).toBe(true);
    });

    await act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "write-op-delete",
          action: "delete_immediately",
          targetPath: null,
          items: [{ sourcePath: "/Users/demo/.Trash/old.txt", destinationPath: null }],
        }),
      );
    });

    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent("Deleted");
    });
    expect(viewport).not.toHaveTextContent("Pasted");
  });

  it("never says a stopped Trash was done", async () => {
    const harness = createAppHarness(withTrashFolder);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
    });
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        true,
      );
    });
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-trash",
        action: "trash",
        status: "partial",
        completedItemCount: 1,
        totalItemCount: 2,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: {
          operationId: "write-op-trash",
          action: "trash",
          status: "partial",
          targetPath: null,
          startedAt: "2026-10-03T10:00:00.000Z",
          finishedAt: "2026-10-03T10:00:01.000Z",
          summary: {
            topLevelItemCount: 2,
            totalItemCount: 2,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 1,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: null,
              status: "completed",
              error: null,
              skipReason: null,
            },
            {
              sourcePath: "/Users/demo/b.txt",
              destinationPath: null,
              status: "cancelled",
              error: "Not started because the operation was stopped.",
              skipReason: null,
            },
          ],
          error: null,
        },
      } as WriteOperationProgressEvent);
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Stopped before every item was done.");
    expect(dialog).not.toHaveTextContent("Done.");
  });
});

describe("the Preparing to Paste sheet", () => {
  async function startPasteThatIsBeingPrepared(harness: ReturnType<typeof createAppHarness>) {
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await selectItem("/Users/demo/Folder");
    await pressKey({ key: "v", metaKey: true });
    return screen.findByRole("dialog", { name: "Preparing to Paste…" });
  }

  it("starts with Cancel focused", async () => {
    const harness = createAppHarness({ deferCopyPastePlan: true });
    renderApp(harness);

    const sheet = await startPasteThatIsBeingPrepared(harness);

    expect(within(sheet).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  // Escape is the sheet's Cancel: the paste stops, and nothing behind it hears the key.
  it("cancels the paste on Escape, and the list behind doesn't take the key", async () => {
    const harness = createAppHarness({ deferCopyPastePlan: true });
    renderApp(harness);
    await startPasteThatIsBeingPrepared(harness);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    await act(async () => {
      harness.resolveCopyPastePlan();
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Preparing to Paste…" })).not.toBeInTheDocument();
    });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
  });
});

describe("dragging while an operation runs", () => {
  // One operation runs at a time, and a drag would start another: it doesn't start, and
  // a notification says why, so the rows don't just seem stuck.
  it("doesn't start the drag, and says why", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await pressKey({ key: "v", metaKey: true });
    await screen.findByRole("region", { name: "Pasting…" });

    const dataTransfer = await dragBetween(
      screen.getByTitle("/Users/demo/source.txt"),
      await screen.findByTitle("tree:/Users/demo/Folder"),
    );

    expect(dataTransfer.getData("text/plain")).toBe("");
    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent(/Can't drag while .* being copied/);
    });
    expect(analyzeRequests(harness)).toHaveLength(1);
  });
});

describe("acting on search results", () => {
  const result = (path: string) => {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    return {
      path,
      name,
      extension: name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath: path.slice(0, slash),
      relativeParentPath: path.slice("/Users/demo/".length, slash) || ".",
    };
  };

  async function selectResult(path: string, init: { metaKey?: boolean } = {}) {
    await act(async () => {
      fireEvent.click(await screen.findByTitle(`search:${path}`), init);
    });
  }

  function duplicateRequests(harness: ReturnType<typeof createAppHarness>) {
    return harness.invocations
      .filter(
        (call) => call.channel === "copyPaste:plan" || call.channel === "copyPaste:analyzeStart",
      )
      .map((call) => call.payload as { action?: string; destinationDirectoryPath?: string })
      .filter((payload) => payload.action === "duplicate");
  }

  it("moves a result to the Trash with Command-Delete", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/Folder/deep.txt");

    await pressKey({ key: "Backspace", metaKey: true });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({ paths: ["/Users/demo/Folder/deep.txt"] });
    });
  });

  it("duplicates a result next to it, in its own folder", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/Folder/deep.txt");

    await pressKey({ key: "d", metaKey: true });

    await vi.waitFor(() => {
      expect(duplicateRequests(harness).length).toBeGreaterThan(0);
    });
    for (const request of duplicateRequests(harness)) {
      expect(request.destinationDirectoryPath).toBe("/Users/demo/Folder");
    }
  });

  it("doesn't duplicate results from different folders at once, and says why", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/source.txt"), result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/source.txt");
    await selectResult("/Users/demo/Folder/deep.txt", { metaKey: true });

    await pressKey({ key: "d", metaKey: true });

    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent("Duplicate items from one folder at a time");
    });
    expect(duplicateRequests(harness)).toEqual([]);
  });

  it("renames a result in its row", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/Folder/deep.txt");

    await pressKey({ key: "F2" });
    const field = await screen.findByLabelText("Rename result deep.txt");
    await act(async () => {
      fireEvent.change(field, { target: { value: "deeper.txt" } });
      fireEvent.keyDown(field, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
      ).toEqual({ sourcePath: "/Users/demo/Folder/deep.txt", destinationName: "deeper.txt" });
    });
    expect(screen.queryByRole("dialog", { name: /Rename/ })).not.toBeInTheDocument();
  });

  it("offers Move to Trash, Rename and Duplicate in a result's menu", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("search:/Users/demo/Folder/deep.txt"));
    });

    for (const name of [/^Move to Trash/, /^Rename/, /^Duplicate/, /^Move To…/]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "false");
    }
    expect(screen.queryByRole("button", { name: /^Delete Immediately/ })).not.toBeInTheDocument();
  });
});

describe("Delete Immediately and Empty Trash", () => {
  const emptyQuestion = "Are you sure you want to permanently erase the items in the Trash?";

  // Everything goes to the Trash; only what is already in it is deleted for good.
  it("has no Option-Command-Delete in the list", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "Backspace", metaKey: true, altKey: true });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
    ).toBe(false);
  });

  it("offers Delete Immediately in a tree folder's menu only inside the Trash", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const menuTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(menuTarget);
    });

    expect(screen.queryByRole("button", { name: /^Delete Immediately/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Move to Trash/ })).toBeInTheDocument();
  });

  it("empties the Trash from the menu bar, after asking, and not on Cancel", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "emptyTrash" });
    });
    let dialog = await screen.findByRole("dialog", { name: emptyQuestion });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(harness.invocations.some((call) => call.channel === "system:emptyTrash")).toBe(false);

    await pressKey({ key: "Backspace", metaKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: emptyQuestion });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Empty Trash" }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "system:emptyTrash")).toBe(true);
    });
  });

  it("empties the Trash from the Trash favorite's menu", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const menuTarget = await screen.findByTitle("favorite:/Users/demo/.Trash");
    await act(async () => {
      fireEvent.contextMenu(menuTarget);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Empty Trash/ }));
    });

    expect(await screen.findByRole("dialog", { name: emptyQuestion })).toBeInTheDocument();
  });

  it("doesn't offer Empty Trash on other favorites", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesInitialized: true,
        favorites: [
          { path: "/Users/demo/Folder", icon: "folder" },
          { path: "/Users/demo/.Trash", icon: "trash" },
        ],
      },
    });
    renderApp(harness);
    const menuTarget = await screen.findByTitle("favorite:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(menuTarget);
    });

    expect(screen.queryByRole("button", { name: /^Empty Trash/ })).not.toBeInTheDocument();
  });
});

// Empty Trash and Delete Immediately are operations too: while another runs they can't
// start, so they aren't asked about, and nothing about them touches the running one.
describe("Empty Trash and Delete Immediately while another operation runs", () => {
  const withTrash = {
    directorySnapshots: {
      "/Users/demo": {
        path: "/Users/demo",
        parentPath: "/Users",
        entries: [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/Folder", "directory"),
          createDirectoryEntry("/Users/demo/.Trash", "directory"),
        ],
      },
      "/Users/demo/.Trash": {
        path: "/Users/demo/.Trash",
        parentPath: "/Users/demo",
        entries: [createDirectoryEntry("/Users/demo/.Trash/old.txt", "file")],
      },
    },
  };

  async function expectBusyDialog(title: string): Promise<void> {
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog).toHaveTextContent(
      "Another file operation is running. Wait for it to finish, or stop it.",
    );
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });
  }

  it("refuses Empty Trash from the menu bar without asking, and the paste goes on", async () => {
    const harness = createAppHarness(withTrash);
    renderApp(harness);
    await pasteSourceIntoFolder(harness, "c");
    await screen.findByRole("region", { name: "Pasting…" });

    await act(async () => {
      harness.emitCommand({ type: "emptyTrash" });
    });

    await expectBusyDialog("Empty Trash couldn’t start");
    expect(
      screen.queryByRole("dialog", {
        name: "Are you sure you want to permanently erase the items in the Trash?",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "system:emptyTrash")).toBe(false);
    expect(harness.invocations.some((call) => call.channel === "writeOperation:cancel")).toBe(
      false,
    );
  });

  it("greys out Empty Trash and Delete Immediately in the menus", async () => {
    const harness = createAppHarness(withTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");
    // A Delete Immediately that keeps running.
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/old.txt"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Delete Immediately/ }));
    });
    const question = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “old.txt”?",
    });
    await act(async () => {
      fireEvent.click(within(question).getByRole("button", { name: "Delete" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
      ).toBe(true);
    });

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/old.txt"));
    });
    expect(screen.getByRole("button", { name: /^Delete Immediately/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await pressKey({ key: "Escape" });
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });
    expect(screen.getByRole("button", { name: /^Empty Trash/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

// In the Trash things are only taken out or deleted for good, as in Finder: nothing is
// pasted, dropped, made or duplicated there, and Move to Trash does nothing there.
describe("file commands in the Trash", () => {
  const inTrash = {
    directorySnapshots: {
      "/Users/demo": {
        path: "/Users/demo",
        parentPath: "/Users",
        entries: [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/Folder", "directory"),
          createDirectoryEntry("/Users/demo/.Trash", "directory"),
        ],
      },
      "/Users/demo/.Trash": {
        path: "/Users/demo/.Trash",
        parentPath: "/Users/demo",
        entries: [
          createDirectoryEntry("/Users/demo/.Trash/old.txt", "file"),
          createDirectoryEntry("/Users/demo/.Trash/Old Folder", "directory"),
        ],
      },
      "/Users/demo/.Trash/Old Folder": {
        path: "/Users/demo/.Trash/Old Folder",
        parentPath: "/Users/demo/.Trash",
        entries: [],
      },
    },
  };

  function writeRequests(harness: ReturnType<typeof createAppHarness>) {
    return harness.invocations.filter(
      (call) =>
        call.channel === "copyPaste:analyzeStart" ||
        call.channel === "copyPaste:start" ||
        call.channel === "writeOperation:trash" ||
        call.channel === "writeOperation:createFolder",
    );
  }

  it("pastes nothing into the Trash, and says so", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await openDirectory("/Users/demo/.Trash");

    await pressKey({ key: "v", metaKey: true });

    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent("Nothing can be pasted into the Trash");
    });
    expect(writeRequests(harness)).toEqual([]);
  });

  it("makes, duplicates and trashes nothing there from the keyboard", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");
    await selectItem("/Users/demo/.Trash/old.txt");

    await pressKey({ key: "Backspace", metaKey: true });
    await pressKey({ key: "d", metaKey: true });
    await pressKey({ key: "n", metaKey: true, shiftKey: true });

    expect(writeRequests(harness)).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers only taking items out or deleting them for good in an item's menu", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/Old Folder"));
    });

    expect(screen.getByRole("button", { name: /^Delete Immediately/ })).toBeInTheDocument();
    for (const name of [/^Paste/, /^New Folder/, /^Duplicate/, /^Move to Trash/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^Move To/ })).toBeInTheDocument();
  });

  it("offers no Paste or New Folder on the Trash favorite", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });

    expect(screen.getByRole("button", { name: /^Empty Trash/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Paste/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^New Folder/ })).not.toBeInTheDocument();
  });

  it("refuses a drop on a folder in the Trash", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");

    await dragBetween(
      await screen.findByTitle("/Users/demo/.Trash/old.txt"),
      await screen.findByTitle("/Users/demo/.Trash/Old Folder"),
    );

    expect(writeRequests(harness)).toEqual([]);
  });
});

// On a disk with no Trash (a network share, some USB drives) items can't be moved to the
// Trash; as Finder does, the window offers to delete them immediately instead.
describe("moving to the Trash on a disk without a Trash", () => {
  function trashResult(items: Array<{ path: string; noTrash?: true; error?: string }>) {
    const failed = items.filter((item) => item.noTrash || item.error);
    return {
      operationId: "write-op-trash",
      action: "trash" as const,
      status: "failed" as const,
      completedItemCount: items.length - failed.length,
      totalItemCount: items.length,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result: {
        operationId: "write-op-trash",
        action: "trash" as const,
        status: "failed" as const,
        targetPath: null,
        startedAt: "2026-10-03T10:00:00.000Z",
        finishedAt: "2026-10-03T10:00:01.000Z",
        summary: {
          topLevelItemCount: items.length,
          totalItemCount: items.length,
          completedItemCount: items.length - failed.length,
          failedItemCount: failed.length,
          skippedItemCount: 0,
          cancelledItemCount: 0,
          completedByteCount: 0,
          totalBytes: null,
        },
        items: items.map((item) => ({
          sourcePath: item.path,
          destinationPath: null,
          status: item.noTrash || item.error ? ("failed" as const) : ("completed" as const),
          error: item.noTrash
            ? `“${item.path.split("/").at(-1)}” couldn't be moved to the Trash because its disk has no Trash.`
            : (item.error ?? null),
          ...(item.noTrash ? { noTrash: true as const } : {}),
        })),
        error: "failed",
      },
    };
  }

  async function trashSource(harness: ReturnType<typeof createAppHarness>) {
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        true,
      );
    });
  }

  it("asks, with Cancel as the default, and deletes immediately on Delete", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await trashSource(harness);

    await act(async () => {
      harness.emitProgress(trashResult([{ path: "/Users/demo/source.txt", noTrash: true }]));
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “source.txt”?",
    });
    expect(dialog).toHaveTextContent(
      "Its disk has no Trash, so it will be deleted immediately. You can’t undo this action.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:deleteImmediately")
          ?.payload,
      ).toEqual({ paths: ["/Users/demo/source.txt"] });
    });
  });

  it("deletes nothing on Cancel", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await trashSource(harness);
    await act(async () => {
      harness.emitProgress(trashResult([{ path: "/Users/demo/source.txt", noTrash: true }]));
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “source.txt”?",
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
    ).toBe(false);
  });

  it("reports other failures as failures, without asking", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await trashSource(harness);

    await act(async () => {
      harness.emitProgress(
        trashResult([
          { path: "/Users/demo/source.txt", noTrash: true },
          { path: "/Users/demo/Folder", error: "You don't have permission to access this item." },
        ]),
      );
    });

    expect(
      screen.queryByRole("dialog", { name: /Are you sure you want to delete/ }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "You don't have permission to access this item.",
    );
  });
});

describe("New Folder in the folder on screen", () => {
  function folderMadeEvent(path: string): TestProgressEvent {
    return {
      operationId: "write-op-folder",
      action: "new_folder",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: path,
      result: {
        operationId: "write-op-folder",
        action: "new_folder",
        status: "completed",
        targetPath: path,
        startedAt: "2026-10-03T10:00:00.000Z",
        finishedAt: "2026-10-03T10:00:01.000Z",
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          completedItemCount: 1,
          failedItemCount: 0,
          skippedItemCount: 0,
          cancelledItemCount: 0,
          completedByteCount: 0,
          totalBytes: null,
        },
        items: [{ sourcePath: null, destinationPath: path, status: "completed", error: null }],
        error: null,
      },
    };
  }

  // An "untitled folder" made in Finder meanwhile isn't listed yet: the main process takes the
  // next free name, and that is the folder whose name is edited.
  it("edits the name of the folder actually made when it got the next free name", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await clearContentSelection();
    await pressKey({ key: "n", metaKey: true, shiftKey: true });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(true);
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder 2", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress(folderMadeEvent("/Users/demo/untitled folder 2"));
    });

    expect(await screen.findByLabelText("Rename untitled folder 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rename untitled folder")).not.toBeInTheDocument();
  });

  // Refused while a paste runs, the folder isn't made: an "untitled folder" that turns up later
  // (renamed or pasted) mustn't open a rename field by surprise.
  it("doesn't rename a later “untitled folder” after one was refused while busy", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await pasteSourceIntoFolder(harness, "c");
    await screen.findByRole("region", { name: "Pasting…" });
    await clearContentSelection();
    await pressKey({ key: "n", metaKey: true, shiftKey: true });
    const busy = await screen.findByRole("dialog", { name: "New Folder couldn’t start" });
    await act(async () => {
      fireEvent.click(within(busy).getByRole("button", { name: "OK" }));
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("copy", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });

    await screen.findByTitle("/Users/demo/untitled folder");
    expect(screen.queryByLabelText("Rename untitled folder")).not.toBeInTheDocument();
  });
});

describe("file commands from the keyboard, in more states", () => {
  it("pastes once for a held ⌘V, without a refusal for the repeats", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });

    await pressKey({ key: "v", metaKey: true });
    await pressKey({ key: "v", metaKey: true, repeat: true });
    await pressKey({ key: "v", metaKey: true, repeat: true });

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toHaveLength(1);
    });
    expect(screen.queryByRole("dialog", { name: "Paste couldn’t start" })).not.toBeInTheDocument();
  });

  it("says at once that Rename and Move To wait for a running operation", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await pasteSourceIntoFolder(harness, "c");
    await screen.findByRole("region", { name: "Pasting…" });
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "F2" });
    let dialog = await screen.findByRole("dialog", { name: "Rename couldn’t start" });
    expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });

    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "m", metaKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Move couldn’t start" });
    expect(dialog).toBeInTheDocument();
  });

  it("names a new folder in its row while the list is filtered", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "s" });
    await pressKey({ key: "o" });
    await vi.waitFor(() => {
      expect(screen.queryByTitle("/Users/demo/Folder")).not.toBeInTheDocument();
    });

    await pressKey({ key: "n", metaKey: true, shiftKey: true });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(true);
    });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-folder",
        action: "new_folder",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: "/Users/demo/untitled folder",
        result: {
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          targetPath: "/Users/demo/untitled folder",
          startedAt: "2026-10-03T10:00:00.000Z",
          finishedAt: "2026-10-03T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: null,
              destinationPath: "/Users/demo/untitled folder",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    expect(await screen.findByLabelText("Rename untitled folder")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Rename “New Folder”" })).not.toBeInTheDocument();
  });

  // Search results show no folder of their own: New Folder has nowhere to go.
  it("offers no New Folder on a folder in the search results", async () => {
    const harness = createAppHarness({
      searchResultItems: [
        {
          path: "/Users/demo/Folder",
          name: "Folder",
          extension: "",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          parentPath: "/Users/demo",
          relativeParentPath: ".",
        },
      ],
    });
    renderApp(harness);
    await openSearchResults();

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("search:/Users/demo/Folder"));
    });

    expect(screen.getByRole("button", { name: /^Rename/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^New Folder/ })).not.toBeInTheDocument();
  });

  // A search tab shows results, not the folder behind them: like Paste there, a drop on
  // it would put the items somewhere out of sight.
  it("takes no drop on a tab showing search results", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");
    await pressKey({ key: "t", metaKey: true });
    await vi.waitFor(() => {
      expect(screen.getAllByRole("tab")).toHaveLength(2);
    });
    // The search runs in another folder than the item dragged, so a drop would move it.
    await openDirectory("/Users/demo/Folder");
    await openSearchResults();
    const [folderTab, searchTab] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    await act(async () => {
      fireEvent.click(folderTab);
    });
    const source = await within(await screen.findByTestId("content-pane")).findByTitle(
      "/Users/demo/source.txt",
    );

    await dragBetween(source, searchTab);

    expect(harness.invocations.map((call) => call.channel)).not.toContain("copyPaste:analyzeStart");
  });
});

describe("tabs on a folder that was renamed", () => {
  it("follow it to its new name, as a Finder window does", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Work": { path: "/Users/demo/Work", parentPath: "/Users/demo", entries: [] },
      },
    });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    const [firstTab] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    await act(async () => {
      fireEvent.click(firstTab);
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-rename",
        action: "rename",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "write-op-rename",
          action: "rename",
          status: "completed",
          targetPath: null,
          startedAt: "2026-10-03T10:00:00.000Z",
          finishedAt: "2026-10-03T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/Folder",
              destinationPath: "/Users/demo/Work",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getAllByRole("tab")[1]).toHaveTextContent("Work");
    });
  });
});

describe("Empty Trash with nothing in the Trash", () => {
  // As in Finder, there is nothing to empty, so nothing to ask about.
  it("is greyed out in the menus and the menu bar", async () => {
    const harness = createAppHarness({ trashEmpty: true });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });

    expect(screen.getByRole("button", { name: /^Empty Trash/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.disabledCommands).toContain("emptyTrash");
    });
  });

  it("stays available when what the Trash holds can't be told", async () => {
    const harness = createAppHarness({ trashEmpty: null });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });

    expect(screen.getByRole("button", { name: /^Empty Trash/ })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});
