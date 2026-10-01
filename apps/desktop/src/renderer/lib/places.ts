import { type VisitedFolder, visitScore } from "../../shared/visitedFolders";
import { getFavoriteLabel } from "./favorites";

// The Go To box (⌘K) finds a folder from a few letters of its name. Candidates are the
// folders that have been opened plus the favorites; they are ranked by how well the text
// matches first, and by how much the folder is used second.

export type Place = {
  path: string;
  name: string;
  /** The path as shown, with the home folder as "~"; also what a typed word is looked for in. */
  displayPath: string;
  isFavorite: boolean;
  /** Whether the folder has been opened; favorites that never were can not be forgotten. */
  isVisited: boolean;
  /** How much the folder is in use (see `visitScore`); 0 for a favorite never opened. */
  score: number;
};

export type PlaceMatch = {
  place: Place;
  /** Character ranges of the name to highlight, as [start, end) pairs. */
  nameRanges: Array<[number, number]>;
};

// How a piece of the typed text was found, best first.
const MATCH_PREFIX = 5;
const MATCH_WORD_START = 4;
const MATCH_SUBSTRING = 3;
const MATCH_SCATTERED = 2;
const MATCH_PATH_ONLY = 1;

export const MAX_PLACE_RESULTS = 50;

// Every opened folder and every favorite, once each, without the folder on screen.
export function buildPlaces(args: {
  visitedFolders: readonly VisitedFolder[];
  favoritePaths: readonly string[];
  currentPath: string;
  homePath: string;
  now: number;
}): Place[] {
  const { visitedFolders, favoritePaths, currentPath, homePath, now } = args;
  const favorites = new Set(favoritePaths);
  const places = new Map<string, Place>();
  for (const folder of visitedFolders) {
    places.set(folder.path, {
      path: folder.path,
      // Named as the sidebar names them: Home, Trash, Macintosh HD.
      name: getFavoriteLabel(folder.path, homePath),
      displayPath: abbreviatePlacePath(folder.path, homePath),
      isFavorite: favorites.has(folder.path),
      isVisited: true,
      score: visitScore(folder, now),
    });
  }
  for (const path of favoritePaths) {
    if (!places.has(path)) {
      places.set(path, {
        path,
        name: getFavoriteLabel(path, homePath),
        displayPath: abbreviatePlacePath(path, homePath),
        isFavorite: true,
        isVisited: false,
        score: 0,
      });
    }
  }
  places.delete(currentPath);
  return [...places.values()];
}

// Text that is a path rather than a name: the box completes it folder by folder instead.
export function isPathQuery(query: string): boolean {
  const trimmed = query.trimStart();
  return trimmed.startsWith("/") || trimmed.startsWith("~");
}

// The places matching `query`, best first. Each word typed must be found, in the name or
// failing that in the path. With nothing typed, the most used places are listed.
export function rankPlaces(places: readonly Place[], query: string): PlaceMatch[] {
  const words = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const ranked: Array<PlaceMatch & { quality: number }> = [];
  for (const place of places) {
    if (words.length === 0) {
      ranked.push({ place, nameRanges: [], quality: 0 });
      continue;
    }
    const name = place.name.toLocaleLowerCase();
    // The shortened path, so the name of the home folder does not match every folder in it.
    const path = place.displayPath.toLocaleLowerCase();
    let quality = Number.POSITIVE_INFINITY;
    const nameRanges: Array<[number, number]> = [];
    for (const word of words) {
      const inName = matchWord(name, word);
      if (inName) {
        quality = Math.min(quality, inName.quality);
        nameRanges.push(...inName.ranges);
        continue;
      }
      if (path.includes(word)) {
        quality = Math.min(quality, MATCH_PATH_ONLY);
        continue;
      }
      quality = 0;
      break;
    }
    if (quality > 0) {
      ranked.push({ place, nameRanges: mergeRanges(nameRanges), quality });
    }
  }
  // The sort is stable, so equals keep their order: most recently opened first, then the
  // favorites as the sidebar lists them.
  ranked.sort(
    (left, right) =>
      right.quality - left.quality ||
      right.place.score - left.place.score ||
      Number(right.place.isFavorite) - Number(left.place.isFavorite),
  );
  return ranked.slice(0, MAX_PLACE_RESULTS).map(({ place, nameRanges }) => ({ place, nameRanges }));
}

// Finds `word` in `name`: at the start, at the start of a later word, anywhere, or as
// letters in order with other letters between them ("dwn" finds "Downloads").
function matchWord(
  name: string,
  word: string,
): { quality: number; ranges: Array<[number, number]> } | null {
  const index = name.indexOf(word);
  if (index === 0) {
    return { quality: MATCH_PREFIX, ranges: [[0, word.length]] };
  }
  if (index > 0) {
    const wordStart = findWordStart(name, word);
    return wordStart >= 0
      ? { quality: MATCH_WORD_START, ranges: [[wordStart, wordStart + word.length]] }
      : { quality: MATCH_SUBSTRING, ranges: [[index, index + word.length]] };
  }
  const ranges: Array<[number, number]> = [];
  let position = 0;
  for (const character of word) {
    const found = name.indexOf(character, position);
    if (found < 0) {
      return null;
    }
    ranges.push([found, found + character.length]);
    position = found + character.length;
  }
  // Scattered letters only count when the first one starts the name; otherwise almost
  // anything would match a short query.
  return ranges[0]?.[0] === 0 ? { quality: MATCH_SCATTERED, ranges } : null;
}

function findWordStart(name: string, word: string): number {
  let index = name.indexOf(word);
  while (index >= 0) {
    if (index === 0 || /[\s\-_.()[\]]/u.test(name[index - 1] ?? "")) {
      return index;
    }
    index = name.indexOf(word, index + 1);
  }
  return -1;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  return merged;
}

// The path as shown next to a name: the home folder as "~", like Terminal.
export function abbreviatePlacePath(path: string, homePath: string): string {
  if (homePath.length > 1 && (path === homePath || path.startsWith(`${homePath}/`))) {
    return `~${path.slice(homePath.length)}`;
  }
  return path;
}
