// Text colors for the views that style inline (Settings, Help, Action Log). They reference
// the root tokens that `applyAppearance` maintains, so the palette reaches these views
// exactly as it reaches the rest of the app.
export const VIEW_TEXT = {
  primary: "var(--text-primary)",
  secondary: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
} as const;

// A view's page background: the theme's window background.
export const VIEW_PAGE_BG = "var(--bg-base)";
