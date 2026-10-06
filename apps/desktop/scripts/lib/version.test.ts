import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildVersion,
  bundleVersion,
  latestRelease,
  nextVersion,
  parseReleaseTag,
  readReleaseTags,
  versionFromGit,
} from "./version";

describe("release tags", () => {
  it("are vX.Y.Z; a tag with a suffix isn't a release", () => {
    expect(parseReleaseTag("v0.2.0")).toEqual({ major: 0, minor: 2, patch: 0 });
    expect(parseReleaseTag("v0.3.0-beta")).toBeNull();
    expect(parseReleaseTag("0.2.0")).toBeNull();
  });

  it("are ordered by version, not by when they were made", () => {
    expect(latestRelease(["v0.1.0-beta", "v0.3.0-beta", "v0.1.0", "v0.1.10", "v0.1.9"])).toEqual({
      major: 0,
      minor: 1,
      patch: 10,
    });
    expect(latestRelease(["v0.3.0-beta"])).toBeNull();
  });
});

describe("nextVersion", () => {
  const latest = { major: 0, minor: 1, patch: 3 };

  it("bumps the last release", () => {
    expect(nextVersion(latest, "patch")).toEqual({ major: 0, minor: 1, patch: 4 });
    expect(nextVersion(latest, "minor")).toEqual({ major: 0, minor: 2, patch: 0 });
    expect(nextVersion(latest, "major")).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(nextVersion(null, "minor")).toEqual({ major: 0, minor: 1, patch: 0 });
  });

  it("takes an exact version only after the last release", () => {
    expect(nextVersion(latest, "0.2.0")).toEqual({ major: 0, minor: 2, patch: 0 });
    expect(() => nextVersion(latest, "0.1.3")).toThrow(/not after the last release, 0\.1\.3/u);
    expect(() => nextVersion(latest, "v0.2.0")).toThrow(/not major, minor, patch/u);
  });
});

describe("buildVersion", () => {
  it("is the release tagged on the commit", () => {
    expect(
      buildVersion({
        tagsAtCommit: ["v0.2.0"],
        lastRelease: { major: 0, minor: 2, patch: 0 },
        commitsSinceLastRelease: 0,
      }),
    ).toBe("0.2.0");
  });

  it("is otherwise the last release and how many commits past it", () => {
    expect(
      buildVersion({
        tagsAtCommit: ["v0.3.0-beta"],
        lastRelease: { major: 0, minor: 1, patch: 0 },
        commitsSinceLastRelease: 4,
      }),
    ).toBe("0.1.0+dev.4");
    expect(bundleVersion("0.1.0+dev.4")).toBe("0.1.0");
    expect(bundleVersion("0.2.0")).toBe("0.2.0");
  });
});

describe("reading the version from git", () => {
  let repo: string;

  function git(...args: string[]) {
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  }

  function commit(message: string) {
    writeFileSync(join(repo, "file.txt"), message);
    git("add", "file.txt");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", message);
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "filetrail-version-"));
    git("init", "-q");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("follows the tags as releases are made", () => {
    commit("first");
    expect(versionFromGit(repo)).toBe("0.0.0+dev.1");

    git("tag", "v0.1.0");
    expect(versionFromGit(repo)).toBe("0.1.0");

    commit("second");
    git("tag", "v0.3.0-beta");
    commit("third");
    expect(versionFromGit(repo)).toBe("0.1.0+dev.2");
    expect(readReleaseTags(repo)).toEqual(["v0.1.0"]);
  });

  it("is unknown outside a repository", () => {
    rmSync(join(repo, ".git"), { recursive: true, force: true });
    expect(versionFromGit(repo)).toBeNull();
  });
});
