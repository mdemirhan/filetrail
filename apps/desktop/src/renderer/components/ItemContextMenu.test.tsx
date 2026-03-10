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

  it("orders content actions with copy before cut", () => {
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

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((label) => label && !["Zed", "Visual Studio Code", "Finder", "Other…"].includes(label))
      .map((label) => {
        if (label?.startsWith("Open With")) {
          return "Open With";
        }
        if (label?.startsWith("Show Info")) {
          return "Show Info";
        }
        if (label?.startsWith("Copy Path")) {
          return "Copy Path";
        }
        if (label?.startsWith("Open in Terminal")) {
          return "Open in Terminal";
        }
        if (label?.startsWith("Open")) {
          return "Open";
        }
        if (label?.startsWith("Copy")) {
          return "Copy";
        }
        if (label?.startsWith("Cut")) {
          return "Cut";
        }
        return label;
      });

    expect(labels.indexOf("Copy")).toBeLessThan(labels.indexOf("Cut"));
  });

  it("shows only safe shortcut badges for tree folders", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="treeFolder"
        favoriteToggleLabel="Add to Favorites"
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
    expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy⌘C" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cut" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cut⌘X" })).toBeNull();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "RenameF2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse" })).toBeNull();
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

    expect(screen.getByRole("button", { name: "Reveal in Tree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open⌘O$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Paste" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste⌘V" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open in Terminal⌘T" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy$/ })).toBeNull();
  });

  it("orders tree folder actions with new folder before terminal and copy path", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="treeFolder"
        favoriteToggleLabel="Add to Favorites"
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

    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.textContent)
        .filter((label) => label && !["Zed", "Visual Studio Code", "Finder", "Other…"].includes(label))
        .map((label) => {
          if (label?.startsWith("Open in Terminal")) {
            return "Open in Terminal";
          }
          if (label?.startsWith("Copy Path")) {
            return "Copy Path";
          }
          if (label?.startsWith("Show Info")) {
            return "Show Info";
          }
          if (label?.startsWith("Open")) {
            return "Open";
          }
          return label;
        }),
    ).toEqual([
      "Open",
      "Show Info",
      "Add to Favorites",
      "Copy",
      "Cut",
      "Paste",
      "Move To…",
      "Rename",
      "Duplicate",
      "New Folder",
      "Open in Terminal",
      "Copy Path",
      "Move to Trash",
    ]);
  });

  it("keeps favorite new-folder actions split from terminal and copy path", () => {
    const { container } = render(
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

    expect(container.querySelectorAll(".context-menu-separator")).toHaveLength(4);
    const pasteButton = screen.getByRole("button", { name: "Paste" });
    const newFolderButton = screen.getByRole("button", { name: "New Folder" });
    const terminalButton = screen.getByRole("button", { name: "Open in Terminal⌘T" });
    const separatorAfterPaste = pasteButton.nextElementSibling;
    const separatorAfterNewFolder = newFolderButton.nextElementSibling;

    expect(separatorAfterPaste).not.toBeNull();
    expect(separatorAfterPaste).toHaveClass("context-menu-separator");
    expect(separatorAfterPaste?.nextElementSibling).toBe(newFolderButton);
    expect(separatorAfterNewFolder).not.toBeNull();
    expect(separatorAfterNewFolder).toHaveClass("context-menu-separator");
    expect(separatorAfterNewFolder?.nextElementSibling).toBe(terminalButton);
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

    expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
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
