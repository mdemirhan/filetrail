import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observedElementRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === observedElementRef.current) {
      return;
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    observedElementRef.current = element;
    if (!element) {
      setSize({ width: 0, height: 0 });
      return;
    }
    const update = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observerRef.current = observer;
  });

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  return size;
}
