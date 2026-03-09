import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

type FileSystem = {
  statSync: (path: string) => { isDirectory: () => boolean };
};

const DEFAULT_FILE_SYSTEM: FileSystem = {
  statSync: (path) => statSync(path),
};

export function resolveStartupFolderPath(
  argv: string[],
  cwd: string,
  options: {
    argvOffset?: number;
    homePath?: string;
    appPath?: string | null;
    fileSystem?: FileSystem;
  } = {},
): string | null {
  const argvOffset = options.argvOffset ?? 1;
  const homePath = options.homePath ?? homedir();
  const appPath = options.appPath ?? null;
  const fileSystem = options.fileSystem ?? DEFAULT_FILE_SYSTEM;
  const userArgs = argv.slice(argvOffset);
  const rawPath =
    extractFolderOption(userArgs) ?? extractPositionalFolderArgument(userArgs, cwd, homePath, appPath);
  if (!rawPath) {
    return null;
  }

  const candidatePath = resolveLaunchPath(rawPath, cwd, homePath);

  try {
    return fileSystem.statSync(candidatePath).isDirectory() ? candidatePath : null;
  } catch {
    return null;
  }
}

export function resolveLaunchWorkingDirectory(envPwd: string | undefined, cwd: string): string {
  if (typeof cwd === "string" && cwd.length > 0 && isAbsolute(cwd)) {
    return cwd;
  }
  if (envPwd && isAbsolute(envPwd)) {
    return envPwd;
  }
  return cwd;
}

function extractFolderOption(argv: string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value) {
      continue;
    }
    if (value === "--folder") {
      return argv[index + 1] ?? null;
    }
    if (value.startsWith("--folder=")) {
      const folderPath = value.slice("--folder=".length).trim();
      return folderPath.length > 0 ? folderPath : null;
    }
  }
  return null;
}

function extractPositionalFolderArgument(
  argv: string[],
  cwd: string,
  homePath: string,
  appPath: string | null,
): string | null {
  for (const value of argv) {
    if (!value || value.startsWith("-")) {
      continue;
    }
    if (appPath && resolveLaunchPath(value, cwd, homePath) === appPath) {
      continue;
    }
    return value;
  }
  return null;
}

function resolveLaunchPath(rawPath: string, cwd: string, homePath: string): string {
  if (rawPath === "~") {
    return homePath;
  }
  if (rawPath.startsWith("~/")) {
    return resolve(homePath, rawPath.slice(2));
  }
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}
