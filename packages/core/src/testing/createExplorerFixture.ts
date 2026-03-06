import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

type FixtureNode =
  | {
      type: "directory";
      children?: Record<string, FixtureNode>;
    }
  | {
      type: "file";
      text: string;
    }
  | {
      type: "symlink";
      target: string;
    };

export async function createExplorerFixture(
  tree: Record<string, FixtureNode>,
): Promise<{ rootPath: string }> {
  const rootPath = await mkdtemp(join(tmpdir(), "filetrail-fixture-"));
  await createChildren(rootPath, tree);
  return { rootPath };
}

async function createChildren(basePath: string, tree: Record<string, FixtureNode>): Promise<void> {
  for (const [name, node] of Object.entries(tree)) {
    const nextPath = join(basePath, name);
    if (node.type === "directory") {
      await mkdir(nextPath, { recursive: true });
      await createChildren(nextPath, node.children ?? {});
      continue;
    }
    if (node.type === "file") {
      await mkdir(dirname(nextPath), { recursive: true });
      await writeFile(nextPath, node.text, "utf8");
      continue;
    }
    await mkdir(dirname(nextPath), { recursive: true });
    await symlink(node.target, nextPath);
  }
}
