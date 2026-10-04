export type SinglePanelLayout = "wide" | "narrow" | "compact";

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
