import { basename, dirname, extname, relative, resolve } from "node:path";

import type { Readable } from "node:stream";
import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

const SEARCH_RESULT_LIMIT = 20_000;

type SearchStartRequest = IpcRequest<"search:start">;
type SearchUpdateResponse = IpcResponse<"search:getUpdate">;
type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchJobStatus = IpcResponse<"search:start">["status"];

interface SearchProcess {
  stdout: Readable;
  stderr: Readable;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export type SpawnLike = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    stdio: ["ignore", "pipe", "pipe"];
  },
) => SearchProcess;

type SearchJob = {
  jobId: string;
  rootPath: string;
  items: SearchResultItem[];
  status: SearchJobStatus;
  truncated: boolean;
  error: string | null;
  process: SearchProcess;
  stdoutBuffer: Buffer;
  stderr: string;
  done: boolean;
};

export type FdSearchRuntimeDependencies = {
  spawn: SpawnLike;
};

export function buildFdSearchArgs(request: SearchStartRequest): string[] {
  const args = ["--type", "f", "--print0", "--absolute-path", "--color", "never", "--no-ignore"];

  if (request.patternMode === "glob") {
    args.push("--glob");
  }
  if (request.matchScope === "path") {
    args.push("--full-path");
  }
  if (!request.recursive) {
    args.push("--max-depth", "1");
  }
  if (request.includeHidden) {
    args.push("--hidden");
  }

  args.push(request.query, request.rootPath);
  return args;
}

export class FdSearchRuntime {
  private readonly fdBinaryPath: string;
  private readonly spawn: SpawnLike;
  private readonly jobs = new Map<string, SearchJob>();
  private sequence = 0;

  constructor(fdBinaryPath: string, dependencies: FdSearchRuntimeDependencies) {
    this.fdBinaryPath = fdBinaryPath;
    this.spawn = dependencies.spawn;
  }

  startSearch(request: SearchStartRequest): IpcResponse<"search:start"> {
    const rootPath = resolve(request.rootPath);
    const jobId = `search-${++this.sequence}`;
    const process = this.spawn(this.fdBinaryPath, buildFdSearchArgs({ ...request, rootPath }), {
      cwd: rootPath,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const job: SearchJob = {
      jobId,
      rootPath,
      items: [],
      status: "running",
      truncated: false,
      error: null,
      process,
      stdoutBuffer: Buffer.alloc(0),
      stderr: "",
      done: false,
    };

    process.stdout.on("data", (chunk: Buffer | string) => {
      this.handleStdout(jobId, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    process.stderr.on("data", (chunk: Buffer | string) => {
      this.handleStderr(jobId, chunk.toString());
    });
    process.once("error", (error) => {
      this.finishJob(jobId, "error", error instanceof Error ? error.message : String(error));
    });
    process.once("close", (code, signal) => {
      this.handleClose(jobId, code, signal);
    });

    this.jobs.set(jobId, job);
    return { jobId, status: "running" };
  }

  getUpdate(jobId: string, cursor: number): SearchUpdateResponse {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown search job: ${jobId}`);
    }
    const safeCursor = Math.max(0, Math.min(cursor, job.items.length));
    const items = job.items.slice(safeCursor);
    const done = job.done;

    return {
      jobId,
      status: job.status,
      items,
      nextCursor: safeCursor + items.length,
      done,
      truncated: job.truncated,
      error: job.error,
    };
  }

  cancelSearch(jobId: string): IpcResponse<"search:cancel"> {
    const job = this.jobs.get(jobId);
    if (!job || job.done) {
      return { ok: true };
    }
    job.status = "cancelled";
    job.done = true;
    job.process.kill("SIGTERM");
    return { ok: true };
  }

  async close(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!job.done) {
        job.status = "cancelled";
        job.done = true;
        job.process.kill("SIGTERM");
      }
    }
    this.jobs.clear();
  }

  private handleStdout(jobId: string, chunk: Buffer): void {
    const job = this.jobs.get(jobId);
    if (!job || job.done) {
      return;
    }
    job.stdoutBuffer = Buffer.concat([job.stdoutBuffer, chunk]);
    let separatorIndex = job.stdoutBuffer.indexOf(0);
    while (separatorIndex >= 0) {
      const entry = job.stdoutBuffer.subarray(0, separatorIndex).toString("utf8");
      job.stdoutBuffer = job.stdoutBuffer.subarray(separatorIndex + 1);
      if (entry.length > 0) {
        this.appendItem(job, entry);
        if (job.truncated) {
          return;
        }
      }
      separatorIndex = job.stdoutBuffer.indexOf(0);
    }
  }

  private handleStderr(jobId: string, chunk: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    job.stderr += chunk;
  }

  private appendItem(job: SearchJob, outputPath: string): void {
    job.items.push(toSearchResultItem(job.rootPath, outputPath));
    if (job.items.length < SEARCH_RESULT_LIMIT) {
      return;
    }
    job.truncated = true;
    job.status = "truncated";
    job.done = true;
    job.process.kill("SIGTERM");
  }

  private handleClose(jobId: string, code: number | null, signal: NodeJS.Signals | null): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    if (job.stdoutBuffer.length > 0 && !job.done) {
      const trailing = job.stdoutBuffer.toString("utf8").replace(/\0+$/, "");
      if (trailing.length > 0) {
        this.appendItem(job, trailing);
      }
      job.stdoutBuffer = Buffer.alloc(0);
    }
    if (job.status === "cancelled") {
      job.done = true;
      return;
    }
    if (job.status === "truncated") {
      job.done = true;
      return;
    }
    if (signal && signal !== "SIGTERM") {
      this.finishJob(jobId, "error", job.stderr.trim() || `fd exited via signal ${signal}`);
      return;
    }
    if (code === 0) {
      job.status = "complete";
      job.done = true;
      return;
    }
    this.finishJob(jobId, "error", job.stderr.trim() || `fd exited with code ${code ?? "null"}`);
  }

  private finishJob(jobId: string, status: SearchJobStatus, error: string | null): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    job.status = status;
    job.error = error;
    job.done = true;
  }
}

function toSearchResultItem(rootPath: string, entryPath: string): SearchResultItem {
  const resolvedPath = resolve(entryPath);
  const name = basename(resolvedPath);
  const parentPath = dirname(resolvedPath);
  const relativeParentPath = relative(rootPath, parentPath);

  return {
    path: resolvedPath,
    name,
    extension: extname(name).replace(/^\./, "").toLowerCase(),
    kind: "file",
    isHidden: name.startsWith("."),
    isSymlink: false,
    parentPath,
    relativeParentPath: relativeParentPath.length === 0 ? "." : relativeParentPath,
  };
}
