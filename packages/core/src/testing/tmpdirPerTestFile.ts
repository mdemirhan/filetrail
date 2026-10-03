// Every temporary folder a test makes (mkdtemp in os.tmpdir()) goes into one folder for its
// test file, removed when the file has run: tests that don't clean up after themselves
// can't leave anything behind. os.tmpdir() reads TMPDIR on each call, so pointing TMPDIR
// here catches them all, the ones written later included.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The system's own, kept across the test files a worker runs one after another.
export const SYSTEM_TMPDIR = process.env.FILETRAIL_SYSTEM_TMPDIR ?? tmpdir();
process.env.FILETRAIL_SYSTEM_TMPDIR = SYSTEM_TMPDIR;

const root = mkdtempSync(join(SYSTEM_TMPDIR, "filetrail-test-"));
process.env.TMPDIR = root;

afterAll(() => {
  // A test that failed half way may leave locked or read-only items, which would stop the
  // folder from being removed.
  for (const [command, args] of [
    ["/usr/bin/chflags", ["-R", "nouchg", root]],
    ["/bin/chmod", ["-R", "u+rwx", root]],
  ] as const) {
    try {
      execFileSync(command, [...args], { stdio: "ignore" });
    } catch {
      // Nothing there to change.
    }
  }
  rmSync(root, { recursive: true, force: true });
  process.env.TMPDIR = SYSTEM_TMPDIR;
});
