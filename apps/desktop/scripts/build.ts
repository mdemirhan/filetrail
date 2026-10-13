import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { versionFromGit } from "./lib/version";
import { writeThirdPartyLicenses } from "./thirdPartyLicenses";

declare const Bun: {
  build: (options: Record<string, unknown>) => Promise<{
    success: boolean;
    logs: Array<{ message: string }>;
  }>;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptDir, "..");
const repoDir = join(appDir, "..", "..");
const desktopSrcDir = join(appDir, "src");
const outDir = join(appDir, "dist");

// The main process and the worker keep their names, so the stack traces they write to
// app.log stay readable; the renderer is minified fully. React ships its production build:
// without NODE_ENV it picks the development one, which is about four times the size and
// runs every effect twice under StrictMode.
// --development builds as before instead: React's development build, with its warnings and
// StrictMode checks, and nothing minified.
const development = process.argv.includes("--development");
const KEEP_NAMES_MINIFY = development
  ? false
  : { whitespace: true, syntax: true, identifiers: false };
const FULL_MINIFY = !development;
const PRODUCTION_DEFINE: Record<string, string> = development
  ? {}
  : { "process.env.NODE_ENV": '"production"' };

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await buildMainAndPreload();
await buildRenderer();
copyRendererHtml();
copyRendererAssets();
copyAppAssets();
writeThirdPartyLicenses({ appDir, repoDir, outDir });
writeBuildInfo();

console.log(`Desktop ${development ? "development " : ""}build completed at ${outDir}`);

async function buildMainAndPreload(): Promise<void> {
  const mainBuild = await Bun.build({
    entrypoints: [
      join(desktopSrcDir, "main", "main.ts"),
      join(repoDir, "packages", "core", "src", "worker", "explorerWorker.ts"),
    ],
    outdir: join(outDir, "main"),
    target: "node",
    format: "esm",
    sourcemap: "linked",
    minify: KEEP_NAMES_MINIFY,
    define: PRODUCTION_DEFINE,
    external: ["electron"],
    naming: {
      entry: "[name].js",
      chunk: "chunks/[name]-[hash].js",
      asset: "assets/[name]-[hash].[ext]",
    },
  });
  ensureBuildSuccess("main", mainBuild);

  const preloadBuild = await Bun.build({
    entrypoints: [join(desktopSrcDir, "preload", "index.ts")],
    outdir: join(outDir, "preload"),
    target: "node",
    format: "cjs",
    sourcemap: "linked",
    minify: KEEP_NAMES_MINIFY,
    define: PRODUCTION_DEFINE,
    external: ["electron"],
    naming: {
      entry: "[name].cjs",
      chunk: "chunks/[name]-[hash].js",
      asset: "assets/[name]-[hash].[ext]",
    },
  });
  ensureBuildSuccess("preload", preloadBuild);
}

async function buildRenderer(): Promise<void> {
  const rendererBuild = await Bun.build({
    entrypoints: [join(desktopSrcDir, "renderer", "main.tsx")],
    outdir: join(outDir, "renderer"),
    target: "browser",
    format: "esm",
    sourcemap: "linked",
    minify: FULL_MINIFY,
    define: PRODUCTION_DEFINE,
    splitting: false,
  });
  ensureBuildSuccess("renderer", rendererBuild);
}

function copyRendererHtml(): void {
  const rendererOutDir = join(outDir, "renderer");
  mkdirSync(rendererOutDir, { recursive: true });
  const sourceHtmlPath = join(desktopSrcDir, "renderer", "index.html");
  let html = readFileSync(sourceHtmlPath, "utf8");
  if (existsSync(join(rendererOutDir, "main.css"))) {
    html = html.replace("</head>", '    <link rel="stylesheet" href="./main.css" />\n  </head>');
  }
  writeFileSync(join(rendererOutDir, "index.html"), html);
}

function copyRendererAssets(): void {
  const sourceAssetsDir = join(desktopSrcDir, "renderer", "assets");
  if (!existsSync(sourceAssetsDir)) {
    return;
  }
  cpSync(sourceAssetsDir, join(outDir, "renderer", "assets"), { recursive: true });
}

function copyAppAssets(): void {
  const sourceAssetsDir = join(appDir, "assets");
  if (!existsSync(sourceAssetsDir)) {
    return;
  }
  cpSync(sourceAssetsDir, join(outDir, "assets"), { recursive: true });
}

// The About window shows the version (from the release tag, see lib/version.ts) and which
// commit the app was built from.
function writeBuildInfo(): void {
  let commit: string | null = null;
  try {
    commit =
      execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: repoDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
  } catch {
    // Built outside the repository, or without git: the version is shown on its own.
  }
  const version = versionFromGit(repoDir);
  writeFileSync(join(outDir, "build-info.json"), `${JSON.stringify({ version, commit })}\n`);
}

function ensureBuildSuccess(
  name: string,
  result: {
    success: boolean;
    logs: Array<{ message: string }>;
  },
): void {
  if (result.success) {
    return;
  }
  const diagnostics = result.logs.map((log) => log.message).join("\n");
  throw new Error(`Failed to build ${name}:\n${diagnostics}`);
}
