export type ExplorerToolbarLayout = "full" | "condensed" | "narrow" | "minimal";
export type SinglePanelLayout = "wide" | "narrow" | "compact";

// Keep these breakpoints aligned with the real toolbar control density before changing labels
// or adding/removing groups.
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

// Single-panel pages use a separate breakpoint scale because they do not share space with
// the explorer panes and path/tree chrome.
export function resolveSinglePanelLayout(width: number): SinglePanelLayout {
  if (width >= 1100) {
    return "wide";
  }
  if (width >= 760) {
    return "narrow";
  }
  return "compact";
}
