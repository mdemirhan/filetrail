// Shared explorer shell constraints referenced by pane resize math, persistence clamps,
// and layout calculations across renderer code.
export const EXPLORER_LAYOUT = {
  treeMinWidth: 220,
  treeMaxWidth: 520,
  inspectorMinWidth: 260,
  inspectorMaxWidth: 480,
  resizerWidth: 8,
  paneResizeStep: 12,
  paneResizeStepLarge: 24,
  minContentWidth: 420,
} as const;
