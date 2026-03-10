import { rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

export async function readFileSize(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch {
    return 0;
  }
}

export async function rotateLogFiles(filePath: string, maxFiles: number): Promise<void> {
  if (maxFiles <= 1) {
    await unlink(filePath).catch(() => undefined);
    return;
  }
  await unlink(resolveRotatedLogPath(filePath, maxFiles - 1)).catch(() => undefined);
  for (let index = maxFiles - 2; index >= 1; index -= 1) {
    await rename(resolveRotatedLogPath(filePath, index), resolveRotatedLogPath(filePath, index + 1)).catch(
      () => undefined,
    );
  }
  await rename(filePath, resolveRotatedLogPath(filePath, 1)).catch(() => undefined);
}

export function resolveRotatedLogPath(filePath: string, index: number): string {
  const extension = extname(filePath);
  const directoryPath = dirname(filePath);
  const filename = basename(filePath, extension);
  return join(directoryPath, `${filename}.${index}${extension}`);
}
