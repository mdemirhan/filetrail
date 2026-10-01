// Tooltips for icon-only buttons, drawn by the app instead of the system.
//
// macOS shows a web page's `title` tooltips through AppKit, around the real pointer. In
// this app that turned out to be unreliable: the same button shows its tooltip on one
// approach and not on the next. Drawing them here makes them appear every time, placed
// beside the control.
//
// Only buttons with no visible label get one (toolbar and rail buttons, and the like): an
// icon needs its name, while a file or folder row already shows its own.

const SHOW_DELAY_MS = 600;
// Moving straight on to another control shows its tooltip at once.
const WARM_WINDOW_MS = 400;
const EDGE_MARGIN = 6;
const ANCHOR_GAP = 6;
// Rows keep to themselves, including the small disclosure buttons inside them.
const QUIET_CONTAINER_SELECTOR = ".tree-row";

type TooltipPlacement = { left: number; top: number };

export function resolveTooltipPlacement(input: {
  anchor: { left: number; top: number; right: number; bottom: number; width: number };
  bubble: { width: number; height: number };
  viewport: { width: number; height: number };
  side: "below" | "right";
}): TooltipPlacement {
  const { anchor, bubble, viewport, side } = input;
  const clampLeft = (left: number) =>
    Math.max(EDGE_MARGIN, Math.min(left, viewport.width - bubble.width - EDGE_MARGIN));
  const clampTop = (top: number) =>
    Math.max(EDGE_MARGIN, Math.min(top, viewport.height - bubble.height - EDGE_MARGIN));

  if (side === "right") {
    const anchorCenterY = (anchor.top + anchor.bottom) / 2;
    return {
      left: clampLeft(anchor.right + ANCHOR_GAP),
      top: clampTop(anchorCenterY - bubble.height / 2),
    };
  }

  const below = anchor.bottom + ANCHOR_GAP;
  const fitsBelow = below + bubble.height <= viewport.height - EDGE_MARGIN;
  return {
    left: clampLeft(anchor.left + anchor.width / 2 - bubble.width / 2),
    top: clampTop(fitsBelow ? below : anchor.top - ANCHOR_GAP - bubble.height),
  };
}

function findTooltipElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const element = target.closest("[title]");
  if (
    !element ||
    !element.matches('button, [role="button"]') ||
    element.closest(QUIET_CONTAINER_SELECTOR)
  ) {
    return null;
  }
  const hasTitle = (element.getAttribute("title") ?? "").trim().length > 0;
  const hasVisibleLabel = (element.textContent ?? "").trim().length > 0;
  return hasTitle && !hasVisibleLabel ? element : null;
}

export function installTitleTooltips(doc: Document = document): () => void {
  const defaultView = doc.defaultView;
  if (!defaultView) {
    return () => undefined;
  }
  const view: Window = defaultView;

  // The element whose tooltip is waiting to show or showing.
  let anchor: Element | null = null;
  // After a click, the element stays quiet until the pointer leaves it.
  let quietElement: Element | null = null;
  let stashedTitle: string | null = null;
  let bubble: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastHiddenAt = Number.NEGATIVE_INFINITY;

  // The title is taken off the element for as long as the pointer is over it, so the system
  // never draws its own tooltip next to this one. A title set again meanwhile (the label
  // changed) is picked up the same way.
  function stashTitle() {
    if (!anchor) {
      return;
    }
    const title = anchor.getAttribute("title");
    if (title === null) {
      return;
    }
    stashedTitle = title;
    anchor.removeAttribute("title");
    if (bubble) {
      bubble.textContent = title.trim();
    }
  }

  function show() {
    timer = null;
    if (!anchor || !anchor.isConnected) {
      hide();
      return;
    }
    const text = (stashedTitle ?? "").trim();
    if (text.length === 0) {
      return;
    }

    bubble = doc.createElement("div");
    bubble.className = "app-tooltip";
    bubble.setAttribute("role", "tooltip");
    bubble.textContent = text;
    doc.body.appendChild(bubble);

    const anchorRect = anchor.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const placement = resolveTooltipPlacement({
      anchor: anchorRect,
      bubble: { width: bubbleRect.width, height: bubbleRect.height },
      viewport: { width: view.innerWidth, height: view.innerHeight },
      side: anchor.closest(".sidebar-rail") ? "right" : "below",
    });
    bubble.style.left = `${Math.round(placement.left)}px`;
    bubble.style.top = `${Math.round(placement.top)}px`;
  }

  function hide() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (bubble) {
      bubble.remove();
      bubble = null;
      lastHiddenAt = Date.now();
    }
    if (anchor && stashedTitle !== null && anchor.isConnected && !anchor.hasAttribute("title")) {
      anchor.setAttribute("title", stashedTitle);
    }
    stashedTitle = null;
    anchor = null;
  }

  function handleMouseOver(event: MouseEvent) {
    const target = event.target;
    if (quietElement) {
      if (target instanceof Node && quietElement.contains(target)) {
        return;
      }
      quietElement = null;
    }
    if (anchor && target instanceof Node && anchor.contains(target)) {
      return;
    }
    hide();
    const next = findTooltipElement(target);
    if (!next) {
      return;
    }
    anchor = next;
    stashTitle();
    const delay = Date.now() - lastHiddenAt <= WARM_WINDOW_MS ? 0 : SHOW_DELAY_MS;
    timer = setTimeout(show, delay);
  }

  function handleMouseMove() {
    stashTitle();
  }

  function handleMouseOut(event: MouseEvent) {
    // Leaving the window altogether.
    if (event.relatedTarget === null) {
      hide();
    }
  }

  function handlePress(event: Event) {
    const pressed = anchor ?? findTooltipElement(event.target);
    hide();
    quietElement = event.type === "mousedown" ? pressed : null;
  }

  function handleDismiss() {
    hide();
  }

  doc.addEventListener("mouseover", handleMouseOver, true);
  doc.addEventListener("mousemove", handleMouseMove, true);
  doc.addEventListener("mouseout", handleMouseOut, true);
  doc.addEventListener("mousedown", handlePress, true);
  doc.addEventListener("keydown", handleDismiss, true);
  doc.addEventListener("wheel", handleDismiss, true);
  doc.addEventListener("scroll", handleDismiss, true);
  doc.addEventListener("dragstart", handleDismiss, true);
  view.addEventListener("blur", handleDismiss);

  return () => {
    hide();
    doc.removeEventListener("mouseover", handleMouseOver, true);
    doc.removeEventListener("mousemove", handleMouseMove, true);
    doc.removeEventListener("mouseout", handleMouseOut, true);
    doc.removeEventListener("mousedown", handlePress, true);
    doc.removeEventListener("keydown", handleDismiss, true);
    doc.removeEventListener("wheel", handleDismiss, true);
    doc.removeEventListener("scroll", handleDismiss, true);
    doc.removeEventListener("dragstart", handleDismiss, true);
    view.removeEventListener("blur", handleDismiss);
  };
}
