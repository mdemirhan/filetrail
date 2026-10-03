import { createContext, useContext } from "react";

// How long the Info panel slides, and how long items take to glide to their new places
// when it opens or closes. The CSS animations in styles.css use the same duration.
export const PANE_LAYOUT_CHANGE_MS = 220;

// Counts the times the Info panel opened or closed. The content pane's width changes in one
// step then, and views that place items by width (icon view) move each item from where it
// was to where it lands, instead of letting it jump.
export const PaneLayoutChangeContext = createContext(0);

export function usePaneLayoutChange(): number {
  return useContext(PaneLayoutChangeContext);
}
