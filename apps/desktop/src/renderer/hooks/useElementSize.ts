import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observedElementRef = useRef<T | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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
      const rect = element.getBoundingClientRect();
      const nextSize = {
        width: Math.round(rect.width || element.clientWidth),
        height: Math.round(rect.height || element.clientHeight),
      };
      setSize((currentSize) =>
        currentSize.width === nextSize.width && currentSize.height === nextSize.height
          ? currentSize
          : nextSize,
      );
    };
    const scheduleUpdate = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        update();
      });
    };
    update();
    const observer = new ResizeObserver(() => {
      scheduleUpdate();
    });
    observer.observe(element);
    if (element.parentElement) {
      observer.observe(element.parentElement);
    }
    observerRef.current = observer;
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);

    return () => {
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  });

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      observerRef.current?.disconnect();
    },
    [],
  );

  return size;
}
