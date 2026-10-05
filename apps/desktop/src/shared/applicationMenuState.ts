import { RENDERER_COMMAND_TYPES, type RendererCommandType } from "./rendererCommands";

// What the application menu shows of the explorer window: which commands can run now (the
// rest are dimmed) and which of its checkmarks are on. The window sends it whenever it
// changes; the menu itself lives in the main process.
export type ApplicationMenuState = {
  disabledCommands: RendererCommandType[];
  viewMode: "icons" | "list" | "details";
  sortBy: "name" | "modified" | "size" | "kind";
  foldersFirst: boolean;
  hiddenFilesShown: boolean;
  folderTreeOpen: boolean;
  infoPanelOpen: boolean;
  infoRowOpen: boolean;
  /** Whether the folder the Favorites item acts on is a favorite already. */
  favoriteIsSet: boolean;
  /** A text field has the keyboard: Undo and Redo are its own, and always on. */
  textEditing: boolean;
};

// Before the window has reported: everything available, nothing checked.
export const INITIAL_APPLICATION_MENU_STATE: ApplicationMenuState = {
  disabledCommands: [],
  viewMode: "list",
  sortBy: "name",
  foldersFirst: true,
  hiddenFilesShown: false,
  folderTreeOpen: true,
  infoPanelOpen: false,
  infoRowOpen: false,
  favoriteIsSet: false,
  textEditing: false,
};

const KNOWN_COMMANDS = new Set<string>(RENDERER_COMMAND_TYPES);

// The state as it arrives over IPC, where command names are plain strings.
export function toApplicationMenuState(
  state: Omit<ApplicationMenuState, "disabledCommands"> & { disabledCommands: string[] },
): ApplicationMenuState {
  return {
    ...state,
    disabledCommands: state.disabledCommands.filter((command): command is RendererCommandType =>
      KNOWN_COMMANDS.has(command),
    ),
  };
}
