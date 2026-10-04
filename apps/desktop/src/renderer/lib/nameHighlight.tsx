import { type ReactNode, createContext } from "react";

// What a search matched in names, marked in every view while search results are shown.
export const NameHighlightContext = createContext<RegExp | null>(null);

export type TextRange = { start: number; end: number };

const ELLIPSIS = "…";

// Where `pattern` matches in `name`; null when it does not, or matches nothing.
export function findNameMatch(pattern: RegExp | null, name: string): TextRange | null {
  const match = pattern?.exec(name);
  return match && match[0].length > 0
    ? { start: match.index, end: match.index + match[0].length }
    : null;
}

// The match in a name as it shows in a label that may have lost its middle ("Annual…Report.pdf",
// see iconLabel.ts): the part before the "…" is the start of the name and the part after it
// the end. What of the match is still on show is marked; a match (or part of one) that fell
// in the missing middle marks the "…", so it is not lost from sight.
export function mapMatchToLabel(name: string, label: string, match: TextRange): TextRange[] {
  if (label === name) {
    return [match];
  }
  for (let at = label.indexOf(ELLIPSIS); at >= 0; at = label.indexOf(ELLIPSIS, at + 1)) {
    const head = label.slice(0, at);
    const tail = label.slice(at + 1);
    if (!name.startsWith(head) || !name.endsWith(tail) || head.length + tail.length > name.length) {
      continue;
    }
    const tailStart = name.length - tail.length;
    const ranges: TextRange[] = [];
    if (match.start < head.length) {
      ranges.push({ start: match.start, end: Math.min(match.end, head.length) });
    }
    if (match.end > head.length && match.start < tailStart) {
      ranges.push({ start: at, end: at + 1 });
    }
    if (match.end > tailStart) {
      const start = Math.max(match.start, tailStart) - tailStart + at + 1;
      ranges.push({ start, end: match.end - tailStart + at + 1 });
    }
    // Ranges side by side are drawn as one mark.
    return ranges.reduce<TextRange[]>((merged, range) => {
      const last = merged.at(-1);
      if (last && last.end === range.start) {
        last.end = range.end;
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
  }
  return [];
}

// `text` with the given stretches marked; `offset` is where `text` starts in the string the
// ranges are counted in.
export function renderMarkedText(
  text: string,
  ranges: readonly TextRange[],
  offset = 0,
): ReactNode {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const range of ranges) {
    const start = Math.max(at, range.start - offset);
    const end = Math.min(text.length, range.end - offset);
    if (start >= end) {
      continue;
    }
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="search-result-match">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (parts.length === 0) {
    return text;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
