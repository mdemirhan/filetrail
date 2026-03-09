type Rgb = {
  r: number;
  g: number;
  b: number;
};

export function hexToRgb(value: string): Rgb {
  const normalized = value.trim().replace(/^#/, "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

export function withAlpha(value: string, alpha: number): string {
  if (!value.startsWith("#")) {
    return value;
  }
  const rgb = hexToRgb(value);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}
