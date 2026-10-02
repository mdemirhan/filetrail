// Used in contexts that still want a human-readable fallback string.
// Table/detail views that need an empty loading state should check raw metadata first.
export function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not available";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not available";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
// A clock a little ahead of this one still reads as now; further ahead gets the full date.
const FUTURE_TOLERANCE_MS = MINUTE_MS;

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const FULL_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const EXACT_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "medium" });

// Whether a date reads as minutes ("24 min ago"), and so changes from one minute to the next.
export function isWithinLastHour(ms: number, now: number): boolean {
  return ms <= now + FUTURE_TOLERANCE_MS && now - ms < HOUR_MS;
}

// A date for a list, said the way it would be said aloud: the closer it is, the more
// relative it reads, and the year or the time is left out where it adds nothing.
//   "Just now", "24 min ago", "Today, 9:12 AM", "Yesterday, 6:03 PM", "Mon, 4:05 PM",
//   "Jun 12, 8:30 AM", "Mar 3, 2024"
// A date in the future (a wrong clock somewhere) is shown in full rather than as "Just now".
export function formatRelativeDateTime(ms: number, now: number): string {
  const date = new Date(ms);
  if (ms > now + FUTURE_TOLERANCE_MS) {
    return FULL_FORMAT.format(date);
  }
  const age = Math.max(0, now - ms);
  if (age < MINUTE_MS) {
    return "Just now";
  }
  if (age < HOUR_MS) {
    return `${Math.floor(age / MINUTE_MS)} min ago`;
  }
  const today = new Date(now);
  // Calendar days, not 24-hour steps: days around a daylight saving change are 23 or 25 hours.
  const startOfDay = (daysAgo: number) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo).getTime();
  const time = TIME_FORMAT.format(date);
  if (ms >= startOfDay(0)) {
    return `Today, ${time}`;
  }
  if (ms >= startOfDay(1)) {
    return `Yesterday, ${time}`;
  }
  // The six days before today: a week back would name today's own weekday.
  if (ms >= startOfDay(6)) {
    return `${WEEKDAY_FORMAT.format(date)}, ${time}`;
  }
  if (date.getFullYear() === today.getFullYear()) {
    return `${DAY_FORMAT.format(date)}, ${time}`;
  }
  return DAY_YEAR_FORMAT.format(date);
}

// The whole date, to the second, for the tooltip of a relative one.
export function formatExactDateTime(ms: number): string {
  return EXACT_FORMAT.format(new Date(ms));
}

export function formatSize(
  sizeBytes: number | null,
  sizeStatus: "ready" | "deferred" | "unavailable",
): string {
  // Callers that need `-` for directories or an empty loading state should layer that
  // behavior outside this generic formatter.
  if (sizeStatus === "deferred") {
    return "Not yet available";
  }
  if (sizeStatus === "unavailable" || sizeBytes === null) {
    return "Unavailable";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

// The mode as its code ("755"). The letters (rwxr-xr-x) say the same thing at three times
// the width, so views show the code and keep the letters for the tooltip.
export function formatPermissionMode(permissionMode: number | null): string {
  return splitPermissionMode(permissionMode)?.octal ?? "Unavailable";
}

// Exposes the symbolic/octal split so views can choose whether they want one combined
// string or separate permission parts.
export function splitPermissionMode(
  permissionMode: number | null,
): { symbolic: string; octal: string } | null {
  if (permissionMode === null || !Number.isFinite(permissionMode) || permissionMode < 0) {
    return null;
  }

  const normalized = permissionMode & 0o777;
  const segments = [
    [0o400, 0o200, 0o100],
    [0o040, 0o020, 0o010],
    [0o004, 0o002, 0o001],
  ];
  const symbols = ["r", "w", "x"];
  const symbolic = segments
    .map((group) => group.map((bit, index) => (normalized & bit ? symbols[index] : "-")).join(""))
    .join("");
  return {
    symbolic,
    octal: normalized.toString(8).padStart(3, "0"),
  };
}

// Root is represented explicitly so breadcrumb-like UIs can render `/` as a real segment.
export function pathSegments(path: string): Array<{ label: string; path: string }> {
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return [{ label: "/", path: "/" }];
  }
  const segments: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

// Splits the visible filename into stem + extension suffix without assuming the stored
// `extension` is always trustworthy or even present in the display name.
export function splitDisplayName(
  name: string,
  extension: string,
): { stem: string; extensionSuffix: string } {
  if (!extension) {
    return {
      stem: name,
      extensionSuffix: "",
    };
  }

  const suffix = `.${extension}`;
  if (!name.toLowerCase().endsWith(suffix.toLowerCase()) || name.length <= suffix.length) {
    return {
      stem: name,
      extensionSuffix: "",
    };
  }

  return {
    stem: name.slice(0, -suffix.length),
    extensionSuffix: suffix,
  };
}

export function formatRelativeDuration(deltaMs: number): string {
  // Round to whole milliseconds first so 999.6 ms reads "1 second", not "1000 ms".
  const absDelta = Math.round(Math.abs(deltaMs));

  if (absDelta < 1000) {
    return `${absDelta} ms`;
  }

  const seconds = Math.floor(absDelta / 1000);
  if (seconds < 60) {
    return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} ${days === 1 ? "day" : "days"}`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months} ${months === 1 ? "month" : "months"}`;
  }

  const years = Math.floor(days / 365);
  return `${years} ${years === 1 ? "year" : "years"}`;
}

export function formatShortDateTime(ms: number): string {
  const date = new Date(ms);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatFolderSizeDetail(
  sizeBytes: number,
  diskBytes: number,
  fileCount: number,
): { size: string; disk: string | null; items: string } {
  const size = formatSize(sizeBytes, "ready");
  const disk = formatSize(diskBytes, "ready");
  return {
    size,
    disk: disk !== size ? `${disk} on disk` : null,
    items: `${fileCount.toLocaleString()} items`,
  };
}

export function formatHintSize(sizeBytes: number | null): string | null {
  if (sizeBytes === null) {
    return null;
  }
  return formatSize(sizeBytes, "ready");
}

export function formatSizeComparison(
  srcBytes: number | null,
  destBytes: number | null,
): { src: string; dest: string; delta: string | null } | null {
  if (srcBytes === null || destBytes === null) {
    return null;
  }
  const src = formatSize(srcBytes, "ready");
  const dest = formatSize(destBytes, "ready");
  let delta: string | null = null;
  if (src === dest && srcBytes !== destBytes) {
    const diff = Math.abs(srcBytes - destBytes);
    const sign = srcBytes > destBytes ? "+" : "-";
    delta = `${sign}${formatSize(diff, "ready")}`;
  }
  return { src, dest, delta };
}
