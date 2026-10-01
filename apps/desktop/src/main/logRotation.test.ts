import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { removeRetiredActionLogFiles } from "./logRotation";

describe("removeRetiredActionLogFiles", () => {
  it("deletes the old action log files and nothing else", async () => {
    const logs = join(await mkdtemp(join(tmpdir(), "filetrail-logs-")), "logs");
    await mkdir(logs);
    for (const name of [
      "action-log.jsonl",
      "action-log.1.jsonl",
      "action-log.9.jsonl",
      "app.log",
      "app.1.log",
      "my-action-log.jsonl",
    ]) {
      await writeFile(join(logs, name), "x");
    }

    await removeRetiredActionLogFiles(logs);

    expect((await readdir(logs)).sort()).toEqual(["app.1.log", "app.log", "my-action-log.jsonl"]);
  });

  it("does nothing when there is no logs folder", async () => {
    await expect(
      removeRetiredActionLogFiles("/nonexistent/filetrail/logs"),
    ).resolves.toBeUndefined();
  });
});
