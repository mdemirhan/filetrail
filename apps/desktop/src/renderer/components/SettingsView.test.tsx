// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import { THEME_OPTIONS, type ThemeMode } from "../../shared/appPreferences";
import { SettingsView } from "./SettingsView";

function renderSettingsView(overrides: Partial<ComponentProps<typeof SettingsView>> = {}) {
  return render(
    <SettingsView
      theme="dark"
      iconTheme="classic"
      accent="#daa520"
      accentToolbarButtons={true}
      toolbarAccent="#2cb5a0"
      accentFavoriteItems={false}
      accentFavoriteText={false}
      favoriteAccent="#e8806a"
      zoomPercent={100}
      uiFontFamily="lexend"
      uiFontSize={13}
      uiFontWeight={500}
      effectiveTextPrimaryColor="#ffffff"
      effectiveTextSecondaryColor="#cccccc"
      effectiveTextMutedColor="#999999"
      compactListView={false}
      compactDetailsView={false}
      compactTreeView={false}
      singleClickExpandTreeItems={false}
      highlightHoveredItems={true}
      detailColumns={{
        size: true,
        modified: true,
        permissions: true,
      }}
      layoutMode="wide"
      tabSwitchesExplorerPanes={true}
      typeaheadEnabled={true}
      typeaheadDebounceMs={750}
      notificationsEnabled={true}
      notificationDurationSeconds={4}
      actionLogEnabled={true}
      restoreLastVisitedFolderOnStartup={false}
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
      themeOptions={THEME_OPTIONS}
      accentOptions={[
        { value: "#daa520", label: "Gold", primary: "#daa520" },
        { value: "#d4845a", label: "Copper", primary: "#d4845a" },
        { value: "#e8806a", label: "Coral", primary: "#e8806a" },
        { value: "#d84a4a", label: "Ruby", primary: "#d84a4a" },
        { value: "#8094b8", label: "Slate", primary: "#8094b8" },
        { value: "#23c7d9", label: "Aqua", primary: "#23c7d9" },
        { value: "#2cb5a0", label: "Teal", primary: "#2cb5a0" },
      ]}
      uiFontOptions={[{ value: "lexend", label: "Lexend" }]}
      uiFontSizeOptions={[13]}
      uiFontWeightOptions={[500]}
      typeaheadDebounceOptions={[750]}
      notificationDurationSecondsOptions={[4, 6]}
      onThemeChange={() => undefined}
      onIconThemeChange={() => undefined}
      onAccentChange={() => undefined}
      onAccentToolbarButtonsChange={() => undefined}
      onToolbarAccentChange={() => undefined}
      onAccentFavoriteItemsChange={() => undefined}
      onAccentFavoriteTextChange={() => undefined}
      onFavoriteAccentChange={() => undefined}
      onZoomPercentChange={() => undefined}
      onUiFontFamilyChange={() => undefined}
      onUiFontSizeChange={() => undefined}
      onUiFontWeightChange={() => undefined}
      onTextPrimaryColorChange={() => undefined}
      onTextSecondaryColorChange={() => undefined}
      onTextMutedColorChange={() => undefined}
      onResetAppearance={() => undefined}
      onCompactListViewChange={() => undefined}
      onCompactDetailsViewChange={() => undefined}
      onCompactTreeViewChange={() => undefined}
      onSingleClickExpandTreeItemsChange={() => undefined}
      onHighlightHoveredItemsChange={() => undefined}
      onDetailColumnsChange={() => undefined}
      onTabSwitchesExplorerPanesChange={() => undefined}
      onTypeaheadEnabledChange={() => undefined}
      onTypeaheadDebounceMsChange={() => undefined}
      onNotificationsEnabledChange={() => undefined}
      onNotificationDurationSecondsChange={() => undefined}
      onActionLogEnabledChange={() => undefined}
      onRestoreLastVisitedFolderOnStartupChange={() => undefined}
      onBrowseTerminalApp={() => undefined}
      onClearTerminalApp={() => undefined}
      onBrowseDefaultTextEditor={() => undefined}
      onClearDefaultTextEditor={() => undefined}
      onAddFavorite={() => undefined}
      onBrowseFavorite={() => undefined}
      onMoveFavorite={() => undefined}
      onRemoveFavorite={() => undefined}
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

    expect(screen.getByText("Settings").closest(".settings-view")).toHaveAttribute(
      "data-layout",
      "compact",
    );
  });

  it("uses the header without a description row", () => {
    renderSettingsView();

    expect(screen.getByText("File Trail")).toBeInTheDocument();
    expect(screen.queryByText("Application preferences and configuration")).not.toBeInTheDocument();
  });

  it.each([
    ["light", "#edeef4"],
    ["dark", "#181b22"],
    ["tomorrow-night", "#151617"],
    ["catppuccin-mocha", "#0e0e18"],
    ["obsidian", "#080809"],
    ["clean-white", "#f3f3f3"],
  ] satisfies Array<[ThemeMode, string]>)(
    "applies the supplied %s theme palette to the page background",
    (theme, expectedBackground) => {
      renderSettingsView({ theme });

      expect(screen.getByText("Settings").closest(".settings-view")).toHaveStyle({
        background: expectedBackground,
      });
    },
  );

  it("renders the provided theme labels in the theme selector", () => {
    renderSettingsView();

    const themeSelect = screen.getByLabelText("Theme");
    expect(themeSelect).toHaveTextContent("Light");
    expect(themeSelect).toHaveTextContent("Dark");
    expect(themeSelect).toHaveTextContent("Tomorrow Night");
    expect(themeSelect).toHaveTextContent("Catppuccin Mocha");
    expect(themeSelect).toHaveTextContent("Obsidian");
    expect(themeSelect).toHaveTextContent("Clean White");
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

  it("forwards toolbar accent toggle changes", () => {
    const onAccentToolbarButtonsChange = vi.fn();
    const onToolbarAccentChange = vi.fn();
    renderSettingsView({
      accentToolbarButtons: true,
      toolbarAccent: "#2cb5a0",
      onAccentToolbarButtonsChange,
      onToolbarAccentChange,
    });

    fireEvent.click(screen.getByLabelText("Toolbar accent Teal"));
    const toolbarAccentDialog = screen.getByRole("dialog", { name: "Toolbar accent options" });
    expect(toolbarAccentDialog.parentElement).toBe(document.body);
    fireEvent.click(screen.getByLabelText("Toolbar accent Gold"));
    fireEvent.click(screen.getByLabelText("Accent toolbar buttons"));

    expect(onToolbarAccentChange).toHaveBeenCalledWith("#daa520");
    expect(onAccentToolbarButtonsChange).toHaveBeenCalledWith(false);
  });

  it("supports custom toolbar accent colors from the popover", () => {
    const onToolbarAccentChange = vi.fn();
    renderSettingsView({
      accentToolbarButtons: true,
      toolbarAccent: "#2cb5a0",
      onToolbarAccentChange,
    });

    fireEvent.click(screen.getByLabelText("Toolbar accent Teal"));
    fireEvent.click(screen.getByLabelText("Toolbar accent Custom"));
    expect(screen.queryByText("Custom color")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Toolbar accent Custom value"), {
      target: { value: "#123456" },
    });

    expect(onToolbarAccentChange).toHaveBeenCalledWith("#123456");
    expect(screen.getByRole("dialog", { name: "Toolbar accent options" })).toBeInTheDocument();
  });

  it("closes the toolbar accent popover on outside click", () => {
    renderSettingsView({
      accentToolbarButtons: true,
      toolbarAccent: "#2cb5a0",
    });

    fireEvent.click(screen.getByLabelText("Toolbar accent Teal"));
    expect(screen.getByRole("dialog", { name: "Toolbar accent options" })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("dialog", { name: "Toolbar accent options" })).not.toBeInTheDocument();
  });

  it("forwards favorite accent preference changes", () => {
    const onAccentFavoriteItemsChange = vi.fn();
    const onAccentFavoriteTextChange = vi.fn();
    const onFavoriteAccentChange = vi.fn();
    renderSettingsView({
      accentFavoriteItems: true,
      accentFavoriteText: false,
      favoriteAccent: "#e8806a",
      onAccentFavoriteItemsChange,
      onAccentFavoriteTextChange,
      onFavoriteAccentChange,
    });

    fireEvent.click(screen.getByLabelText("Accent favorite items"));
    fireEvent.click(screen.getByLabelText("Accent favorite text"));
    fireEvent.click(screen.getByLabelText("Favorite accent Coral"));
    const favoriteAccentDialog = screen.getByRole("dialog", { name: "Favorite accent options" });
    expect(favoriteAccentDialog.parentElement).toBe(document.body);
    expect(favoriteAccentDialog).toHaveStyle({ position: "fixed", zIndex: "1000" });
    expect(favoriteAccentDialog.firstElementChild).toHaveStyle({
      gridTemplateColumns: "repeat(8, 28px)",
    });
    fireEvent.click(screen.getByLabelText("Favorite accent Teal"));

    expect(onAccentFavoriteItemsChange).toHaveBeenCalledWith(false);
    expect(onAccentFavoriteTextChange).toHaveBeenCalledWith(true);
    expect(onFavoriteAccentChange).toHaveBeenCalledWith("#2cb5a0");
  });

  it("renders the icon theme picker with 4 theme cards", () => {
    const onIconThemeChange = vi.fn();
    renderSettingsView({ iconTheme: "monoline", onIconThemeChange });

    const monolineCard = screen.getByLabelText("Icon theme: Monoline");
    expect(monolineCard).toHaveAttribute("aria-pressed", "true");

    const classicCard = screen.getByLabelText("Icon theme: Classic");
    expect(classicCard).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(classicCard);
    expect(onIconThemeChange).toHaveBeenCalledWith("classic");
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

  it("disables the favorite accent swatch when favorite accents are off", () => {
    renderSettingsView({
      accentFavoriteItems: false,
    });

    expect(screen.getByLabelText("Favorite accent Coral")).toBeDisabled();
  });

  it("disables the toolbar accent swatch when toolbar accents are off", () => {
    renderSettingsView({
      accentToolbarButtons: false,
    });

    expect(screen.getByLabelText("Toolbar accent Teal")).toBeDisabled();
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

  it("forwards action log preference changes", () => {
    const onActionLogEnabledChange = vi.fn();
    renderSettingsView({
      actionLogEnabled: true,
      onActionLogEnabledChange,
    });

    fireEvent.click(screen.getByLabelText("Enable action log"));

    expect(onActionLogEnabledChange).toHaveBeenCalledWith(false);
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
