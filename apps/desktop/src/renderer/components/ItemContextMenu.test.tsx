// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import type { ShortcutContext } from "../lib/shortcutPolicy";
import { type ContextMenuSubmenuItem, ItemContextMenu } from "./ItemContextMenu";

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
        kind: "other" as const,
        id: "other" as const,
        label: "Other…" as const,
        appName: "Other…" as const,
      },
    },
  ];

  it("is worked with the keyboard: arrows, a letter, Return, and the submenu with → and ←", () => {
    const onAction = vi.fn();
    const onSubmenuAction = vi.fn();
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        disabledActionIds={["quickLook"]}
        hiddenActionIds={["openInNewTab", "showPackageContents", "edit"]}
        submenus={{ openWith: submenuItems }}
        shortcutContext={shortcutContext}
        open
        onAction={onAction}
        onSubmenuAction={onSubmenuAction}
      />,
    );
    const active = () =>
      document.querySelector(".context-menu-item.active .context-menu-item-label");
    const press = (key: string) => fireEvent.keyDown(window, { key });

    // ↓ starts on the first item; keys taken by the menu are not seen by the window.
    expect(press("ArrowDown")).toBe(false);
    expect(active()).toHaveTextContent("Open");
    press("ArrowDown");
    expect(active()).toHaveTextContent("Open With");
    // Quick Look can't be chosen, so ↓ goes past it.
    press("ArrowDown");
    expect(active()).toHaveTextContent("Show Info");
    // ↑ from the first item wraps to the last.
    press("Home");
    press("ArrowUp");
    expect(active()).toHaveTextContent("Move to Trash");

    // A letter moves to the next item that starts with it.
    press("d");
    expect(active()).toHaveTextContent("Duplicate");
    press("Enter");
    expect(onAction).toHaveBeenCalledWith("duplicate");

    // → goes into Open With, ↓ moves there, ← comes back out.
    press("Home");
    press("ArrowDown");
    expect(active()).toHaveTextContent("Open With");
    press("ArrowRight");
    expect(document.querySelector(".context-submenu-item.active")).toHaveTextContent("Zed");
    press("ArrowDown");
    expect(document.querySelector(".context-submenu-item.active")).toHaveTextContent(
      "Visual Studio Code",
    );
    press("Enter");
    expect(onSubmenuAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "vscode", kind: "application" }),
    );
    press("ArrowLeft");
    expect(document.querySelector(".context-submenu-item.active")).toBeNull();
    // Escape is left to the window, which closes the menu.
    expect(press("Escape")).toBe(true);
  });

  it("opens without preselecting any menu item", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        submenus={{ openWith: submenuItems }}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(document.querySelector(".context-menu-item.active")).toBeNull();
  });

  it("lists only the current-folder actions in the background menu", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="background"
        disabledActionIds={["paste"]}
        hiddenActionIds={["emptyTrash"]}
        submenus={{ openWith: submenuItems }}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(
      screen.getAllByRole("button").map((button) => button.textContent?.replace(/[⌘⇧⌥⌃].*$/u, "")),
    ).toEqual([
      "New Folder",
      "Show Info",
      "Calculate Size",
      "Paste",
      "Copy Path",
      "View As",
      "Sort By",
      "Open in Terminal",
      "Show in Finder",
    ]);
    expect(screen.getByRole("button", { name: "Paste" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /^New Folder/ })).toHaveAttribute(
      "aria-disabled",
      "false",
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
        submenus={{ openWith: submenuItems }}
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
        submenus={{ openWith: submenuItems }}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Move to…⇧⌘M" })).toBeInTheDocument();
  });

  it("shows a dynamic favorite toggle label when supplied", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        options={{ favoriteToggleLabel: "Remove from Favorites" }}
        submenus={{ openWith: submenuItems }}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Remove from Favorites" })).toBeInTheDocument();
  });

  it("orders content actions with cut before copy", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        submenus={{ openWith: submenuItems }}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={() => undefined}
      />,
    );

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((label) => label && !["Zed", "Visual Studio Code", "Other…"].includes(label))
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

    expect(labels.indexOf("Cut")).toBeLessThan(labels.indexOf("Copy"));
  });

  it("shows only safe shortcut badges for tree folders", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="treeFolder"
        options={{ favoriteToggleLabel: "Add to Favorites" }}
        submenus={{ openWith: submenuItems }}
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

    expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy⌘C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cut⌘X" })).toBeInTheDocument();
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
        options={{ favoriteToggleLabel: "Remove from Favorites" }}
        hiddenActionIds={["emptyTrash"]}
        submenus={{ openWith: submenuItems }}
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
    expect(screen.getByRole("button", { name: "Paste into Folder" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Paste into Folder⌘V" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Copy$/ })).toBeNull();
  });

  it("starts a tree folder's menu with New Folder and leaves out what a click does", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="treeFolder"
        options={{ favoriteToggleLabel: "Add to Favorites" }}
        submenus={{ openWith: submenuItems }}
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
      screen.getAllByRole("button").map((button) => button.textContent?.replace(/[⌘⇧⌥⌃].*$/u, "")),
    ).toEqual([
      "New Folder",
      "Open in New Tab",
      "Use as Tree Root",
      "Show Info",
      "Calculate Size",
      "Cut",
      "Copy",
      "Paste into Folder",
      "Copy Path",
      "Rename",
      "Duplicate",
      "Move to…",
      "Add to Favorites",
      "Open in Terminal",
      "Show in Finder",
      "Move to Trash",
      "Delete Immediately…",
    ]);
  });

  it("keeps the favorite menu's new folder and favorite toggle in their own groups", () => {
    const { container } = render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="favorite"
        options={{ favoriteToggleLabel: "Remove from Favorites" }}
        hiddenActionIds={["emptyTrash"]}
        submenus={{ openWith: submenuItems }}
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

    expect(container.querySelectorAll(".context-menu-separator")).toHaveLength(5);
    const pasteButton = screen.getByRole("button", { name: "Paste into Folder" });
    const copyPathButton = screen.getByRole("button", { name: "Copy Path⌥⌘C" });
    const newFolderButton = screen.getByRole("button", { name: "New Folder" });
    const favoriteButton = screen.getByRole("button", { name: "Remove from Favorites" });
    const terminalButton = screen.getByRole("button", { name: "Open in Terminal⌥⌘T" });

    // New Folder comes first, on its own.
    expect(screen.getAllByRole("button")[0]).toBe(newFolderButton);
    expect(newFolderButton.nextElementSibling).toHaveClass("context-menu-separator");
    expect(pasteButton.nextElementSibling).toBe(copyPathButton);
    const separatorAfterCopyPath = copyPathButton.nextElementSibling;
    expect(separatorAfterCopyPath).toHaveClass("context-menu-separator");
    expect(separatorAfterCopyPath?.nextElementSibling).toBe(favoriteButton);
    const separatorAfterFavorite = favoriteButton.nextElementSibling;
    expect(separatorAfterFavorite).toHaveClass("context-menu-separator");
    expect(separatorAfterFavorite?.nextElementSibling).toBe(terminalButton);
  });

  it("offers Empty Trash at the end of the Trash favorite's menu", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="favorite"
        hiddenActionIds={["toggleFavorite"]}
        submenus={{ openWith: submenuItems }}
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

    const buttons = screen.getAllByRole("button");
    expect(buttons.at(-1)?.textContent).toMatch(/^Empty Trash…/);
  });

  it("hides the favorite toggle item when requested", () => {
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        hiddenActionIds={["toggleFavorite"]}
        submenus={{ openWith: submenuItems }}
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
        options={{ favoriteToggleLabel: "Remove from Favorites" }}
        hiddenActionIds={["toggleFavorite", "rootTreeHere", "paste", "newFolder", "emptyTrash"]}
        submenus={{ openWith: submenuItems }}
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
    expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
    expect(container.querySelectorAll(".context-menu-separator")).toHaveLength(3);
  });

  it("ticks the current view in the background menu's View As, and picks another", () => {
    const onSubmenuAction = vi.fn();
    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="background"
        hiddenActionIds={["emptyTrash"]}
        submenus={{
          viewAs: [
            { action: { kind: "viewMode", id: "icons", label: "Icons", checked: false } },
            { action: { kind: "viewMode", id: "details", label: "List", checked: true } },
          ],
        }}
        shortcutContext={shortcutContext}
        open
        onAction={() => undefined}
        onSubmenuAction={onSubmenuAction}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "View As" }));
    expect(screen.getByRole("menuitemradio", { name: "List" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Icons" }));
    expect(onSubmenuAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "viewMode", id: "icons" }),
    );

    // Another item's submenu takes its place; Sort By has none here.
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Sort By" }));
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("renders submenu items in the supplied order and dispatches the clicked action", () => {
    const onSubmenuAction = vi.fn();

    render(
      <ItemContextMenu
        anchorX={0}
        anchorY={0}
        surface="content"
        submenus={{ openWith: submenuItems }}
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
        ["Zed", "Visual Studio Code", "Other…"].includes(button.textContent ?? ""),
      );
    expect(submenuButtons.map((button) => button.textContent)).toEqual([
      "Zed",
      "Visual Studio Code",
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
