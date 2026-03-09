export function getFocusableElements(
  root: HTMLElement,
  options: { includeLinks?: boolean } = {},
): HTMLElement[] {
  const selectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ];
  if (options.includeLinks) {
    selectors.splice(1, 0, "[href]");
  }
  return Array.from(root.querySelectorAll<HTMLElement>(selectors.join(", "))).filter(
    (element) => !element.hasAttribute("disabled"),
  );
}
