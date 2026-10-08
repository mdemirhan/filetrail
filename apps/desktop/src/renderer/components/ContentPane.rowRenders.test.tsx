// @vitest-environment jsdom

// How many rows the file list draws again when the window around it is drawn again. A
// progress or size update draws the whole window ten times a second; only the rows whose
// item changed should be drawn again with it.

import { act, render } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { ExplorerViewMode } from "../../shared/appPreferences";
import { ContentPane } from "./ContentPane";

// Each row draws one icon: counting icons counts rows.
const drawn = vi.hoisted(() => ({ rows: 0 }));
vi.mock("../lib/fileIcons", async () => {
  const actual = await vi.importActual<typeof import("../lib/fileIcons")>("../lib/fileIcons");
  return {
    ...actual,
    FileIcon: (props: ComponentProps<typeof actual.FileIcon>) => {
      drawn.rows += 1;
      return <actual.FileIcon {...props} />;
    },
  };
});
vi.mock("../lib/fileThumbnails", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/fileThumbnails")>("../lib/fileThumbnails");
  return {
    ...actual,
    FileThumbnail: () => {
      drawn.rows += 1;
      return null;
    },
  };
});
// A pane big enough to show a few dozen rows.
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({ width: 1000, height: 600 }),
}));

type Entry = ComponentProps<typeof ContentPane>["entries"][number];

const ENTRIES: Entry[] = Array.from({ length: 2000 }, (_, index) => {
  const isFolder = index % 5 === 0;
  const name = isFolder ? `Folder ${index}` : `photo-${index}.jpg`;
  return {
    path: `/Users/demo/big/${name}`,
    name,
    extension: isFolder ? "" : "jpg",
    kind: isFolder ? "directory" : "file",
    isHidden: false,
    isSymlink: false,
  };
});
const METADATA = {};
const NO_SELECTION: string[] = [];

// The props App gives the list: the same items, with callbacks made again for every render
// (as App's are).
function paneProps(
  viewMode: ExplorerViewMode,
  overrides: Partial<ComponentProps<typeof ContentPane>> = {},
): ComponentProps<typeof ContentPane> {
  return {
    isFocused: true,
    currentPath: "/Users/demo/big",
    entries: ENTRIES,
    viewMode,
    loading: false,
    error: null,
    hiddenItemCount: 0,
    metadataByPath: METADATA,
    selectedPaths: NO_SELECTION,
    sortBy: "name",
    sortDirection: "asc",
    onSelectionGesture: () => undefined,
    onActivateEntry: () => undefined,
    onSortChange: () => undefined,
    onLayoutColumnsChange: () => undefined,
    onVisiblePathsChange: () => undefined,
    onNavigatePath: () => undefined,
    onRequestPathSuggestions: async () => ({ inputPath: "", basePath: null, suggestions: [] }),
    onFocusChange: () => undefined,
    onItemContextMenu: () => undefined,
    onItemDragStart: () => undefined,
    onItemDragEnd: () => undefined,
    onItemDrop: () => undefined,
    getItemDropIndicator: () => null,
    getFolderSizeLabel: () => null,
    ...overrides,
  };
}

function rowsDrawnBy(update: () => void): number {
  const before = drawn.rows;
  act(update);
  return drawn.rows - before;
}

describe.each<ExplorerViewMode>(["details", "list", "icons"])("the %s view", (viewMode) => {
  it("draws no row again when the window is drawn again with nothing in it changed", () => {
    let rerender: ReturnType<typeof render>["rerender"] = () => undefined;
    const shown = rowsDrawnBy(() => {
      rerender = render(<ContentPane {...paneProps(viewMode)} />).rerender;
    });
    expect(shown).toBeGreaterThan(20);

    const redrawn = rowsDrawnBy(() => rerender(<ContentPane {...paneProps(viewMode)} />));

    expect(redrawn).toBe(0);
  });

  it("draws again only the rows whose selection changed", () => {
    const { rerender } = render(<ContentPane {...paneProps(viewMode)} />);
    const firstFile = ENTRIES[1]?.path ?? "";

    const redrawn = rowsDrawnBy(() =>
      rerender(
        <ContentPane
          {...paneProps(viewMode, { selectedPaths: [firstFile], selectionLeadPath: firstFile })}
        />,
      ),
    );

    expect(redrawn).toBe(1);
  });
});

describe("the details view's sizes", () => {
  it("draws again only the row of the folder whose size arrived", () => {
    const { rerender } = render(<ContentPane {...paneProps("details")} />);
    const measured = ENTRIES[5]?.path;

    const redrawn = rowsDrawnBy(() =>
      rerender(
        <ContentPane
          {...paneProps("details", {
            getFolderSizeLabel: (path) => (path === measured ? "12 MB" : null),
          })}
        />,
      ),
    );

    expect(redrawn).toBe(1);
  });
});
