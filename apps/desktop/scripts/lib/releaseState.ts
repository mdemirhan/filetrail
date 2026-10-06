// What a release left unfinished, so the next one doesn't take a version past it: the next
// version comes from the release tags, so a tag whose release never came out would be
// skipped over.

// What GitHub has for a release tag.
export type GitHubReleaseState = "published" | "draft" | "missing";

export function findUnfinishedReleases(args: {
  // Release tags (vX.Y.Z) here, and on GitHub.
  localTags: readonly string[];
  remoteTags: readonly string[];
  // The latest release tag on GitHub, and what GitHub has for it.
  latestOnGitHub: { tag: string; state: GitHubReleaseState } | null;
}): string[] {
  const remote = new Set(args.remoteTags);
  const problems = args.localTags
    .filter((tag) => !remote.has(tag))
    .map(
      (tag) =>
        `${tag} is only on this Mac, left by a release that stopped before pushing it: delete it (git tag -d ${tag}) and run again.`,
    );
  const latest = args.latestOnGitHub;
  if (latest?.state === "draft") {
    problems.push(
      `${latest.tag}'s release is still a draft: publish it on GitHub, or delete it and its tag (git push origin :${latest.tag}; git tag -d ${latest.tag}), before making another.`,
    );
  } else if (latest?.state === "missing") {
    problems.push(
      `${latest.tag} is on GitHub without a release, left by a release that stopped after pushing it: make its release on GitHub, or delete the tag (git push origin :${latest.tag}; git tag -d ${latest.tag}) to start over.`,
    );
  }
  return problems;
}
