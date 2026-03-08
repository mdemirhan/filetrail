// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { HelpView } from "./HelpView";

describe("HelpView", () => {
  it("exposes the selected layout mode on the root element", () => {
    render(
      <HelpView
        shortcutItems={[{ group: "Navigation", shortcut: "Cmd+R", description: "Refresh" }]}
        referenceItems={[{ label: "Single click", description: "Navigate directly." }]}
        layoutMode="compact"
      />,
    );

    expect(screen.getByText("Help & Reference").closest(".help-view")).toHaveAttribute(
      "data-layout",
      "compact",
    );
  });
});
