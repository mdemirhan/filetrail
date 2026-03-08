export type ExplorerToolbarLayout = "full" | "condensed" | "narrow" | "minimal";
export type SinglePanelLayout = "wide" | "narrow" | "compact";

export function resolveExplorerToolbarLayout(width: number): ExplorerToolbarLayout {
  if (width >= 1120) {
    return "full";
  }
  if (width >= 920) {
    return "condensed";
  }
  if (width >= 760) {
    return "narrow";
  }
  return "minimal";
}

export function resolveSinglePanelLayout(width: number): SinglePanelLayout {
  if (width >= 1100) {
    return "wide";
  }
  if (width >= 760) {
    return "narrow";
  }
  return "compact";
}
