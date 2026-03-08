import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observedElementRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const resizeListenerRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === observedElementRef.current) {
      return;
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (resizeListenerRef.current) {
      window.removeEventListener("resize", resizeListenerRef.current);
      resizeListenerRef.current = null;
    }
    observedElementRef.current = element;
    if (!element) {
      setSize({ width: 0, height: 0 });
      return;
    }
    const update = () => {
      const w = element.clientWidth;
      const h = element.clientHeight;
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observerRef.current = observer;
    window.addEventListener("resize", update);
    resizeListenerRef.current = update;
  });

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      if (resizeListenerRef.current) {
        window.removeEventListener("resize", resizeListenerRef.current);
      }
    },
    [],
  );

  return size;
}
