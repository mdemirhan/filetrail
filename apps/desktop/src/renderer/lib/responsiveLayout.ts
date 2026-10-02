export type SinglePanelLayout = "wide" | "narrow" | "compact";
export type SearchResultsColumnLayout = "full" | "no-date" | "names";

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

// Search results drop the Date Modified column in a narrow pane, and the Size column too
// in a very narrow one, so names and folders keep their room. A width of 0 means the pane
// has not been measured yet. `[data-columns]` rules in styles.css match these names.
export function resolveSearchResultsColumnLayout(width: number): SearchResultsColumnLayout {
  if (width <= 0 || width > 600) {
    return "full";
  }
  return width > 380 ? "no-date" : "names";
}
