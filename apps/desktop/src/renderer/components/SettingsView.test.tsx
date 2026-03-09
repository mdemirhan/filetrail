// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { THEME_OPTIONS, type ThemeMode } from "../../shared/appPreferences";
import { SettingsView } from "./SettingsView";

function renderSettingsView(overrides: Partial<ComponentProps<typeof SettingsView>> = {}) {
  return render(
    <SettingsView
      theme="dark"
      accent="gold"
      accentToolbarButtons={true}
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
      restoreLastVisitedFolderOnStartup={false}
      terminalApp={null}
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
      themeOptions={THEME_OPTIONS}
      accentOptions={[
        { value: "gold", label: "Gold", primary: "#daa520" },
        { value: "teal", label: "Teal", primary: "#2cb5a0" },
      ]}
      uiFontOptions={[{ value: "lexend", label: "Lexend" }]}
      uiFontSizeOptions={[13]}
      uiFontWeightOptions={[500]}
      typeaheadDebounceOptions={[750]}
      notificationDurationSecondsOptions={[4, 6]}
      onThemeChange={() => undefined}
      onAccentChange={() => undefined}
      onAccentToolbarButtonsChange={() => undefined}
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
      onDetailColumnsChange={() => undefined}
      onTabSwitchesExplorerPanesChange={() => undefined}
      onTypeaheadEnabledChange={() => undefined}
      onTypeaheadDebounceMsChange={() => undefined}
      onNotificationsEnabledChange={() => undefined}
      onNotificationDurationSecondsChange={() => undefined}
      onRestoreLastVisitedFolderOnStartupChange={() => undefined}
      onTerminalAppChange={() => undefined}
      onAddOpenWithApplication={() => undefined}
      onBrowseOpenWithApplication={() => undefined}
      onMoveOpenWithApplication={() => undefined}
      onRemoveOpenWithApplication={() => undefined}
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
    renderSettingsView({ accent: "teal" });

    expect(screen.getByLabelText("Accent color Gold")).toBeInTheDocument();
    expect(screen.getByLabelText("Accent color Teal")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Teal")).toBeInTheDocument();
  });

  it("forwards toolbar accent toggle changes", () => {
    const onAccentToolbarButtonsChange = vi.fn();
    renderSettingsView({
      accentToolbarButtons: true,
      onAccentToolbarButtonsChange,
    });

    fireEvent.click(screen.getByLabelText("Accent toolbar buttons"));

    expect(onAccentToolbarButtonsChange).toHaveBeenCalledWith(false);
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

  it("forwards terminal app edits as trimmed nullable values", () => {
    const onTerminalAppChange = vi.fn();
    renderSettingsView({ onTerminalAppChange });

    const input = screen.getByLabelText("Terminal app");
    fireEvent.change(input, { target: { value: "  iTerm  " } });
    fireEvent.change(input, { target: { value: "   " } });

    expect(onTerminalAppChange).toHaveBeenNthCalledWith(1, "iTerm");
    expect(onTerminalAppChange).toHaveBeenNthCalledWith(2, null);
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

  it("renders configured Open With applications and fixed helper text", () => {
    renderSettingsView();

    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("/Applications/Visual Studio Code.app")).toBeInTheDocument();
    expect(screen.getByText("Zed")).toBeInTheDocument();
    expect(screen.getByText("Finder and Other… always stay in the context menu.")).toBeInTheDocument();
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
