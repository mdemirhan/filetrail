// While plain text is typed into the search field, most keystrokes only make the text
// longer. Everything the longer text can match was already matched by the shorter one, so
// the search that is running (or has finished) is kept and its results are narrowed here,
// instead of walking the disk again for every pause in typing.

type SearchMatchScope = "name" | "path";

// fd's "smart case": a query with an uppercase letter is matched exactly, any other
// ignores case.
function isCaseSensitiveQuery(query: string): boolean {
  return /\p{Lu}/u.test(query);
}

// Whether a plain-text search for `query` would find this item, as fd decides it.
export function matchesTextQuery(
  item: { name: string; path: string },
  query: string,
  matchScope: SearchMatchScope,
): boolean {
  const haystack = matchScope === "path" ? item.path : item.name;
  return isCaseSensitiveQuery(query)
    ? haystack.includes(query)
    : haystack.toLowerCase().includes(query);
}

// Whether everything a plain-text search for `next` finds is also found by one for `base`:
// `next` contains `base`, by the case rule `base` is matched with.
export function isNarrowerTextQuery(base: string, next: string): boolean {
  if (base.length === 0 || next.length < base.length) {
    return false;
  }
  return isCaseSensitiveQuery(base) ? next.includes(base) : next.toLowerCase().includes(base);
}

// The results a search for `query` and one for `previousQuery` have in common: whichever of
// the two is the narrower decides. Used to keep, across a change of query, the results on
// screen that still belong there. Unrelated queries share nothing that is known.
export function keepMatchingResults<T extends { name: string; path: string }>(
  results: T[],
  previousQuery: string,
  query: string,
  matchScope: SearchMatchScope,
): T[] {
  if (isNarrowerTextQuery(previousQuery, query)) {
    return results.filter((item) => matchesTextQuery(item, query, matchScope));
  }
  // The new text is the shorter one: everything found so far still matches it.
  if (isNarrowerTextQuery(query, previousQuery)) {
    return results;
  }
  return [];
}
