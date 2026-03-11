import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { inspect } from "node:util";

import type { AppLogEntry, AppLogLevel } from "@filetrail/contracts";
import { readFileSize, rotateLogFiles } from "./logRotation";

type AppLogStoreDependencies = {
  maxBytes?: number;
  maxFiles?: number;
  debugEnabled?: boolean;
  onError?: (error: unknown) => void;
};

type ConsoleLike = Pick<Console, "debug" | "info" | "warn" | "error">;

export type AppLogger = ConsoleLike & {
  flush: () => Promise<void>;
  isDebugEnabled: () => boolean;
};

const DEFAULT_APP_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_APP_LOG_MAX_FILES = 10;

export function resolveAppLogFilePath(userDataPath: string): string {
  return join(userDataPath, "logs", "app.log");
}

export function isDebugLoggingEnabled(): boolean {
  return process.env.FILETRAIL_DEBUG === "1" || process.env.FILETRAIL_DEBUG_TIMINGS === "1";
}

export function createAppLogger(
  filePath: string,
  dependencies: AppLogStoreDependencies & { sink?: ConsoleLike } = {},
): AppLogger {
  const sink = dependencies.sink ?? console;
  const maxBytes = dependencies.maxBytes ?? DEFAULT_APP_LOG_MAX_BYTES;
  const maxFiles = Math.max(1, dependencies.maxFiles ?? DEFAULT_APP_LOG_MAX_FILES);
  const debugEnabled = dependencies.debugEnabled ?? isDebugLoggingEnabled();
  const onError =
    dependencies.onError ??
    ((error: unknown) => {
      console.error("[filetrail] app log failed", error);
    });
  let writeQueue = Promise.resolve();

  async function appendLine(level: AppLogLevel, args: unknown[]): Promise<void> {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${formatArgs(args)}\n`;
    const lineBytes = Buffer.byteLength(line);
    await mkdir(dirname(filePath), { recursive: true });
    const size = await readFileSize(filePath);
    if (size > 0 && size + lineBytes > maxBytes) {
      await rotateLogFiles(filePath, maxFiles);
    }
    await appendFile(filePath, line, "utf8");
  }

  function shouldEmit(level: AppLogLevel): boolean {
    return level !== "debug" || debugEnabled;
  }

  function enqueue(level: AppLogLevel, args: unknown[]): void {
    if (!shouldEmit(level)) {
      return;
    }
    writeQueue = writeQueue.then(() => appendLine(level, args)).catch(onError);
  }

  function emitToConsole(level: AppLogLevel, args: unknown[]): void {
    if (!shouldEmit(level)) {
      return;
    }
    if (level === "debug") {
      sink.debug(...args);
      return;
    }
    if (level === "info") {
      sink.info(...args);
      return;
    }
    if (level === "warn") {
      sink.warn(...args);
      return;
    }
    sink.error(...args);
  }

  function emit(level: AppLogLevel, args: unknown[]): void {
    emitToConsole(level, args);
    enqueue(level, args);
  }

  return {
    debug(...args) {
      emit("debug", args);
    },
    info(...args) {
      emit("info", args);
    },
    warn(...args) {
      emit("warn", args);
    },
    error(...args) {
      emit("error", args);
    },
    async flush() {
      await writeQueue;
    },
    isDebugEnabled() {
      return debugEnabled;
    },
  };
}

export function writeStructuredAppLogEntry(
  logger: Pick<AppLogger, "debug" | "info" | "warn" | "error">,
  entry: AppLogEntry,
): void {
  const prefix = `[${entry.namespace}] ${entry.message}`;
  const args: unknown[] = [prefix];
  if (entry.error) {
    args.push(entry.error);
  }
  if (Object.keys(entry.context).length > 0) {
    args.push(entry.context);
  }
  logger[entry.level](...args);
}

function formatArgs(args: unknown[]): string {
  return args
    .map((value) => {
      if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
      }
      if (typeof value === "string") {
        return value;
      }
      return inspect(value, {
        depth: 8,
        breakLength: Number.POSITIVE_INFINITY,
        compact: true,
        sorted: true,
      });
    })
    .join(" ");
}

export async function readAppLogFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
