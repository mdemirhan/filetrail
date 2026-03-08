// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

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
        compactTreeView={false}
        layoutMode="compact"
        tabSwitchesExplorerPanes={true}
        typeaheadEnabled={true}
        typeaheadDebounceMs={750}
        restoreLastVisitedFolderOnStartup={false}
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
        onCompactTreeViewChange={() => undefined}
        onTabSwitchesExplorerPanesChange={() => undefined}
        onTypeaheadEnabledChange={() => undefined}
        onTypeaheadDebounceMsChange={() => undefined}
        onRestoreLastVisitedFolderOnStartupChange={() => undefined}
      />,
    );

    expect(screen.getByText("Settings").closest(".settings-view")).toHaveAttribute(
      "data-layout",
      "compact",
    );
  });
});
