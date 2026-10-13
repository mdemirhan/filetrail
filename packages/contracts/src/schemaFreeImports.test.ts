import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The IPC contract's schemas (ipc.ts) are built with zod when the module loads: about
// 120 KB of code, 15 ms and 4 MB in each process that loads them. Only the main process
// checks requests against them; the windows and the worker take the helpers they need from
// the package's other modules ("@filetrail/contracts/trash"), and only types from the
// package itself, which leave nothing behind in the build.

const repoDir = fileURLToPath(new URL("../../../", import.meta.url));
const contractsDir = fileURLToPath(new URL("./", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "test" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// `import { a, type B } from "<module>"` and `export { a } from "<module>"`, but not
// `import type { … }`: the names brought in as values.
function valueNamesFrom(source: string, module: string): string[] {
  const pattern = new RegExp(
    `(?:import|export)\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+"${module.replace("/", "\\/")}"`,
    "g",
  );
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1]
      ? []
      : (match[2] ?? "")
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0 && !name.startsWith("type ")),
  );
}

describe("the IPC contract's schemas stay out of the windows and the worker", () => {
  it("is imported only for its types by the renderer, preload, shared code and the core", () => {
    const dirs = [
      "apps/desktop/src/renderer",
      "apps/desktop/src/preload",
      "apps/desktop/src/shared",
      "packages/core/src",
    ];
    const valueImports = dirs
      .flatMap((dir) => sourceFiles(join(repoDir, dir)))
      .flatMap((file) =>
        valueNamesFrom(readFileSync(file, "utf8"), "@filetrail/contracts").map(
          (name) => `${relative(repoDir, file)}: ${name}`,
        ),
      );

    expect(valueImports).toEqual([]);
  });

  it("keeps the package's other modules free of zod and of the schemas", () => {
    const schemaImports = sourceFiles(contractsDir)
      .filter((file) => !/\/(ipc|index)\.ts$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(file, "utf8");
        return [
          ...source.matchAll(/^import\s+(?!type\s)[^;]*from\s+"(zod|\.\/ipc|\.\/index)"/gm),
        ].map((match) => `${relative(repoDir, file)}: ${match[1]}`);
      });

    expect(schemaImports).toEqual([]);
  });
});
