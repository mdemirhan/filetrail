import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  formatMacosVersion,
  readAcknowledgements,
  readBuildCommit,
  resolveChromiumNoticesPath,
  resolveDistDir,
  resolveNoticesPath,
} from "./aboutInfo";

describe("aboutInfo", () => {
  let root: string;
  let distDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "filetrail-about-"));
    distDir = join(root, "dist");
    mkdirSync(join(distDir, "main"), { recursive: true });
    mkdirSync(join(distDir, "assets", "licenses"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds the build's folder from the main bundle inside it", () => {
    const moduleUrl = pathToFileURL(join(distDir, "main", "main.js")).toString();
    const elsewhere = { moduleUrl, resourcesPath: join(root, "none"), cwd: join(root, "none") };

    expect(resolveDistDir(elsewhere)).toBeNull();

    writeFileSync(join(distDir, "build-info.json"), '{"commit":"df11088"}\n');
    expect(resolveDistDir(elsewhere)).toBe(distDir);
  });

  it("reads the commit the build recorded, and does without one", () => {
    expect(readBuildCommit(null)).toBeNull();
    expect(readBuildCommit(distDir)).toBeNull();

    writeFileSync(join(distDir, "build-info.json"), '{"commit":null}\n');
    expect(readBuildCommit(distDir)).toBeNull();

    writeFileSync(join(distDir, "build-info.json"), '{"commit":"df11088"}\n');
    expect(readBuildCommit(distDir)).toBe("df11088");
  });

  it("names a macOS version the way macOS does", () => {
    expect(formatMacosVersion("27.0.0")).toBe("27.0");
    expect(formatMacosVersion("27.0.1")).toBe("27.0.1");
    expect(formatMacosVersion("27.1.0")).toBe("27.1");
    expect(formatMacosVersion("27.0")).toBe("27.0");
  });

  it("lists the bundled software with each license as shipped", () => {
    const licensesDir = join(distDir, "assets", "licenses");
    writeFileSync(join(licensesDir, "fd.txt"), "MIT License\n");
    writeFileSync(
      join(licensesDir, "index.json"),
      JSON.stringify([
        {
          id: "fd",
          name: "fd",
          version: "10.5.0",
          license: "MIT or Apache 2.0",
          url: "https://github.com/sharkdp/fd",
          file: "fd.txt",
        },
        {
          id: "chromium",
          name: "Chromium",
          version: null,
          license: "BSD 3-Clause and others",
          url: "https://www.chromium.org",
          file: null,
        },
      ]),
    );

    expect(readAcknowledgements(null, { chromium: "150.0.0.0" })).toEqual([]);
    expect(readAcknowledgements(distDir, { chromium: "150.0.0.0" })).toEqual([
      {
        id: "fd",
        name: "fd",
        version: "10.5.0",
        license: "MIT or Apache 2.0",
        url: "https://github.com/sharkdp/fd",
        text: "MIT License\n",
      },
      // Chromium's notices are a file of their own, and its version is the running one.
      {
        id: "chromium",
        name: "Chromium",
        version: "150.0.0.0",
        license: "BSD 3-Clause and others",
        url: "https://www.chromium.org",
        text: null,
      },
    ]);
  });

  it("finds Chromium's notices inside the packaged app or beside Electron's own app", () => {
    const packagedResources = join(root, "File Trail.app", "Contents", "Resources");
    const electronDist = join(root, "electron", "dist");
    const developmentResources = join(electronDist, "Electron.app", "Contents", "Resources");
    mkdirSync(packagedResources, { recursive: true });
    mkdirSync(developmentResources, { recursive: true });

    expect(resolveChromiumNoticesPath(packagedResources)).toBeNull();

    writeFileSync(join(packagedResources, "LICENSES.chromium.html"), "");
    writeFileSync(join(electronDist, "LICENSES.chromium.html"), "");
    expect(resolveChromiumNoticesPath(packagedResources)).toBe(
      join(packagedResources, "LICENSES.chromium.html"),
    );
    expect(resolveChromiumNoticesPath(developmentResources)).toBe(
      join(electronDist, "LICENSES.chromium.html"),
    );
  });

  it("opens notices for Chromium only, whatever name is asked for", () => {
    const resources = join(root, "Resources");
    mkdirSync(resources, { recursive: true });
    writeFileSync(join(resources, "LICENSES.chromium.html"), "");

    expect(resolveNoticesPath("chromium", resources)).toBe(
      join(resources, "LICENSES.chromium.html"),
    );
    expect(resolveNoticesPath("../../etc/passwd", resources)).toBeNull();
  });
});
