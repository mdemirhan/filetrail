// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { ThemeMode } from "../../shared/appPreferences";
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

  it("uses the one Settings button for every Reset, so each answers the pointer", () => {
    renderSettingsView();

    expect(screen.getByRole("button", { name: "Reset Appearance" })).toHaveClass("settings-button");
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

    // Every pop-up, field and button is drawn by the one rule for Settings controls.
    for (const select of Array.from(view.container.querySelectorAll("select"))) {
      expect(select.parentElement).toHaveClass("settings-popup");
    }
    for (const field of Array.from(view.container.querySelectorAll("input[type=number]"))) {
      expect(field).toHaveClass("settings-field");
    }
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    expect(styles).toMatch(
      /\.settings-button,\s*\.settings-popup select,\s*\.settings-app-popup,\s*\.settings-field \{[^}]*height: var\(--control-height\);[^}]*inset 0 0 0 0\.5px/u,
    );
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
      within(screen.getByLabelText("Favorites placement"))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["In the folder tree", "In their own section"]);
  });

  it("keeps the Terminal app with the other app choices on the Files tab", () => {
    renderSettingsView({ activeTab: "files" });
    const fileOpening = screen.getByText("File Opening").closest("section");
    if (!(fileOpening instanceof HTMLElement)) {
      throw new Error("Missing File Opening section.");
    }
    expect(within(fileOpening).getByRole("button", { name: "Default text editor" })).toBeVisible();
    expect(within(fileOpening).getByRole("button", { name: "Terminal app" })).toBeVisible();
    cleanup();

    // General keeps the startup choices only.
    renderSettingsView({ activeTab: "general" });
    expect(screen.getByText("Reopen the last folder")).toBeInTheDocument();
    expect(screen.getByText("Reopen tabs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminal app" })).toBeNull();
  });

  it("switches Restore open tabs on its own, next to Restore last visited folder", () => {
    const onRestoreOpenTabsOnStartupChange = vi.fn();
    renderSettingsView({ activeTab: "general", onRestoreOpenTabsOnStartupChange });

    fireEvent.click(screen.getByRole("switch", { name: "Restore open tabs" }));

    expect(onRestoreOpenTabsOnStartupChange).toHaveBeenCalledWith(true);
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

    const popup = screen.getByRole("button", { name: "Terminal app" });
    expect(popup).toHaveTextContent("iTerm");

    fireEvent.click(popup);
    const menu = screen.getByRole("menu", { name: "Terminal app" });
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

    const editor = screen.getByRole("button", { name: "Default text editor" });
    expect(editor).toHaveTextContent("Zed");

    fireEvent.change(screen.getByLabelText("File activation"), {
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

    fireEvent.change(screen.getByLabelText("Favorites placement"), {
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

    fireEvent.click(screen.getByRole("button", { name: "Add Favorite" }));
    fireEvent.click(screen.getByLabelText("Favorite icon for Home"));
    fireEvent.click(screen.getByLabelText("Favorite icon for Home: Star"));

    // Nothing is selected yet, so there is nothing to change or remove.
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    const home = screen.getByRole("option", { name: "Home" });
    fireEvent.mouseDown(home);
    fireEvent.click(screen.getByRole("button", { name: "Change Home" }));
    fireEvent.doubleClick(home);

    const applications = screen.getByRole("option", { name: "Applications" });
    fireEvent.mouseDown(applications);
    fireEvent.click(screen.getByRole("button", { name: "Remove Applications" }));
    fireEvent.keyDown(applications, { key: "ArrowUp", altKey: true });

    expect(onAddFavorite).toHaveBeenCalledTimes(1);
    expect(onFavoriteIconChange).toHaveBeenCalledWith(0, "star");
    expect(onBrowseFavorite).toHaveBeenNthCalledWith(1, 0);
    expect(onBrowseFavorite).toHaveBeenNthCalledWith(2, 0);
    expect(onMoveFavorite).toHaveBeenCalledWith(1, 0);
    expect(onRemoveFavorite).toHaveBeenCalledWith(1);
  });

  it("keeps the Trash in the favorites", () => {
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
    expect(screen.getByRole("button", { name: "Remove Trash" })).toBeDisabled();
    fireEvent.keyDown(trash, { key: "Backspace" });
    expect(onRemoveFavorite).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole("button", { name: "Add Open With application" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "Visual Studio Code" }));
    fireEvent.click(screen.getByRole("button", { name: "Change Visual Studio Code" }));
    const zed = screen.getByRole("option", { name: "Zed" });
    fireEvent.mouseDown(zed);
    fireEvent.click(screen.getByRole("button", { name: "Remove Zed" }));
    fireEvent.keyDown(zed, { key: "ArrowUp", metaKey: true });

    expect(onAddOpenWithApplication).toHaveBeenCalledTimes(1);
    expect(onBrowseOpenWithApplication).toHaveBeenCalledWith("vscode");
    expect(onMoveOpenWithApplication).toHaveBeenCalledWith("zed", 0);
    expect(onRemoveOpenWithApplication).toHaveBeenCalledWith("zed");
  });
});
