export type ToastKind = "success" | "info" | "warning" | "error";

export type ToastEntry = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  durationMs: number;
  expiresAt: number;
};

const TOAST_DURATION_MS: Record<ToastKind, number> = {
  success: 3000,
  info: 3000,
  warning: 4500,
  error: 4500,
};

export function createToastEntry(
  id: string,
  input: {
    kind: ToastKind;
    title: string;
    message?: string;
    durationMs?: number;
  },
  now = Date.now(),
): ToastEntry {
  const durationMs =
    typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
      ? Math.max(0, Math.round(input.durationMs))
      : TOAST_DURATION_MS[input.kind];
  return {
    id,
    kind: input.kind,
    title: input.title,
    ...(input.message ? { message: input.message } : {}),
    durationMs,
    expiresAt: now + durationMs,
  };
}

export function enqueueToast(
  current: ToastEntry[],
  nextToast: ToastEntry,
  maxVisible = 3,
): ToastEntry[] {
  return [...current, nextToast].slice(-maxVisible);
}
