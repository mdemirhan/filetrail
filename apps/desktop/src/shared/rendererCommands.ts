export const RENDERER_COMMAND_TYPES = [
  "editCut",
  "editCopy",
  "editPaste",
  "editSelectAll",
  "focusFileSearch",
  "openSelection",
  "editSelection",
  "openLocationSheet",
  "openSettings",
  "zoomIn",
  "zoomOut",
  "resetZoom",
  "openInTerminal",
  "moveSelection",
  "renameSelection",
  "duplicateSelection",
  "newFolder",
  "trashSelection",
  "copySelection",
  "cutSelection",
  "pasteSelection",
  "copyPath",
  "refreshOrApplySearchSort",
  "toggleInfoPanel",
  "toggleInfoRow",
] as const;

export type RendererCommandType = (typeof RENDERER_COMMAND_TYPES)[number];

export type RendererCommand = {
  type: RendererCommandType;
};
