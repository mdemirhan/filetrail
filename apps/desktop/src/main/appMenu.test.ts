import { createApplicationMenuTemplate } from "./appMenu";

describe("createApplicationMenuTemplate", () => {
  it("wires Open and Edit to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = Array.isArray(fileMenu?.submenu) ? fileMenu.submenu : [];
    const openItem = submenu.find((item) => "label" in item && item.label === "Open");
    const editItem = submenu.find((item) => "label" in item && item.label === "Edit");

    if (!openItem || !("click" in openItem) || typeof openItem.click !== "function") {
      throw new Error("Open menu item missing.");
    }
    if (!editItem || !("click" in editItem) || typeof editItem.click !== "function") {
      throw new Error("Edit menu item missing.");
    }

    openItem.click(undefined as never, undefined as never, undefined as never);
    editItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "openSelection" });
    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "editSelection" });
  });

  it("wires Open in Terminal to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = Array.isArray(fileMenu?.submenu) ? fileMenu.submenu : [];
    const openInTerminalItem = submenu.find(
      (item) => "label" in item && item.label === "Open in Terminal",
    );

    expect(openInTerminalItem).toBeTruthy();
    if (
      !openInTerminalItem ||
      !("click" in openInTerminalItem) ||
      typeof openInTerminalItem.click !== "function"
    ) {
      throw new Error("Open in Terminal menu item missing.");
    }
    openInTerminalItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "openInTerminal" });
  });

  it("wires Move To, Rename, Duplicate, New Folder, and Move to Trash", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const fileMenu = template.find((item) => item.label === "File");
    const submenu = Array.isArray(fileMenu?.submenu) ? fileMenu.submenu : [];
    const labels = [
      ["Move To…", "moveSelection"],
      ["Rename", "renameSelection"],
      ["Duplicate", "duplicateSelection"],
      ["New Folder", "newFolder"],
      ["Move to Trash", "trashSelection"],
    ] as const;

    for (const [label, command] of labels) {
      const item = submenu.find((entry) => "label" in entry && entry.label === label);
      expect(item).toBeTruthy();
      if (!item || !("click" in item) || typeof item.click !== "function") {
        throw new Error(`${label} menu item missing.`);
      }
      item.click(undefined as never, undefined as never, undefined as never);
      expect(send).toHaveBeenCalledWith("filetrail:command", { type: command });
    }
  });

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

  it("wires Copy, Cut, Paste, and Select All to generic edit commands", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const editMenu = template.find((item) => item.label === "Edit");
    const submenu = Array.isArray(editMenu?.submenu) ? editMenu.submenu : [];
    const copyItem = submenu.find((item) => "label" in item && item.label === "Copy");
    const cutItem = submenu.find((item) => "label" in item && item.label === "Cut");
    const pasteItem = submenu.find((item) => "label" in item && item.label === "Paste");
    const selectAllItem = submenu.find((item) => "label" in item && item.label === "Select All");

    if (!copyItem || !("click" in copyItem) || typeof copyItem.click !== "function") {
      throw new Error("Copy menu item missing.");
    }
    if (!cutItem || !("click" in cutItem) || typeof cutItem.click !== "function") {
      throw new Error("Cut menu item missing.");
    }
    if (!pasteItem || !("click" in pasteItem) || typeof pasteItem.click !== "function") {
      throw new Error("Paste menu item missing.");
    }
    if (
      !selectAllItem ||
      !("click" in selectAllItem) ||
      typeof selectAllItem.click !== "function"
    ) {
      throw new Error("Select All menu item missing.");
    }

    copyItem.click(undefined as never, undefined as never, undefined as never);
    cutItem.click(undefined as never, undefined as never, undefined as never);
    pasteItem.click(undefined as never, undefined as never, undefined as never);
    selectAllItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "editCopy" });
    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "editCut" });
    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "editPaste" });
    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "editSelectAll" });
  });

  it("wires Go to Folder to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const editMenu = template.find((item) => item.label === "Edit");
    const submenu = Array.isArray(editMenu?.submenu) ? editMenu.submenu : [];
    const goToFolderItem = submenu.find(
      (item) => "label" in item && item.label === "Go to Folder…",
    );

    expect(goToFolderItem).toBeTruthy();
    if (
      !goToFolderItem ||
      !("click" in goToFolderItem) ||
      typeof goToFolderItem.click !== "function"
    ) {
      throw new Error("Go to Folder menu item missing.");
    }
    goToFolderItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "openLocationSheet" });
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

  it("shows Action Log in the View menu when enabled", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never, {
      actionLogEnabled: true,
    });
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];
    const actionLogItem = submenu.find((item) => "label" in item && item.label === "Action Log");

    expect(actionLogItem).toBeTruthy();
    if (!actionLogItem || !("click" in actionLogItem) || typeof actionLogItem.click !== "function") {
      throw new Error("Action Log menu item missing.");
    }

    actionLogItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", { type: "openActionLog" });
  });

  it("hides Action Log in the View menu when disabled", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never, {
      actionLogEnabled: false,
    });
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];

    expect(submenu.some((item) => "label" in item && item.label === "Action Log")).toBe(false);
  });

  it("wires Toggle Info Panel to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];
    const getInfoItem = submenu.find(
      (item) => "label" in item && item.label === "Toggle Info Panel",
    );

    expect(getInfoItem).toBeTruthy();
    if (!getInfoItem || !("click" in getInfoItem) || typeof getInfoItem.click !== "function") {
      throw new Error("Toggle Info Panel menu item missing.");
    }
    getInfoItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", {
      type: "toggleInfoPanel",
    });
  });

  it("wires Toggle Info Row to the renderer command channel", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send } as never);
    const viewMenu = template.find((item) => item.label === "View");
    const submenu = Array.isArray(viewMenu?.submenu) ? viewMenu.submenu : [];
    const infoRowItem = submenu.find((item) => "label" in item && item.label === "Toggle Info Row");

    expect(infoRowItem).toBeTruthy();
    if (!infoRowItem || !("click" in infoRowItem) || typeof infoRowItem.click !== "function") {
      throw new Error("Toggle Info Row menu item missing.");
    }
    infoRowItem.click(undefined as never, undefined as never, undefined as never);

    expect(send).toHaveBeenCalledWith("filetrail:command", {
      type: "toggleInfoRow",
    });
  });
});
