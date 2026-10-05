import type { RendererCommandType } from "../../shared/rendererCommands";
import { getTrashPath } from "./favorites";

// The places the Go menu goes to, as Finder's does. Macintosh HD and the Trash are rows of
// the sidebar's Locations and open as a click on the row does; the folders open as Go to
// Folder opens them.
export type GoMenuPlace = { path: string; asLocation: boolean };

type GoMenuPlaceCommand = Extract<
  RendererCommandType,
  | "goDocuments"
  | "goDesktop"
  | "goDownloads"
  | "goLibrary"
  | "goMacintoshHD"
  | "goApplications"
  | "goTrash"
>;

const HOME_FOLDER_BY_COMMAND: Partial<Record<GoMenuPlaceCommand, string>> = {
  goDocuments: "Documents",
  goDesktop: "Desktop",
  goDownloads: "Downloads",
  goLibrary: "Library",
};

export function isGoMenuPlaceCommand(command: RendererCommandType): command is GoMenuPlaceCommand {
  return (
    command in HOME_FOLDER_BY_COMMAND ||
    command === "goMacintoshHD" ||
    command === "goApplications" ||
    command === "goTrash"
  );
}

// Null until the home folder is known, for the places in it.
export function resolveGoMenuPlace(
  command: GoMenuPlaceCommand,
  homePath: string,
): GoMenuPlace | null {
  if (command === "goMacintoshHD") {
    return { path: "/", asLocation: true };
  }
  if (command === "goApplications") {
    return { path: "/Applications", asLocation: false };
  }
  if (homePath.length === 0) {
    return null;
  }
  if (command === "goTrash") {
    return { path: getTrashPath(homePath), asLocation: true };
  }
  return { path: `${homePath}/${HOME_FOLDER_BY_COMMAND[command]}`, asLocation: false };
}
