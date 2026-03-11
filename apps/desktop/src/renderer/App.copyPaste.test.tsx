// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { RefObject } from "react";

import type {
  CopyPasteProgressEvent,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
  WriteOperationProgressEvent,
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
  }: {
    currentPath: string;
    entries: Array<{ path: string; name: string; kind: string; isSymlink?: boolean }>;
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
    onActivateEntry: (entry: {
      path: string;
      name: string;
      kind: string;
      isSymlink?: boolean;
    }) => void;
  }) => (
    <div data-testid="content-pane" onPointerDown={() => onFocusChange(true)}>
      <output data-testid="content-current-path">{currentPath}</output>
      <output data-testid="content-entry-count">{entries.length}</output>
      <label>
        Current folder path
        <input
          aria-label="Current folder path"
          defaultValue={currentPath}
          onFocus={() => onFocusChange(true)}
        />
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
          onDoubleClick={() => onActivateEntry(entry)}
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
    onFocusChange,
    onLeftPaneSubviewChange,
    onRerootHome,
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
    onFocusChange: (focused: boolean) => void;
    onLeftPaneSubviewChange: (value: "favorites" | "tree") => void;
    onRerootHome: () => void;
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
      <button type="button" data-testid="reroot-home" onClick={() => onRerootHome()}>
        Reroot Home
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
  }: {
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
      <label>
        Filter search results
        <input aria-label="Filter search results" defaultValue="source" />
      </label>
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
  InfoPanel: () => null,
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
vi.mock("./components/HelpView", () => ({
  HelpView: () => (
    <div data-testid="help-view">
      <label>
        Help notes
        <input aria-label="Help notes" defaultValue="docs" />
      </label>
    </div>
  ),
}));
vi.mock("./components/ActionLogView", () => ({
  ActionLogView: () => <div data-testid="action-log-view">Action Log</div>,
}));
vi.mock("./components/SettingsView", () => ({
  SettingsView: () => (
    <div data-testid="settings-view">
      <label>
        Terminal app
        <input aria-label="Terminal app" defaultValue="Terminal" />
      </label>
      <label>
        Open and Edit item limit
        <input aria-label="Open and Edit item limit" defaultValue="5" readOnly />
      </label>
      <label>
        Search scope
        <select aria-label="Search scope" defaultValue="name">
          <option value="name">Name</option>
          <option value="path">Path</option>
        </select>
      </label>
      <label>
        Accent color
        <input aria-label="Accent color" type="color" defaultValue="#336699" />
      </label>
    </div>
  ),
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
  beginResize: () => () => undefined,
  setTreeWidth: () => undefined,
  setInspectorWidth: () => undefined,
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

describe("App copy/paste integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a copy toast on the first command press without changing focus", async () => {
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

    const initialToastViewport = await screen.findByTestId("toast-viewport");
    expect(within(initialToastViewport).getByText("Ready to paste")).toBeInTheDocument();
    expect(within(initialToastViewport).getByText("source.txt")).toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCopy);
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

  it("shows a cut toast without changing focus", async () => {
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

    const toastViewport = await screen.findByTestId("toast-viewport");
    expect(within(toastViewport).getByText("Ready to move")).toBeInTheDocument();
    expect(within(toastViewport).getByText("source.txt")).toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCut);
  });

  it("shows the first selected item name and remaining count for multi-item copy toasts", async () => {
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

    const toastViewport = await screen.findByTestId("toast-viewport");
    expect(within(toastViewport).getByText("Ready to paste")).toBeInTheDocument();
    expect(within(toastViewport).getByText("source-a.txt and 1 more")).toBeInTheDocument();
  });

  it("ignores menu shortcut commands while help is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.keyDown(window, { key: "?" });
    });
    await screen.findByTestId("help-view");

    await act(async () => {
      harness.emitCommand({ type: "copyPath" });
    });

    expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
  });

  it("ignores menu shortcut commands while settings is open", async () => {
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
    await screen.findByTestId("settings-view");

    await act(async () => {
      harness.emitCommand({ type: "copyPath" });
    });

    expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
  });

  it("routes generic edit menu commands to native text editing for the toolbar search input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText("Find files…");
    await act(async () => {
      searchInput.focus();
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editCut" });
      harness.emitCommand({ type: "editPaste" });
      harness.emitCommand({ type: "editSelectAll" });
    });

    expectNativeEditActions(harness, ["copy", "cut", "paste", "selectAll"]);
    expectNoFileClipboardActions(harness);
    expect(screen.queryByText("Ready to paste")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready to move")).not.toBeInTheDocument();
  });

  it("does not trigger explorer file actions when keyboard copy, cut, or paste are pressed in a text input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText("Find files…");
    await act(async () => {
      searchInput.focus();
      fireEvent.keyDown(searchInput, { key: "c", metaKey: true });
      fireEvent.keyDown(searchInput, { key: "x", metaKey: true });
      fireEvent.keyDown(searchInput, { key: "v", metaKey: true });
    });

    expectNoFileClipboardActions(harness);
    expect(screen.queryByText("Ready to paste")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready to move")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Ready to paste")).not.toBeInTheDocument();
    expectNoFileClipboardActions(harness);

    await act(async () => {
      harness.emitCommand({ type: "editCut" });
    });

    const cutToastViewport = await screen.findByTestId("toast-viewport");
    expect(
      within(cutToastViewport).getByText("Select at least one item to cut."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Ready to move")).not.toBeInTheDocument();
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

  it("routes generic edit commands to native editing for path, location, rename, and settings inputs", async () => {
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
    const renameInput = await screen.findByLabelText("New name");
    await act(async () => {
      renameInput.focus();
      harness.emitCommand({ type: "editSelectAll" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });
    const settingsInput = await screen.findByLabelText("Terminal app");
    await act(async () => {
      settingsInput.focus();
      harness.emitCommand({ type: "editCut" });
    });

    expectNativeEditActions(harness, ["copy", "paste", "selectAll", "cut"]);
    expectNoFileClipboardActions(harness);
  });

  it("routes generic edit commands to the search results filter input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const filterInput = await screen.findByLabelText("Filter search results");
    await act(async () => {
      filterInput.focus();
      harness.emitCommand({ type: "editCopy" });
    });

    expectNativeEditActions(harness, ["copy"]);
    expectNoFileClipboardActions(harness);
  });

  it("uses copy and select all for readonly text inputs but ignores cut and paste", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });
    const readonlyInput = await screen.findByLabelText("Open and Edit item limit");
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

  it("does not treat non-text settings controls as native text editors", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });
    const searchScopeSelect = await screen.findByLabelText("Search scope");
    const accentColorInput = await screen.findByLabelText("Accent color");

    await act(async () => {
      searchScopeSelect.focus();
      harness.emitCommand({ type: "editCopy" });
      accentColorInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });

    expectNativeEditActions(harness, []);
    expectNoFileClipboardActions(harness);
  });

  it("keeps generic edit commands working for text inputs in help and settings views", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "?" });
    });
    const helpInput = await screen.findByLabelText("Help notes");
    await act(async () => {
      helpInput.focus();
      harness.emitCommand({ type: "editCopy" });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });
    const settingsInput = await screen.findByLabelText("Terminal app");
    await act(async () => {
      settingsInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });

    expectNativeEditActions(harness, ["copy", "paste"]);
    expectNoFileClipboardActions(harness);
  });

  it("no-ops generic edit commands outside text inputs on non-explorer views", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "?" });
    });
    await screen.findByTestId("help-view");

    await act(async () => {
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editPaste" });
      harness.emitCommand({ type: "editSelectAll" });
    });

    expectNativeEditActions(harness, []);
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

    const toastViewport = await screen.findByTestId("toast-viewport");
    expect(within(toastViewport).getByText("Ready to paste")).toBeInTheDocument();
    expect(within(toastViewport).getByText("source.txt")).toBeInTheDocument();
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

  it("starts at home when restore last visited is disabled", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreLastVisitedFolderOnStartup: false,
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

  it("restores favorite tree selection when the remembered location is a favorite root", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreLastVisitedFolderOnStartup: true,
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
        restoreLastVisitedFolderOnStartup: true,
        treeRootPath: "/",
        lastVisitedPath: "/Users/demo/Documents",
        lastVisitedFavoritePath: "/Users/demo/Documents",
        favoritesPlacement: "separate",
        favoritesPaneHeight: 240,
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
      fireEvent.click(screen.getByText("Browse"));
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

    await screen.findByRole("dialog", { name: "Rename" });
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

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

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

    expect(await screen.findByRole("dialog", { name: "Rename" })).toHaveTextContent(
      "Rename source.txt",
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("New name"), {
        target: { value: "renamed.txt" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
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
    await screen.findByRole("dialog", { name: "Rename" });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("New name"), {
        target: { value: "renamed.txt" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
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

  it("creates a new folder in the current directory with Cmd+Shift+N when nothing is selected", async () => {
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

    expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
      "Create in /Users/demo",
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Folder name"), {
        target: { value: "Notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "Notes",
      });
    });
  });

  it("selects the new folder after creation in the current directory", async () => {
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
    await screen.findByRole("dialog", { name: "New Folder" });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Folder name"), {
        target: { value: "Notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/Notes", "directory"),
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
        currentDestinationPath: "/Users/demo/Notes",
        result: {
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          targetPath: "/Users/demo/Notes",
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
              destinationPath: "/Users/demo/Notes",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/Notes")).toHaveAttribute("data-selected", "true");
    });
  });

  it("creates a new folder inside the selected folder with Cmd+Shift+N", async () => {
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
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
      "Create in /Users/demo/Folder",
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

    expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
      "Create in /Users/demo",
    );
  });

  it("does not open New Folder when a file is selected", async () => {
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

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    expect(
      harness.invocations.find((call) => call.channel === "writeOperation:createFolder"),
    ).toBeUndefined();
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

  it("uses the selected paths for Enter in the content pane", async () => {
    const harness = createAppHarness();
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

  it("uses the selected folder in the content pane as the keyboard paste target", async () => {
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

      expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
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

      expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
      if (targetTitle.startsWith("tree:")) {
        expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Copy⌘C" })).toBeNull();
        expect(screen.getByRole("button", { name: "Cut" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Cut⌘X" })).toBeNull();
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

    expect(await screen.findByRole("dialog", { name: "Move to Trash?" })).toHaveTextContent(
      "Move Folder to Trash?",
    );
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

    const dialog = await screen.findByRole("dialog", { name: "Move to Trash?" });
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Move to Trash?" })).not.toBeInTheDocument();
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

    const dialog = await screen.findByRole("dialog", { name: "Move to Trash?" });
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Move to Trash?" })).not.toBeInTheDocument();
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

    expect(await screen.findByRole("dialog", { name: "Rename" })).toBeInTheDocument();
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

  it("reroots the tree at home without keeping an out-of-home selection", async () => {
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
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/go", "directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Volumes/Shared/Project");
    await screen.findByTitle("tree:/Volumes/Shared/Project");

    await act(async () => {
      fireEvent.click(screen.getByTestId("reroot-home"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
      expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
      expect(screen.queryByTitle("tree:/Volumes/Shared/Project")).not.toBeInTheDocument();
      expect(screen.queryByTitle("/Volumes/Shared/Project")).not.toBeInTheDocument();
      expect(screen.getByTitle("tree:/Users/demo")).toBeInTheDocument();
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

  it("does not mark the selected leaf folder expanded after rerooting at home", async () => {
    const harness = createAppHarness({
      preferences: {
        treeRootPath: "/Users/demo",
        lastVisitedPath: "/Users/demo/go",
      },
      directorySnapshots: {
        "/Users/demo/go": {
          path: "/Users/demo/go",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/go/pkg", "directory")],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/go", "directory"),
        ],
        "/Users/demo/go": [createTreeChild("/Users/demo/go/pkg", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const goButton = await screen.findByTitle("tree:/Users/demo/go");
    expect(goButton).toHaveAttribute("data-expanded", "false");

    await act(async () => {
      fireEvent.click(screen.getByTestId("reroot-home"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo");
      expect(screen.getByTitle("tree:/Users/demo/go")).toHaveAttribute("data-expanded", "false");
    });
  });

  it("blocks Cmd+C in tree focus even when content still has a stale selection", async () => {
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

    expect(screen.queryByText("Ready to paste")).not.toBeInTheDocument();
  });

  it("blocks Cmd+X in tree focus even when content still has a stale selection", async () => {
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

    expect(screen.queryByText("Ready to move")).not.toBeInTheDocument();
  });

  it("blocks Cmd+V in tree focus even when the current tree folder is a valid destination", async () => {
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
    const invocationCountBeforePaste = harness.invocations.length;
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(harness.invocations).toHaveLength(invocationCountBeforePaste);
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

  it("blocks the Copy menu command in tree focus", async () => {
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

    expect(screen.queryByText("Ready to paste")).not.toBeInTheDocument();
  });

  it("blocks the Cut menu command in tree focus", async () => {
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

    expect(screen.queryByText("Ready to move")).not.toBeInTheDocument();
  });

  it("blocks the Paste menu command in tree focus", async () => {
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
    const invocationCountBeforePaste = harness.invocations.length;
    await act(async () => {
      harness.emitCommand({ type: "editPaste" });
    });

    expect(harness.invocations).toHaveLength(invocationCountBeforePaste);
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
          expect(screen.queryByRole("dialog", { name: "Rename" })).not.toBeInTheDocument();
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
      expect(screen.getByPlaceholderText("Find files…")).toBe(document.activeElement);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    expect(await screen.findByLabelText("Path")).toBeInTheDocument();
  });

  it("allows Cmd+T in tree focus for the selected tree folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "t", metaKey: true });
    });

    expect(
      harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
    ).toEqual({ path: "/Users/demo" });
  });

  it("allows Cmd+T and Cmd+Option+C for favorites in the separate favorites pane", async () => {
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
      fireEvent.keyDown(window, { key: "t", metaKey: true });
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

  it("keeps tree pane switching shortcuts working", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", metaKey: true });
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

    expect(
      await screen.findByRole("dialog", { name: "Paste cannot continue" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cannot paste an item onto itself.")).toBeInTheDocument();
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

  it("persists moved copy-paste review dialog bounds", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "conflict",
            sizeBytes: 5,
          },
        ],
        conflicts: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
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
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await screen.findByRole("dialog", { name: "Paste Requires Review" });

    await act(async () => {
      fireEvent.pointerDown(screen.getByTestId("copy-paste-review-drag-handle"), {
        button: 0,
        clientX: 180,
        clientY: 140,
      });
      fireEvent.pointerMove(window, { clientX: 220, clientY: 175 });
      fireEvent.pointerUp(window);
    });

    const persistedSizeCall = harness.invocations
      .filter((call) => call.channel === "app:updatePreferences")
      .findLast((call) => {
        const payload = call.payload as IpcRequestInput<"app:updatePreferences">;
        return payload.preferences.copyPasteReviewDialogSize !== null;
      });

    expect(persistedSizeCall).toBeDefined();
    expect(
      (persistedSizeCall?.payload as IpcRequestInput<"app:updatePreferences">).preferences
        .copyPasteReviewDialogSize,
    ).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });
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

    await screen.findByRole("dialog", { name: "Duplicate Requires Review" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace Folder" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue Duplicate" }));
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
        directory: "overwrite",
        mismatch: "skip",
      },
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
      await screen.findByRole("dialog", { name: "Paste Paused: Destination Changed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Destination")).toBeInTheDocument();
    expect(screen.getAllByText("/Users/demo/Folder").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/the destination item changed after planning/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Replace Folder" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Merge Folders" })).toBeInTheDocument();
    expect(
      screen.getByText(/replace the destination folder with the source folder/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Paste" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace Folder" }));
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
      await screen.findByRole("dialog", { name: "Move Paused: Source Missing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the source item no longer exists at its original path/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Move" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Overwrite" })).not.toBeInTheDocument();
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.getByText("Preparing write plan")).toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("locks write actions immediately while paste planning is in flight", async () => {
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    const invocationCountBeforeBlockedCopy = harness.invocations.length;
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    expect(await screen.findByText("Wait for the current write to finish")).toBeInTheDocument();
    expect(harness.invocations).toHaveLength(invocationCountBeforeBlockedCopy);

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(harness.invocations).toHaveLength(invocationCountBeforeBlockedCopy);

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true, altKey: true });
    });
    expect(harness.invocations).toHaveLength(invocationCountBeforeBlockedCopy);

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.contextMenu(sourceButton);
    });

    expect(await screen.findByRole("button", { name: "Copy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Cut" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Paste" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Copy Path" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("region", { name: "Paste In Progress" })).not.toBeInTheDocument();
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

    expect(
      await screen.findByRole("dialog", { name: "Unable to prepare paste" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Unable to prepare paste" })).toBeNull();
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

    expect(
      await screen.findByRole("dialog", { name: "Paste cannot continue" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Paste cannot continue" })).toBeNull();
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

  it("keeps the cut clipboard cleared after a cancelled cut/paste operation", async () => {
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
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

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
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

    expect(await screen.findByText("Wait for the current write to finish")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Paste In Progress" })).not.toBeInTheDocument();
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste In Progress" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
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

    expect(screen.queryByText("Ready to paste")).not.toBeInTheDocument();
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

  it("clears the clipboard after a successful paste so it cannot be repeated", async () => {
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
    expect(within(pastedToast as HTMLElement).getByText("source.txt")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste Result" })).not.toBeInTheDocument();

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

  it("clears the clipboard after an expected skip-conflicts paste result without opening a modal", async () => {
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
    expect(screen.queryByRole("dialog", { name: "Paste Result" })).not.toBeInTheDocument();
    expect(
      within(skipToast as HTMLElement).getByText(
        "1 item skipped by the selected conflict handling.",
      ),
    ).toBeInTheDocument();

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

  it("clears the cut clipboard after a failed cut/paste result", async () => {
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
      fireEvent.click(await screen.findByRole("button", { name: "Close" }));
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

    expect(await screen.findByRole("button", { name: "Retry Failed Items" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Retry Failed Items" }));
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
      fireEvent.click(await screen.findByRole("button", { name: "Retry Failed Items" }));
    });

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    const startCallsBeforeCancel = harness.invocations.filter(
      (call) => call.channel === "copyPaste:start",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("region", { name: "Paste In Progress" })).not.toBeInTheDocument();

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

    const toastViewport = await screen.findByTestId("toast-viewport");
    expect(within(toastViewport).getByText("Ready to paste")).toBeInTheDocument();
    expect(within(toastViewport).getByText("source.txt")).toBeInTheDocument();
    expect(screen.queryByText("Pasting into Folder")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(1);

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

    expect(screen.queryByRole("dialog", { name: "Paste Result" })).not.toBeInTheDocument();
    const updatedToastViewport = await screen.findByTestId("toast-viewport");
    const pastedToastTitle = within(updatedToastViewport).getByText("Pasted into Folder");
    const pastedToast = pastedToastTitle.closest(".toast-card");
    expect(pastedToast).not.toBeNull();
    expect(within(pastedToast as HTMLElement).getByText("source.txt")).toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(2);
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
    expect(screen.queryByText("Move Requires Review")).not.toBeInTheDocument();
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

    expect(await screen.findByRole("dialog", { name: "Move Requires Review" })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue Move" }));
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
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
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

    expect(await screen.findByRole("dialog", { name: "Move Requires Review" })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue Move" }));
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
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
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

    expect(await screen.findByRole("dialog", { name: "Move Requires Review" })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue Move" }));
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
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
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
          entries: [createDirectoryEntry("/Users/demo/tmp2/test1/kotlin/composetest1", "directory")],
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

function createAppHarness(
  args: {
    planResponse?: IpcResponse<"copyPaste:plan">;
    preferences?: Partial<IpcResponse<"app:getPreferences">["preferences"]>;
    directorySnapshots?: Record<string, IpcResponse<"directory:getSnapshot">>;
    treeChildrenByPath?: Record<string, IpcResponse<"tree:getChildren">["children"]>;
    copyTextError?: Error;
    pickApplicationResponse?: IpcResponse<"system:pickApplication">;
    pickDirectoryResponse?: IpcResponse<"system:pickDirectory">;
    copyPastePlanError?: Error;
    deferCopyPastePlan?: boolean;
    deferCopyPastePlanCalls?: number[];
    deferCopyPasteStart?: boolean;
    copyPasteStartError?: Error;
    openPathsWithApplicationError?: Error;
  } = {},
): {
  client: FiletrailClient;
  invocations: Array<{ channel: IpcChannel; payload: unknown }>;
  emitCommand: (command: RendererCommand) => void;
  emitProgress: (event: TestProgressEvent) => void;
  setDirectoryEntries: (
    path: string,
    entries: IpcResponse<"directory:getSnapshot">["entries"],
  ) => void;
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
  let commandListener: ((command: RendererCommand) => void) | null = null;
  let writeOperationProgressListener: ((event: WriteOperationProgressEvent) => void) | null = null;
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

  const client: FiletrailClient = {
    async invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>) {
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
        return {
          path: (payload as IpcRequestInput<"tree:getChildren">).path,
          children: treeChildrenByPath[(payload as IpcRequestInput<"tree:getChildren">).path] ?? [],
        } satisfies IpcResponse<"tree:getChildren"> as IpcResponse<C>;
      }
      if (channel === "directory:getSnapshot") {
        return directorySnapshots[
          (payload as IpcRequestInput<"directory:getSnapshot">).path
        ] as IpcResponse<C>;
      }
      if (channel === "directory:getMetadataBatch") {
        return {
          directoryPath: (payload as IpcRequestInput<"directory:getMetadataBatch">).directoryPath,
          items: [],
        } satisfies IpcResponse<"directory:getMetadataBatch"> as IpcResponse<C>;
      }
      if (channel === "item:getProperties") {
        const targetPath = (payload as IpcRequestInput<"item:getProperties">).path;
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
        if (args.copyPastePlanError) {
          throw args.copyPastePlanError;
        }
        return (args.planResponse ?? defaultPlanResponse()) as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeStart") {
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
        return {
          analysisId: "analysis-1",
          status: "complete",
          done: true,
          report: analysisReport,
          error: null,
        } as IpcResponse<C>;
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
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "writeOperation:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "writeOperation:createFolder") {
        return { operationId: "write-op-folder", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "writeOperation:rename") {
        return { operationId: "write-op-rename", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "writeOperation:trash") {
        return { operationId: "write-op-trash", status: "queued" } as IpcResponse<C>;
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
        return { jobId: "search-job-1", status: "running" } as IpcResponse<C>;
      }
      if (channel === "search:getUpdate") {
        return {
          jobId: "search-job-1",
          status: "complete",
          items: [
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
          nextCursor: 1,
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
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "app:writeLog") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "actionLog:list") {
        return { items: [] } as IpcResponse<C>;
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
      writeOperationProgressListener = listener;
      return () => {
        if (writeOperationProgressListener === listener) {
          writeOperationProgressListener = null;
        }
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
        writeOperationProgressListener?.(normalizedEvent);
        copyPasteProgressListener?.(normalizedEvent);
        return;
      }
      writeOperationProgressListener?.(event);
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
  const searchInput = await screen.findByPlaceholderText("Find files…");
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

function expectNoFileClipboardActions(harness: ReturnType<typeof createAppHarness>): void {
  expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(false);
  expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
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
