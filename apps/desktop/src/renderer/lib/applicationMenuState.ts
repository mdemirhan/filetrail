import type { ApplicationMenuState } from "../../shared/applicationMenuState";
import { RENDERER_COMMAND_TYPES, type RendererCommandType } from "../../shared/rendererCommands";

// What the application menu is told about the window: every command that can not run now,
// and what its checkmarks show.
export function buildApplicationMenuState(
  args: Omit<ApplicationMenuState, "disabledCommands"> & {
    canRun: (command: RendererCommandType) => boolean;
  },
): ApplicationMenuState {
  const { canRun, ...shown } = args;
  return {
    disabledCommands: RENDERER_COMMAND_TYPES.filter((command) => !canRun(command)),
    ...shown,
  };
}
