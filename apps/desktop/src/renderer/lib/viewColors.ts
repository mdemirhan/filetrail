// Text colors for Settings, which styles inline. They reference the root tokens that
// `applyAppearance` maintains, so the palette reaches it exactly as it reaches the rest of
// the app.
export const VIEW_TEXT = {
  primary: "var(--text-primary)",
  secondary: "var(--text-secondary)",
  muted: "var(--text-tertiary)",
} as const;
