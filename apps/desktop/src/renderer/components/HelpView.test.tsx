// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ThemeMode } from "../../shared/appPreferences";
import { HelpView } from "./HelpView";

const defaultShortcutItems = [
  { group: "Navigation", shortcut: "Cmd+R", description: "Refresh the current folder" },
  { group: "Panels", shortcut: "Cmd+1", description: "Focus the folder tree" },
  { group: "Search", shortcut: "Cmd+F", description: "Focus file search" },
  { group: "Views", shortcut: "Esc", description: "Return from Help or Settings to Explorer" },
] as const;

const defaultReferenceItems = [
  {
    label: "Single click path segment",
    description: "Navigate directly to that folder in the current browsing history.",
  },
  {
    label: "Double click path bar",
    description: "Switch the path bar into editable mode without opening a separate dialog.",
  },
] as const;

function renderHelpView({
  theme = "dark",
  layoutMode = "wide",
  shortcutItems = defaultShortcutItems,
  referenceItems = defaultReferenceItems,
}: {
  theme?: ThemeMode;
  layoutMode?: "wide" | "narrow" | "compact";
  shortcutItems?: ReadonlyArray<{ group: string; shortcut: string; description: string }>;
  referenceItems?: ReadonlyArray<{ label: string; description: string }>;
} = {}) {
  return render(
    <HelpView
      shortcutItems={shortcutItems}
      referenceItems={referenceItems}
      layoutMode={layoutMode}
      theme={theme}
    />,
  );
}

describe("HelpView", () => {
  it("exposes the selected layout mode on the root element", () => {
    renderHelpView({ layoutMode: "compact" });

    expect(screen.getByText("Help & Reference").closest(".help-view")).toHaveAttribute(
      "data-layout",
      "compact",
    );
  });

  it.each([
    ["light", "#edeef4"],
    ["dark", "#181b22"],
    ["tomorrow-night", "#151617"],
    ["catppuccin-mocha", "#0e0e18"],
    ["graphite", "#161614"],
    ["sand", "#ece7dc"],
  ] satisfies Array<[ThemeMode, string]>)(
    "uses the attached design palette for the %s theme",
    (theme, background) => {
      renderHelpView({ theme });

      expect(screen.getByText("Help & Reference").closest(".help-view")).toHaveStyle({
        background,
      });
    },
  );

  it("falls back to the document theme when no theme prop is provided", () => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeVariant = "onyx";

    render(
      <HelpView
        shortcutItems={defaultShortcutItems}
        referenceItems={defaultReferenceItems}
        layoutMode="wide"
      />,
    );

    expect(screen.getByText("Help & Reference").closest(".help-view")).toHaveStyle({
      background: "#101218",
    });
  });

  it("shows keyboard shortcuts first and switches to explorer reference on tab click", async () => {
    const user = userEvent.setup();
    renderHelpView();

    expect(screen.getByText("Refresh the current folder")).toBeInTheDocument();
    expect(screen.queryByText("Single click path segment")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "ℹ Explorer Reference" }));

    expect(screen.getByText("Single click path segment")).toBeInTheDocument();
    expect(screen.queryByText("Refresh the current folder")).not.toBeInTheDocument();
    expect(screen.getByText(/Path Bar Editing/)).toBeInTheDocument();
  });

  it("renders grouped shortcut headings from the provided data", () => {
    renderHelpView();

    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Panels")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Views")).toBeInTheDocument();
  });

  it("renders shortcut keys as separate keycaps and preserves trailing plus keys", () => {
    renderHelpView({
      shortcutItems: [{ group: "Navigation", shortcut: "Cmd++", description: "Zoom in" }],
      referenceItems: defaultReferenceItems,
    });

    expect(screen.getByText("Zoom in")).toBeInTheDocument();
    expect(screen.getByText("Cmd")).toBeInTheDocument();
    expect(screen.getByText("Plus")).toBeInTheDocument();
  });
});
