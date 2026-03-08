import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveBundledFdBinaryPath } from "./fdBinary";

describe("resolveBundledFdBinaryPath", () => {
  it("resolves the matching bundled fd binary from the dist assets directory", () => {
    const root = mkdtempSync(join(tmpdir(), "filetrail-fd-"));
    const moduleDir = join(root, "apps", "desktop", "src", "main");
    const distAssetsDir = join(root, "apps", "desktop", "dist", "assets", "vendor", "fd");
    mkdirSync(moduleDir, { recursive: true });
    mkdirSync(join(distAssetsDir, "darwin-arm64"), { recursive: true });
    writeFileSync(join(distAssetsDir, "darwin-arm64", "fd"), "", "utf8");

    expect(
      resolveBundledFdBinaryPath({
        arch: "arm64",
        cwd: join(root, "apps", "desktop"),
        moduleUrl: pathToFileURL(join(moduleDir, "fdBinary.ts")).toString(),
      }),
    ).toBe(join(distAssetsDir, "darwin-arm64", "fd"));
  });

  it.runIf(process.platform === "darwin" && process.arch === "arm64")(
    "executes the vendored fd binary",
    () => {
      const output = execFileSync(resolveBundledFdBinaryPath(), ["--version"], {
        encoding: "utf8",
      });

      expect(output).toContain("fd 10.3.0");
    },
  );
});
