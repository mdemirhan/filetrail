// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("exposes the selected layout mode on the root element", () => {
    render(
      <SettingsView
        theme="dark"
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
        layoutMode="compact"
        tabSwitchesExplorerPanes={true}
        typeaheadEnabled={true}
        typeaheadDebounceMs={750}
        restoreLastVisitedFolderOnStartup={false}
        terminalApp={null}
        themeOptions={[{ value: "dark", label: "Dark" }]}
        uiFontOptions={[{ value: "lexend", label: "Lexend" }]}
        uiFontSizeOptions={[13]}
        uiFontWeightOptions={[500]}
        typeaheadDebounceOptions={[750]}
        onThemeChange={() => undefined}
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
        onRestoreLastVisitedFolderOnStartupChange={() => undefined}
        onTerminalAppChange={() => undefined}
      />,
    );

    expect(screen.getByText("Settings").closest(".settings-view")).toHaveAttribute(
      "data-layout",
      "compact",
    );
  });

  it("forwards terminal app edits as trimmed nullable values", () => {
    const onTerminalAppChange = vi.fn();

    render(
      <SettingsView
        theme="dark"
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
        tabSwitchesExplorerPanes={true}
        typeaheadEnabled={true}
        typeaheadDebounceMs={750}
        restoreLastVisitedFolderOnStartup={false}
        terminalApp={null}
        themeOptions={[{ value: "dark", label: "Dark" }]}
        uiFontOptions={[{ value: "lexend", label: "Lexend" }]}
        uiFontSizeOptions={[13]}
        uiFontWeightOptions={[500]}
        typeaheadDebounceOptions={[750]}
        onThemeChange={() => undefined}
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
        onRestoreLastVisitedFolderOnStartupChange={() => undefined}
        onTerminalAppChange={onTerminalAppChange}
      />,
    );

    const input = screen.getByLabelText("Terminal app");
    fireEvent.change(input, { target: { value: "  iTerm  " } });
    fireEvent.change(input, { target: { value: "   " } });

    expect(onTerminalAppChange).toHaveBeenNthCalledWith(1, "iTerm");
    expect(onTerminalAppChange).toHaveBeenNthCalledWith(2, null);
  });
});
