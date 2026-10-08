// Makes a release: `bun run release <major|minor|patch|X.Y.Z> [--yes] [--dry-run]`.
//
// From a clean main that is already on GitHub, it checks the commit as CI does (lint,
// typecheck, every test including the slow ones, the smoke tests), tags it vX.Y.Z (the
// version comes from the tag, see lib/version.ts), builds the signed and notarized app,
// pushes the tag, and makes a draft GitHub release with the disk image and the ZIP. The
// notes start as a list of the commits since the last release: rewrite them, then publish
// the release on GitHub. Nothing is published by this script.
//
// --dry-run stops after saying what it would release. --yes skips the question before the
// release starts.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { draftReleaseNotes } from "./lib/releaseNotes";
import { type GitHubReleaseState, findUnfinishedReleases } from "./lib/releaseState";
import {
  formatVersion,
  latestRelease,
  nextVersion,
  parseReleaseTag,
  readReleaseTags,
} from "./lib/version";

declare const prompt: (message: string) => string | null;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptDir, "..");
const repoDir = join(appDir, "..", "..");
// What `desktop:make:mac:notarized` leaves (see make-macos-app.sh).
const outDir = join(appDir, "out", "FileTrail-darwin-arm64");
const appBundle = join(outDir, "File Trail.app");
const shareFiles = [join(outDir, "FileTrail-arm64.dmg"), join(outDir, "FileTrail-arm64.zip")];

class ReleaseError extends Error {}

function capture(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

// Runs a step with its output on screen; stops the release when it fails.
function run(title: string, command: string, args: string[]): void {
  console.log(`\n==> ${title}`);
  const result = spawnSync(command, args, { cwd: repoDir, stdio: "inherit" });
  if (result.status !== 0) {
    throw new ReleaseError(`${title} failed.`);
  }
}

// Stops the release when the checkout changed while it ran (a commit, or an edit made in
// the meantime), so the tag, the build and what was checked are the same code.
function assertUnchangedSince(commit: string, step: string): void {
  if (capture("git", ["rev-parse", "HEAD"]) !== commit) {
    throw new ReleaseError(`HEAD moved during ${step}: run the release again.`);
  }
  if (capture("git", ["status", "--porcelain"]).length > 0) {
    throw new ReleaseError(
      `Files changed during ${step}: commit or set them aside, then run again.`,
    );
  }
}

function usage(): string {
  return "Usage: bun run release <major|minor|patch|X.Y.Z> [--yes] [--dry-run]";
}

// What stands in the way of releasing this commit; nothing when it can be released.
function findStartingProblems(): string[] {
  const problems: string[] = [];
  if (capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
    problems.push("Releases are made from main: switch to it first.");
  }
  if (capture("git", ["status", "--porcelain"]).length > 0) {
    problems.push("There are uncommitted changes: commit or set them aside first.");
  }
  run("Fetching main and the tags from GitHub", "git", ["fetch", "--quiet", "--tags", "origin"]);
  if (capture("git", ["rev-parse", "HEAD"]) !== capture("git", ["rev-parse", "origin/main"])) {
    problems.push(
      "This commit isn't main on GitHub: push main (git push origin main) or pull first, so the release is a commit GitHub has.",
    );
  }
  return problems;
}

// The release tags on GitHub, whether or not they were fetched here.
function readRemoteReleaseTags(): string[] {
  return capture("git", ["ls-remote", "--tags", "--refs", "origin"])
    .split("\n")
    .map((line) => line.split("\t")[1]?.replace(/^refs\/tags\//u, "") ?? "")
    .filter((tag) => parseReleaseTag(tag) !== null);
}

function readGitHubReleaseState(tag: string): GitHubReleaseState {
  const result = spawnSync(
    "gh",
    ["release", "view", tag, "--json", "isDraft", "--jq", ".isDraft"],
    {
      cwd: repoDir,
      encoding: "utf8",
    },
  );
  if (result.status === 0) {
    return result.stdout.trim() === "true" ? "draft" : "published";
  }
  if (/release not found/iu.test(result.stderr)) {
    return "missing";
  }
  throw new ReleaseError(`gh couldn't tell whether ${tag} is released: ${result.stderr.trim()}`);
}

// A release that didn't finish would be skipped over by the next version: each one is
// finished, or undone, before another is made.
function findUnfinishedReleaseProblems(localTags: readonly string[]): string[] {
  const remoteTags = readRemoteReleaseTags();
  const latest = latestRelease(remoteTags);
  const latestTag = latest ? `v${formatVersion(latest)}` : null;
  return findUnfinishedReleases({
    localTags,
    remoteTags,
    latestOnGitHub: latestTag ? { tag: latestTag, state: readGitHubReleaseState(latestTag) } : null,
  });
}

function main(): void {
  const args = process.argv.slice(2);
  const request = args.find((arg) => !arg.startsWith("--"));
  const yes = args.includes("--yes");
  const dryRun = args.includes("--dry-run");
  if (
    !request ||
    args.some((arg) => arg.startsWith("--") && arg !== "--yes" && arg !== "--dry-run")
  ) {
    throw new ReleaseError(usage());
  }

  const problems = findStartingProblems();
  // What is checked, tagged and built: the commit found clean and on GitHub here.
  const checkedCommit = capture("git", ["rev-parse", "HEAD"]);
  const tags = readReleaseTags(repoDir);
  problems.push(...findUnfinishedReleaseProblems(tags));
  const latest = latestRelease(tags);
  let version: string;
  try {
    version = formatVersion(nextVersion(latest, request));
  } catch (error) {
    throw new ReleaseError(`${error instanceof Error ? error.message : String(error)}\n${usage()}`);
  }
  const tag = `v${version}`;
  if (capture("git", ["tag", "--list", tag]).length > 0) {
    problems.push(`${tag} already exists.`);
  }
  const releasedHere = capture("git", ["tag", "--points-at", "HEAD"])
    .split("\n")
    .filter((existing) => tags.includes(existing));
  if (releasedHere.length > 0) {
    problems.push(`This commit is already released as ${releasedHere.join(", ")}.`);
  }
  if (problems.length > 0 && !dryRun) {
    throw new ReleaseError(problems.join("\n"));
  }
  const subjects = capture("git", [
    "log",
    "--no-merges",
    "--format=%s",
    ...(latest ? [`v${formatVersion(latest)}..HEAD`] : ["HEAD"]),
  ]).split("\n");
  const commit = capture("git", ["log", "-1", "--format=%h %s"]);

  console.log(
    `File Trail ${version}${latest ? ` (after ${formatVersion(latest)})` : ""}, from ${commit}, ${subjects.filter(Boolean).length} commits.`,
  );
  if (dryRun) {
    for (const problem of problems) {
      console.log(`Would stop: ${problem}`);
    }
    console.log("\nDry run: the tags were fetched; nothing was checked, tagged, built or pushed.");
    return;
  }
  if (!yes && prompt(`Check, tag, build and draft ${tag}? [y/N]`)?.trim().toLowerCase() !== "y") {
    console.log("Nothing was done.");
    return;
  }

  run("Building the native addon", "bun", ["run", "--cwd", "apps/desktop", "build:native"]);
  run("Lint, typecheck and every test (as CI)", "bun", ["run", "ci"]);
  run("Building the app", "bun", ["run", "desktop:build"]);
  run("Smoke tests", "bun", ["run", "test:smoke"]);

  // The checks and the build take minutes: what is tagged must still be what was checked.
  assertUnchangedSince(checkedCommit, "the checks");
  run(`Tagging ${tag}`, "git", ["tag", "-a", tag, "-m", `File Trail ${version}`]);
  let pushed = false;
  const notesDir = mkdtempSync(join(tmpdir(), "filetrail-release-"));
  try {
    run("Building, signing and notarizing the app", "bun", ["run", "desktop:make:mac:notarized"]);
    const built = capture("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleShortVersionString",
      join(appBundle, "Contents", "Info.plist"),
    ]);
    const recorded = JSON.parse(readFileSync(join(appDir, "dist", "build-info.json"), "utf8"))
      .version as unknown;
    if (built !== version || recorded !== version) {
      throw new ReleaseError(
        `The app was built as ${String(recorded)} (bundle ${built}), not ${version}.`,
      );
    }

    // The app was built from the working tree: it must still be the tagged commit.
    assertUnchangedSince(checkedCommit, "the build");
    run(`Pushing ${tag} to GitHub`, "git", ["push", "origin", tag]);
    pushed = true;

    const notesFile = join(notesDir, "notes.md");
    writeFileSync(notesFile, draftReleaseNotes(subjects));
    run("Making a draft release on GitHub", "gh", [
      "release",
      "create",
      tag,
      "--draft",
      "--verify-tag",
      "--title",
      tag,
      "--notes-file",
      notesFile,
      ...shareFiles,
    ]);
  } catch (error) {
    if (!pushed) {
      // Not on GitHub yet: the tag goes, so the release can simply be tried again.
      spawnSync("git", ["tag", "-d", tag], { cwd: repoDir, stdio: "ignore" });
      console.error(`\n${tag} was removed again; nothing reached GitHub.`);
    } else {
      console.error(
        `\n${tag} is on GitHub. Finish the release there, or delete the tag (git push origin :${tag}; git tag -d ${tag}) to start over.`,
      );
    }
    throw error;
  } finally {
    rmSync(notesDir, { recursive: true, force: true });
  }

  const url = capture("gh", ["release", "view", tag, "--json", "url", "--jq", ".url"]);
  console.log(`\nDraft release ${tag} is ready: ${url}`);
  console.log("Rewrite the notes for people, then press Publish release.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof ReleaseError ? error.message : error);
  process.exit(1);
}
