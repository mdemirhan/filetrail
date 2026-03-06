export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createRendererLogger(namespace: string) {
  const debugEnabled =
    typeof window !== "undefined" && window.localStorage.getItem("filetrail.debug") === "1";
  return {
    debug(message: string, details?: unknown) {
      if (!debugEnabled) {
        return;
      }
      console.debug(`[${namespace}] ${message}`, details);
    },
    error(message: string, error: unknown) {
      console.error(`[${namespace}] ${message}: ${toErrorMessage(error)}`);
    },
  };
}
