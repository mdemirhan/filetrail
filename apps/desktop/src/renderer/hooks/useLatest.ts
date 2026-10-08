import { useLayoutEffect, useRef } from "react";

// The value of the latest render, for a handler that must stay the same function from one
// render to the next (so the rows given it are not drawn again) yet act on what is on
// screen now. Read it in event handlers, never while rendering.
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
