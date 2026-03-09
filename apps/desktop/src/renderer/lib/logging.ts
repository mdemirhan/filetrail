export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createRendererLogger(namespace: string) {
  return {
    error(message: string, error: unknown) {
      console.error(`[${namespace}] ${message}: ${toErrorMessage(error)}`);
    },
  };
}
