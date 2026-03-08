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

  it("wires Copy Path to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const editMenu = template.find((item) => item.label === "Edit");
    const submenu = Array.isArray(editMenu?.submenu) ? editMenu.submenu : [];
    const copyPathItem = submenu.find((item) => "label" in item && item.label === "Copy Path");

    expect(copyPathItem).toBeTruthy();
    if (!copyPathItem || !("click" in copyPathItem) || typeof copyPathItem.click !== "function") {
      throw new Error("Copy Path menu item missing.");
    }
    copyPathItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "copyPath" });
  });

  it("wires Refresh to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];
    const refreshItem = submenu.find((item) => "label" in item && item.label === "Refresh");

    expect(refreshItem).toBeTruthy();
    if (!refreshItem || !("click" in refreshItem) || typeof refreshItem.click !== "function") {
      throw new Error("Refresh menu item missing.");
    }
    refreshItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", {
      type: "refreshOrApplySearchSort",
    });
  });
});
