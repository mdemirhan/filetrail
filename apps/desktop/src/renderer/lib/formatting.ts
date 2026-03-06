export function compactPath(path: string): string {
  if (path.length <= 72) {
    return path;
  }
  return `${path.slice(0, 24)}...${path.slice(-44)}`;
}

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
