import type { AppLogEntry, AppLogLevel } from "@filetrail/contracts";

type RendererLogContext = AppLogEntry["context"];
type RendererLogMethod = {
  (message: string): void;
  (message: string, detail: unknown): void;
  (message: string, detail: unknown, context: RendererLogContext): void;
};
type WindowWithFiletrail = Window & {
  __filetrailGlobalLogHandlersInstalled?: boolean;
};

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export function createRendererLogger(namespace: string) {
  function emit(
    level: AppLogLevel,
    message: string,
    detail?: unknown,
    context?: RendererLogContext,
  ): void {
    const entry = normalizeRendererLogEntry(namespace, level, message, detail, context);
    const bridge = typeof window !== "undefined" ? window.filetrail : undefined;
    if (bridge?.log) {
      void bridge.log(entry).catch(() => {
        emitToConsole(entry);
      });
      return;
    }
    emitToConsole(entry);
  }

  const logWithLevel = (level: AppLogLevel): RendererLogMethod =>
    ((message: string, detail?: unknown, context?: RendererLogContext) => {
      emit(level, message, detail, context);
    }) as RendererLogMethod;

  return {
    debug: logWithLevel("debug"),
    info: logWithLevel("info"),
    error: logWithLevel("error"),
  };
}

export function installGlobalRendererErrorHandlers(namespace = "filetrail.renderer"): void {
  if (typeof window === "undefined") {
    return;
  }
  const globalWindow = window as WindowWithFiletrail;
  if (globalWindow.__filetrailGlobalLogHandlersInstalled) {
    return;
  }
  globalWindow.__filetrailGlobalLogHandlersInstalled = true;
  const logger = createRendererLogger(namespace);

  window.addEventListener("error", (event) => {
    logger.error("uncaught renderer error", event.error ?? event.message, {
      filename: event.filename || null,
      line: event.lineno || null,
      column: event.colno || null,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logger.error("unhandled renderer rejection", event.reason);
  });
}

function normalizeRendererLogEntry(
  namespace: string,
  level: AppLogLevel,
  message: string,
  detail?: unknown,
  context?: RendererLogContext,
): AppLogEntry {
  if (isContextArgument(detail, context)) {
    return {
      level,
      namespace,
      message,
      error: null,
      context: normalizeContext(detail),
    };
  }
  return {
    level,
    namespace,
    message,
    error: detail === undefined ? null : toErrorMessage(detail),
    context: context ? normalizeContext(context) : {},
  };
}

function emitToConsole(entry: AppLogEntry): void {
  const prefix = `[${entry.namespace}] ${entry.message}`;
  const args: unknown[] = [prefix];
  if (entry.error) {
    args.push(entry.error);
  }
  if (Object.keys(entry.context).length > 0) {
    args.push(entry.context);
  }
  if (entry.level === "debug") {
    console.debug(...args);
    return;
  }
  if (entry.level === "info") {
    console.info(...args);
    return;
  }
  if (entry.level === "warn") {
    console.warn(...args);
    return;
  }
  console.error(...args);
}

function isContextArgument(
  value: unknown,
  context: RendererLogContext | undefined,
): value is Record<string, unknown> {
  if (context !== undefined) {
    return false;
  }
  return !!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Error);
}

function normalizeContext(value: Record<string, unknown>): RendererLogContext {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, toJsonValue(entryValue)]),
  );
}

function toJsonValue(value: unknown): AppLogEntry["context"][string] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => [key, toJsonValue(childValue)]),
    );
  }
  return String(value);
}
