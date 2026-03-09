import type { RendererCommandType } from "../../shared/rendererCommands";

type MainView = "explorer" | "help" | "settings";

export type ShortcutContext = {
  actionNoticeOpen: boolean;
  copyPasteModalOpen: boolean;
  locationSheetOpen: boolean;
  mainView: MainView;
};

const ZOOM_COMMANDS = new Set<RendererCommandType>(["zoomIn", "zoomOut", "resetZoom"]);

// Global view toggles such as `?` are handled separately from this policy. This module only
// answers whether renderer commands or explorer-scoped keyboard shortcuts may act on content.
export function canHandleRendererCommand(
  command: RendererCommandType,
  context: ShortcutContext,
): boolean {
  if (ZOOM_COMMANDS.has(command)) {
    return true;
  }

  if (command === "openSettings") {
    return !context.locationSheetOpen && !context.actionNoticeOpen;
  }

  if (context.actionNoticeOpen || context.locationSheetOpen || context.copyPasteModalOpen) {
    return false;
  }

  return context.mainView === "explorer";
}

export function canHandleExplorerKeyboardShortcuts(context: ShortcutContext): boolean {
  return (
    context.mainView === "explorer" &&
    !context.actionNoticeOpen &&
    !context.copyPasteModalOpen &&
    !context.locationSheetOpen
  );
}
