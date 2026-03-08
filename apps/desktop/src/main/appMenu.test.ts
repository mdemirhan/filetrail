import { createApplicationMenuTemplate } from "./appMenu";

describe("createApplicationMenuTemplate", () => {
  it("wires Find Files to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const editMenu = template.find((item) => item.label === "Edit");
    const submenu = Array.isArray(editMenu?.submenu) ? editMenu.submenu : [];
    const findItem = submenu.find((item) => "label" in item && item.label === "Find Files…");

    expect(findItem).toBeTruthy();
    if (!findItem || !("click" in findItem) || typeof findItem.click !== "function") {
      throw new Error("Find Files menu item missing.");
    }
    findItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "focusFileSearch" });
  });
});
