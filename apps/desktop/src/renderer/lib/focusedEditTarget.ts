export type FocusedEditTarget = "editable-text" | "readonly-text" | "non-text";

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "number",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);

export function resolveFocusedEditTarget(element: Element | null): FocusedEditTarget {
  if (!element) {
    return "non-text";
  }

  const marker = element.closest<HTMLElement>("[data-native-text-edit]");
  if (marker) {
    const value = marker.getAttribute("data-native-text-edit");
    if (value === "readonly") {
      return "readonly-text";
    }
    if (value === "true") {
      return "editable-text";
    }
  }

  if (element instanceof HTMLTextAreaElement) {
    if (element.disabled) {
      return "non-text";
    }
    return element.readOnly ? "readonly-text" : "editable-text";
  }

  if (element instanceof HTMLInputElement) {
    if (element.disabled) {
      return "non-text";
    }
    const normalizedType = element.type.trim().toLowerCase();
    if (NON_TEXT_INPUT_TYPES.has(normalizedType)) {
      return "non-text";
    }
    return element.readOnly ? "readonly-text" : "editable-text";
  }

  let currentElement: Element | null = element;
  while (currentElement) {
    if (
      currentElement instanceof HTMLElement &&
      (currentElement.isContentEditable ||
        currentElement.getAttribute("contenteditable") === "true" ||
        currentElement.getAttribute("contenteditable") === "plaintext-only")
    ) {
      return "editable-text";
    }
    currentElement = currentElement.parentElement;
  }

  return "non-text";
}

export function isKeyboardOwnedFormControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (resolveFocusedEditTarget(target) !== "non-text") {
    return true;
  }

  return target instanceof HTMLSelectElement && !target.disabled;
}
