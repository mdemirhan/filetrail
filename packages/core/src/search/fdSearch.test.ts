import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { FdSearchRuntime, buildFdSearchArgs } from "./fdSearch";

function createMockProcess() {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  return {
    stdout,
    stderr,
    once: emitter.once.bind(emitter),
    emit: emitter.emit.bind(emitter),
    kill: vi.fn(),
  };
}

describe("fdSearch", () => {
  it("builds fd args for glob path searches with depth and hidden flags", () => {
    expect(
      buildFdSearchArgs({
        rootPath: "/Users/demo/project",
        query: "src/*.ts",
        patternMode: "glob",
        matchScope: "path",
        recursive: false,
        includeHidden: true,
      }),
    ).toEqual([
      "--type",
      "f",
      "--print0",
      "--absolute-path",
      "--color",
      "never",
      "--no-ignore",
      "--glob",
      "--full-path",
      "--max-depth",
      "1",
      "--hidden",
      "src/*.ts",
      "/Users/demo/project",
    ]);
  });

  it("streams null-delimited results in incremental batches", () => {
    const process = createMockProcess();
    const runtime = new FdSearchRuntime("/tmp/fd", {
      spawn: vi.fn(() => process as never),
    });

    const started = runtime.startSearch({
      rootPath: "/Users/demo/project",
      query: "*.tsx",
      patternMode: "glob",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
    });

    process.stdout.write(
      Buffer.from(
        "/Users/demo/project/src/App.tsx\0/Users/demo/project/src/lib/utils.tsx\0",
        "utf8",
      ),
    );

    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "running",
      items: [
        {
          path: "/Users/demo/project/src/App.tsx",
          name: "App.tsx",
          extension: "tsx",
          kind: "file",
          isHidden: false,
          isSymlink: false,
          parentPath: "/Users/demo/project/src",
          relativeParentPath: "src",
        },
        {
          path: "/Users/demo/project/src/lib/utils.tsx",
          name: "utils.tsx",
          extension: "tsx",
          kind: "file",
          isHidden: false,
          isSymlink: false,
          parentPath: "/Users/demo/project/src/lib",
          relativeParentPath: "src/lib",
        },
      ],
      nextCursor: 2,
      done: false,
      truncated: false,
      error: null,
    });

    process.emit("close", 0, null);

    expect(runtime.getUpdate(started.jobId, 2)).toEqual({
      jobId: started.jobId,
      status: "complete",
      items: [],
      nextCursor: 2,
      done: true,
      truncated: false,
      error: null,
    });
  });

  it("marks cancelled jobs and terminates the running process", () => {
    const process = createMockProcess();
    const runtime = new FdSearchRuntime("/tmp/fd", {
      spawn: vi.fn(() => process as never),
    });

    const started = runtime.startSearch({
      rootPath: "/Users/demo/project",
      query: "*.ts",
      patternMode: "glob",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
    });

    expect(runtime.cancelSearch(started.jobId)).toEqual({ ok: true });
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "cancelled",
      items: [],
      nextCursor: 0,
      done: true,
      truncated: false,
      error: null,
    });
  });

  it("surfaces stderr content for failed searches", () => {
    const process = createMockProcess();
    const runtime = new FdSearchRuntime("/tmp/fd", {
      spawn: vi.fn(() => process as never),
    });

    const started = runtime.startSearch({
      rootPath: "/Users/demo/project",
      query: "(",
      patternMode: "regex",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
    });

    process.stderr.write("regex parse error");
    process.emit("close", 1, null);

    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "error",
      items: [],
      nextCursor: 0,
      done: true,
      truncated: false,
      error: "regex parse error",
    });
  });
});
