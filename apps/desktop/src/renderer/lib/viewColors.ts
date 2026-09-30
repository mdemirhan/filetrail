// Text colors for the views that style inline (Settings, Help, Action Log). They reference
// the root tokens that `applyAppearance` maintains, so the theme and the text color
// overrides reach these views exactly as they reach the rest of the app.
export const VIEW_TEXT = {
  primary: "var(--text-primary)",
  secondary: "var(--text-secondary)",
  // The "Muted" text override writes --text-tertiary along with the dimmer tokens.
  muted: "var(--text-tertiary)",
} as const;

// A view's page background: the theme's window background.
export const VIEW_PAGE_BG = "var(--bg-base)";
