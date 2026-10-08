// @vitest-environment jsdom

import { act, render } from "@testing-library/react";

import { ContentPane } from "./ContentPane";

// When each view scrolls by itself to the item it keeps in view (the selection's lead): only
// when that item changes, shows up, or is sorted somewhere else, and to keep it in view when
// it was, never because the list changed around it out of view.

type ViewMode = "details" | "list" | "icons";
type Entry = {
  path: string;
  name: string;
  extension: string;
  kind: "file";
  isHidden: boolean;
  isSymlink: boolean;
};

const entryNamed = (name: string): Entry => ({
  path: `/Users/demo/${name}`,
  name,
  extension: "txt",
  kind: "file",
  isHidden: false,
  isSymlink: false,
});
const entryAt = (index: number) => entryNamed(`item-${String(index).padStart(3, "0")}.txt`);
const folderEntries = Array.from({ length: 200 }, (_, index) => entryAt(index));
// The way each view scrolls: down, or across for the list's columns.
const scrollOf = (viewMode: ViewMode) => (viewMode === "list" ? "scrollLeft" : "scrollTop");

function renderPane(viewMode: ViewMode) {
  const pane = (props: {
    entries: Entry[];
    lead: string | null;
    sortBy?: "name" | "size";
    sortDirection?: "asc" | "desc";
  }) => (
    <ContentPane
      isFocused
      currentPath="/Users/demo"
      entries={props.entries}
      viewMode={viewMode}
      loading={false}
      error={null}
      hiddenItemCount={0}
      selectedPaths={props.lead === null ? [] : [props.lead]}
      selectionLeadPath={props.lead}
      metadataByPath={{}}
      sortBy={props.sortBy ?? "name"}
      sortDirection={props.sortDirection ?? "asc"}
      onSelectionGesture={() => undefined}
      onClearSelection={() => undefined}
      onActivateEntry={() => undefined}
      onSortChange={() => undefined}
      onLayoutColumnsChange={() => undefined}
      onVisiblePathsChange={() => undefined}
      onNavigatePath={() => undefined}
      onRequestPathSuggestions={async () => ({ inputPath: "", basePath: null, suggestions: [] })}
      onFocusChange={() => undefined}
    />
  );
  const { container, rerender } = render(pane({ entries: folderEntries, lead: null }));
  const scroller = container.querySelector<HTMLElement>(".content-scroll");
  if (!scroller) {
    throw new Error("Missing the list's scroll area.");
  }
  // Room to scroll across the list's columns.
  Object.defineProperty(scroller, "scrollWidth", { value: 100_000, configurable: true });
  const scroll = scrollOf(viewMode);
  return {
    show: (props: Parameters<typeof pane>[0]) => rerender(pane(props)),
    scrolled: () => scroller[scroll],
    scrollTo: (offset: number) => {
      scroller[scroll] = offset;
    },
  };
}

const views: ViewMode[] = ["details", "list", "icons"];

describe("ContentPane bringing the selection into view", () => {
  let restoreSize: () => void;
  // The window made wider, as the views measure it (on the next frame).
  let resizeWindow: (width: number) => Promise<void>;
  beforeEach(() => {
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    restoreSize = () => {
      height.mockRestore();
      width.mockRestore();
    };
    resizeWindow = async (nextWidth) => {
      width.mockReturnValue(nextWidth);
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    };
  });
  afterEach(() => restoreSize());

  // Back put the list back where it was scrolled, then the list measured itself and
  // scrolled to the selection.
  it.each(views)(
    "stays where it was scrolled when the window is resized (%s)",
    async (viewMode) => {
      const pane = renderPane(viewMode);
      pane.show({ entries: folderEntries, lead: entryAt(5).path });
      pane.scrollTo(2_000);

      await resizeWindow(900);

      expect(pane.scrolled()).toBe(2_000);
    },
  );

  it.each(views)("brings a new lead into view, as the arrow keys move it (%s)", (viewMode) => {
    const pane = renderPane(viewMode);
    pane.show({ entries: folderEntries, lead: entryAt(0).path });
    expect(pane.scrolled()).toBe(0);

    pane.show({ entries: folderEntries, lead: entryAt(150).path });
    const atLead = pane.scrolled();
    expect(atLead).toBeGreaterThan(0);

    pane.show({ entries: folderEntries, lead: entryAt(151).path });
    expect(pane.scrolled()).toBeGreaterThanOrEqual(atLead);
    pane.show({ entries: folderEntries, lead: entryAt(1).path });
    expect(pane.scrolled()).toBeLessThan(atLead);
  });

  it.each(views)(
    "stays where it was scrolled when an item is added above a lead out of view (%s)",
    (viewMode) => {
      const pane = renderPane(viewMode);
      pane.show({ entries: folderEntries, lead: entryAt(5).path });
      pane.scrollTo(2_000);

      // Another app adds an item that sorts first, and the folder is read again.
      pane.show({ entries: [entryNamed("a-new.txt"), ...folderEntries], lead: entryAt(5).path });

      expect(pane.scrolled()).toBe(2_000);
    },
  );

  it.each(views)(
    "stays where it was scrolled as sizes coming in re-sort the list (%s)",
    (viewMode) => {
      const pane = renderPane(viewMode);
      const bySize = { sortBy: "size" as const, sortDirection: "desc" as const };
      pane.show({ entries: folderEntries, lead: entryAt(5).path, ...bySize });
      pane.scrollTo(2_000);

      // A folder's size came in: it moves ahead of the lead.
      const resorted = [entryAt(150), ...folderEntries.filter((entry) => entry !== entryAt(150))];
      pane.show({ entries: resorted, lead: entryAt(5).path, ...bySize });

      expect(pane.scrolled()).toBe(2_000);
    },
  );

  it.each(views)(
    "keeps the lead in view when the list changes around it in view (%s)",
    (viewMode) => {
      const pane = renderPane(viewMode);
      pane.show({ entries: folderEntries, lead: entryAt(150).path });
      const atLead = pane.scrolled();

      // Fifty items come before it: where the list is scrolled, it would be out of view.
      const added = Array.from({ length: 50 }, (_, index) => entryNamed(`a-${index}.txt`));
      pane.show({ entries: [...added, ...folderEntries], lead: entryAt(150).path });

      expect(pane.scrolled()).toBeGreaterThan(atLead);
    },
  );

  it.each(views)(
    "brings the lead into view when the list is sorted another way (%s)",
    (viewMode) => {
      const pane = renderPane(viewMode);
      pane.show({ entries: folderEntries, lead: entryAt(0).path });
      expect(pane.scrolled()).toBe(0);

      // The order is chosen before the folder is read again in it.
      pane.show({ entries: folderEntries, lead: entryAt(0).path, sortDirection: "desc" });
      pane.show({
        entries: [...folderEntries].reverse(),
        lead: entryAt(0).path,
        sortDirection: "desc",
      });

      expect(pane.scrolled()).toBeGreaterThan(0);
    },
  );

  it.each(views)("brings a new item into view once the list has it (%s)", (viewMode) => {
    const pane = renderPane(viewMode);
    // A new folder is selected before the folder is read again with it.
    const made = entryNamed("zz-new folder.txt");
    pane.show({ entries: folderEntries, lead: made.path });
    expect(pane.scrolled()).toBe(0);

    pane.show({ entries: [...folderEntries, made], lead: made.path });

    expect(pane.scrolled()).toBeGreaterThan(0);
  });
});
