// @vitest-environment jsdom

import { render } from "@testing-library/react";

import { ToolbarIcon } from "./ToolbarIcon";

const ICON_NAMES = [
  "back",
  "forward",
  "home",
  "up",
  "down",
  "location",
  "hidden",
  "refresh",
  "list",
  "details",
  "drawer",
  "sidebar",
  "edit",
  "chevron",
  "open",
  "theme",
  "close",
  "sortAsc",
  "sortDesc",
  "help",
  "settings",
  "search",
  "applications",
  "drive",
  "trash",
  "rerootHome",
  "infoRow",
  "foldersFirst",
  "clear",
  "stop",
] as const;

describe("ToolbarIcon", () => {
  it("renders an icon for every supported toolbar glyph name", () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<ToolbarIcon name={name} />);
      expect(container.querySelector("svg.toolbar-icon")).not.toBeNull();
      unmount();
    }
  });

  it("renders specialized shapes for list, details, search, clear, and stop icons", () => {
    const { container, rerender } = render(<ToolbarIcon name="list" />);
    expect(container.querySelectorAll("line")).toHaveLength(3);

    rerender(<ToolbarIcon name="details" />);
    expect(container.querySelectorAll("rect")).toHaveLength(4);

    rerender(<ToolbarIcon name="search" />);
    expect(container.querySelector("circle")).not.toBeNull();

    rerender(<ToolbarIcon name="clear" />);
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelectorAll("line")).toHaveLength(2);

    rerender(<ToolbarIcon name="stop" />);
    expect(container.querySelector("rect")).not.toBeNull();
  });

  it("falls back to the generic arrow path for the open icon", () => {
    const { container } = render(<ToolbarIcon name="open" />);
    expect(container.querySelector("path")).toHaveAttribute("d", "M5 12h14M12 5l7 7-7 7");
  });
});
