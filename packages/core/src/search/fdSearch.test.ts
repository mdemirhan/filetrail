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
        skipGitFolders: false,
        skipGitIgnored: false,
      }),
    ).toEqual([
      "--type",
      "f",
      "--type",
      "d",
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
      "--",
      "src/*.ts",
      "/Users/demo/project",
    ]);
  });

  it("skips .git folders and Git-ignored files only when asked to", () => {
    const base = {
      rootPath: "/Users/demo/project",
      query: "cfg",
      patternMode: "regex" as const,
      matchScope: "name" as const,
      recursive: true,
      includeHidden: true,
    };
    const flags = (options: { skipGitFolders: boolean; skipGitIgnored: boolean }) =>
      buildFdSearchArgs({ ...base, ...options }).slice(8, -3);

    // Nothing skipped: fd is told not to read ignore files at all.
    expect(flags({ skipGitFolders: false, skipGitIgnored: false })).toEqual([
      "--no-ignore",
      "--hidden",
    ]);
    // `.git` is not in any ignore file; with hidden files included it needs its own exclude.
    expect(flags({ skipGitFolders: true, skipGitIgnored: false })).toEqual([
      "--no-ignore",
      "--exclude",
      ".git",
      "--hidden",
    ]);
    // Ignored files: fd's default behavior, so the flag that disables it is left out.
    expect(flags({ skipGitFolders: false, skipGitIgnored: true })).toEqual(["--hidden"]);
    expect(flags({ skipGitFolders: true, skipGitIgnored: true })).toEqual([
      "--exclude",
      ".git",
      "--hidden",
    ]);
  });

  it("matches the query literally in plain-text mode and as a pattern otherwise", () => {
    const args = (patternMode: "text" | "glob" | "regex") =>
      buildFdSearchArgs({
        rootPath: "/Users/demo/project",
        query: "report (1).pdf",
        patternMode,
        matchScope: "name",
        recursive: true,
        includeHidden: false,
        skipGitFolders: false,
        skipGitIgnored: false,
      });

    expect(args("text")).toContain("--fixed-strings");
    expect(args("text")).not.toContain("--glob");
    expect(args("glob")).toContain("--glob");
    expect(args("glob")).not.toContain("--fixed-strings");
    expect(args("regex")).not.toContain("--fixed-strings");
    expect(args("regex")).not.toContain("--glob");
    // The query itself is always passed through untouched.
    expect(args("text").slice(-2)).toEqual(["report (1).pdf", "/Users/demo/project"]);
  });

  it("reports folders and packages, which fd marks with a trailing slash", () => {
    const process = createMockProcess();
    const runtime = new FdSearchRuntime("/tmp/fd", {
      spawn: vi.fn(() => process as never),
    });
    const started = runtime.startSearch({
      rootPath: "/Users/demo",
      query: "app",
      patternMode: "text",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.stdout.write(
      Buffer.from(
        "/Users/demo/apps/\0/Users/demo/Notes.app/\0/Users/demo/apps/app.v2/\0/Users/demo/app.ts\0",
        "utf8",
      ),
    );

    expect(
      runtime
        .getUpdate(started.jobId, 0)
        .items.map(({ path, name, extension, kind, parentPath, relativeParentPath }) => ({
          path,
          name,
          extension,
          kind,
          parentPath,
          relativeParentPath,
        })),
    ).toEqual([
      {
        path: "/Users/demo/apps",
        name: "apps",
        extension: "",
        kind: "directory",
        parentPath: "/Users/demo",
        relativeParentPath: ".",
      },
      {
        path: "/Users/demo/Notes.app",
        name: "Notes.app",
        extension: "app",
        kind: "bundle",
        parentPath: "/Users/demo",
        relativeParentPath: ".",
      },
      {
        path: "/Users/demo/apps/app.v2",
        name: "app.v2",
        extension: "v2",
        kind: "directory",
        parentPath: "/Users/demo/apps",
        relativeParentPath: "apps",
      },
      {
        path: "/Users/demo/app.ts",
        name: "app.ts",
        extension: "ts",
        kind: "file",
        parentPath: "/Users/demo",
        relativeParentPath: ".",
      },
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
      skipGitFolders: false,
      skipGitIgnored: false,
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

  it("keeps getUpdate idempotent after a completed job has been drained", () => {
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
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.stdout.write(
      Buffer.from(
        "/Users/demo/project/src/App.tsx\0/Users/demo/project/src/lib/utils.tsx\0",
        "utf8",
      ),
    );
    process.emit("close", 0, null);

    // The first poll after completion returns every remaining item with done:true.
    const finalUpdate = runtime.getUpdate(started.jobId, 0);
    expect(finalUpdate.done).toBe(true);
    expect(finalUpdate.items).toHaveLength(2);
    expect(finalUpdate.nextCursor).toBe(2);

    // Subsequent polls must not throw "Unknown search job".
    expect(runtime.getUpdate(started.jobId, finalUpdate.nextCursor)).toEqual({
      jobId: started.jobId,
      status: "complete",
      items: [],
      nextCursor: 2,
      done: true,
      truncated: false,
      error: null,
    });
    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "complete",
      items: [],
      nextCursor: 0,
      done: true,
      truncated: false,
      error: null,
    });
  });

  it("reassembles entries that are split across stdout chunks", () => {
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
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.stdout.write(Buffer.from("/Users/demo/project/src/Ap", "utf8"));
    process.stdout.write(Buffer.from("p.tsx\0/Users/demo/project/src/lib/uti", "utf8"));
    process.stdout.write(Buffer.from("ls.tsx\0", "utf8"));

    const update = runtime.getUpdate(started.jobId, 0);
    expect(update.items.map((item) => item.path)).toEqual([
      "/Users/demo/project/src/App.tsx",
      "/Users/demo/project/src/lib/utils.tsx",
    ]);
  });

  it("terminates cancelled jobs and answers later polls with a cancelled terminal state", () => {
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
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    expect(runtime.cancelSearch(started.jobId)).toEqual({ ok: true });
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(runtime.getUpdate(started.jobId, 0)).toMatchObject({
      jobId: started.jobId,
      status: "cancelled",
      items: [],
      done: true,
    });
    expect(runtime.cancelSearch(started.jobId)).toEqual({ ok: true });
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
      skipGitFolders: false,
      skipGitIgnored: false,
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

  it("reports what fd said about a bad pattern without its command-line advice", () => {
    const process = createMockProcess();
    const runtime = new FdSearchRuntime("/tmp/fd", {
      spawn: vi.fn(() => process as never),
    });
    const started = runtime.startSearch({
      rootPath: "/Users/demo/project",
      query: "no(te",
      patternMode: "regex",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.stderr.write(
      "[fd error]: regex parse error:\n    no(te\n      ^\nerror: unclosed group\n\nNote: You can search for literal substrings with '--fixed-strings' or literal strings with '--exact' options.",
    );
    process.emit("close", 1, null);

    expect(runtime.getUpdate(started.jobId, 0).error).toBe(
      "regex parse error:\n    no(te\n      ^\nerror: unclosed group",
    );
  });

  it("flushes a trailing stdout buffer on close and preserves root-relative parents", () => {
    const process = createMockProcess();
    const runtime = new FdSearchRuntime("/tmp/fd", {
      spawn: vi.fn(() => process as never),
    });

    const started = runtime.startSearch({
      rootPath: "/Users/demo/project",
      query: ".env",
      patternMode: "glob",
      matchScope: "name",
      recursive: true,
      includeHidden: true,
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.stdout.write("/Users/demo/project/.env");
    process.emit("close", 0, null);

    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "complete",
      items: [
        {
          path: "/Users/demo/project/.env",
          name: ".env",
          extension: "",
          kind: "file",
          isHidden: true,
          isSymlink: false,
          parentPath: "/Users/demo/project",
          relativeParentPath: ".",
        },
      ],
      nextCursor: 1,
      done: true,
      truncated: false,
      error: null,
    });
  });

  it("surfaces process error events as search failures", () => {
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
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.emit("error", new Error("spawn failed"));

    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "error",
      items: [],
      nextCursor: 0,
      done: true,
      truncated: false,
      error: "spawn failed",
    });
  });

  it("reports unexpected exit signals when fd is terminated externally", () => {
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
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    process.emit("close", null, "SIGKILL");

    expect(runtime.getUpdate(started.jobId, 0)).toEqual({
      jobId: started.jobId,
      status: "error",
      items: [],
      nextCursor: 0,
      done: true,
      truncated: false,
      error: "fd exited via signal SIGKILL",
    });
  });

  it("ends option parsing before the query so a leading dash is not an fd flag", () => {
    const args = buildFdSearchArgs({
      rootPath: "/Users/demo/project",
      query: "-xrm",
      patternMode: "regex",
      matchScope: "path",
      recursive: true,
      includeHidden: false,
      skipGitFolders: false,
      skipGitIgnored: false,
    });
    expect(args.slice(-3)).toEqual(["--", "-xrm", "/Users/demo/project"]);
  });

  it("cancels running jobs and clears the registry when the runtime closes", async () => {
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
      skipGitFolders: false,
      skipGitIgnored: false,
    });

    await runtime.close();

    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(() => runtime.getUpdate(started.jobId, 0)).toThrow(
      `Unknown search job: ${started.jobId}`,
    );
  });
});
