// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { ItemContextMenu } from "./ItemContextMenu";

describe("ItemContextMenu", () => {
  it("disables all background actions except New Folder", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        variant="browse"
        disabledActionIds={[
          "open",
          "openWith",
          "info",
          "copy",
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

    expect(screen.getByRole("button", { name: "Open⏎" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New Folder⇧⌘N" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeDisabled();
  });
});
