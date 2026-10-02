// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { ThemeMode } from "../../shared/appPreferences";
import { DEFAULT_TOP_TOOLBAR_ITEMS, type ToolbarItemId } from "../../shared/toolbarItems";
import { SettingsView } from "./SettingsView";

function renderSettingsView(overrides: Partial<ComponentProps<typeof SettingsView>> = {}) {
  return render(
    <SettingsView
      theme="macos-dark"
      accent="#daa520"
      zoomPercent={100}
      uiFontFamily="lexend"
      compactListView={false}
      compactDetailsView={false}
      compactIconView={false}
      compactTreeView={false}
      singleClickExpandTreeItems={false}
      highlightHoveredItems={true}
      detailColumns={{
        size: true,
        modified: true,
        permissions: true,
        kind: true,
        created: false,
      }}
      layoutMode="wide"
      notificationsEnabled={true}
      notificationDurationSeconds={4}
      topToolbarItems={[...DEFAULT_TOP_TOOLBAR_ITEMS]}
      restoreLastVisitedFolderOnStartup={false}
      restoreOpenTabsOnStartup={false}
      homePath="/Users/demo"
      terminalApp={null}
      defaultTextEditor={{
        appPath: "/System/Applications/TextEdit.app",
        appName: "TextEdit",
      }}
      favorites={[
        {
          path: "/Users/demo",
          icon: "home",
        },
        {
          path: "/Applications",
          icon: "applications",
        },
      ]}
      favoritesPlacement="integrated"
      openWithApplications={[
        {
          id: "vscode",
          appPath: "/Applications/Visual Studio Code.app",
          appName: "Visual Studio Code",
        },
        {
          id: "zed",
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
      ]}
      fileActivationAction="open"
      openItemLimit={5}
      accentOptions={[
        { value: "#daa520", label: "Gold" },
        { value: "#d4845a", label: "Copper" },
        { value: "#e8806a", label: "Coral" },
        { value: "#d84a4a", label: "Ruby" },
        { value: "#8094b8", label: "Slate" },
        { value: "#23c7d9", label: "Aqua" },
        { value: "#2cb5a0", label: "Teal" },
      ]}
      uiFontOptions={[{ value: "lexend", label: "Lexend" }]}
      notificationDurationSecondsOptions={[4, 6]}
      onThemeChange={() => undefined}
      onAccentChange={() => undefined}
      onZoomPercentChange={() => undefined}
      onUiFontFamilyChange={() => undefined}
      onResetAppearance={() => undefined}
      onCompactListViewChange={() => undefined}
      onCompactDetailsViewChange={() => undefined}
      onCompactIconViewChange={() => undefined}
      onCompactTreeViewChange={() => undefined}
      onSingleClickExpandTreeItemsChange={() => undefined}
      onHighlightHoveredItemsChange={() => undefined}
      onDetailColumnsChange={() => undefined}
      onNotificationsEnabledChange={() => undefined}
      onNotificationDurationSecondsChange={() => undefined}
      onTopToolbarItemsChange={() => undefined}
      onResetTopToolbar={() => undefined}
      onRestoreLastVisitedFolderOnStartupChange={() => undefined}
      onRestoreOpenTabsOnStartupChange={() => undefined}
      onBrowseTerminalApp={() => undefined}
      onClearTerminalApp={() => undefined}
      onBrowseDefaultTextEditor={() => undefined}
      onClearDefaultTextEditor={() => undefined}
      onAddFavorite={() => undefined}
      onBrowseFavorite={() => undefined}
      onMoveFavorite={() => undefined}
      onRemoveFavorite={() => undefined}
      onRestoreDefaultFavorites={() => undefined}
      onFavoriteIconChange={() => undefined}
      onFavoritesPlacementChange={() => undefined}
      onAddOpenWithApplication={() => undefined}
      onBrowseOpenWithApplication={() => undefined}
      onMoveOpenWithApplication={() => undefined}
      onRemoveOpenWithApplication={() => undefined}
      onFileActivationActionChange={() => undefined}
      onOpenItemLimitChange={() => undefined}
      {...overrides}
    />,
  );
}

describe("SettingsView", () => {
  it("exposes the selected layout mode on the root element", () => {
    renderSettingsView({ layoutMode: "compact" });

    expect(
      screen.getByRole("heading", { name: "Settings" }).closest(".settings-view"),
    ).toHaveAttribute("data-layout", "compact");
  });

  it("uses the header without a description row", () => {
    renderSettingsView();

    expect(screen.getByText("File Trail")).toBeInTheDocument();
    expect(screen.queryByText("Application preferences and configuration")).not.toBeInTheDocument();
  });

  it.each([
    ["macos-light", "#ffffff"],
    ["warm-paper", "#f0ede7"],
    ["sand", "#ece7dc"],
    ["macos-dark", "#1e1e20"],
    ["tomorrow-night", "#151617"],
    ["catppuccin-mocha", "#0e0e18"],
  ] satisfies Array<[ThemeMode, string]>)(
    "applies the supplied %s theme palette to the page background",
    (theme, expectedBackground) => {
      renderSettingsView({ theme });

      expect(
        screen.getByRole("heading", { name: "Settings" }).closest(".settings-view"),
      ).toHaveStyle({
        background: expectedBackground,
      });
    },
  );

  it("offers one palette per side instead of a single list of themes", () => {
    renderSettingsView({ theme: "auto", autoLightTheme: "sand", autoDarkTheme: "tomorrow-night" });

    expect(screen.queryByRole("combobox", { name: "Theme" })).toBeNull();
    const lightPalette = screen.getByLabelText("Light palette");
    const darkPalette = screen.getByLabelText("Dark palette");
    expect(lightPalette).toHaveValue("sand");
    expect(darkPalette).toHaveValue("tomorrow-night");
    expect(
      within(lightPalette)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["macOS Light", "Warm Paper", "Sand"]);
    expect(
      within(darkPalette)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["macOS Dark", "Catppuccin Mocha", "Tomorrow Night"]);
  });

  it("changes only the palette of a side while Auto is on", () => {
    const onThemeChange = vi.fn();
    const onAutoLightThemeChange = vi.fn();
    const onAutoDarkThemeChange = vi.fn();
    renderSettingsView({
      theme: "auto",
      autoLightTheme: "macos-light",
      autoDarkTheme: "macos-dark",
      onThemeChange,
      onAutoLightThemeChange,
      onAutoDarkThemeChange,
    });

    fireEvent.change(screen.getByLabelText("Light palette"), { target: { value: "warm-paper" } });
    fireEvent.change(screen.getByLabelText("Dark palette"), {
      target: { value: "catppuccin-mocha" },
    });

    expect(onAutoLightThemeChange).toHaveBeenCalledWith("warm-paper");
    expect(onAutoDarkThemeChange).toHaveBeenCalledWith("catppuccin-mocha");
    expect(onThemeChange).not.toHaveBeenCalled();
  });

  it("applies a palette at once when it is the side on screen", () => {
    const onThemeChange = vi.fn();
    const onAutoLightThemeChange = vi.fn();
    const onAutoDarkThemeChange = vi.fn();
    renderSettingsView({
      theme: "macos-dark",
      autoLightTheme: "macos-light",
      autoDarkTheme: "macos-dark",
      onThemeChange,
      onAutoLightThemeChange,
      onAutoDarkThemeChange,
    });

    // Dark mode is showing: its palette changes the theme too.
    fireEvent.change(screen.getByLabelText("Dark palette"), {
      target: { value: "tomorrow-night" },
    });
    expect(onAutoDarkThemeChange).toHaveBeenCalledWith("tomorrow-night");
    expect(onThemeChange).toHaveBeenCalledWith("tomorrow-night");

    // The light palette is only stored for later.
    fireEvent.change(screen.getByLabelText("Light palette"), { target: { value: "sand" } });
    expect(onAutoLightThemeChange).toHaveBeenCalledWith("sand");
    expect(onThemeChange).toHaveBeenCalledTimes(1);
  });

  it("switches between Auto, Light and Dark with the palette of each side", () => {
    const onThemeChange = vi.fn();
    renderSettingsView({
      theme: "auto",
      autoLightTheme: "sand",
      autoDarkTheme: "catppuccin-mocha",
      onThemeChange,
    });

    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(onThemeChange.mock.calls).toEqual([["sand"], ["catppuccin-mocha"]]);
  });

  it("has one accent color and no separate toolbar, favorite or text colors", () => {
    renderSettingsView();

    expect(screen.getByText("Accent color")).toBeInTheDocument();
    expect(screen.queryByText("Accent toolbar buttons")).toBeNull();
    expect(screen.queryByText("Accent favorite items")).toBeNull();
    expect(screen.queryByText("Accent favorite text")).toBeNull();
    expect(screen.queryByText("Text colors")).toBeNull();
    expect(screen.queryByLabelText("Primary text")).toBeNull();
  });

  it("renders the supplied accent options and selected label", () => {
    renderSettingsView({ accent: "#2cb5a0" });

    expect(screen.getByLabelText("Accent color Gold")).toBeInTheDocument();
    expect(screen.getByLabelText("Accent color Teal")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Teal")).toBeInTheDocument();
  });

  it("shows a custom accent picker for non-preset colors", () => {
    const onAccentChange = vi.fn();
    renderSettingsView({
      accent: "#112233",
      onAccentChange,
    });

    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByText("Custom color")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Accent color Custom"));
    fireEvent.change(screen.getByLabelText("Accent color Custom value"), {
      target: { value: "#123456" },
    });

    expect(onAccentChange).toHaveBeenCalledWith("#123456");
  });

  it("updates the toolbar editor and reset action", () => {
    const onTopToolbarItemsChange = vi.fn();
    const onResetTopToolbar = vi.fn();
    renderSettingsView({
      topToolbarItems: ["back", "title", "clipboard", "viewOptions", "search"],
      onTopToolbarItemsChange,
      onResetTopToolbar,
    });

    const topToolbarEditor = screen.getByRole("group", { name: "Toolbar" });

    fireEvent.click(within(topToolbarEditor).getByRole("button", { name: "Add Copy to Toolbar" }));
    fireEvent.mouseEnter(within(topToolbarEditor).getByRole("button", { name: "Back" }));
    fireEvent.click(
      within(topToolbarEditor).getByRole("button", { name: "Remove Back from Toolbar" }),
    );
    fireEvent.click(within(topToolbarEditor).getByRole("button", { name: "Reset Toolbar" }));

    // A new item goes ahead of the fixed items that close the toolbar.
    expect(onTopToolbarItemsChange).toHaveBeenNthCalledWith(1, [
      "back",
      "title",
      "copySelection",
      "clipboard",
      "viewOptions",
      "search",
    ]);
    expect(onTopToolbarItemsChange).toHaveBeenNthCalledWith(2, [
      "title",
      "clipboard",
      "viewOptions",
      "search",
    ]);
    expect(onResetTopToolbar).toHaveBeenCalledTimes(1);
  });

  it("lets the title, clipboard, view options and search be moved but not removed", () => {
    const onTopToolbarItemsChange = vi.fn();
    renderSettingsView({
      topToolbarItems: ["back", "title", "sort", "clipboard", "viewOptions", "search"],
      onTopToolbarItemsChange,
    });

    const topToolbarEditor = screen.getByRole("group", { name: "Toolbar" });
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setDragImage: () => undefined,
    };
    const tile = (name: string) => within(topToolbarEditor).getByRole("button", { name });

    for (const name of ["Title", "Clipboard", "View Options", "Search"]) {
      // No remove button, nothing to add it back with, and dropping it outside the strip
      // leaves it where it was.
      fireEvent.mouseEnter(tile(name));
      expect(
        within(topToolbarEditor).queryByRole("button", { name: `Remove ${name} from Toolbar` }),
      ).toBeNull();
      fireEvent.mouseLeave(tile(name));
      expect(
        within(topToolbarEditor).queryByRole("button", { name: `Add ${name} to Toolbar` }),
      ).toBeNull();
      expect(tile(name)).toHaveAttribute("draggable", "true");
      fireEvent.dragStart(tile(name), { dataTransfer });
      fireEvent.drop(topToolbarEditor, { dataTransfer });
      fireEvent.dragEnd(tile(name), { dataTransfer });
    }
    expect(onTopToolbarItemsChange).not.toHaveBeenCalled();

    // Search dragged onto Back takes the first place; the title dragged onto Search goes last.
    fireEvent.dragStart(tile("Search"), { dataTransfer });
    fireEvent.drop(tile("Back"), { dataTransfer });
    expect(onTopToolbarItemsChange).toHaveBeenLastCalledWith([
      "search",
      "back",
      "title",
      "sort",
      "clipboard",
      "viewOptions",
    ]);
    fireEvent.dragStart(tile("Title"), { dataTransfer });
    fireEvent.drop(tile("Search"), { dataTransfer });
    expect(onTopToolbarItemsChange).toHaveBeenLastCalledWith([
      "back",
      "sort",
      "clipboard",
      "viewOptions",
      "search",
      "title",
    ]);
  });

  it("shows a toolbar saved before the title could be moved with the fixed items in place", () => {
    renderSettingsView({ topToolbarItems: ["back", "forward", "sort", "search"] });

    const tiles = Array.from(
      screen.getByRole("group", { name: "Toolbar" }).querySelectorAll("[data-toolbar-tile]"),
      (tile) => tile.getAttribute("data-toolbar-tile"),
    );
    expect(tiles).toEqual([
      "back",
      "forward",
      "title",
      "sort",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("names every toolbar tile, in the toolbar and in the list of items to add", () => {
    renderSettingsView({ topToolbarItems: ["back", "forward", "search"] });

    const topToolbarEditor = screen.getByRole("group", { name: "Toolbar" });
    // The name under each tile is shown as text, not only as a hover tooltip.
    for (const label of ["Back", "Forward", "Refresh", "Go To", "Open in Terminal"]) {
      expect(within(topToolbarEditor).getByText(label)).toBeVisible();
    }
    expect(within(topToolbarEditor).getByText("Available Items")).toBeInTheDocument();
    // The buttons keep their own names for assistive technology.
    expect(within(topToolbarEditor).getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(
      within(topToolbarEditor).getByRole("button", { name: "Add Refresh to Toolbar" }),
    ).toBeInTheDocument();
  });

  it("draws every tile in the toolbar alike, whatever kind of control it is", () => {
    renderSettingsView();

    const editor = screen.getByRole("group", { name: "Toolbar" });
    // A button, a toggle, a segmented control, two menus and the search field.
    const iconColors = ["Back", "Info Panel", "View Mode", "Sort", "View Options", "Search"].map(
      (name) => {
        const icon = within(editor).getByRole("button", { name }).querySelector("svg.toolbar-icon");
        return (icon?.parentElement as HTMLElement).style.color;
      },
    );
    expect(new Set(iconColors).size).toBe(1);
    expect(iconColors[0]).not.toBe("");
  });

  it("keeps the title's tile one size wherever it is put", () => {
    const widthOf = (order: ToolbarItemId[]) => {
      const view = renderSettingsView({ topToolbarItems: order });
      const tile = view.container.querySelector<HTMLElement>('[data-toolbar-tile="title"]');
      const sizes = [tile?.style.flex, (tile?.children[0] as HTMLElement).style.width];
      view.unmount();
      return sizes;
    };

    const first = widthOf(["title", "back", "clipboard", "viewOptions", "search"]);
    // It does not grow to fill its row, as it once did when it wrapped onto a row of its own.
    expect(first).toEqual(["0 0 auto", "134px"]);
    expect(widthOf(["back", "clipboard", "viewOptions", "search", "title"])).toEqual(first);
  });

  it("offers Reset only while the toolbar is not the default one", () => {
    const untouched = renderSettingsView({ topToolbarItems: [...DEFAULT_TOP_TOOLBAR_ITEMS] });
    expect(screen.getByRole("button", { name: "Reset Toolbar" })).toBeDisabled();
    untouched.unmount();

    renderSettingsView({
      topToolbarItems: ["back", "title", "clipboard", "viewOptions", "search"],
    });
    expect(screen.getByRole("button", { name: "Reset Toolbar" })).toBeEnabled();
  });

  it("uses the one Settings button for every Reset, so each answers the pointer", () => {
    renderSettingsView();

    for (const name of ["Reset Appearance", "Reset Toolbar"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("settings-button");
    }
  });

  it("draws no line under the last row of a group, whichever row that is", () => {
    const view = renderSettingsView();

    // Rows leave their line to the stylesheet, which knows which one is last.
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>(".settings-row"));
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((row) => row.style.borderBottom !== "")).toEqual([]);
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    expect(styles).toMatch(/\.settings-row:last-child \{\s*border-bottom: 0;/u);

    // Each group ends with a row, and has no line of its own between rows.
    for (const card of Array.from(view.container.querySelectorAll<HTMLElement>(".settings-card"))) {
      const title = card.parentElement?.querySelector("h3")?.textContent;
      if (card.querySelector(".settings-row") === null) {
        continue;
      }
      for (const child of Array.from(card.children)) {
        expect(`${title}: ${(child as HTMLElement).style.borderTop}`).toBe(`${title}: `);
      }
    }
  });

  it("gives every control one height and a hairline outline", () => {
    const view = renderSettingsView();

    const controls = Array.from(
      view.container.querySelectorAll<HTMLElement>(
        "select, input[type=text], input[type=number], button.settings-button",
      ),
      // The Shortcuts search field takes the same size and outline from the stylesheet.
    ).filter((control) => !control.classList.contains("shortcut-settings-search"));
    expect(controls.length).toBeGreaterThan(10);
    expect(new Set(controls.map((control) => control.style.height))).toEqual(new Set(["28px"]));
    expect(new Set(controls.map((control) => control.style.borderWidth))).toEqual(
      new Set(["0.5px"]),
    );
  });

  it("has one toolbar to arrange, and nothing about rails", () => {
    renderSettingsView();

    const editors = screen
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label"))
      .filter((label) => label !== null);
    expect(editors).toEqual(["Toolbar"]);
    expect(screen.queryByLabelText("Show left rail")).toBeNull();
    expect(screen.queryByLabelText("Show bottom rail")).toBeNull();
  });

  it("allows adding repeatable separators", () => {
    const onTopToolbarItemsChange = vi.fn();
    renderSettingsView({
      topToolbarItems: ["back", "topSeparator", "title", "clipboard", "viewOptions", "search"],
      onTopToolbarItemsChange,
    });

    fireEvent.click(
      within(screen.getByRole("group", { name: "Toolbar" })).getByRole("button", {
        name: "Add Separator to Toolbar",
      }),
    );

    expect(onTopToolbarItemsChange).toHaveBeenCalledWith([
      "back",
      "topSeparator",
      "title",
      "topSeparator",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("removes a toolbar item when it is dropped outside the active toolbar strip", () => {
    const onTopToolbarItemsChange = vi.fn();
    renderSettingsView({
      topToolbarItems: ["back", "title", "clipboard", "viewOptions", "search"],
      onTopToolbarItemsChange,
    });

    const topToolbarEditor = screen.getByRole("group", { name: "Toolbar" });
    const backButton = within(topToolbarEditor).getByRole("button", { name: "Back" });
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setDragImage: () => undefined,
    };

    fireEvent.dragStart(backButton, { dataTransfer });
    fireEvent.drop(topToolbarEditor, { dataTransfer });

    expect(onTopToolbarItemsChange).toHaveBeenCalledWith([
      "title",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("offers the app's own buttons and the file actions, not the fixed or retired items", () => {
    renderSettingsView();

    for (const name of ["Settings", "Theme", "Help", "New Tab", "Quick Look", "Show in Finder"]) {
      expect(screen.getByRole("button", { name: `Add ${name} to Toolbar` })).toBeInTheDocument();
    }
    // Always in the toolbar already.
    for (const name of ["Search", "Title", "Clipboard", "View Options"]) {
      expect(screen.queryByRole("button", { name: `Add ${name} to Toolbar` })).toBeNull();
    }
    // Went with the rails (Favorites has the places), or does what a double-click does.
    for (const name of [
      "Home",
      "Macintosh HD",
      "Applications",
      "Trash",
      "Root Tree at Home",
      "Open Selected Item",
    ]) {
      expect(screen.queryByRole("button", { name: `Add ${name} to Toolbar` })).toBeNull();
    }
  });

  it("adds Settings ahead of the search field, like any other button", () => {
    const onTopToolbarItemsChange = vi.fn();
    renderSettingsView({ onTopToolbarItemsChange });

    fireEvent.click(screen.getByRole("button", { name: "Add Settings to Toolbar" }));

    expect(onTopToolbarItemsChange).toHaveBeenCalledWith([
      "back",
      "forward",
      "title",
      "clipboard",
      "view",
      "sort",
      "settings",
      "search",
      "viewOptions",
      "infoPanel",
    ]);
  });

  it("shows the items to add in a stable grouped order", () => {
    renderSettingsView({
      topToolbarItems: ["back", "title", "clipboard", "viewOptions", "search"],
    });

    const addButtons = Array.from(
      screen.getByRole("group", { name: "Toolbar" }).querySelectorAll('button[aria-label^="Add "]'),
      (button) => button.getAttribute("aria-label")?.replace(/^Add (.*) to Toolbar$/u, "$1"),
    );
    expect(addButtons).toEqual([
      "Separator",
      "Forward",
      "Enclosing Folder",
      "Go To",
      "Refresh",
      "New Tab",
      "View Mode",
      "Sort",
      "Folders First",
      "Hidden Files",
      "Info Panel",
      "Info Row",
      "Open",
      "Quick Look",
      "Edit",
      "Copy",
      "Cut",
      "Paste",
      "Rename",
      "Move To",
      "Duplicate",
      "New Folder",
      "Move to Trash",
      "Open in Terminal",
      "Show in Finder",
      "Copy Path",
      "Theme",
      "Settings",
      "Help",
    ]);
  });

  it("forwards single-click tree expansion preference changes", () => {
    const onSingleClickExpandTreeItemsChange = vi.fn();
    renderSettingsView({
      singleClickExpandTreeItems: false,
      onSingleClickExpandTreeItemsChange,
    });

    fireEvent.click(screen.getByLabelText("Single-click expand tree folders"));

    expect(onSingleClickExpandTreeItemsChange).toHaveBeenCalledWith(true);
  });

  it("forwards hovered item highlight toggle changes", () => {
    const onHighlightHoveredItemsChange = vi.fn();
    renderSettingsView({
      highlightHoveredItems: true,
      onHighlightHoveredItemsChange,
    });

    fireEvent.click(screen.getByLabelText("Highlight hovered items"));

    expect(onHighlightHoveredItemsChange).toHaveBeenCalledWith(false);
  });

  it("accepts typed zoom percentages and normalizes them on blur", () => {
    const onZoomPercentChange = vi.fn();
    renderSettingsView({ onZoomPercentChange });

    const input = screen.getByLabelText("Zoom level");
    fireEvent.change(input, { target: { value: "%107" } });
    fireEvent.blur(input);

    expect(onZoomPercentChange).toHaveBeenCalledWith(107);
    expect(input).toHaveValue("107%");
  });

  it("reverts invalid zoom input to the current persisted value", () => {
    const onZoomPercentChange = vi.fn();
    renderSettingsView({ zoomPercent: 125, onZoomPercentChange });

    const input = screen.getByLabelText("Zoom level");
    fireEvent.change(input, { target: { value: "oops" } });
    fireEvent.blur(input);

    expect(onZoomPercentChange).toHaveBeenCalledWith(100);
    expect(input).toHaveValue("100%");
  });

  it("keeps the Terminal app with the other app choices on the Files tab", () => {
    renderSettingsView({ activeTab: "files" });
    const fileOpening = screen.getByText("File Opening").closest("section");
    if (!(fileOpening instanceof HTMLElement)) {
      throw new Error("Missing File Opening section.");
    }
    expect(within(fileOpening).getAllByText("Default text editor").length).toBeGreaterThan(0);
    expect(within(fileOpening).getAllByText("Terminal app").length).toBeGreaterThan(0);
    expect(
      within(fileOpening).getByRole("button", { name: "Browse terminal app" }),
    ).toBeInTheDocument();
    cleanup();

    // General keeps the startup choices only.
    renderSettingsView({ activeTab: "general" });
    expect(screen.getByText("Restore last visited folder")).toBeInTheDocument();
    expect(screen.getByText("Restore open tabs")).toBeInTheDocument();
    expect(screen.queryAllByText("Terminal app")).toHaveLength(0);
  });

  it("switches Restore open tabs on its own, next to Restore last visited folder", () => {
    const onRestoreOpenTabsOnStartupChange = vi.fn();
    renderSettingsView({ activeTab: "general", onRestoreOpenTabsOnStartupChange });

    fireEvent.click(screen.getByRole("switch", { name: "Restore open tabs" }));

    expect(onRestoreOpenTabsOnStartupChange).toHaveBeenCalledWith(true);
  });

  it("forwards terminal browse and reset actions", () => {
    const onBrowseTerminalApp = vi.fn();
    const onClearTerminalApp = vi.fn();
    renderSettingsView({
      terminalApp: {
        appPath: "/Applications/iTerm.app",
        appName: "iTerm",
      },
      onBrowseTerminalApp,
      onClearTerminalApp,
    });

    expect(screen.getByText("iTerm")).toBeInTheDocument();
    expect(screen.getByText("/Applications/iTerm.app")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Browse terminal app" }));
    fireEvent.click(screen.getByRole("button", { name: "Use default terminal app" }));

    expect(onBrowseTerminalApp).toHaveBeenCalled();
    expect(onClearTerminalApp).toHaveBeenCalled();
  });

  it("renders and updates file opening preferences", () => {
    const onBrowseDefaultTextEditor = vi.fn();
    const onClearDefaultTextEditor = vi.fn();
    const onFileActivationActionChange = vi.fn();
    const onOpenItemLimitChange = vi.fn();
    renderSettingsView({
      fileActivationAction: "open",
      openItemLimit: 5,
      defaultTextEditor: {
        appPath: "/Applications/Zed.app",
        appName: "Zed",
      },
      onBrowseDefaultTextEditor,
      onClearDefaultTextEditor,
      onFileActivationActionChange,
      onOpenItemLimitChange,
    });

    const editorGroup = screen.getByRole("group", { name: "Default text editor" });
    expect(within(editorGroup).getByText("Zed")).toBeInTheDocument();
    expect(within(editorGroup).getByText("/Applications/Zed.app")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("File activation"), {
      target: { value: "edit" },
    });
    fireEvent.change(screen.getByLabelText("Open and Edit item limit"), {
      target: { value: "9" },
    });
    fireEvent.blur(screen.getByLabelText("Open and Edit item limit"));
    fireEvent.click(screen.getByRole("button", { name: "Browse default text editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Use default text editor" }));

    expect(onFileActivationActionChange).toHaveBeenCalledWith("edit");
    expect(onOpenItemLimitChange).toHaveBeenCalledWith(9);
    expect(onBrowseDefaultTextEditor).toHaveBeenCalled();
    expect(onClearDefaultTextEditor).toHaveBeenCalled();
  });

  it("forwards notification preference changes", () => {
    const onNotificationsEnabledChange = vi.fn();
    const onNotificationDurationSecondsChange = vi.fn();
    renderSettingsView({
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      notificationDurationSecondsOptions: [4, 6],
      onNotificationsEnabledChange,
      onNotificationDurationSecondsChange,
    });

    fireEvent.click(screen.getByLabelText("Show notifications"));
    fireEvent.change(screen.getByLabelText("Notification duration"), {
      target: { value: "6" },
    });

    expect(onNotificationsEnabledChange).toHaveBeenCalledWith(false);
    expect(onNotificationDurationSecondsChange).toHaveBeenCalledWith(6);
  });

  it("forwards the copy and cut preference changes", () => {
    const onHighlightClipboardItemsInTreeChange = vi.fn();
    const onHighlightClipboardItemsInContentChange = vi.fn();
    const onNotifyClipboardItemsChange = vi.fn();
    renderSettingsView({
      highlightClipboardItemsInTree: true,
      highlightClipboardItemsInContent: false,
      notifyClipboardItems: true,
      onHighlightClipboardItemsInTreeChange,
      onHighlightClipboardItemsInContentChange,
      onNotifyClipboardItemsChange,
    });

    expect(screen.getByText("Copy and Cut")).toBeInTheDocument();
    const treeToggle = screen.getByLabelText("Highlight copied items in the folder tree");
    const contentToggle = screen.getByLabelText("Highlight copied items in the file list");
    expect(treeToggle).toHaveAttribute("aria-checked", "true");
    expect(contentToggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(treeToggle);
    fireEvent.click(contentToggle);
    fireEvent.click(screen.getByLabelText("Notify what was copied"));

    expect(onHighlightClipboardItemsInTreeChange).toHaveBeenCalledWith(false);
    expect(onHighlightClipboardItemsInContentChange).toHaveBeenCalledWith(true);
    expect(onNotifyClipboardItemsChange).toHaveBeenCalledWith(false);
  });

  it("has nothing to notify of copies while notifications are off", () => {
    renderSettingsView({ notificationsEnabled: false });
    expect(screen.getByLabelText("Notify what was copied")).toBeDisabled();
  });

  it("renders configured Open With applications", () => {
    renderSettingsView();

    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("/Applications/Visual Studio Code.app")).toBeInTheDocument();
    expect(screen.getByText("Zed")).toBeInTheDocument();
  });

  it("renders configured favorites with compact icon pickers", () => {
    renderSettingsView();

    expect(screen.getByLabelText("Favorite icon for Home")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("/Users/demo")).toBeInTheDocument();
    expect(screen.getByLabelText("Favorite icon for Applications")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("/Applications")).toBeInTheDocument();
    expect(screen.queryByText("Icon")).toBeNull();

    const homeControls = screen.getByRole("button", { name: "Browse Home" }).parentElement;
    expect(homeControls).not.toBeNull();
    if (!homeControls) {
      throw new Error("Home controls wrapper missing.");
    }
    expect(within(homeControls).getByLabelText("Favorite icon for Home")).toBeInTheDocument();
  });

  it("forwards favorites placement changes", () => {
    const onFavoritesPlacementChange = vi.fn();
    renderSettingsView({
      favoritesPlacement: "integrated",
      onFavoritesPlacementChange,
    });

    fireEvent.change(screen.getByLabelText("Favorites placement"), {
      target: { value: "separate" },
    });

    expect(onFavoritesPlacementChange).toHaveBeenCalledWith("separate");
  });

  it("forwards favorite add, browse, move, icon, and remove actions", () => {
    const onAddFavorite = vi.fn();
    const onBrowseFavorite = vi.fn();
    const onMoveFavorite = vi.fn();
    const onRemoveFavorite = vi.fn();
    const onFavoriteIconChange = vi.fn();

    renderSettingsView({
      onAddFavorite,
      onBrowseFavorite,
      onMoveFavorite,
      onRemoveFavorite,
      onFavoriteIconChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Favorite" }));
    fireEvent.click(screen.getByLabelText("Favorite icon for Home"));
    fireEvent.click(screen.getByLabelText("Favorite icon for Home: Star"));
    fireEvent.click(screen.getByRole("button", { name: "Browse Home" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Applications up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Applications" }));

    expect(onAddFavorite).toHaveBeenCalledTimes(1);
    expect(onFavoriteIconChange).toHaveBeenCalledWith(0, "star");
    expect(onBrowseFavorite).toHaveBeenCalledWith(0);
    expect(onMoveFavorite).toHaveBeenCalledWith(1, "up");
    expect(onRemoveFavorite).toHaveBeenCalledWith(1);
  });

  it("renders favorite icon picker popovers in a body portal", () => {
    renderSettingsView();

    fireEvent.click(screen.getByLabelText("Favorite icon for Home"));

    const iconDialog = screen.getByRole("dialog", { name: "Favorite icon for Home options" });
    expect(iconDialog.parentElement).toBe(document.body);
    expect(iconDialog).toHaveStyle({
      position: "fixed",
      gridTemplateColumns: "repeat(6, 34px)",
    });
  });

  it("forwards Open With add, browse, move, and remove actions", () => {
    const onAddOpenWithApplication = vi.fn();
    const onBrowseOpenWithApplication = vi.fn();
    const onMoveOpenWithApplication = vi.fn();
    const onRemoveOpenWithApplication = vi.fn();

    renderSettingsView({
      onAddOpenWithApplication,
      onBrowseOpenWithApplication,
      onMoveOpenWithApplication,
      onRemoveOpenWithApplication,
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Open With application" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse Visual Studio Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Zed up" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Zed" }));

    expect(onAddOpenWithApplication).toHaveBeenCalledTimes(1);
    expect(onBrowseOpenWithApplication).toHaveBeenCalledWith("vscode");
    expect(onMoveOpenWithApplication).toHaveBeenCalledWith("zed", "up");
    expect(onRemoveOpenWithApplication).toHaveBeenCalledWith("zed");
  });
});
