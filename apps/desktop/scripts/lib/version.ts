import { execFileSync } from "node:child_process";

// File Trail's version comes from git, not from package.json: a release is a commit tagged
// `vX.Y.Z`, and that tag is its version. Any other build is named after the last release
// before it, with how many commits it is past it ("0.1.0+dev.4"). Tags with a suffix
// ("v0.3.0-beta") are not releases.

export type Version = { major: number; minor: number; patch: number };
export type Bump = "major" | "minor" | "patch";

const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/u;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

export function parseReleaseTag(tag: string): Version | null {
  return toVersion(RELEASE_TAG.exec(tag.trim()));
}

export function parseVersion(text: string): Version | null {
  return toVersion(VERSION.exec(text.trim()));
}

function toVersion(match: RegExpExecArray | null): Version | null {
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatVersion(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

// The highest release among the tags; null when there is none.
export function latestRelease(tags: readonly string[]): Version | null {
  let latest: Version | null = null;
  for (const tag of tags) {
    const version = parseReleaseTag(tag);
    if (version && (!latest || compareVersions(version, latest) > 0)) {
      latest = version;
    }
  }
  return latest;
}

// The version a release asked for as "major", "minor", "patch" or "X.Y.Z" gets. An exact
// version must come after the last release.
export function nextVersion(latest: Version | null, request: string): Version {
  const base = latest ?? { major: 0, minor: 0, patch: 0 };
  switch (request) {
    case "major":
      return { major: base.major + 1, minor: 0, patch: 0 };
    case "minor":
      return { major: base.major, minor: base.minor + 1, patch: 0 };
    case "patch":
      return { major: base.major, minor: base.minor, patch: base.patch + 1 };
  }
  const exact = parseVersion(request);
  if (!exact) {
    throw new Error(`"${request}" is not major, minor, patch or a version like 0.2.0.`);
  }
  if (latest && compareVersions(exact, latest) <= 0) {
    throw new Error(
      `${formatVersion(exact)} is not after the last release, ${formatVersion(latest)}.`,
    );
  }
  return exact;
}

// The version of a build: the release tagged on its commit, or the last release before it
// and how far past it the commit is.
export function buildVersion(args: {
  tagsAtCommit: readonly string[];
  lastRelease: Version | null;
  commitsSinceLastRelease: number;
}): string {
  const tagged = latestRelease(args.tagsAtCommit);
  if (tagged) {
    return formatVersion(tagged);
  }
  const base = formatVersion(args.lastRelease ?? { major: 0, minor: 0, patch: 0 });
  return `${base}+dev.${args.commitsSinceLastRelease}`;
}

// What macOS shows as the app's version (CFBundleShortVersionString): numbers only.
export function bundleVersion(version: string): string {
  return version.split(/[+-]/u)[0] ?? version;
}

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.length > 0);
}

// The release tags in the repository, all of them.
export function readReleaseTags(repoDir: string): string[] {
  return lines(git(repoDir, ["tag", "--list", "v*"])).filter((tag) => RELEASE_TAG.test(tag));
}

// The version of a build of the commit checked out in `repoDir`; null outside a repository.
export function versionFromGit(repoDir: string): string | null {
  try {
    const tagsAtCommit = lines(git(repoDir, ["tag", "--points-at", "HEAD"]));
    const lastRelease = latestRelease(
      lines(git(repoDir, ["tag", "--merged", "HEAD", "--list", "v*"])),
    );
    const commitsSinceLastRelease = lastRelease
      ? Number(git(repoDir, ["rev-list", "--count", `v${formatVersion(lastRelease)}..HEAD`]))
      : Number(git(repoDir, ["rev-list", "--count", "HEAD"]));
    return buildVersion({ tagsAtCommit, lastRelease, commitsSinceLastRelease });
  } catch {
    return null;
  }
}
