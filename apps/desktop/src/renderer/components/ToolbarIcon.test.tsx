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
  "actionLog",
  "copy",
  "cut",
  "paste",
  "move",
  "duplicate",
  "newFolder",
  "terminal",
  "copyPath",
  "rename",
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
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelectorAll("line")).toHaveLength(3);

    rerender(<ToolbarIcon name="search" />);
    expect(container.querySelector("circle")).not.toBeNull();

    rerender(<ToolbarIcon name="clear" />);
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelectorAll("line")).toHaveLength(2);

    rerender(<ToolbarIcon name="stop" />);
    expect(container.querySelector("rect")).not.toBeNull();
  });

  it("renders the external-open icon for the open action", () => {
    const { container } = render(<ToolbarIcon name="open" />);
    expect(container.querySelector("path")).toHaveAttribute(
      "d",
      "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3",
    );
  });

  it("renders distinct icons for copy vs copyPath", () => {
    const { container: copyContainer } = render(<ToolbarIcon name="copy" />);
    const { container: copyPathContainer } = render(<ToolbarIcon name="copyPath" />);
    const copySvg = copyContainer.querySelector("svg")!.innerHTML;
    const copyPathSvg = copyPathContainer.querySelector("svg")!.innerHTML;
    expect(copySvg).not.toBe(copyPathSvg);
  });

  it("renders distinct icons for edit vs rename", () => {
    const { container: editContainer } = render(<ToolbarIcon name="edit" />);
    const { container: renameContainer } = render(<ToolbarIcon name="rename" />);
    const editSvg = editContainer.querySelector("svg")!.innerHTML;
    const renameSvg = renameContainer.querySelector("svg")!.innerHTML;
    expect(editSvg).not.toBe(renameSvg);
  });
});
