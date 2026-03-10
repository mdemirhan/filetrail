// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { type ContextMenuSubmenuItem, ItemContextMenu } from "./ItemContextMenu";
import type { ShortcutContext } from "../lib/shortcutPolicy";

describe("ItemContextMenu", () => {
  const shortcutContext: ShortcutContext = {
    actionNoticeOpen: false,
    copyPasteModalOpen: false,
    focusedPane: "content",
    locationSheetOpen: false,
    mainView: "explorer",
    selectedTreeTargetKind: null,
  };
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
        surface="content"
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
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
        surface="content"
        disabledActionIds={[
          "open",
          "openWith",
          "edit",
          "showInfo",
          "cut",
          "copy",
          "paste",
          "move",
          "rename",
          "duplicate",
          "terminal",
          "copyPath",
          "trash",
        ]}
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "New Folder⇧⌘N" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy Path" })).toHaveAttribute(
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
        surface="content"
        disabledActionIds={["copyPath"]}
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
        open
        onAction={onAction}
        onSubmenuAction={() => undefined}
      />,
    );

    const copyPathItem = screen.getByRole("button", { name: "Copy Path" });
    fireEvent.mouseEnter(copyPathItem);
    fireEvent.click(copyPathItem);

    expect(copyPathItem.className).toContain("active");
    expect(copyPathItem.className).toContain("disabled");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows the updated Move To shortcut", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Move To…⇧⌘M" })).toBeInTheDocument();
  });

  it("shows a dynamic favorite toggle label when supplied", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        favoriteToggleLabel="Remove from Favorites"
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Remove from Favorites" })).toBeInTheDocument();
  });

  it("shows only safe shortcut badges for tree folders", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="treeFolder"
        favoriteToggleLabel="Add to Favorites"
        folderExpansionLabel="Collapse"
        submenuItems={submenuItems}
        shortcutContext={{
          ...shortcutContext,
          focusedPane: "tree",
          selectedTreeTargetKind: "filesystemFolder",
        }}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Open⌘O" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy⌘C" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cut" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cut⌘X" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "RenameF2" })).toBeNull();
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });

  it("renders the narrowed favorite menu with only enabled shortcut badges", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="favorite"
        favoriteToggleLabel="Remove from Favorites"
        submenuItems={submenuItems}
        shortcutContext={{
          ...shortcutContext,
          focusedPane: "tree",
          selectedTreeTargetKind: "favorite",
        }}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Open⌘O" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal in Tree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste Into Favorite" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste Into Favorite⌘V" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy$/ })).toBeNull();
  });

  it("omits expand controls when the action is hidden for alias folders", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="treeFolder"
        hiddenActionIds={["toggleExpand"]}
        submenuItems={submenuItems}
        shortcutContext={{
          ...shortcutContext,
          focusedPane: "tree",
          selectedTreeTargetKind: "filesystemFolder",
        }}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse" })).toBeNull();
  });

  it("hides the favorite toggle item when requested", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        hiddenActionIds={["toggleFavorite"]}
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.queryByRole("button", { name: /Favorites/i })).toBeNull();
  });

  it("removes orphaned separators after hidden favorite actions are filtered out", () => {
    const { container } = render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="favorite"
        favoriteToggleLabel="Remove from Favorites"
        hiddenActionIds={["toggleFavorite", "paste", "newFolder"]}
        submenuItems={submenuItems}
        shortcutContext={{
          ...shortcutContext,
          focusedPane: "tree",
          selectedTreeTargetKind: "favorite",
        }}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Show Info" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
    expect(container.querySelectorAll(".context-menu-separator")).toHaveLength(1);
  });

  it("renders submenu items in the supplied order and dispatches the clicked action", () => {
    const onSubmenuAction = vi.fn();

    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        submenuItems={submenuItems}
        shortcutContext={shortcutContext}
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
