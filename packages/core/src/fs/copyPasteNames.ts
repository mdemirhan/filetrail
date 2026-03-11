import { basename, dirname, extname, join } from "node:path";

import { pathExists } from "./copyPasteFingerprint";
import type { WriteServiceFileSystem } from "./writeServiceTypes";

export async function resolveKeepBothDestinationPath(
  sourcePath: string,
  destinationPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<string> {
  const sourceName = basename(sourcePath);
  const destinationDirectoryPath = dirname(destinationPath);
  return resolveDuplicateName(sourceName, destinationDirectoryPath, fileSystem);
}

export async function resolveDuplicateName(
  sourceName: string,
  destinationDirectoryPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<string> {
  const extension = extname(sourceName);
  const baseName =
    extension.length > 0 ? sourceName.slice(0, sourceName.length - extension.length) : sourceName;

  for (let index = 1; ; index += 1) {
    const duplicateName =
      index === 1 ? `${baseName} copy${extension}` : `${baseName} copy ${index}${extension}`;
    const candidatePath = join(destinationDirectoryPath, duplicateName);
    if (!(await pathExists(fileSystem, candidatePath))) {
      return candidatePath;
    }
  }
}
