import type {
  CopyPasteNodeKind,
  NodeFingerprint,
  WriteServiceFileSystem,
  WriteServiceStats,
} from "./writeServiceTypes";

export async function captureFingerprint(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<NodeFingerprint> {
  try {
    const stats = await fileSystem.lstat(path);
    const kind = detectKind(stats);
    return {
      exists: true,
      kind,
      size: kind === "file" ? stats.size : null,
      mtimeMs: typeof stats.mtimeMs === "number" ? stats.mtimeMs : null,
      mode: typeof stats.mode === "number" ? stats.mode : null,
      ino: typeof stats.ino === "number" ? stats.ino : null,
      dev: typeof stats.dev === "number" ? stats.dev : null,
      symlinkTarget: kind === "symlink" ? await readlinkSafe(fileSystem, path) : null,
    };
  } catch {
    return {
      exists: false,
      kind: "missing",
      size: null,
      mtimeMs: null,
      mode: null,
      ino: null,
      dev: null,
      symlinkTarget: null,
    };
  }
}

export function detectKind(stats: WriteServiceStats): Exclude<CopyPasteNodeKind, "missing"> {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  return "file";
}

export function fingerprintsEqual(left: NodeFingerprint, right: NodeFingerprint): boolean {
  return (
    left.exists === right.exists &&
    left.kind === right.kind &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.mode === right.mode &&
    left.symlinkTarget === right.symlinkTarget &&
    (left.ino === null || right.ino === null || left.ino === right.ino) &&
    (left.dev === null || right.dev === null || left.dev === right.dev)
  );
}

export async function pathExists(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<boolean> {
  const fingerprint = await captureFingerprint(fileSystem, path);
  return fingerprint.exists;
}

async function readlinkSafe(fileSystem: WriteServiceFileSystem, path: string): Promise<string | null> {
  try {
    return await fileSystem.readlink(path);
  } catch {
    return null;
  }
}
