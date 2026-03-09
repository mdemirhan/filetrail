import { lstat, readFile, readlink, readdir } from "node:fs/promises";
import { join } from "node:path";

import { createExplorerFixture } from "./createExplorerFixture";

describe("createExplorerFixture", () => {
  it("creates nested directories, files, and symlinks", async () => {
    const { rootPath } = await createExplorerFixture({
      src: {
        type: "directory",
        children: {
          "index.ts": {
            type: "file",
            text: "export const value = 1;\n",
          },
        },
      },
      "README.md": {
        type: "file",
        text: "# File Trail\n",
      },
      "src-link": {
        type: "symlink",
        target: "src",
      },
    });

    await expect(readdir(rootPath)).resolves.toEqual(expect.arrayContaining(["README.md", "src"]));
    await expect(readFile(join(rootPath, "README.md"), "utf8")).resolves.toBe("# File Trail\n");
    await expect(readFile(join(rootPath, "src", "index.ts"), "utf8")).resolves.toContain(
      "value = 1",
    );

    const linkStats = await lstat(join(rootPath, "src-link"));
    expect(linkStats.isSymbolicLink()).toBe(true);
    await expect(readlink(join(rootPath, "src-link"))).resolves.toBe("src");
  });
});
