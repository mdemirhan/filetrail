import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const contractsIndexPath = fileURLToPath(
  new URL("./packages/contracts/src/index.ts", import.meta.url),
);
const contractsDirPath = fileURLToPath(new URL("./packages/contracts/src/", import.meta.url));
const coreIndexPath = fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url));
const coreDirPath = fileURLToPath(new URL("./packages/core/src/", import.meta.url));

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
    ],
    environment: "node",
    globals: true,
    setupFiles: ["./apps/desktop/src/renderer/test/setup.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@filetrail\/contracts\/(.*)$/,
        replacement: `${contractsDirPath}$1`,
      },
      {
        find: "@filetrail/contracts",
        replacement: contractsIndexPath,
      },
      {
        find: /^@filetrail\/core\/(.*)$/,
        replacement: `${coreDirPath}$1`,
      },
      {
        find: "@filetrail/core",
        replacement: coreIndexPath,
      },
    ],
  },
});
