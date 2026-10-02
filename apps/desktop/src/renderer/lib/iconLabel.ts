import { splitDisplayName } from "./formatting";

// Names under icons wrap onto at most two lines. A longer name is shortened like Finder
// does: the first line stays as it wraps, and the rest loses its middle so that the end of
// the name and the extension stay readable: "Panorama" / "Miradouro…Monte.jpeg".

const ELLIPSIS = "…";
// How much of the name before the extension is kept at the end.
const TAIL_STEM_CHARACTERS = 5;
const LABEL_LINE_COUNT = 2;
const FITTED_LABEL_CACHE_MAX = 4000;

// Shortens `name` in the middle until `fits` accepts it, keeping as much of its start as
// possible. `fits` must not accept a longer text after refusing a shorter one (true of a
// single line). A name that cannot be made to fit is returned whole and left to the
// label's own clipping.
export function shortenNameInMiddle(
  name: string,
  extension: string,
  fits: (text: string) => boolean,
): string {
  if (fits(name)) {
    return name;
  }
  const { stem, extensionSuffix } = splitDisplayName(name, extension);
  // Code points, so a character outside the basic plane is never cut in half.
  const stemCharacters = Array.from(stem);
  // Less of the end is kept when keeping all of it leaves no room for a start.
  const longestTail = Math.min(TAIL_STEM_CHARACTERS, Math.floor(stemCharacters.length / 2));
  for (let tailLength = longestTail; tailLength >= 0; tailLength -= 1) {
    const tail = `${stemCharacters.slice(stemCharacters.length - tailLength).join("")}${extensionSuffix}`;
    const shortened = (headLength: number) =>
      `${stemCharacters.slice(0, headLength).join("").trimEnd()}${ELLIPSIS}${tail}`;

    // The longest start of the name that still fits, found by halving.
    let low = 1;
    let high = stemCharacters.length - tailLength - 1;
    let best: string | null = null;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = shortened(middle);
      if (fits(candidate)) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best !== null) {
      return best;
    }
  }
  return name;
}

type LabelMeasurer = {
  element: HTMLElement;
  /** Tallest a label of two lines is. */
  maxHeight: number;
  /** Width a line of text has. */
  lineWidth: number;
};
const measurers = new Map<boolean, LabelMeasurer>();

// An off-screen copy of the label (same font, width and wrapping, see `.icon-label-measurer`
// in styles.css) that tells how tall a name comes out.
function getMeasurer(compact: boolean): LabelMeasurer | null {
  const existing = measurers.get(compact);
  if (existing?.element.isConnected) {
    return existing;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const element = document.createElement("div");
  element.className = `icon-item-label icon-label-measurer${compact ? " compact" : ""}`;
  element.setAttribute("aria-hidden", "true");
  document.body.appendChild(element);
  const style = window.getComputedStyle(element);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
    // No layout (a test environment): nothing can be measured, so names are left whole.
    element.remove();
    return null;
  }
  const pixels = (value: string) => Number.parseFloat(value) || 0;
  const measurer = {
    element,
    maxHeight:
      lineHeight * LABEL_LINE_COUNT + pixels(style.paddingTop) + pixels(style.paddingBottom) + 0.5,
    lineWidth: element.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight) + 0.5,
  };
  measurers.set(compact, measurer);
  return measurer;
}

// How many characters of the text in `element` the browser put on its first line.
function measureFirstLineLength(element: HTMLElement): number {
  const textNode = element.firstChild;
  if (!(textNode instanceof Text)) {
    return 0;
  }
  const text = textNode.data;
  const range = document.createRange();
  // Top of the line holding the character at `index`. A space folded away at the end of a
  // line, and the second half of a character outside the basic plane, have no box of their
  // own; they are on the line of the character before them.
  const lineTop = (index: number): number => {
    for (let at = index; at >= 0; at -= 1) {
      range.setStart(textNode, at);
      range.setEnd(textNode, at + 1);
      const rect = range.getClientRects()[0];
      if (rect && rect.height > 0) {
        return rect.top;
      }
    }
    return 0;
  };
  const firstTop = lineTop(0);
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineTop(middle) > firstTop + 1) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function fitWithMeasurer(measurer: LabelMeasurer, name: string, extension: string): string {
  const { element, maxHeight, lineWidth } = measurer;
  const fitsOnTwoLines = (text: string) => {
    element.textContent = text;
    return element.offsetHeight <= maxHeight;
  };
  if (fitsOnTwoLines(name)) {
    return name;
  }
  // The first line stays as the browser wrapped it; what follows is shortened to one line.
  const firstLineLength = measureFirstLineLength(element);
  const range = document.createRange();
  element.style.whiteSpace = "nowrap";
  const rest = shortenNameInMiddle(name.slice(firstLineLength), extension, (text) => {
    element.textContent = text;
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width <= lineWidth;
  });
  element.style.whiteSpace = "";
  const fitted = `${name.slice(0, firstLineLength)}${rest}`;
  return fitsOnTwoLines(fitted) ? fitted : name;
}

const fittedLabels = new Map<string, string>();

// The name as icon view shows it: whole when it fits on two lines, shortened in the middle
// otherwise. Results are remembered for each name, density and font.
export function fitIconLabel(name: string, extension: string, compact: boolean): string {
  const measurer = getMeasurer(compact);
  if (!measurer) {
    return name;
  }
  const font = document.documentElement.style.getPropertyValue("--font-sans");
  const cacheKey = `${compact ? "c" : "r"}\0${font}\0${name}`;
  const cached = fittedLabels.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const fitted = fitWithMeasurer(measurer, name, extension);
  measurer.element.textContent = "";
  if (fittedLabels.size >= FITTED_LABEL_CACHE_MAX) {
    fittedLabels.clear();
  }
  fittedLabels.set(cacheKey, fitted);
  return fitted;
}
