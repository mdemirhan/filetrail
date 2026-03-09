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
