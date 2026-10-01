import { isNarrowerTextQuery, keepMatchingResults, matchesTextQuery } from "./searchRefinement";

const item = (path: string) => ({ path, name: path.slice(path.lastIndexOf("/") + 1) });
const README = item("/Users/demo/Project/README.md");
const readme = item("/Users/demo/docs/readme.txt");
const notes = item("/Users/demo/docs/notes.txt");

describe("search refinement", () => {
  it("matches plain text as fd does: exactly with an uppercase letter, any case without", () => {
    expect(matchesTextQuery(README, "readme", "name")).toBe(true);
    expect(matchesTextQuery(readme, "readme", "name")).toBe(true);
    expect(matchesTextQuery(README, "README", "name")).toBe(true);
    expect(matchesTextQuery(readme, "README", "name")).toBe(false);
    expect(matchesTextQuery(notes, "readme", "name")).toBe(false);
    // Nothing is a pattern.
    expect(matchesTextQuery(item("/x/report (1).pdf"), "(1).p", "name")).toBe(true);
    expect(matchesTextQuery(item("/x/abc"), "a.c", "name")).toBe(false);
  });

  it("looks at the whole path when the search matches the full path", () => {
    expect(matchesTextQuery(notes, "docs", "name")).toBe(false);
    expect(matchesTextQuery(notes, "docs", "path")).toBe(true);
    expect(matchesTextQuery(README, "project", "path")).toBe(true);
    expect(matchesTextQuery(README, "Docs", "path")).toBe(false);
  });

  it("knows when longer text can only find a subset of what shorter text finds", () => {
    expect(isNarrowerTextQuery("re", "readme")).toBe(true);
    expect(isNarrowerTextQuery("re", "more")).toBe(true);
    expect(isNarrowerTextQuery("re", "re")).toBe(true);
    // A capital in the longer text only makes it stricter.
    expect(isNarrowerTextQuery("re", "REadme")).toBe(true);
    // A capital in the shorter text was matched exactly, so the longer one must keep it.
    expect(isNarrowerTextQuery("Re", "Readme")).toBe(true);
    expect(isNarrowerTextQuery("Re", "readme")).toBe(false);
    expect(isNarrowerTextQuery("re", "r")).toBe(false);
    expect(isNarrowerTextQuery("re", "notes")).toBe(false);
    expect(isNarrowerTextQuery("", "anything")).toBe(false);
  });

  it("keeps the results on screen that the new text also finds", () => {
    const results = [README, readme, notes];
    // Longer text: only what still matches.
    expect(keepMatchingResults([README, readme], "re", "readme.t", "name")).toEqual([readme]);
    // Shorter text: everything found so far still matches.
    expect(keepMatchingResults([README, readme], "readme", "re", "name")).toEqual([README, readme]);
    // Unrelated text: nothing is known to match.
    expect(keepMatchingResults(results, "readme", "notes", "name")).toEqual([]);
    expect(keepMatchingResults(results, "", "re", "name")).toEqual([]);
  });
});
