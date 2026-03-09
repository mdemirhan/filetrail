// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { ItemContextMenu } from "./ItemContextMenu";

describe("ItemContextMenu", () => {
  it("opens without preselecting any menu item", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        variant="browse"
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(document.querySelector(".context-menu-item.active")).toBeNull();
  });

  it("disables all background actions except New Folder", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        variant="browse"
        disabledActionIds={[
          "open",
          "openWith",
          "toggleInfoPanel",
          "cut",
          "copy",
          "paste",
          "move",
          "rename",
          "duplicate",
          "compress",
          "terminal",
          "copyPath",
          "trash",
        ]}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Open⏎" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "New Folder⇧⌘N" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("lets disabled items become hovered without firing actions", () => {
    const onAction = vi.fn();

    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        variant="browse"
        disabledActionIds={["copyPath"]}
        open
        onAction={onAction}
        onSubmenuAction={() => undefined}
      />,
    );

    const copyPathItem = screen.getByRole("button", { name: "Copy Path⌥⌘C" });
    fireEvent.mouseEnter(copyPathItem);
    fireEvent.click(copyPathItem);

    expect(copyPathItem.className).toContain("active");
    expect(copyPathItem.className).toContain("disabled");
    expect(onAction).not.toHaveBeenCalled();
  });
});
