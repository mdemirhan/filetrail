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

export function formatPermissionMode(permissionMode: number | null): string {
  const parts = splitPermissionMode(permissionMode);
  if (!parts) {
    return "Unavailable";
  }
  return `${parts.symbolic} (${parts.octal})`;
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
  const absDelta = Math.abs(deltaMs);

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
