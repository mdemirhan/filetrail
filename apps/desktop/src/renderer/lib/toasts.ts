import type { ClipboardIcon } from "./copyPasteClipboard";

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
  /** Shown in place of the kind's icon: what was copied or cut. */
  icon?: ClipboardIcon;
  durationMs: number;
  expiresAt: number;
};

const TOAST_DURATION_MS: Record<ToastKind, number> = {
  success: 3000,
  info: 3000,
  warning: 4500,
};

export function createToastEntry(
  id: string,
  input: {
    kind: ToastKind;
    title: string;
    message?: string;
    icon?: ClipboardIcon;
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
    ...(input.icon ? { icon: input.icon } : {}),
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
