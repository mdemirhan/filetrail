// A first draft of a release's notes, in the shape of the earlier ones: a "What's new" list
// with one line per commit since the last release, to be rewritten for people before the
// release is published.
export function draftReleaseNotes(commitSubjects: readonly string[]): string {
  const items = commitSubjects
    .map((subject) => subject.trim())
    .filter((subject) => subject.length > 0 && !/^Merge (branch|pull request)\b/u.test(subject));
  return [
    "<!-- Draft: one line per commit since the last release. Rewrite it for people, then publish. -->",
    "### What's new",
    ...(items.length > 0 ? items.map((item) => `- ${item}`) : ["- "]),
    "",
  ].join("\n");
}
