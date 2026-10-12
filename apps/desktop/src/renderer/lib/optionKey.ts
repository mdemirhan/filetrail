import { useSyncExternalStore } from "react";

// Whether Option is held, as the last key or mouse event in the window said. Mouse events
// count because Option can go down while another app is in front: a right-click with
// Option held then opens a menu with its alternate items already showing, as on the Mac.
let optionHeld = false;
const listeners = new Set<() => void>();

function setOptionHeld(held: boolean) {
  if (held === optionHeld) {
    return;
  }
  optionHeld = held;
  for (const listener of listeners) {
    listener();
  }
}

if (typeof window !== "undefined") {
  const read = (event: KeyboardEvent | MouseEvent) => setOptionHeld(event.altKey);
  for (const type of ["keydown", "keyup", "mousedown", "mousemove", "contextmenu"] as const) {
    window.addEventListener(type, read, true);
  }
  window.addEventListener("blur", () => setOptionHeld(false));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOptionKeyHeld(): boolean {
  return useSyncExternalStore(subscribe, () => optionHeld);
}
