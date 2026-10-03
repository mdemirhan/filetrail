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
    (element) => !element.hasAttribute("disabled") && isRadioGroupTabStop(root, element),
  );
}

// Tab reaches a radio group once, on its checked radio (or its first, when none is checked).
function isRadioGroupTabStop(root: HTMLElement, element: HTMLElement): boolean {
  if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) {
    return true;
  }
  const group = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
    (radio) => radio.name === element.name && !radio.disabled,
  );
  const checked = group.find((radio) => radio.checked);
  return element === (checked ?? group[0]);
}
