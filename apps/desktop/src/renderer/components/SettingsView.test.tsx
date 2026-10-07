// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { SettingsView } from "./SettingsView";

// A list in Settings with the buttons under it. Queries are kept to it: looking for a role
// across the whole page is slow, slow enough on CI with coverage to run past a test's time.
function settingsList(name: string) {
  const listbox = screen.getByRole("listbox", { name });
  return within(listbox.parentElement as HTMLElement);
}

function renderSettingsView(overrides: Partial<ComponentProps<typeof SettingsView>> = {}) {
  return render(
    <SettingsView
      theme="dark"
      accent="#daa520"
      zoomPercent={100}
      compactListView={false}
      compactDetailsView={false}
      compactIconView={false}
      compactTreeView={false}
      singleClickExpandTreeItems={false}
      detailColumns={{
        size: true,
        modified: true,
        permissions: true,
        kind: true,
        created: false,
      }}
      detailColumnOrder={["modified", "size", "kind", "created", "permissions"]}
      layoutMode="wide"
      notificationsEnabled={true}
      markClipboardItems={true}
      autoCalculateFolderSizes={true}
      restoreSessionOnStartup={true}
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
      onThemeChange={() => undefined}
      onAccentChange={() => undefined}
      onZoomPercentChange={() => undefined}
      onResetAppearance={() => undefined}
      onCompactListViewChange={() => undefined}
      onCompactDetailsViewChange={() => undefined}
      onCompactIconViewChange={() => undefined}
      onCompactTreeViewChange={() => undefined}
      onSingleClickExpandTreeItemsChange={() => undefined}
      onDetailColumnsChange={() => undefined}
      onDetailColumnOrderChange={() => undefined}
      onNotificationsEnabledChange={() => undefined}
      onMarkClipboardItemsChange={() => undefined}
      onAutoCalculateFolderSizesChange={() => undefined}
      onRestoreSessionOnStartupChange={() => undefined}
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

  it("offers Auto, Light and Dark, and no palettes, fonts or tab styles", () => {
    const onThemeChange = vi.fn();
    renderSettingsView({ theme: "auto", onThemeChange });

    expect(screen.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(onThemeChange.mock.calls).toEqual([["light"], ["dark"]]);

    expect(screen.queryByLabelText("Light palette")).toBeNull();
    expect(screen.queryByLabelText("Dark palette")).toBeNull();
    expect(screen.queryByText("Font")).toBeNull();
    expect(screen.queryByText("Tab style")).toBeNull();
  });

  it("takes its colors from the stylesheet, not from inline styles", () => {
    renderSettingsView();

    const view = screen.getByRole("heading", { name: "Settings" }).closest(".settings-view");
    expect(view?.getAttribute("style")).toBeNull();
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
    // The name is the swatch's tooltip; no line under the swatches repeats it.
    expect(screen.getByLabelText("Accent color Teal")).toHaveAttribute("title", "Teal");
    expect(screen.queryByText("Teal")).toBeNull();
  });

  it("shows a custom accent picker for non-preset colors", () => {
    const onAccentChange = vi.fn();
    renderSettingsView({
      accent: "#112233",
      onAccentChange,
    });

    expect(screen.getByLabelText("Accent color Custom")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Custom color")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Accent color Custom"));
    fireEvent.change(screen.getByLabelText("Accent color Custom value"), {
      target: { value: "#123456" },
    });

    expect(onAccentChange).toHaveBeenCalledWith("#123456");
  });

  it("uses the dialogs' push button for every Reset, so each answers the pointer", () => {
    renderSettingsView();

    expect(screen.getByRole("button", { name: "Restore the default appearance" })).toHaveClass(
      "push-button",
    );
  });

  it("draws no line under the last row of a group, whichever row that is", () => {
    const view = renderSettingsView();

    // Rows leave their line to the stylesheet, which knows which one is last.
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>(".settings-row"));
    expect(rows.length).toBeGreaterThan(15);
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

  it("gives every control one height and a hairline edge", () => {
    const view = renderSettingsView();

    // Buttons are the push button, pop-ups wear its bezel, and fields are inset, as every
    // text field is; all of them are one height.
    for (const select of Array.from(view.container.querySelectorAll("select"))) {
      expect(select.parentElement).toHaveClass("settings-popup");
    }
    for (const field of Array.from(view.container.querySelectorAll("input[type=number]"))) {
      expect(field).toHaveClass("settings-field");
    }
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    expect(styles).toMatch(
      /\.push-button \{[^}]*height: var\(--control-height\);[^}]*box-shadow: var\(--push-button-bezel\);/u,
    );
    expect(styles).toMatch(
      /\.settings-popup select,\s*\.settings-app-popup \{[^}]*height: var\(--control-height\);[^}]*box-shadow: var\(--push-button-bezel\);/u,
    );
    expect(styles).toMatch(
      /\.settings-field \{[^}]*height: var\(--control-height\);[^}]*box-shadow: var\(--field-edge\);/u,
    );
    expect(styles).toMatch(/--push-button-bezel: 0 0 0 0\.5px/u);
    expect(styles).toMatch(/--field-edge: inset 0 0 0 0\.5px/u);
  });

  it("sets every view's density at once, and shows a mix as Custom", () => {
    const changes = {
      onCompactListViewChange: vi.fn(),
      onCompactDetailsViewChange: vi.fn(),
      onCompactIconViewChange: vi.fn(),
      onCompactTreeViewChange: vi.fn(),
    };
    renderSettingsView({ compactListView: true, ...changes });

    const density = screen.getByLabelText("Density");
    expect(density).toHaveValue("custom");
    expect(within(density).getByRole("option", { name: "Custom" })).toBeDisabled();
    expect(screen.queryByLabelText("Compact list view")).toBeNull();

    fireEvent.change(density, { target: { value: "compact" } });
    for (const change of Object.values(changes)) {
      expect(change).toHaveBeenCalledWith(true);
    }
  });

  it("leaves the toolbar to the window it is in, and has nothing about rails", () => {
    renderSettingsView();

    expect(screen.queryByRole("group", { name: "Toolbar" })).toBeNull();
    expect(screen.queryByText("In the Toolbar")).toBeNull();
    expect(screen.queryByLabelText("Show left rail")).toBeNull();
    expect(screen.queryByLabelText("Show bottom rail")).toBeNull();
  });

  it("forwards single-click tree expansion preference changes", () => {
    const onSingleClickExpandTreeItemsChange = vi.fn();
    renderSettingsView({
      singleClickExpandTreeItems: false,
      onSingleClickExpandTreeItemsChange,
    });

    fireEvent.click(screen.getByLabelText("Expand folders with a single click"));

    expect(onSingleClickExpandTreeItemsChange).toHaveBeenCalledWith(true);
  });

  it("does not offer to highlight items under the pointer", () => {
    renderSettingsView();

    expect(screen.queryByText("Highlight items under the pointer")).toBeNull();
  });

  it("takes any zoom typed in, such as 105%, and keeps it in range", () => {
    const onZoomPercentChange = vi.fn();
    renderSettingsView({ zoomPercent: 100, onZoomPercentChange });

    const field = screen.getByLabelText("Zoom level");
    fireEvent.change(field, { target: { value: "105%" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(105);
    expect(field).toHaveValue("105%");

    fireEvent.change(field, { target: { value: "400" } });
    fireEvent.blur(field);
    expect(onZoomPercentChange).toHaveBeenLastCalledWith(150);
    expect(field).toHaveValue("150%");
  });

  it("puts back the zoom there was when what is typed is not a size", () => {
    const onZoomPercentChange = vi.fn();
    renderSettingsView({ zoomPercent: 125, onZoomPercentChange });

    const field = screen.getByLabelText("Zoom level");
    fireEvent.change(field, { target: { value: "oops" } });
    fireEvent.blur(field);

    expect(onZoomPercentChange).not.toHaveBeenCalled();
    expect(field).toHaveValue("125%");
  });

  it("offers the zoom steps in a menu beside the field", () => {
    const onZoomPercentChange = vi.fn();
    renderSettingsView({ zoomPercent: 100, onZoomPercentChange });

    fireEvent.click(screen.getByRole("button", { name: "Zoom levels" }));
    const menu = screen.getByRole("menu", { name: "Zoom levels" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["75%", "80%", "90%", "100%", "110%", "120%", "130%", "140%", "150%"]);
    expect(within(menu).getByRole("menuitemradio", { name: "100%" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "120%" }));
    expect(onZoomPercentChange).toHaveBeenCalledWith(120);
    expect(screen.queryByRole("menu", { name: "Zoom levels" })).toBeNull();
  });

  it("lists favorites in the folder tree first", () => {
    renderSettingsView();

    expect(
      within(screen.getByLabelText("Show favorites"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["In the folder tree", "In their own section"]);
  });

  it("keeps the Terminal app with the other app choices on the Files tab", () => {
    renderSettingsView({ activeTab: "files" });
    const opening = screen.getByText("Opening Files").closest("section");
    if (!(opening instanceof HTMLElement)) {
      throw new Error("Missing Opening Files section.");
    }
    expect(within(opening).getByRole("button", { name: "Text editor" })).toBeVisible();
    expect(within(opening).getByRole("button", { name: "Terminal" })).toBeVisible();
    cleanup();

    // General has the appearance first, then one group of the switches for how it behaves.
    const view = renderSettingsView({ activeTab: "general" });
    expect(
      Array.from(view.container.querySelectorAll("h3")).map((heading) => heading.textContent),
    ).toEqual(["Appearance", "Behavior"]);
    expect(screen.getByText("Reopen the last folder and tabs")).toBeInTheDocument();
    expect(screen.queryByText("Reopen tabs")).toBeNull();
    expect(screen.queryByRole("button", { name: "Terminal" })).toBeNull();
  });

  it("reopens the last folder and tabs with one switch", () => {
    const onRestoreSessionOnStartupChange = vi.fn();
    renderSettingsView({ activeTab: "general", onRestoreSessionOnStartupChange });

    fireEvent.click(screen.getByRole("switch", { name: "Reopen the last folder and tabs" }));

    expect(onRestoreSessionOnStartupChange).toHaveBeenCalledWith(false);
  });

  it("chooses the Terminal app from its pop-up, or goes back to the default", () => {
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

    const popup = screen.getByRole("button", { name: "Terminal" });
    expect(popup).toHaveTextContent("iTerm");

    fireEvent.click(popup);
    const menu = screen.getByRole("menu", { name: "Terminal" });
    expect(within(menu).getByRole("menuitemradio", { name: "iTerm" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Choose…" }));
    expect(onBrowseTerminalApp).toHaveBeenCalled();

    fireEvent.click(popup);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Terminal" }));
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

    const editor = screen.getByRole("button", { name: "Text editor" });
    expect(editor).toHaveTextContent("Zed");

    fireEvent.change(screen.getByLabelText("Double-click a file to"), {
      target: { value: "edit" },
    });
    fireEvent.change(screen.getByLabelText("Open and Edit item limit"), {
      target: { value: "9" },
    });
    fireEvent.blur(screen.getByLabelText("Open and Edit item limit"));
    fireEvent.click(editor);
    fireEvent.click(screen.getByRole("menuitem", { name: "Choose…" }));
    fireEvent.click(editor);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "TextEdit" }));

    expect(onFileActivationActionChange).toHaveBeenCalledWith("edit");
    expect(onOpenItemLimitChange).toHaveBeenCalledWith(9);
    expect(onBrowseDefaultTextEditor).toHaveBeenCalled();
    expect(onClearDefaultTextEditor).toHaveBeenCalled();
  });

  it("forwards notification preference changes, and has no duration to set", () => {
    const onNotificationsEnabledChange = vi.fn();
    renderSettingsView({ notificationsEnabled: true, onNotificationsEnabledChange });

    fireEvent.click(screen.getByLabelText("Show notifications"));

    expect(onNotificationsEnabledChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Show for")).toBeNull();
  });

  it("marks copied and cut items with one switch", () => {
    const onMarkClipboardItemsChange = vi.fn();
    renderSettingsView({ markClipboardItems: true, onMarkClipboardItemsChange });

    expect(screen.getByText("Behavior")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Mark copied and cut items" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    expect(onMarkClipboardItemsChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText("Notify what was copied")).toBeNull();
  });

  it("turns the Info panel's folder sizes off with one switch", () => {
    const onAutoCalculateFolderSizesChange = vi.fn();
    renderSettingsView({ autoCalculateFolderSizes: true, onAutoCalculateFolderSizesChange });

    const toggle = screen.getByRole("switch", {
      name: "Calculate folder sizes automatically",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);

    expect(onAutoCalculateFolderSizesChange).toHaveBeenCalledWith(false);
  });

  it("renders configured Open With applications", () => {
    renderSettingsView();

    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("/Applications/Visual Studio Code.app")).toBeInTheDocument();
    expect(screen.getByText("Zed")).toBeInTheDocument();
  });

  it("renders configured favorites with their icons as pickers", () => {
    renderSettingsView();

    const favorites = screen.getByRole("listbox", { name: "Favorites" });
    const home = within(favorites).getByRole("option", { name: "Home" });
    expect(within(home).getByLabelText("Favorite icon for Home")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(home).getByText("/Users/demo")).toBeInTheDocument();
    expect(within(favorites).getByText("/Applications")).toBeInTheDocument();
    expect(screen.queryByText("Icon")).toBeNull();
  });

  it("forwards favorites placement changes", () => {
    const onFavoritesPlacementChange = vi.fn();
    renderSettingsView({
      favoritesPlacement: "integrated",
      onFavoritesPlacementChange,
    });

    fireEvent.change(screen.getByLabelText("Show favorites"), {
      target: { value: "separate" },
    });

    expect(onFavoritesPlacementChange).toHaveBeenCalledWith("separate");
  });

  it("forwards favorite add, change, move, icon, and remove actions", () => {
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
    const list = settingsList("Favorites");

    // Nothing is selected yet, so there is nothing to change or remove.
    expect(list.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(list.getByRole("button", { name: "Change" })).toBeDisabled();

    fireEvent.click(list.getByRole("button", { name: "Add Favorite" }));
    fireEvent.click(screen.getByLabelText("Favorite icon for Home"));
    fireEvent.click(screen.getByLabelText("Favorite icon for Home: Star"));

    const home = list.getByRole("option", { name: "Home" });
    fireEvent.mouseDown(home);
    fireEvent.click(list.getByRole("button", { name: "Change Home" }));
    fireEvent.doubleClick(home);

    const applications = list.getByRole("option", { name: "Applications" });
    fireEvent.mouseDown(applications);
    fireEvent.click(list.getByRole("button", { name: "Remove Applications" }));
    fireEvent.keyDown(applications, { key: "ArrowUp", altKey: true });

    expect(onAddFavorite).toHaveBeenCalledTimes(1);
    expect(onFavoriteIconChange).toHaveBeenCalledWith(0, "star");
    expect(onBrowseFavorite).toHaveBeenNthCalledWith(1, 0);
    expect(onBrowseFavorite).toHaveBeenNthCalledWith(2, 0);
    expect(onMoveFavorite).toHaveBeenCalledWith(1, 0);
    expect(onRemoveFavorite).toHaveBeenCalledWith(1);
  });

  // The Trash is always under Locations, so a Trash favorite is one like any other.
  it("lets a Trash favorite be removed", () => {
    const onRemoveFavorite = vi.fn();
    renderSettingsView({
      favorites: [
        { path: "/Users/demo", icon: "home" },
        { path: "/Users/demo/.Trash", icon: "trash" },
      ],
      onRemoveFavorite,
    });

    const trash = screen.getByRole("option", { name: "Trash" });
    fireEvent.mouseDown(trash);
    expect(screen.getByRole("button", { name: "Remove Trash" })).toBeEnabled();
    fireEvent.keyDown(trash, { key: "Backspace" });
    expect(onRemoveFavorite).toHaveBeenCalled();
  });

  it("renders favorite icon picker popovers in a body portal", () => {
    renderSettingsView();

    fireEvent.click(screen.getByLabelText("Favorite icon for Home"));

    const iconDialog = screen.getByRole("dialog", { name: "Favorite icon for Home options" });
    expect(iconDialog.parentElement).toBe(document.body);
    expect(iconDialog).toHaveClass("settings-icon-grid");
    expect(iconDialog).toHaveStyle({ gridTemplateColumns: "repeat(6, 30px)" });
  });

  it("forwards Open With add, change, move, and remove actions", () => {
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

    const list = settingsList("Open With applications");
    fireEvent.click(list.getByRole("button", { name: "Add Open With application" }));
    fireEvent.mouseDown(list.getByRole("option", { name: "Visual Studio Code" }));
    fireEvent.click(list.getByRole("button", { name: "Change Visual Studio Code" }));
    const zed = list.getByRole("option", { name: "Zed" });
    fireEvent.mouseDown(zed);
    fireEvent.click(list.getByRole("button", { name: "Remove Zed" }));
    fireEvent.keyDown(zed, { key: "ArrowUp", metaKey: true });

    expect(onAddOpenWithApplication).toHaveBeenCalledTimes(1);
    expect(onBrowseOpenWithApplication).toHaveBeenCalledWith("vscode");
    expect(onMoveOpenWithApplication).toHaveBeenCalledWith("zed", 0);
    expect(onRemoveOpenWithApplication).toHaveBeenCalledWith("zed");
  });

  it("lists search results' columns on the Search tab, apart from a folder's", () => {
    const onSearchColumnsChange = vi.fn();
    const onSearchColumnOrderChange = vi.fn();
    renderSettingsView({
      activeTab: "search",
      searchDefaults: {
        searchPatternMode: "text",
        searchMatchScope: "name",
        searchRecursive: true,
        searchSkipGitFolders: true,
        searchSkipGitIgnored: false,
      },
      searchColumnOrder: ["folder", "kind", "modified", "size", "created", "permissions"],
      onSearchColumnsChange,
      onSearchColumnOrderChange,
    });

    expect(screen.queryByRole("listbox", { name: "Columns in List view" })).toBeNull();
    const list = screen.getByRole("listbox", { name: "Columns in search results" });
    const rows = within(list).getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Name",
      "Folder",
      "Kind",
      "Date Modified",
      "Size",
      "Date Created",
      "Permissions",
    ]);
    // Folder, Date Modified and Size are shown to begin with.
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
      null,
      "true",
      "false",
      "true",
      "true",
      "false",
      "false",
    ]);
    fireEvent.click(within(list).getByRole("checkbox", { name: "Show Kind" }));
    expect(onSearchColumnsChange).toHaveBeenCalledWith(expect.objectContaining({ kind: true }));
    fireEvent.click(screen.getByRole("button", { name: "Restore the default column order" }));
    expect(onSearchColumnOrderChange).toHaveBeenCalledWith([
      "folder",
      "modified",
      "size",
      "kind",
      "created",
      "permissions",
    ]);
  });

  it("lists the columns in their order, with Name first and fixed", () => {
    renderSettingsView({
      detailColumnOrder: ["kind", "modified", "size", "permissions", "created"],
    });

    const list = screen.getByRole("listbox", { name: "Columns in List view" });
    const rows = within(list).getAllByRole("option");
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Name",
      "Kind",
      "Date Modified",
      "Size",
      "Permissions",
      "Date Created",
    ]);
    expect(rows[0]).toHaveAttribute("aria-disabled", "true");
    expect(rows[0]).not.toHaveAttribute("draggable");
    expect(within(rows[0] as HTMLElement).getByRole("checkbox", { hidden: true })).toBeDisabled();
    expect(within(list).getByRole("checkbox", { name: "Show Date Created" })).not.toBeChecked();
  });

  it("checks a column with its checkbox or with Space", () => {
    const onDetailColumnsChange = vi.fn();
    renderSettingsView({ onDetailColumnsChange });

    fireEvent.click(screen.getByRole("checkbox", { name: "Show Date Created" }));
    fireEvent.keyDown(screen.getByRole("option", { name: "Size" }), { key: " " });

    expect(onDetailColumnsChange.mock.calls).toEqual([
      [{ size: true, modified: true, permissions: true, kind: true, created: true }],
      [{ size: false, modified: true, permissions: true, kind: true, created: false }],
    ]);
  });

  it("moves a column with the arrow buttons, the keyboard or a drag", () => {
    const onDetailColumnOrderChange = vi.fn();
    renderSettingsView({ onDetailColumnOrderChange });
    const list = settingsList("Columns in List view");

    const moveUp = list.getByRole("button", { name: "Move Up" });
    expect(moveUp).toBeDisabled();
    const size = list.getByRole("option", { name: "Size" });
    fireEvent.mouseDown(size);
    fireEvent.click(list.getByRole("button", { name: "Move Size Up" }));
    fireEvent.click(list.getByRole("button", { name: "Move Size Down" }));
    fireEvent.keyDown(size, { key: "ArrowDown", altKey: true });

    // The first optional column cannot go above Name; the last cannot go further down.
    fireEvent.mouseDown(list.getByRole("option", { name: "Date Modified" }));
    expect(list.getByRole("button", { name: "Move Date Modified Up" })).toBeDisabled();
    fireEvent.mouseDown(list.getByRole("option", { name: "Permissions" }));
    expect(list.getByRole("button", { name: "Move Permissions Down" })).toBeDisabled();

    const dataTransfer = { setData: () => undefined, effectAllowed: "", dropEffect: "" };
    const permissions = list.getByRole("option", { name: "Permissions" });
    const modified = list.getByRole("option", { name: "Date Modified" });
    fireEvent.dragStart(permissions, { dataTransfer });
    fireEvent.dragOver(modified, { dataTransfer });
    fireEvent.drop(modified, { dataTransfer });

    expect(onDetailColumnOrderChange.mock.calls).toEqual([
      [["size", "modified", "kind", "created", "permissions"]],
      [["modified", "kind", "size", "created", "permissions"]],
      [["modified", "kind", "size", "created", "permissions"]],
      [["permissions", "modified", "size", "kind", "created"]],
    ]);
  });

  it("restores the default column order, and leaves the checked columns alone", () => {
    const onDetailColumnOrderChange = vi.fn();
    const onDetailColumnsChange = vi.fn();
    const { unmount } = renderSettingsView({ onDetailColumnOrderChange, onDetailColumnsChange });
    expect(screen.getByRole("button", { name: "Restore the default column order" })).toBeDisabled();
    unmount();

    renderSettingsView({
      detailColumnOrder: ["permissions", "kind", "size", "modified", "created"],
      onDetailColumnOrderChange,
      onDetailColumnsChange,
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore the default column order" }));

    expect(onDetailColumnOrderChange).toHaveBeenCalledWith([
      "modified",
      "size",
      "kind",
      "created",
      "permissions",
    ]);
    expect(onDetailColumnsChange).not.toHaveBeenCalled();
  });
});
