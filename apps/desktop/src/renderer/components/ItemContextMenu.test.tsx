// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { type ContextMenuSubmenuItem, ItemContextMenu } from "./ItemContextMenu";

describe("ItemContextMenu", () => {
  const submenuItems: ContextMenuSubmenuItem[] = [
    {
      action: {
        kind: "application" as const,
        id: "zed",
        label: "Zed",
        appPath: "/Applications/Zed.app",
        appName: "Zed",
      },
    },
    {
      action: {
        kind: "application" as const,
        id: "vscode",
        label: "Visual Studio Code",
        appPath: "/Applications/Visual Studio Code.app",
        appName: "Visual Studio Code",
      },
    },
    { type: "separator" as const, key: "fixed" },
    {
      action: {
        kind: "finder" as const,
        id: "finder" as const,
        label: "Finder" as const,
        appPath: "Finder" as const,
        appName: "Finder" as const,
      },
    },
    {
      action: {
        kind: "other" as const,
        id: "other" as const,
        label: "Other…" as const,
        appName: "Other…" as const,
      },
    },
  ];

  it("opens without preselecting any menu item", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        variant="browse"
        submenuItems={submenuItems}
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
          "edit",
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
        submenuItems={submenuItems}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Open⌘O" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Edit⌘E" })).toHaveAttribute("aria-disabled", "true");
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
        submenuItems={submenuItems}
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

  it("renders submenu items in the supplied order and dispatches the clicked action", () => {
    const onSubmenuAction = vi.fn();

    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        variant="browse"
        submenuItems={submenuItems}
        open
        onAction={() => undefined}
        onSubmenuAction={onSubmenuAction}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));

    const submenuButtons = screen
      .getAllByRole("button")
      .filter((button) =>
        ["Zed", "Visual Studio Code", "Finder", "Other…"].includes(button.textContent ?? ""),
      );
    expect(submenuButtons.map((button) => button.textContent)).toEqual([
      "Zed",
      "Visual Studio Code",
      "Finder",
      "Other…",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Visual Studio Code" }));

    expect(onSubmenuAction).toHaveBeenCalledWith({
      kind: "application",
      id: "vscode",
      label: "Visual Studio Code",
      appPath: "/Applications/Visual Studio Code.app",
      appName: "Visual Studio Code",
    });
  });
});
