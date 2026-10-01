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

/** Compact terminal record kept after a finished job has been fully drained via
 *  `getUpdate`, so late or duplicate polls stay idempotent instead of throwing. */
type FinishedSearchJob = {
  status: SearchJobStatus;
  truncated: boolean;
  error: string | null;
  itemCount: number;
};

const MAX_FINISHED_JOB_RECORDS = 64;

export type FdSearchRuntimeDependencies = {
  spawn: SpawnLike;
};

export function buildFdSearchArgs(request: SearchStartRequest): string[] {
  const args = ["--type", "f", "--print0", "--absolute-path", "--color", "never"];

  // fd leaves out what Git ignores (.gitignore, .ignore, .fdignore and the global ignore
  // file, inside Git repositories) unless told otherwise.
  if (!request.skipGitIgnored) {
    args.push("--no-ignore");
  }
  // `.git` is not covered by ignore files: fd only passes over it for being hidden, so it
  // would be searched as soon as hidden files are included.
  if (request.skipGitFolders) {
    args.push("--exclude", ".git");
  }

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

  // "--" ends option parsing so a query starting with "-" (e.g. "-xrm") is
  // treated as a pattern, never as an fd flag such as --exec.
  args.push("--", request.query, request.rootPath);
  return args;
}

export class FdSearchRuntime {
  private readonly fdBinaryPath: string;
  private readonly spawn: SpawnLike;
  private readonly jobs = new Map<string, SearchJob>();
  private readonly finishedJobs = new Map<string, FinishedSearchJob>();
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
      const finished = this.finishedJobs.get(jobId);
      if (finished) {
        return {
          jobId,
          status: finished.status,
          items: [],
          nextCursor: Math.max(0, Math.min(cursor, finished.itemCount)),
          done: true,
          truncated: finished.truncated,
          error: finished.error,
        };
      }
      throw new Error(`Unknown search job: ${jobId}`);
    }
    const safeCursor = Math.max(0, Math.min(cursor, job.items.length));
    const items = job.items.slice(safeCursor);
    const done = job.done;

    const response = {
      jobId,
      status: job.status,
      items,
      nextCursor: safeCursor + items.length,
      done,
      truncated: job.truncated,
      error: job.error,
    };
    if (done) {
      // The final response above already carries every remaining item, so the
      // job can be released — but remember its terminal state so later polls
      // stay idempotent instead of failing with "Unknown search job".
      this.jobs.delete(jobId);
      this.rememberFinishedJob(jobId, job);
    }
    return response;
  }

  cancelSearch(jobId: string): IpcResponse<"search:cancel"> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { ok: true };
    }
    if (!job.done) {
      job.status = "cancelled";
      job.done = true;
      job.process.kill("SIGTERM");
    }
    // Keep the terminal state so a poll already in flight gets a done response
    // instead of "Unknown search job".
    this.jobs.delete(jobId);
    this.rememberFinishedJob(jobId, job);
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
    this.finishedJobs.clear();
  }

  private rememberFinishedJob(jobId: string, job: SearchJob): void {
    this.finishedJobs.set(jobId, {
      status: job.status,
      truncated: job.truncated,
      error: job.error,
      itemCount: job.items.length,
    });
    while (this.finishedJobs.size > MAX_FINISHED_JOB_RECORDS) {
      const oldestJobId = this.finishedJobs.keys().next().value;
      if (oldestJobId === undefined) {
        break;
      }
      this.finishedJobs.delete(oldestJobId);
    }
  }

  private handleStdout(jobId: string, chunk: Buffer): void {
    const job = this.jobs.get(jobId);
    if (!job || job.done) {
      return;
    }
    // Complete records are parsed out of each chunk immediately; only the
    // unterminated tail is carried over, so accumulation stays linear instead
    // of re-copying every previously received byte on each chunk.
    const buffer = job.stdoutBuffer.length > 0 ? Buffer.concat([job.stdoutBuffer, chunk]) : chunk;
    let start = 0;
    let separatorIndex = buffer.indexOf(0, start);
    while (separatorIndex >= 0) {
      const entry = buffer.subarray(start, separatorIndex).toString("utf8");
      start = separatorIndex + 1;
      if (entry.length > 0) {
        this.appendItem(job, entry);
        if (job.truncated) {
          job.stdoutBuffer = Buffer.alloc(0);
          return;
        }
      }
      separatorIndex = buffer.indexOf(0, start);
    }
    // Copy the tail so the retained buffer does not pin the full chunk.
    job.stdoutBuffer =
      start < buffer.length ? Buffer.from(buffer.subarray(start)) : Buffer.alloc(0);
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
  const name = basename(entryPath);
  const parentPath = dirname(entryPath);
  const relativeParentPath = relative(rootPath, parentPath);

  return {
    path: entryPath,
    name,
    extension: extname(name).replace(/^\./, "").toLowerCase(),
    kind: "file",
    isHidden: name.startsWith("."),
    isSymlink: false,
    parentPath,
    relativeParentPath: relativeParentPath.length === 0 ? "." : relativeParentPath,
  };
}
