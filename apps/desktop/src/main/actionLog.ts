import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  type ActionLogAction,
  type ActionLogEntry,
  type ActionLogItem,
  type WriteOperationAction,
  type WriteOperationResult,
  actionLogEntrySchema,
} from "@filetrail/contracts";
import { readFileSize, resolveRotatedLogPath, rotateLogFiles } from "./logRotation";

type ActionLogStoreDependencies = {
  maxBytes?: number;
  maxFiles?: number;
  onError?: (error: unknown) => void;
};

type ActionLogStore = {
  append: (entry: ActionLogEntry) => Promise<void>;
  list: () => Promise<ActionLogEntry[]>;
};

type ActionLogMetadata = Record<string, string | number | boolean | null>;

type ActionLogRecorder = {
  recordWriteOperation: (args: {
    action: WriteOperationAction;
    operationId: string;
    result: WriteOperationResult;
    sourcePaths: string[];
    destinationPaths: string[];
    metadata?: ActionLogMetadata | null;
  }) => Promise<void>;
  recordOpenPath: (args: {
    path: string;
    ok: boolean;
    error: string | null;
    startedAtMs: number;
    finishedAtMs: number;
  }) => Promise<void>;
  recordOpenWithApplication: (args: {
    applicationPath: string;
    applicationName: string;
    paths: string[];
    ok: boolean;
    error: string | null;
    startedAtMs: number;
    finishedAtMs: number;
  }) => Promise<void>;
  recordOpenInTerminal: (args: {
    requestedPath: string;
    targetPath: string;
    terminalName: string;
    ok: boolean;
    error: string | null;
    startedAtMs: number;
    finishedAtMs: number;
  }) => Promise<void>;
};

const DEFAULT_ACTION_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_ACTION_LOG_MAX_FILES = 10;

export function resolveActionLogFilePath(userDataPath: string): string {
  return join(userDataPath, "logs", "action-log.jsonl");
}

export function createActionLogStore(
  filePath: string,
  dependencies: ActionLogStoreDependencies = {},
): ActionLogStore {
  const maxBytes = dependencies.maxBytes ?? DEFAULT_ACTION_LOG_MAX_BYTES;
  const maxFiles = Math.max(1, dependencies.maxFiles ?? DEFAULT_ACTION_LOG_MAX_FILES);
  const onError =
    dependencies.onError ??
    ((error: unknown) => {
      console.error("[filetrail] action log failed", error);
    });
  let writeQueue = Promise.resolve();

  async function appendEntry(entry: ActionLogEntry): Promise<void> {
    const normalizedEntry = actionLogEntrySchema.parse(entry);
    const line = `${JSON.stringify(normalizedEntry)}\n`;
    const lineBytes = Buffer.byteLength(line);
    await mkdir(dirname(filePath), { recursive: true });
    const size = await readFileSize(filePath);
    if (size > 0 && size + lineBytes > maxBytes) {
      await rotateLogFiles(filePath, maxFiles);
    }
    await appendFile(filePath, line, "utf8");
  }

  return {
    async append(entry) {
      writeQueue = writeQueue
        .then(() => appendEntry(entry))
        .catch((error) => {
          onError(error);
        });
      await writeQueue;
    },
    async list() {
      await writeQueue;
      const entries: ActionLogEntry[] = [];
      const files = [
        filePath,
        ...Array.from({ length: maxFiles - 1 }, (_, index) => index + 1).map((index) =>
          resolveRotatedLogPath(filePath, index),
        ),
      ];
      for (const candidatePath of files) {
        const raw = await readFile(candidatePath, "utf8").catch(() => null);
        if (!raw) {
          continue;
        }
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          try {
            const parsed = actionLogEntrySchema.safeParse(JSON.parse(trimmed));
            if (parsed.success) {
              entries.push(parsed.data);
            } else {
              onError(
                new Error(
                  `[filetrail] action log entry validation failed: ${parsed.error.message}`,
                ),
              );
            }
          } catch (error) {
            onError(error);
          }
        }
      }
      return entries.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    },
  };
}

export function createActionLogRecorder(store: Pick<ActionLogStore, "append">): ActionLogRecorder {
  return {
    async recordWriteOperation(args) {
      const itemSourcePaths = args.result.items
        .map((item) => item.sourcePath)
        .filter((path): path is string => typeof path === "string");
      const itemDestinationPaths = args.result.items
        .map((item) => item.destinationPath)
        .filter((path): path is string => typeof path === "string");
      const sourcePaths = uniquePaths(
        itemSourcePaths.length > 0 ? itemSourcePaths : [...args.sourcePaths],
      );
      const destinationPaths = uniquePaths(
        itemDestinationPaths.length > 0 ? itemDestinationPaths : [...args.destinationPaths],
      );
      await store.append({
        id: createActionLogEntryId(args.action),
        occurredAt: args.result.finishedAt,
        action: args.action,
        status: toActionLogStatus(args.result.status),
        operationId: args.operationId,
        sourcePaths,
        destinationPaths,
        sourceSummary: summarizePaths(sourcePaths),
        destinationSummary: summarizePaths(destinationPaths),
        title: `${getActionLabel(args.action)} ${getStatusLabel(toActionLogStatus(args.result.status))}`,
        message: buildWriteMessage(args.action, args.result, sourcePaths, destinationPaths),
        durationMs: resolveDurationMs(args.result.startedAt, args.result.finishedAt),
        error: args.result.error,
        summary: {
          totalItemCount: args.result.summary.totalItemCount,
          completedItemCount: args.result.summary.completedItemCount,
          failedItemCount: args.result.summary.failedItemCount,
          skippedItemCount: args.result.summary.skippedItemCount,
          cancelledItemCount: args.result.summary.cancelledItemCount,
        },
        items: args.result.items.map((item) => ({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: item.status,
          error: item.error,
          skipReason: item.skipReason,
        })),
        metadata: { ...(args.metadata ?? {}) },
      });
    },
    async recordOpenPath(args) {
      const item = createSingleActionLogItem(args.path, null, args.ok, args.error);
      await store.append(
        createNonWriteActionEntry({
          action: "open",
          occurredAt: new Date(args.finishedAtMs).toISOString(),
          sourcePaths: [args.path],
          destinationPaths: [],
          items: [item],
          error: args.ok ? null : args.error,
          durationMs: Math.max(0, Math.round(args.finishedAtMs - args.startedAtMs)),
          title: args.ok ? "Opened item" : "Open failed",
          message: args.ok
            ? `Opened ${summarizePaths([args.path])}.`
            : `Unable to open ${summarizePaths([args.path])}.`,
          metadata: {},
        }),
      );
    },
    async recordOpenWithApplication(args) {
      const items = args.paths.map((path) =>
        createSingleActionLogItem(path, args.applicationPath, args.ok, args.error),
      );
      await store.append(
        createNonWriteActionEntry({
          action: "open_with",
          occurredAt: new Date(args.finishedAtMs).toISOString(),
          sourcePaths: [...args.paths],
          destinationPaths: [args.applicationPath],
          items,
          error: args.ok ? null : args.error,
          durationMs: Math.max(0, Math.round(args.finishedAtMs - args.startedAtMs)),
          title: args.ok
            ? `Opened With ${args.applicationName}`
            : `Open With ${args.applicationName} failed`,
          message: args.ok
            ? `Opened ${formatItemCount(args.paths.length)} with ${args.applicationName}.`
            : `Unable to open ${formatItemCount(args.paths.length)} with ${args.applicationName}.`,
          metadata: {
            applicationName: args.applicationName,
            applicationPath: args.applicationPath,
          },
        }),
      );
    },
    async recordOpenInTerminal(args) {
      const item = createSingleActionLogItem(
        args.requestedPath,
        args.targetPath,
        args.ok,
        args.error,
      );
      await store.append(
        createNonWriteActionEntry({
          action: "open_in_terminal",
          occurredAt: new Date(args.finishedAtMs).toISOString(),
          sourcePaths: [args.requestedPath],
          destinationPaths: [args.targetPath],
          items: [item],
          error: args.ok ? null : args.error,
          durationMs: Math.max(0, Math.round(args.finishedAtMs - args.startedAtMs)),
          title: args.ok ? `Opened in ${args.terminalName}` : `${args.terminalName} open failed`,
          message: args.ok
            ? `Opened ${summarizePaths([args.targetPath])} in ${args.terminalName}.`
            : `Unable to open ${summarizePaths([args.targetPath])} in ${args.terminalName}.`,
          metadata: {
            terminalName: args.terminalName,
          },
        }),
      );
    },
  };
}

function createNonWriteActionEntry(args: {
  action: Extract<ActionLogAction, "open" | "open_with" | "open_in_terminal">;
  occurredAt: string;
  sourcePaths: string[];
  destinationPaths: string[];
  items: ActionLogItem[];
  error: string | null;
  durationMs: number;
  title: string;
  message: string;
  metadata: ActionLogMetadata;
}): ActionLogEntry {
  const completedItemCount = args.items.filter((item) => item.status === "completed").length;
  const failedItemCount = args.items.filter((item) => item.status === "failed").length;
  const skippedItemCount = args.items.filter((item) => item.status === "skipped").length;
  const cancelledItemCount = args.items.filter((item) => item.status === "cancelled").length;
  return {
    id: createActionLogEntryId(args.action),
    occurredAt: args.occurredAt,
    action: args.action,
    status: failedItemCount > 0 ? "failed" : "completed",
    operationId: null,
    sourcePaths: uniquePaths(args.sourcePaths),
    destinationPaths: uniquePaths(args.destinationPaths),
    sourceSummary: summarizePaths(args.sourcePaths),
    destinationSummary: summarizePaths(args.destinationPaths),
    title: args.title,
    message: args.message,
    durationMs: args.durationMs,
    error: args.error,
    summary: {
      totalItemCount: args.items.length,
      completedItemCount,
      failedItemCount,
      skippedItemCount,
      cancelledItemCount,
    },
    items: args.items,
    metadata: args.metadata,
  };
}

function createSingleActionLogItem(
  sourcePath: string | null,
  destinationPath: string | null,
  ok: boolean,
  error: string | null,
): ActionLogItem {
  return {
    sourcePath,
    destinationPath,
    status: ok ? "completed" : "failed",
    error: ok ? null : error,
    skipReason: null,
  };
}

function createActionLogEntryId(action: ActionLogAction): string {
  return `${action}-${randomUUID()}`;
}

function resolveDurationMs(startedAt: string, finishedAt: string): number | null {
  const startedMs = Date.parse(startedAt);
  const finishedMs = Date.parse(finishedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(finishedMs)) {
    return null;
  }
  return Math.max(0, Math.round(finishedMs - startedMs));
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  return result;
}

function summarizePaths(paths: string[]): string | null {
  if (paths.length === 0) {
    return null;
  }
  if (paths.length === 1) {
    return paths[0] ?? null;
  }
  return `${paths[0]} +${paths.length - 1} more`;
}

function formatItemCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

function getActionLabel(action: WriteOperationAction): string {
  if (action === "move_to") {
    return "Move";
  }
  if (action === "new_folder") {
    return "Create Folder";
  }
  if (action === "trash") {
    return "Move to Trash";
  }
  if (action === "paste") {
    return "Paste";
  }
  if (action === "duplicate") {
    return "Duplicate";
  }
  return "Rename";
}

function getStatusLabel(status: ActionLogEntry["status"]): string {
  if (status === "completed") {
    return "completed";
  }
  if (status === "partial") {
    return "partially completed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function toActionLogStatus(status: WriteOperationResult["status"]): ActionLogEntry["status"] {
  if (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "partial"
  ) {
    return status;
  }
  return "failed";
}

function buildWriteMessage(
  action: WriteOperationAction,
  result: WriteOperationResult,
  sourcePaths: string[],
  destinationPaths: string[],
): string {
  const sourceSummary = summarizePaths(sourcePaths);
  const destinationSummary = summarizePaths(destinationPaths);
  const completedLabel =
    result.summary.completedItemCount > 0 ? `${result.summary.completedItemCount} completed` : null;
  const failedLabel =
    result.summary.failedItemCount > 0 ? `${result.summary.failedItemCount} failed` : null;
  const skippedLabel =
    result.summary.skippedItemCount > 0 ? `${result.summary.skippedItemCount} skipped` : null;
  const cancelledLabel =
    result.summary.cancelledItemCount > 0 ? `${result.summary.cancelledItemCount} cancelled` : null;
  const counts = [completedLabel, failedLabel, skippedLabel, cancelledLabel].filter(
    (value): value is string => value !== null,
  );

  if (action === "trash") {
    return counts.length > 0
      ? `${getActionLabel(action)} finished: ${counts.join(", ")}.`
      : `${getActionLabel(action)} finished.`;
  }
  if (action === "new_folder") {
    return destinationSummary
      ? `${getActionLabel(action)} at ${destinationSummary}.`
      : `${getActionLabel(action)} finished.`;
  }
  if (action === "rename") {
    if (sourceSummary && destinationSummary) {
      return `${getActionLabel(action)} ${sourceSummary} to ${destinationSummary}.`;
    }
    return `${getActionLabel(action)} finished.`;
  }
  if (sourceSummary && destinationSummary) {
    const countSuffix = counts.length > 0 ? ` ${counts.join(", ")}.` : "";
    return `${getActionLabel(action)} ${formatItemCount(result.summary.totalItemCount)} from ${sourceSummary} to ${destinationSummary}.${countSuffix}`;
  }
  return counts.length > 0
    ? `${getActionLabel(action)} finished: ${counts.join(", ")}.`
    : `${getActionLabel(action)} finished.`;
}
