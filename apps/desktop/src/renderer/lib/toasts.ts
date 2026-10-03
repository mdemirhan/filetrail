// Notifications carry information only: something finished ("success"), something worth
// knowing happened ("info"), or a command did nothing and why ("warning"). They go away by
// themselves and can be turned off, so nothing the user must see may depend on them. An
// action that failed, or only partly worked, is reported in a modal dialog instead, which
// is why there is no "error" kind.
export type ToastKind = "success" | "info" | "warning";

export type ToastEntry = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  durationMs: number;
  expiresAt: number;
};

// How long a notification stays: long enough to read a line and a name.
const TOAST_DURATION_MS = 4000;

export function createToastEntry(
  id: string,
  input: {
    kind: ToastKind;
    title: string;
    message?: string;
  },
  now = Date.now(),
): ToastEntry {
  const durationMs = TOAST_DURATION_MS;
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
