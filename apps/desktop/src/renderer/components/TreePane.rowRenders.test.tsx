// @vitest-environment jsdom

// How many rows of the folder tree are drawn again when the window around it is drawn again
// (ten times a second while files are copied or folders measured).

import { act, render } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ClipboardMarksProvider } from "../lib/clipboardMarks";
import { TreePane } from "./TreePane";

// Each row asks once whether to say it is loading: counting that counts rows drawn.
const drawn = vi.hoisted(() => ({ rows: 0 }));
vi.mock("../hooks/useDelayedFlag", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useDelayedFlag")>("../hooks/useDelayedFlag");
  return {
    useDelayedFlag: (value: boolean, delayMs: number) => {
      drawn.rows += 1;
      return actual.useDelayedFlag(value, delayMs);
    },
  };
});

type Nodes = ComponentProps<typeof TreePane>["nodes"];

const CHILDREN = Array.from({ length: 60 }, (_, index) => `/Users/demo/Folder ${index}`);
const NODES: Nodes = {
  "/Users/demo": {
    path: "/Users/demo",
    name: "demo",
    kind: "directory",
    isHidden: false,
    isSymlink: false,
    expanded: true,
    loading: false,
    loaded: true,
    error: null,
    childPaths: CHILDREN,
  },
  ...Object.fromEntries(
    CHILDREN.map((path) => [
      path,
      {
        path,
        name: path.split("/").at(-1) ?? path,
        kind: "directory" as const,
        isHidden: false,
        isSymlink: false,
        expanded: false,
        loading: false,
        loaded: false,
        error: null,
        childPaths: [],
      },
    ]),
  ),
};
const FAVORITES: ComponentProps<typeof TreePane>["favorites"] = [
  { path: "/Users/demo/Desktop", icon: "desktop" },
  { path: "/Users/demo/Documents", icon: "documents" },
];
const MARKS = { tree: null, content: null };

// The props App gives the tree: the same folders, with callbacks made again for every
// render (as App's are).
function treeProps(
  overrides: Partial<ComponentProps<typeof TreePane>> = {},
): ComponentProps<typeof TreePane> {
  return {
    isFocused: true,
    rootPath: "/Users/demo",
    homePath: "/Users/demo",
    selectedTreeItemId: "fs:/Users/demo",
    favorites: FAVORITES,
    favoritesPlacement: "integrated",
    activeLeftPaneSubview: "tree",
    favoritesExpanded: true,
    nodes: NODES,
    includeHidden: false,
    onFocusChange: () => undefined,
    onLeftPaneSubviewChange: () => undefined,
    onClearSelection: () => undefined,
    onToggleExpand: () => undefined,
    onNavigate: () => undefined,
    onNavigateFavorite: () => undefined,
    onOpenInNewTab: () => undefined,
    onItemContextMenu: () => undefined,
    onItemDragEnter: () => undefined,
    onItemDragOver: () => undefined,
    onItemDrop: () => undefined,
    getItemDropIndicator: () => null,
    onToggleFavoritesExpanded: () => undefined,
    onToggleLocationsExpanded: () => undefined,
    onSelectItem: async () => true,
    onReorderFavorites: () => undefined,
    typeaheadQuery: "",
    ...overrides,
  };
}

function renderTree(props: ComponentProps<typeof TreePane>) {
  return (
    <ClipboardMarksProvider value={MARKS}>
      <TreePane {...props} />
    </ClipboardMarksProvider>
  );
}

function rowsDrawnBy(update: () => void): number {
  const before = drawn.rows;
  act(update);
  return drawn.rows - before;
}

describe.each(["integrated", "separate"] as const)("the tree with %s favorites", (placement) => {
  it("draws no row again when the window is drawn again with nothing in it changed", () => {
    let rerender: ReturnType<typeof render>["rerender"] = () => undefined;
    const shown = rowsDrawnBy(() => {
      rerender = render(renderTree(treeProps({ favoritesPlacement: placement }))).rerender;
    });
    expect(shown).toBeGreaterThan(60);

    const redrawn = rowsDrawnBy(() =>
      rerender(renderTree(treeProps({ favoritesPlacement: placement }))),
    );

    expect(redrawn).toBe(0);
  });

  it("draws again only the rows a drag moves over", () => {
    const { rerender } = render(renderTree(treeProps({ favoritesPlacement: placement })));
    const target = CHILDREN[3];

    const redrawn = rowsDrawnBy(() =>
      rerender(
        renderTree(
          treeProps({
            favoritesPlacement: placement,
            getItemDropIndicator: (item) => (item.path === target ? "valid" : null),
          }),
        ),
      ),
    );

    expect(redrawn).toBe(1);
  });
});
