import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// The open-source software shipped inside the app. Each license asks that its text travel
// with the copies, so the build writes every text into `dist/assets/licenses`, beside an
// index the Acknowledgements window lists them from. A component whose license can not be
// found fails the build: the app is not packaged without it.
type Component = {
  id: string;
  name: string;
  license: string;
  url: string;
  // The npm package the version and the license are read from; resolved from `from`.
  package?: { name: string; from: "app" | "contracts" | "native-fs"; showVersion: boolean };
  // License files that are not in a package's own folder.
  files?: string[];
  version?: string;
  // The notices ship as a file of their own instead of a text beside the index.
  separateNotices?: true;
};

export type LicenseIndexEntry = {
  id: string;
  name: string;
  version: string | null;
  license: string;
  url: string;
  // The text's file beside the index; null when the notices ship as a file of their own.
  file: string | null;
};

const LICENSE_FILE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "license"];

export function writeThirdPartyLicenses({
  appDir,
  repoDir,
  outDir,
}: {
  appDir: string;
  repoDir: string;
  outDir: string;
}): void {
  const fromDirs = {
    app: appDir,
    contracts: join(repoDir, "packages", "contracts"),
    "native-fs": join(repoDir, "packages", "native-fs"),
  };
  const fdDir = join(appDir, "assets", "vendor", "fd");
  const fdManifest = JSON.parse(readFileSync(join(fdDir, "manifest.json"), "utf8")) as {
    version: string;
  };
  const electronDir = findPackageDir("electron", appDir);

  const components: Component[] = [
    {
      id: "fd",
      name: "fd",
      license: "MIT or Apache 2.0",
      url: "https://github.com/sharkdp/fd",
      version: fdManifest.version,
      files: [join(fdDir, "licenses", "LICENSE-MIT"), join(fdDir, "licenses", "LICENSE-APACHE")],
    },
    {
      id: "electron",
      name: "Electron",
      license: "MIT",
      url: "https://www.electronjs.org",
      version: readPackageVersion(electronDir),
      files: [join(electronDir, "dist", "LICENSE")],
    },
    // Chromium's notices are a 20 MB page that Electron ships. The packaging script puts
    // that page into the app as it is, and the version shown is the running one.
    {
      id: "chromium",
      name: "Chromium",
      license: "BSD 3-Clause and others",
      url: "https://www.chromium.org",
      separateNotices: true,
    },
    {
      id: "react",
      name: "React",
      license: "MIT",
      url: "https://react.dev",
      package: { name: "react", from: "app", showVersion: true },
    },
    {
      id: "zod",
      name: "Zod",
      license: "MIT",
      url: "https://zod.dev",
      package: { name: "zod", from: "contracts", showVersion: true },
    },
    {
      id: "node-gyp-build",
      name: "node-gyp-build",
      license: "MIT",
      url: "https://github.com/prebuild/node-gyp-build",
      package: { name: "node-gyp-build", from: "native-fs", showVersion: true },
    },
  ];

  const licensesDir = join(outDir, "assets", "licenses");
  mkdirSync(licensesDir, { recursive: true });
  const index: LicenseIndexEntry[] = components.map((component) => {
    const { id, name, license, url } = component;
    if (component.separateNotices) {
      return { id, name, version: null, license, url, file: null };
    }
    const packageDir = component.package
      ? findPackageDir(component.package.name, fromDirs[component.package.from])
      : null;
    const files = component.files ?? (packageDir ? [findLicenseFile(packageDir)] : []);
    if (files.length === 0) {
      throw new Error(`No license file listed for ${component.name}.`);
    }
    const text = files
      .map((file) => readFileSync(file, "utf8").trim())
      .join(`\n\n${"-".repeat(72)}\n\n`);
    const file = `${id}.txt`;
    writeFileSync(join(licensesDir, file), `${text}\n`);
    const version =
      component.version ??
      (packageDir && component.package?.showVersion ? readPackageVersion(packageDir) : null);
    return { id, name, version, license, url, file };
  });
  writeFileSync(join(licensesDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

// Node's own lookup: the nearest `node_modules/<name>` at or above `fromDir`.
function findPackageDir(name: string, fromDir: string): string {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Package ${name} was not found from ${fromDir}. Run 'bun install' first.`);
    }
    dir = parent;
  }
}

function findLicenseFile(packageDir: string): string {
  for (const name of LICENSE_FILE_NAMES) {
    const candidate = join(packageDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No license file in ${packageDir}.`);
}

function readPackageVersion(packageDir: string): string {
  return (JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as { version: string })
    .version;
}
