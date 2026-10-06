import { findUnfinishedReleases } from "./releaseState";

describe("findUnfinishedReleases", () => {
  it("has nothing to say when every release tag is on GitHub and released", () => {
    expect(
      findUnfinishedReleases({
        localTags: ["v0.1.0", "v0.2.0"],
        remoteTags: ["v0.1.0", "v0.2.0"],
        latestOnGitHub: { tag: "v0.2.0", state: "published" },
      }),
    ).toEqual([]);
    expect(findUnfinishedReleases({ localTags: [], remoteTags: [], latestOnGitHub: null })).toEqual(
      [],
    );
  });

  it("stops at a tag left on this Mac by a release that stopped before pushing it", () => {
    expect(
      findUnfinishedReleases({
        localTags: ["v0.1.0", "v0.2.0"],
        remoteTags: ["v0.1.0"],
        latestOnGitHub: { tag: "v0.1.0", state: "published" },
      }),
    ).toEqual([expect.stringMatching(/^v0\.2\.0 is only on this Mac.*git tag -d v0\.2\.0/u)]);
  });

  it("stops at a release still a draft, or a tag on GitHub with no release", () => {
    expect(
      findUnfinishedReleases({
        localTags: ["v0.2.0"],
        remoteTags: ["v0.2.0"],
        latestOnGitHub: { tag: "v0.2.0", state: "draft" },
      }),
    ).toEqual([expect.stringMatching(/^v0\.2\.0's release is still a draft/u)]);
    expect(
      findUnfinishedReleases({
        localTags: ["v0.2.0"],
        remoteTags: ["v0.2.0"],
        latestOnGitHub: { tag: "v0.2.0", state: "missing" },
      }),
    ).toEqual([expect.stringMatching(/^v0\.2\.0 is on GitHub without a release/u)]);
  });
});
