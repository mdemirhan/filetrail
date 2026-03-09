export type ExplorerPane = "tree" | "content";

export function resolveExplorerPaneRestoreTarget(input: {
  preferredPane: ExplorerPane | null;
  lastFocusedPane: ExplorerPane | null;
  hasTreePane: boolean;
  hasContentPane: boolean;
}): ExplorerPane | null {
  const candidates: Array<ExplorerPane | null> = [
    input.preferredPane,
    input.lastFocusedPane,
    input.hasContentPane ? "content" : null,
    input.hasTreePane ? "tree" : null,
  ];

  for (const candidate of candidates) {
    if (candidate === "tree" && input.hasTreePane) {
      return candidate;
    }
    if (candidate === "content" && input.hasContentPane) {
      return candidate;
    }
  }

  return null;
}
