// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { PATHBAR_FOLDER_MENU_LIMIT, PathbarFolderMenu } from "./PathbarFolderMenu";

const folder = (name: string) => ({ path: `/Users/demo/${name}`, name });
const FOLDERS = [folder("Desktop"), folder("Documents"), folder("Downloads"), folder("src")];

function renderMenu(overrides: Partial<Parameters<typeof PathbarFolderMenu>[0]> = {}) {
  const onRequestFolders = vi.fn().mockResolvedValue(FOLDERS);
  const onNavigatePath = vi.fn();
  const view = render(
    <PathbarFolderMenu
      parentPath="/Users/demo"
      parentLabel="demo"
      activePath="/Users/demo/Documents"
      onRequestFolders={onRequestFolders}
      onNavigatePath={onNavigatePath}
      {...overrides}
    />,
  );
  return { ...view, onRequestFolders, onNavigatePath };
}

async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Folders in demo" }));
  });
}

const itemNames = () =>
  Array.from(screen.getAllByRole("menuitemradio"), (item) => item.textContent);

describe("PathbarFolderMenu", () => {
  it("lists the folders at that level with the one on the path ticked", async () => {
    const { onRequestFolders } = renderMenu();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onRequestFolders).not.toHaveBeenCalled();

    await openMenu();
    expect(onRequestFolders).toHaveBeenCalledWith("/Users/demo");
    expect(itemNames()).toEqual(["Desktop", "✓Documents", "Downloads", "src"]);
    expect(screen.getByRole("menuitemradio", { name: /Documents/u })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The arrow keys start on the ticked folder.
    expect(screen.getByRole("menuitemradio", { current: true })).toHaveTextContent("Documents");
  });

  it("goes to the folder chosen, and nowhere when the ticked one is chosen", async () => {
    const { onNavigatePath } = renderMenu();

    await openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Documents/u }));
    expect(onNavigatePath).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();

    await openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "src" }));
    expect(onNavigatePath).toHaveBeenCalledWith("/Users/demo/src");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves with the arrow keys and jumps to a letter, and closes with Escape", async () => {
    const { onNavigatePath } = renderMenu();
    await openMenu();

    const current = () => screen.getByRole("menuitemradio", { current: true }).textContent;
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(current()).toBe("Downloads");
    fireEvent.keyDown(window, { key: "s" });
    expect(current()).toBe("src");
    // The next folder starting with "d" after the last one wraps to the first.
    fireEvent.keyDown(window, { key: "d" });
    expect(current()).toBe("Desktop");
    fireEvent.keyDown(window, { key: "End" });
    expect(current()).toBe("src");
    // The keyboard focus itself is never moved into the menu.
    expect(screen.getByRole("menu").contains(document.activeElement)).toBe(false);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    // Return goes to the folder the arrow keys are on.
    await openMenu();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onNavigatePath).toHaveBeenCalledWith("/Users/demo/Desktop");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a click elsewhere and when the path changes", async () => {
    const view = renderMenu();
    await openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    await openMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    view.rerender(
      <PathbarFolderMenu
        parentPath="/Users/demo"
        parentLabel="demo"
        activePath="/Users/demo/src"
        onRequestFolders={view.onRequestFolders}
        onNavigatePath={view.onNavigatePath}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says so when there are no folders or the folder cannot be read", async () => {
    const empty = renderMenu({ onRequestFolders: vi.fn().mockResolvedValue([]) });
    await openMenu();
    expect(screen.getByText("No folders")).toBeInTheDocument();
    empty.unmount();

    renderMenu({ onRequestFolders: vi.fn().mockRejectedValue(new Error("EACCES")) });
    await openMenu();
    expect(screen.getByText("This folder could not be read.")).toBeInTheDocument();
  });

  it("shows the folders around the ticked one when there are too many to list", async () => {
    const many = Array.from({ length: PATHBAR_FOLDER_MENU_LIMIT + 400 }, (_, index) =>
      folder(`pkg-${String(index).padStart(4, "0")}`),
    );
    const activeIndex = PATHBAR_FOLDER_MENU_LIMIT + 200;
    renderMenu({
      onRequestFolders: vi.fn().mockResolvedValue(many),
      activePath: many[activeIndex]?.path ?? "",
    });
    await openMenu();

    expect(screen.getAllByRole("menuitemradio")).toHaveLength(PATHBAR_FOLDER_MENU_LIMIT);
    expect(
      screen.getByRole("menuitemradio", { name: new RegExp(many[activeIndex]?.name ?? "") }),
    ).toHaveAttribute("aria-checked", "true");
    const start = activeIndex - PATHBAR_FOLDER_MENU_LIMIT / 2;
    expect(screen.getByText(`${start} more folders above`)).toBeInTheDocument();
    expect(
      screen.getByText(`${many.length - start - PATHBAR_FOLDER_MENU_LIMIT} more folders below`),
    ).toBeInTheDocument();
  });
});
