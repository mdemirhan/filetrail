// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { ThemeMode } from "../../shared/appPreferences";
import { DEFAULT_LEFT_TOOLBAR_ITEMS, DEFAULT_TOP_TOOLBAR_ITEMS } from "../../shared/toolbarItems";
import { SettingsView } from "./SettingsView";

function renderSettingsView(overrides: Partial<ComponentProps<typeof SettingsView>> = {}) {
  return render(
    <SettingsView
      theme="macos-dark"
      iconTheme="classic"
      accent="#daa520"
      zoomPercent={100}
      uiFontFamily="lexend"
      compactListView={false}
      compactDetailsView={false}
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
      tabSwitchesExplorerPanes={true}
      typeaheadEnabled={true}
      typeaheadDebounceMs={750}
      notificationsEnabled={true}
      notificationDurationSeconds={4}
      actionLogEnabled={true}
      topToolbarItems={[...DEFAULT_TOP_TOOLBAR_ITEMS]}
      leftToolbarItems={{
        main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
        utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
      }}
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
      typeaheadDebounceOptions={[750]}
      notificationDurationSecondsOptions={[4, 6]}
      onThemeChange={() => undefined}
      onIconThemeChange={() => undefined}
      onAccentChange={() => undefined}
      onZoomPercentChange={() => undefined}
      onUiFontFamilyChange={() => undefined}
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
      onTopToolbarItemsChange={() => undefined}
      onLeftToolbarItemsChange={() => undefined}
      onResetTopToolbar={() => undefined}
      onResetLeftToolbar={() => undefined}
      onResetToolbars={() => undefined}
      onRestoreLastVisitedFolderOnStartupChange={() => undefined}
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

  it("updates the top toolbar editor and reset action", () => {
    const onTopToolbarItemsChange = vi.fn();
    const onResetTopToolbar = vi.fn();
    renderSettingsView({
      topToolbarItems: ["back", "search"],
      onTopToolbarItemsChange,
      onResetTopToolbar,
    });

    const topToolbarEditor = screen.getByRole("group", { name: "Top toolbar" });

    fireEvent.click(
      within(topToolbarEditor).getByRole("button", { name: "Add Copy to Top toolbar" }),
    );
    fireEvent.mouseEnter(within(topToolbarEditor).getByRole("button", { name: "Back" }));
    fireEvent.click(
      within(topToolbarEditor).getByRole("button", { name: "Remove Back from Top toolbar" }),
    );
    fireEvent.click(within(topToolbarEditor).getByRole("button", { name: "Reset" }));

    expect(onTopToolbarItemsChange).toHaveBeenNthCalledWith(1, ["back", "copySelection", "search"]);
    expect(onTopToolbarItemsChange).toHaveBeenNthCalledWith(2, ["search"]);
    expect(onResetTopToolbar).toHaveBeenCalledTimes(1);
  });

  it("names every toolbar tile, in the toolbar and in the list of items to add", () => {
    renderSettingsView({ topToolbarItems: ["back", "forward", "search"] });

    const topToolbarEditor = screen.getByRole("group", { name: "Top toolbar" });
    // The name under each tile is shown as text, not only as a hover tooltip.
    for (const label of ["Back", "Forward", "Refresh", "Go To Folder", "Open In Terminal"]) {
      expect(within(topToolbarEditor).getByText(label)).toBeVisible();
    }
    expect(within(topToolbarEditor).getByText("Available · click to add")).toBeInTheDocument();
    // The buttons keep their own names for assistive technology.
    expect(within(topToolbarEditor).getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(
      within(topToolbarEditor).getByRole("button", { name: "Add Refresh to Top toolbar" }),
    ).toBeInTheDocument();
  });

  it("shows a rail's editor only while that rail is on", () => {
    const toolbarEditors = () =>
      screen
        .getAllByRole("group")
        .map((group) => group.getAttribute("aria-label"))
        .filter((label) => label !== null);

    // Both rails off: only the top toolbar can be edited, and the rails stay switchable.
    const bothOff = renderSettingsView({ showSidebarRail: false, showSidebarBottomRail: false });
    expect(toolbarEditors()).toEqual(["Top toolbar"]);
    expect(screen.getByLabelText("Show left rail")).toBeInTheDocument();
    expect(screen.getByLabelText("Show bottom rail")).toBeInTheDocument();
    bothOff.unmount();

    renderSettingsView({ showSidebarRail: false, showSidebarBottomRail: true });
    expect(toolbarEditors()).toEqual(["Top toolbar", "Bottom rail"]);
  });

  it("keeps the bottom rail's editor while its buttons sit at the foot of the left rail", () => {
    renderSettingsView({ showSidebarRail: true, showSidebarBottomRail: false });

    expect(screen.getByRole("group", { name: "Left rail" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Bottom rail" })).toHaveTextContent(
      "Shown at the foot of the left rail.",
    );
  });

  it("allows adding repeatable separators and restores grouped defaults on reset", () => {
    const onTopToolbarItemsChange = vi.fn();
    const onLeftToolbarItemsChange = vi.fn();
    renderSettingsView({
      showSidebarRail: true,
      topToolbarItems: ["back", "topSeparator", "search"],
      leftToolbarItems: {
        main: ["home", "leftSeparator"],
        utility: ["leftSeparator", "settings"],
      },
      onTopToolbarItemsChange,
      onLeftToolbarItemsChange,
    });

    fireEvent.click(
      within(screen.getByRole("group", { name: "Top toolbar" })).getByRole("button", {
        name: "Add Separator to Top toolbar",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Left rail" })).getByRole("button", {
        name: "Add Separator to Left rail",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("group", { name: "Bottom rail" })).getByRole("button", {
        name: "Add Separator to Bottom rail",
      }),
    );

    expect(onTopToolbarItemsChange).toHaveBeenCalledWith([
      "back",
      "topSeparator",
      "topSeparator",
      "search",
    ]);
    expect(onLeftToolbarItemsChange).toHaveBeenNthCalledWith(1, {
      main: ["home", "leftSeparator", "leftSeparator"],
      utility: ["leftSeparator", "settings"],
    });
    expect(onLeftToolbarItemsChange).toHaveBeenNthCalledWith(2, {
      main: ["home", "leftSeparator"],
      utility: ["leftSeparator", "leftSeparator", "settings"],
    });
  });

  it("removes a toolbar item when it is dropped outside the active toolbar strip", () => {
    const onTopToolbarItemsChange = vi.fn();
    renderSettingsView({
      topToolbarItems: ["back", "search"],
      onTopToolbarItemsChange,
    });

    const topToolbarEditor = screen.getByRole("group", { name: "Top toolbar" });
    const backButton = within(topToolbarEditor).getByRole("button", { name: "Back" });
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setDragImage: () => undefined,
    };

    fireEvent.dragStart(backButton, { dataTransfer });
    fireEvent.drop(topToolbarEditor, { dataTransfer });

    expect(onTopToolbarItemsChange).toHaveBeenCalledWith(["search"]);
  });

  it("updates left rail zones and supports toolbar resets", () => {
    const onLeftToolbarItemsChange = vi.fn();
    const onResetLeftToolbar = vi.fn();
    const onResetToolbars = vi.fn();
    renderSettingsView({
      showSidebarRail: true,
      leftToolbarItems: {
        main: ["home", "help"],
        utility: ["settings"],
      },
      onLeftToolbarItemsChange,
      onResetLeftToolbar,
      onResetToolbars,
    });

    const leftRailEditor = screen.getByRole("group", { name: "Left rail" });
    const utilityZoneEditor = screen.getByRole("group", { name: "Bottom rail" });

    fireEvent.click(
      within(leftRailEditor).getByRole("button", { name: "Add Action Log to Left rail" }),
    );
    fireEvent.click(
      within(utilityZoneEditor).getByRole("button", { name: "Add Trash to Bottom rail" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset All" }));
    fireEvent.click(within(leftRailEditor).getByRole("button", { name: "Reset" }));

    expect(onLeftToolbarItemsChange).toHaveBeenNthCalledWith(1, {
      main: ["home", "help", "actionLog"],
      utility: ["settings"],
    });
    expect(onLeftToolbarItemsChange).toHaveBeenNthCalledWith(2, {
      main: ["home", "help"],
      utility: ["trash", "settings"],
    });
    expect(onResetToolbars).toHaveBeenCalledTimes(1);
    expect(onResetLeftToolbar).toHaveBeenCalledTimes(0);
  });

  it("keeps search and settings out of the customizable lists", () => {
    renderSettingsView();

    expect(screen.queryByRole("button", { name: "Add Search to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Settings to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Settings to Bottom rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Home to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Macintosh HD to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Applications to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Trash to Top toolbar" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add Root Tree At Home to Top toolbar" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Action Log to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Help to Top toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Back to Left rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Forward to Left rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Navigate Up to Left rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Navigate Down to Left rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Back to Bottom rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Forward to Bottom rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Navigate Up to Bottom rail" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Navigate Down to Bottom rail" })).toBeNull();
  });

  it("shows toolbar actions in a stable grouped order across the add lists", () => {
    renderSettingsView({
      showSidebarRail: true,
      topToolbarItems: ["back", "search"],
      leftToolbarItems: {
        main: ["home"],
        utility: ["settings"],
      },
    });

    const topToolbarEditor = screen.getByRole("group", { name: "Top toolbar" });
    const leftRailEditor = screen.getByRole("group", { name: "Left rail" });
    const utilityEditor = screen.getByRole("group", { name: "Bottom rail" });

    expect(
      within(topToolbarEditor).getByRole("button", { name: "Add Copy to Top toolbar" }),
    ).toBeInTheDocument();
    expect(
      within(topToolbarEditor).getByRole("button", { name: "Add Cut to Top toolbar" }),
    ).toBeInTheDocument();
    expect(
      within(topToolbarEditor).getByRole("button", { name: "Add Paste to Top toolbar" }),
    ).toBeInTheDocument();
    expect(
      within(leftRailEditor).getByRole("button", { name: "Add Copy to Left rail" }),
    ).toBeInTheDocument();
    expect(
      within(leftRailEditor).getByRole("button", { name: "Add Cut to Left rail" }),
    ).toBeInTheDocument();
    expect(
      within(leftRailEditor).getByRole("button", { name: "Add Paste to Left rail" }),
    ).toBeInTheDocument();
    expect(
      within(utilityEditor).getByRole("button", { name: "Add Copy to Bottom rail" }),
    ).toBeInTheDocument();
    expect(
      within(utilityEditor).getByRole("button", { name: "Add Cut to Bottom rail" }),
    ).toBeInTheDocument();
    expect(
      within(utilityEditor).getByRole("button", { name: "Add Paste to Bottom rail" }),
    ).toBeInTheDocument();

    const topToolbarAddButtons = Array.from(
      topToolbarEditor.querySelectorAll('button[aria-label^="Add "]'),
    );
    const leftRailAddButtons = Array.from(
      leftRailEditor.querySelectorAll('button[aria-label^="Add "]'),
    );
    const utilityAddButtons = Array.from(
      utilityEditor.querySelectorAll('button[aria-label^="Add "]'),
    );

    expect(
      topToolbarAddButtons.slice(0, 6).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Add Separator to Top toolbar",
      "Add Forward to Top toolbar",
      "Add Navigate Up to Top toolbar",
      "Add Navigate Down to Top toolbar",
      "Add Go To Folder to Top toolbar",
      "Add Refresh to Top toolbar",
    ]);
    expect(leftRailAddButtons[0]).toHaveAttribute("aria-label", "Add Separator to Left rail");
    expect(utilityAddButtons[0]).toHaveAttribute("aria-label", "Add Separator to Bottom rail");
    expect(
      leftRailAddButtons.slice(0, 6).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Add Separator to Left rail",
      "Add Macintosh HD to Left rail",
      "Add Applications to Left rail",
      "Add Trash to Left rail",
      "Add Root Tree At Home to Left rail",
      "Add Go To Folder to Left rail",
    ]);
    expect(
      utilityAddButtons.slice(0, 4).map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Add Separator to Bottom rail",
      "Add Action Log to Bottom rail",
      "Add Help to Bottom rail",
      "Add Theme to Bottom rail",
    ]);
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
