// @vitest-environment jsdom

import { render } from "@testing-library/react";

import { ToolbarIcon } from "./ToolbarIcon";

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error("Expected value to be defined.");
  }
  return value;
}

const ICON_NAMES = [
  "back",
  "forward",
  "up",
  "location",
  "hidden",
  "refresh",
  "list",
  "details",
  "drawer",
  "edit",
  "chevron",
  "open",
  "theme",
  "close",
  "sortAsc",
  "sortDesc",
  "sort",
  "more",
  "help",
  "settings",
  "search",
  "trash",
  "infoRow",
  "foldersFirst",
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
  "title",
  "clipboard",
  "newTab",
  "quickLook",
  "showInFinder",
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
    // Bulleted list: three rows plus three bullet dots.
    expect(container.querySelectorAll("path")).toHaveLength(2);

    rerender(<ToolbarIcon name="details" />);
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelector("path")).toHaveAttribute("d", "M3 10h18M3 15h18M9 10v9.5");

    rerender(<ToolbarIcon name="sort" />);
    expect(container.querySelector("path")).toHaveAttribute(
      "d",
      "M8 4v16M4 16l4 4 4-4M16 20V4M12 8l4-4 4 4",
    );

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
    const copySvg = expectDefined(copyContainer.querySelector("svg")).innerHTML;
    const copyPathSvg = expectDefined(copyPathContainer.querySelector("svg")).innerHTML;
    expect(copySvg).not.toBe(copyPathSvg);
  });

  it("centers the disclosure chevron in its box, so it turns in place when rotated", () => {
    const { container } = render(<ToolbarIcon name="chevron" />);
    const d = container.querySelector("path")?.getAttribute("d") ?? "";
    // Absolute points of an "M x y l dx dy dx dy" path.
    const [x = 0, y = 0, ...steps] = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const points = [[x, y]];
    for (let i = 0; i + 1 < steps.length; i += 2) {
      const [px = 0, py = 0] = points[points.length - 1] ?? [];
      points.push([px + (steps[i] ?? 0), py + (steps[i + 1] ?? 0)]);
    }
    const xs = points.map(([px]) => px ?? 0);
    const ys = points.map(([, py]) => py ?? 0);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBe(12);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBe(12);
  });

  it("renders distinct icons for edit vs rename", () => {
    const { container: editContainer } = render(<ToolbarIcon name="edit" />);
    const { container: renameContainer } = render(<ToolbarIcon name="rename" />);
    const editSvg = expectDefined(editContainer.querySelector("svg")).innerHTML;
    const renameSvg = expectDefined(renameContainer.querySelector("svg")).innerHTML;
    expect(editSvg).not.toBe(renameSvg);
  });
});
