// The App test harness: a mock main process behind the window's client, and the helpers
// the App test files share. Those files mock the panes first (see appMocks.tsx).

import {
  type CopyPasteProgressEvent,
  type IpcChannel,
  type IpcRequestInput,
  type IpcResponse,
  type WriteOperationProgressEvent,
  ipcContractSchemas,
} from "@filetrail/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { recordFolderVisit } from "../../shared/visitedFolders";

import { App } from "../App";
import { type FiletrailClient, FiletrailClientProvider } from "../lib/filetrailClient";

export type RendererCommand = Parameters<Parameters<FiletrailClient["onCommand"]>[0]>[0];
export type TestProgressEvent =
  | (Omit<CopyPasteProgressEvent, "action"> & {
      action?: CopyPasteProgressEvent["action"];
    })
  | WriteOperationProgressEvent;

// Requests the window sent that the main process's checks would refuse (see the harness).
const refusedRequests: string[] = [];

// Checked after every test of a file that uses the harness: requests it refused.
export function expectNoRefusedRequests(): void {
  const refused = refusedRequests.splice(0);
  expect(refused, "requests the main process would refuse").toEqual([]);
}

export async function pasteSourceIntoFolder(
  harness: ReturnType<typeof createAppHarness>,
  clipboardKey: "c" | "x",
): Promise<void> {
  await selectItem("/Users/demo/source.txt");
  await act(async () => {
    fireEvent.keyDown(window, { key: clipboardKey, metaKey: true });
  });
  await selectItem("/Users/demo/Folder");
  await act(async () => {
    fireEvent.keyDown(window, { key: "v", metaKey: true });
  });
  await vi.waitFor(() => {
    expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
  });
}

export type TestResultItem = {
  sourcePath: string;
  status: "completed" | "failed" | "cancelled";
  error: string | null;
};

export function failedResultEvent(
  mode: "copy" | "cut",
  items: TestResultItem[],
): TestProgressEvent {
  return finishedResultEvent(mode, "failed", items);
}

export function finishedResultEvent(
  mode: "copy" | "cut",
  status: "completed" | "failed",
  items: TestResultItem[],
): TestProgressEvent {
  const count = (itemStatus: TestResultItem["status"]) =>
    items.filter((item) => item.status === itemStatus).length;
  const summary = {
    topLevelItemCount: 1,
    totalItemCount: items.length,
    completedItemCount: count("completed"),
    failedItemCount: count("failed"),
    skippedItemCount: 0,
    cancelledItemCount: count("cancelled"),
    completedByteCount: 0,
    totalBytes: 5,
  };
  return {
    operationId: "copy-op-1",
    mode,
    status,
    completedItemCount: summary.completedItemCount,
    totalItemCount: items.length,
    completedByteCount: 0,
    totalBytes: 5,
    currentSourcePath: null,
    currentDestinationPath: null,
    result: {
      operationId: "copy-op-1",
      mode,
      status,
      destinationDirectoryPath: "/Users/demo/Folder",
      startedAt: "2026-03-09T00:00:00.000Z",
      finishedAt: "2026-03-09T00:00:01.000Z",
      summary,
      items: items.map((item) => ({
        sourcePath: item.sourcePath,
        destinationPath: `/Users/demo/Folder/${item.sourcePath.split("/").at(-1)}`,
        status: item.status,
        error: item.error,
      })),
      error: status === "failed" ? (items.find((item) => item.error)?.error ?? null) : null,
    },
  };
}

type AnalysisReport = NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
export type CopyPasteIssue = AnalysisReport["issues"][number];

// A paste's outcome as the tests describe it: the items and what is wrong. toAnalysisReport
// makes the analysis the window is given from it.
export type TestPastePlan = {
  mode: AnalysisReport["mode"];
  sourcePaths: string[];
  destinationDirectoryPath: string;
  items: Array<{
    sourcePath: string;
    destinationPath: string;
    kind: "file" | "directory" | "symlink";
    status: "ready" | "conflict" | "blocked";
    sizeBytes: number | null;
  }>;
  issues: CopyPasteIssue[];
  warnings: AnalysisReport["warnings"];
  summary: {
    topLevelItemCount: number;
    totalItemCount: number;
    totalBytes: number | null;
  };
};

export function sameFolderIssue(sourcePath: string): CopyPasteIssue {
  return {
    code: "same_path",
    message: `Cannot paste ${sourcePath} onto itself.`,
    sourcePath,
    destinationPath: sourcePath,
  };
}

export function cutPlan(
  sourcePaths: string[],
  destinationDirectoryPath: string,
  issues: CopyPasteIssue[] = [],
): TestPastePlan {
  const issuePaths = new Set(issues.map((issue) => issue.sourcePath));
  const items = sourcePaths
    .filter((sourcePath) => !issuePaths.has(sourcePath))
    .map((sourcePath) => ({
      sourcePath,
      destinationPath: `${destinationDirectoryPath}/${sourcePath.split("/").at(-1)}`,
      kind: "file" as const,
      status: "ready" as const,
      sizeBytes: 5,
    }));
  return {
    mode: "cut",
    sourcePaths,
    destinationDirectoryPath,
    items,
    issues,
    warnings: [],
    summary: {
      topLevelItemCount: sourcePaths.length,
      totalItemCount: items.length,
      totalBytes: items.length * 5,
    },
  };
}

export function folderConflictPlan(): TestPastePlan {
  return {
    mode: "copy",
    sourcePaths: ["/Users/demo/Folder"],
    destinationDirectoryPath: "/Users/demo",
    items: [
      {
        sourcePath: "/Users/demo/Folder",
        destinationPath: "/Users/demo/Folder",
        kind: "directory",
        status: "conflict",
        sizeBytes: null,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalItemCount: 1,
      totalBytes: null,
    },
  };
}

export function createAppHarness(
  args: {
    planResponse?: TestPastePlan;
    analysisUpdateResponse?: IpcResponse<"copyPaste:analyzeGetUpdate">;
    // Builds the finished analysis from the request, for tests where it depends on the
    // items being analyzed.
    analysisReportForRequest?: (
      request: IpcRequestInput<"copyPaste:analyzeStart">,
    ) => NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]>;
    preferences?: Partial<IpcResponse<"app:getPreferences">["preferences"]>;
    directorySnapshots?: Record<string, IpcResponse<"directory:getSnapshot">>;
    treeChildrenByPath?: Record<string, IpcResponse<"tree:getChildren">["children"]>;
    itemPropertiesByPath?: Record<
      string,
      "missing" | NonNullable<IpcResponse<"item:getProperties">["item"]>
    >;
    copyTextError?: Error;
    pickApplicationResponse?: IpcResponse<"system:pickApplication">;
    pickDirectoryResponse?: IpcResponse<"system:pickDirectory">;
    visitedFolders?: IpcResponse<"places:list">["folders"];
    // Scripts the searches by the text searched for: the names found in /Users/demo, whether
    // the search is still running, and whether it stopped at its limit.
    searchJobs?: (query: string) => { names: string[]; running?: boolean; truncated?: boolean };
    // Reading this folder's subfolders for the tree waits until `releaseTreeChildren`.
    holdTreeChildrenFor?: string;
    // Which disk the folders under each path are on (the longest matching path wins).
    diskIds?: Record<string, number>;
    // Folder sizes a calculation finds, by path. Without them sizes are not answered.
    folderSizes?: Record<string, number>;
    // Answers about a scripted search wait until `releaseSearchUpdates`.
    holdSearchUpdates?: boolean;
    copyPastePlanError?: Error;
    deferCopyPastePlan?: boolean;
    deferCopyPastePlanCalls?: number[];
    deferCopyPasteStart?: boolean;
    copyPasteStartError?: Error;
    openPathsWithApplicationError?: Error;
    // Thrown by the next rename requests, one each, as the main process would refuse them.
    renameErrors?: Error[];
    // Why some items can't be renamed, as the Rename sheet's checks find.
    batchRenameCannotRename?: Record<string, string>;
    createFolderError?: Error;
    resolveConflictError?: Error;
    clearCachesError?: Error;
    // What a search that is not scripted finds, instead of the one source.txt.
    searchResultItems?: IpcResponse<"search:getUpdate">["items"];
    // What the Trash holds, as far as the main process can tell (null: it can't).
    trashEmpty?: boolean | null;
    // What the next Undo (or Redo) requests find, one each; after them, one with nothing
    // to ask about.
    undoPrepareResponses?: Array<IpcResponse<"undo:prepare">>;
    undoStartError?: Error;
  } = {},
): {
  client: FiletrailClient;
  invocations: Array<{ channel: IpcChannel; payload: unknown }>;
  menuStates: Array<IpcRequestInput<"app:setMenuState">["state"]>;
  emitCommand: (command: RendererCommand) => void;
  emitProgress: (event: TestProgressEvent) => void;
  setDirectoryEntries: (
    path: string,
    entries: IpcResponse<"directory:getSnapshot">["entries"],
  ) => void;
  // The folder is gone from disk: reading it fails from now on.
  removeDirectory: (path: string) => void;
  // Holds back the listings of `path` until the returned function is called.
  holdDirectorySnapshot: (path: string) => () => void;
  releaseTreeChildren: () => void;
  releaseSearchUpdates: () => void;
  resolveCopyPastePlan: () => void;
  resolveCopyPasteStart: () => void;
} {
  let preferences = {
    ...DEFAULT_APP_PREFERENCES,
    viewMode: "details" as const,
    propertiesOpen: false,
    detailRowOpen: false,
    treeRootPath: "/Users/demo",
    lastVisitedPath: "/Users/demo",
    ...args.preferences,
  } as IpcResponse<"app:getPreferences">["preferences"];
  let visitedFolders = args.visitedFolders ?? [];
  let searchJobCount = 0;
  const searchJobQueries = new Map<string, string>();
  const directorySnapshots: Record<string, IpcResponse<"directory:getSnapshot">> = {
    "/Users/demo": {
      path: "/Users/demo",
      parentPath: "/Users",
      entries: [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ],
    },
    "/Users/demo/Folder": {
      path: "/Users/demo/Folder",
      parentPath: "/Users/demo",
      entries: [],
    },
    ...args.directorySnapshots,
  };
  const treeChildrenByPath: Record<string, IpcResponse<"tree:getChildren">["children"]> = {
    "/Users/demo": [createTreeChild("/Users/demo/Folder", "directory")],
    ...args.treeChildrenByPath,
  };
  const invocations: Array<{ channel: IpcChannel; payload: unknown }> = [];
  // What the window reports to the application menu; kept apart from the calls tests count.
  const menuStates: Array<IpcRequestInput<"app:setMenuState">["state"]> = [];
  const heldSnapshots = new Map<string, Promise<void>>();
  let releaseTreeChildren: () => void = () => undefined;
  const heldTreeChildren = new Promise<void>((resolve) => {
    releaseTreeChildren = resolve;
  });
  let releaseSearchUpdates: () => void = () => undefined;
  const heldSearchUpdates = args.holdSearchUpdates
    ? new Promise<void>((resolve) => {
        releaseSearchUpdates = resolve;
      })
    : Promise.resolve();
  // Like the worker, a search that has reported its end keeps no results to hand out again.
  const finishedSearchJobs = new Set<string>();
  let commandListener: ((command: RendererCommand) => void) | null = null;
  // Several parts of the window listen (the operation itself, folder sizes), as in the app.
  const writeOperationProgressListeners = new Set<(event: WriteOperationProgressEvent) => void>();
  let copyPasteProgressListener: ((event: WriteOperationProgressEvent) => void) | null = null;
  const resolveCopyPastePlanPromises: Array<() => void> = [];
  let copyPastePlanCallCount = 0;
  let resolveCopyPasteStartPromise: (() => void) | null = null;
  const copyPasteStartPromise =
    args.deferCopyPasteStart === true
      ? new Promise<void>((resolve) => {
          resolveCopyPasteStartPromise = resolve;
        })
      : null;
  const analysisReport = args.planResponse
    ? toAnalysisReport(args.planResponse)
    : toAnalysisReport(defaultPlanResponse());
  let lastAnalyzeRequest: IpcRequestInput<"copyPaste:analyzeStart"> | null = null;

  const client: FiletrailClient = {
    async invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>) {
      // What the main process accepts, checked as it checks it: a request it would refuse
      // fails the test instead of passing here.
      const checked = ipcContractSchemas[channel].request.safeParse(payload);
      if (!checked.success) {
        // The window catches failed requests itself, so the test hears of it afterwards.
        refusedRequests.push(`${channel}: ${checked.error.message}`);
        throw new Error(`The main process would refuse this ${channel} request.`);
      }
      if (channel === "app:setMenuState") {
        menuStates.push((payload as IpcRequestInput<"app:setMenuState">).state);
        return { ok: true } as IpcResponse<C>;
      }
      const recordedPayload =
        channel === "copyPaste:start" && "analysisId" in (payload as Record<string, unknown>)
          ? {
              ...(payload as object),
              sourcePaths: analysisReport.sourcePaths,
              destinationDirectoryPath: analysisReport.destinationDirectoryPath,
            }
          : payload;
      invocations.push({ channel, payload: recordedPayload });
      if (channel === "app:getPreferences") {
        return { preferences } as IpcResponse<C>;
      }
      if (channel === "app:getHomeDirectory") {
        return { path: "/Users/demo" } as IpcResponse<C>;
      }
      if (channel === "app:getLaunchContext") {
        return { startupFolderPath: null } as IpcResponse<C>;
      }
      if (channel === "app:updatePreferences") {
        preferences = mergePreferences(
          preferences,
          (payload as IpcRequestInput<"app:updatePreferences">).preferences,
        );
        return { preferences } as IpcResponse<C>;
      }
      if (channel === "tree:getChildren") {
        if ((payload as IpcRequestInput<"tree:getChildren">).path === args.holdTreeChildrenFor) {
          await heldTreeChildren;
        }
        return {
          path: (payload as IpcRequestInput<"tree:getChildren">).path,
          children: treeChildrenByPath[(payload as IpcRequestInput<"tree:getChildren">).path] ?? [],
        } satisfies IpcResponse<"tree:getChildren"> as IpcResponse<C>;
      }
      if (channel === "directory:getSnapshot") {
        const snapshotPath = (payload as IpcRequestInput<"directory:getSnapshot">).path;
        await heldSnapshots.get(snapshotPath);
        return directorySnapshots[snapshotPath] as IpcResponse<C>;
      }
      if (channel === "directory:getMetadataBatch") {
        return {
          directoryPath: (payload as IpcRequestInput<"directory:getMetadataBatch">).directoryPath,
          items: [],
        } satisfies IpcResponse<"directory:getMetadataBatch"> as IpcResponse<C>;
      }
      if (channel === "item:getProperties") {
        const targetPath = (payload as IpcRequestInput<"item:getProperties">).path;
        if (Object.prototype.hasOwnProperty.call(args.itemPropertiesByPath ?? {}, targetPath)) {
          const item =
            (
              (args.itemPropertiesByPath ?? {}) as Record<
                string,
                "missing" | NonNullable<IpcResponse<"item:getProperties">["item"]>
              >
            )[targetPath] ?? "missing";
          return {
            item: item === "missing" ? null : item,
          } as IpcResponse<C>;
        }
        const entry =
          Object.values(directorySnapshots)
            .flatMap((snapshot) => snapshot.entries)
            .find((candidate) => candidate.path === targetPath) ??
          Object.values(treeChildrenByPath)
            .flat()
            .find((candidate) => candidate.path === targetPath);
        const kind = entry?.kind ?? (targetPath === "/Users/demo" ? "directory" : "directory");
        const name = targetPath.split("/").at(-1) ?? targetPath;
        return {
          item: {
            path: targetPath,
            name,
            extension: kind === "file" ? (name.split(".").at(-1) ?? "") : "",
            kind,
            kindLabel: kind === "directory" ? "Folder" : "File",
            isHidden: false,
            isSymlink: entry?.isSymlink ?? false,
            createdAt: null,
            modifiedAt: null,
            sizeBytes: null,
            sizeStatus: "ready",
            permissionMode: null,
          },
        } satisfies IpcResponse<"item:getProperties"> as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeStart") {
        lastAnalyzeRequest = payload as IpcRequestInput<"copyPaste:analyzeStart">;
        return { analysisId: "analysis-1", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeGetUpdate") {
        copyPastePlanCallCount += 1;
        if (
          args.deferCopyPastePlan === true ||
          args.deferCopyPastePlanCalls?.includes(copyPastePlanCallCount)
        ) {
          await new Promise<void>((resolve) => {
            resolveCopyPastePlanPromises.push(resolve);
          });
        }
        if (args.copyPastePlanError) {
          throw args.copyPastePlanError;
        }
        return (args.analysisUpdateResponse ?? {
          analysisId: "analysis-1",
          status: "complete",
          done: true,
          report:
            args.analysisReportForRequest && lastAnalyzeRequest
              ? args.analysisReportForRequest(lastAnalyzeRequest)
              : analysisReport,
          error: null,
        }) as IpcResponse<C>;
      }
      if (channel === "copyPaste:analyzeCancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "copyPaste:start") {
        if (copyPasteStartPromise) {
          await copyPasteStartPromise;
        }
        if (args.copyPasteStartError) {
          throw args.copyPasteStartError;
        }
        return { operationId: "copy-op-1", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "copyPaste:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "copyPaste:resolveConflict") {
        if (args.resolveConflictError) {
          throw args.resolveConflictError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "writeOperation:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "writeOperation:createFolder") {
        if (args.createFolderError) {
          throw args.createFolderError;
        }
        return { operationId: "write-op-folder", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "writeOperation:rename") {
        const renameError = args.renameErrors?.shift();
        if (renameError) {
          throw renameError;
        }
        return { operationId: "write-op-rename", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "writeOperation:batchRename") {
        return { operationId: "write-op-batch-rename", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "batchRename:inspect") {
        // Each item made on one day; the folders hold what their listings hold.
        const { paths } = payload as IpcRequestInput<"batchRename:inspect">;
        const folderPaths = [...new Set(paths.map((path) => path.slice(0, path.lastIndexOf("/"))))];
        return {
          items: paths.map((path) => ({
            path,
            createdAt: "2026-09-30T10:12:40",
            modifiedAt: "2026-10-01T08:30:15",
            takenAt: null,
            cannotRename: args.batchRenameCannotRename?.[path] ?? null,
          })),
          folders: folderPaths.map((path) => ({
            path,
            names: (directorySnapshots[path]?.entries ?? []).map((entry) => entry.name),
            caseSensitive: false,
          })),
        } satisfies IpcResponse<"batchRename:inspect"> as IpcResponse<C>;
      }
      if (channel === "writeOperation:trash") {
        return { operationId: "write-op-trash", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "undo:prepare") {
        return (args.undoPrepareResponses?.shift() ?? {
          ticket: `${(payload as IpcRequestInput<"undo:prepare">).direction}:1:1`,
          refusal: null,
          label: "Move of “source.txt”",
          action: "move_to",
          nameTaken: [],
          changed: [],
        }) as IpcResponse<C>;
      }
      if (channel === "undo:start") {
        if (args.undoStartError) {
          throw args.undoStartError;
        }
        return { operationId: "write-op-undo", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "system:getTrashState") {
        return { empty: args.trashEmpty ?? null } as IpcResponse<C>;
      }
      if (channel === "writeOperation:deleteImmediately") {
        return { operationId: "write-op-delete", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "path:resolve") {
        return {
          inputPath: (payload as IpcRequestInput<"path:resolve">).path,
          resolvedPath: (payload as IpcRequestInput<"path:resolve">).path,
        } satisfies IpcResponse<"path:resolve"> as IpcResponse<C>;
      }
      if (channel === "path:getSuggestions") {
        return {
          inputPath: (payload as IpcRequestInput<"path:getSuggestions">).inputPath,
          basePath: null,
          suggestions: [],
        } satisfies IpcResponse<"path:getSuggestions"> as IpcResponse<C>;
      }
      if (channel === "search:start") {
        const request = payload as IpcRequestInput<"search:start">;
        searchJobCount += 1;
        const jobId = args.searchJobs ? `search-job-${searchJobCount}` : "search-job-1";
        searchJobQueries.set(jobId, request.query);
        return { jobId, status: "running" } as IpcResponse<C>;
      }
      if (channel === "search:getUpdate" && args.searchJobs) {
        // A scripted search: which names it finds, and whether it has finished.
        const { jobId, cursor = 0 } = payload as IpcRequestInput<"search:getUpdate">;
        const job = args.searchJobs(searchJobQueries.get(jobId) ?? "");
        const items =
          cursor === 0 && !finishedSearchJobs.has(jobId)
            ? job.names.map((name) => createSearchResult(name))
            : [];
        const running = job.running === true;
        if (!running) {
          finishedSearchJobs.add(jobId);
        }
        await heldSearchUpdates;
        return {
          jobId,
          status: running ? "running" : job.truncated ? "truncated" : "complete",
          items,
          nextCursor: cursor + items.length,
          done: !running,
          truncated: job.truncated === true,
          error: null,
        } satisfies IpcResponse<"search:getUpdate"> as IpcResponse<C>;
      }
      if (channel === "search:getUpdate") {
        return {
          jobId: "search-job-1",
          status: "complete",
          items: args.searchResultItems ?? [
            {
              path: "/Users/demo/source.txt",
              name: "source.txt",
              extension: "txt",
              kind: "file",
              isHidden: false,
              isSymlink: false,
              parentPath: "/Users/demo",
              relativeParentPath: ".",
            },
          ],
          nextCursor: args.searchResultItems?.length ?? 1,
          done: true,
          truncated: false,
          error: null,
        } satisfies IpcResponse<"search:getUpdate"> as IpcResponse<C>;
      }
      if (channel === "search:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "system:openPath") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:pickApplication") {
        return (args.pickApplicationResponse ?? {
          canceled: false,
          appPath: "/Applications/Other.app",
          appName: "Other",
        }) as IpcResponse<C>;
      }
      if (channel === "system:pickDirectory") {
        return (args.pickDirectoryResponse ?? {
          canceled: false,
          path: "/Users/demo/Folder",
        }) as IpcResponse<C>;
      }
      if (channel === "system:openPathsWithApplication") {
        if (args.openPathsWithApplicationError) {
          throw args.openPathsWithApplicationError;
        }
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:openInTerminal") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:copyText") {
        if (args.copyTextError) {
          throw args.copyTextError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "system:performEditAction") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "app:clearCaches") {
        if (args.clearCachesError) {
          throw args.clearCachesError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "places:list") {
        return { folders: visitedFolders } as IpcResponse<C>;
      }
      if (channel === "places:recordVisit") {
        const { path, kind } = payload as IpcRequestInput<"places:recordVisit">;
        visitedFolders = recordFolderVisit(visitedFolders, path, kind, Date.now());
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "places:forget") {
        const { path } = payload as IpcRequestInput<"places:forget">;
        visitedFolders = visitedFolders.filter((folder) => folder.path !== path);
        return { folders: visitedFolders } as IpcResponse<C>;
      }
      if (channel === "app:writeLog") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "system:emptyTrash") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:getDiskIds") {
        // Which disk each folder is on: as given, else the disk its path names.
        const { paths } = payload as IpcRequestInput<"system:getDiskIds">;
        return {
          ids: paths.map(
            (path) =>
              Object.entries(args.diskIds ?? {})
                .filter(([root]) => path === root || path.startsWith(`${root}/`))
                .sort(([left], [right]) => right.length - left.length)[0]?.[1] ??
              /^\/Volumes\/[^/]+/.exec(path)?.[0].length ??
              1,
          ),
        } as IpcResponse<C>;
      }
      if (channel === "folderSize:start" && args.folderSizes) {
        // Nothing is known before it is calculated: a probe of the cache finds nothing.
        const { path, probeOnly } = payload as IpcRequestInput<"folderSize:start">;
        return {
          jobId: `folder-size:${path}`,
          status: probeOnly ? "deferred" : "ready",
        } as IpcResponse<C>;
      }
      if (channel === "folderSize:getStatus" && args.folderSizes) {
        const { jobId } = payload as IpcRequestInput<"folderSize:getStatus">;
        const sizeBytes = args.folderSizes[jobId.slice("folder-size:".length)] ?? 0;
        return {
          jobId,
          status: "ready",
          sizeBytes,
          diskBytes: sizeBytes,
          fileCount: 0,
          folderCount: 0,
          measuredFolderCount: 0,
          error: null,
        } as IpcResponse<C>;
      }
      throw new Error(`Unhandled channel in test harness: ${channel}`);
    },
    async log() {
      return undefined;
    },
    onCommand(listener) {
      commandListener = listener;
      return () => {
        if (commandListener === listener) {
          commandListener = null;
        }
      };
    },
    onWriteOperationProgress(listener) {
      writeOperationProgressListeners.add(listener);
      return () => {
        writeOperationProgressListeners.delete(listener);
      };
    },
    onCopyPasteProgress(listener) {
      copyPasteProgressListener = listener;
      return () => {
        if (copyPasteProgressListener === listener) {
          copyPasteProgressListener = null;
        }
      };
    },
  };

  return {
    client,
    invocations,
    menuStates,
    emitCommand(command) {
      commandListener?.(command);
    },
    emitProgress(event) {
      if ("mode" in event) {
        const action = event.action ?? (event.mode === "cut" ? "move_to" : "paste");
        const normalizedEvent: WriteOperationProgressEvent = {
          operationId: event.operationId,
          action,
          status: event.status,
          completedItemCount: event.completedItemCount,
          totalItemCount: event.totalItemCount,
          completedByteCount: event.completedByteCount,
          totalBytes: event.totalBytes,
          currentSourcePath: event.currentSourcePath,
          currentDestinationPath: event.currentDestinationPath,
          result: event.result
            ? {
                operationId: event.result.operationId,
                action,
                status: event.result.status,
                targetPath: event.result.destinationDirectoryPath,
                startedAt: event.result.startedAt,
                finishedAt: event.result.finishedAt,
                summary: event.result.summary,
                items: event.result.items,
                error: event.result.error,
              }
            : null,
        };
        for (const listener of writeOperationProgressListeners) {
          listener(normalizedEvent);
        }
        copyPasteProgressListener?.(normalizedEvent);
        return;
      }
      for (const listener of writeOperationProgressListeners) {
        listener(event);
      }
    },
    setDirectoryEntries(path, entries) {
      const snapshot = directorySnapshots[path];
      if (!snapshot) {
        throw new Error(`Unknown directory snapshot path: ${path}`);
      }
      directorySnapshots[path] = {
        ...snapshot,
        entries,
      };
    },
    removeDirectory(path) {
      delete directorySnapshots[path];
    },
    holdDirectorySnapshot(path) {
      let release: () => void = () => undefined;
      heldSnapshots.set(
        path,
        new Promise<void>((resolve) => {
          release = () => {
            heldSnapshots.delete(path);
            resolve();
          };
        }),
      );
      return () => release();
    },
    releaseTreeChildren() {
      releaseTreeChildren();
    },
    releaseSearchUpdates() {
      releaseSearchUpdates();
    },
    resolveCopyPastePlan() {
      resolveCopyPastePlanPromises.shift()?.();
    },
    resolveCopyPasteStart() {
      resolveCopyPasteStartPromise?.();
    },
  };
}

export async function selectItem(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  // Once loaded, the window gives the keyboard to a pane (the tree, as at launch). On a
  // slow machine that can come after this click and take the keyboard from the list, so
  // the click waits for it.
  await waitFor(() => {
    expect(
      ["tree-focused", "content-focused"].some(
        (id) => screen.queryByTestId(id)?.textContent === "true",
      ),
    ).toBe(true);
  });
  await act(async () => {
    fireEvent.click(button);
  });
}

// New Folder inside another folder: from that folder's own menu (⇧⌘N makes it in the
// folder on screen).
export async function openNewFolderFromFolderMenu(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.contextMenu(button);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^New Folder/ }));
  });
}

export function createMockDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "all",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((format?: string) => {
      if (format) {
        store.delete(format);
        return;
      }
      store.clear();
    }),
    getData: vi.fn((format: string) => store.get(format) ?? ""),
    setData: vi.fn((format: string, value: string) => {
      store.set(format, value);
    }),
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

export async function dragBetween(source: HTMLElement, target: HTMLElement): Promise<DataTransfer> {
  const dataTransfer = createMockDataTransfer();
  await act(async () => {
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
    fireEvent.dragEnd(source, { dataTransfer });
  });
  return dataTransfer;
}

export async function focusTreePane(): Promise<void> {
  const treePane = await screen.findByTestId("tree-pane");
  await act(async () => {
    fireEvent.click(treePane);
  });
}

export async function clearContentSelection(): Promise<void> {
  const backgroundButton = await screen.findByTestId("content-pane-background");
  await act(async () => {
    fireEvent.click(backgroundButton);
  });
}

export async function openDirectory(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.doubleClick(button);
  });
  await vi.waitFor(() => {
    expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
  });
}

export async function openSearchResults(): Promise<void> {
  const searchInput = await screen.findByPlaceholderText("Search");
  const form = searchInput.closest("form");
  if (!form) {
    throw new Error("Missing search form.");
  }
  await act(async () => {
    fireEvent.change(searchInput, { target: { value: "source" } });
    fireEvent.submit(form);
  });
  await screen.findByTestId("search-results-pane");
}

export function expectNativeEditActions(
  harness: ReturnType<typeof createAppHarness>,
  actions: Array<"undo" | "redo" | "cut" | "copy" | "paste" | "selectAll">,
): void {
  expect(
    harness.invocations
      .filter((call) => call.channel === "system:performEditAction")
      .map((call) => (call.payload as IpcRequestInput<"system:performEditAction">).action),
  ).toEqual(actions);
}

// The toolbar's clipboard button is there exactly while files or folders wait to be pasted.
export function clipboardButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: /^Clipboard: / });
}

// The names the clipboard's list shows, as the Show Clipboard command opens it.
export async function expectClipboardListing(
  harness: ReturnType<typeof createAppHarness>,
  names: string[],
): Promise<void> {
  await act(async () => {
    harness.emitCommand({ type: "showClipboard" });
  });
  const menu = screen.getByRole("menu", { name: "Clipboard" });
  for (const name of names) {
    expect(within(menu).getByText(name)).toBeInTheDocument();
  }
  expect(within(menu).queryByText("source.txt")).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
}

export function expectNoFileClipboardActions(harness: ReturnType<typeof createAppHarness>): void {
  expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(false);
  expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
}

export function createSearchResult(name: string): IpcResponse<"search:getUpdate">["items"][number] {
  const dotIndex = name.lastIndexOf(".");
  return {
    path: `/Users/demo/${name}`,
    name,
    extension: dotIndex > 0 ? name.slice(dotIndex + 1) : "",
    kind: "file",
    isHidden: false,
    isSymlink: false,
    parentPath: "/Users/demo",
    relativeParentPath: ".",
  };
}

export function createDirectoryEntry(
  path: string,
  kind: IpcResponse<"directory:getSnapshot">["entries"][number]["kind"],
  options: {
    isSymlink?: boolean;
  } = {},
): IpcResponse<"directory:getSnapshot">["entries"][number] {
  const name = path.split("/").at(-1) ?? path;
  const extension =
    kind === "file"
      ? (() => {
          const dotIndex = name.lastIndexOf(".");
          return dotIndex > 0 ? name.slice(dotIndex + 1) : "";
        })()
      : "";
  return {
    path,
    name,
    extension,
    kind,
    isHidden: false,
    isSymlink: options.isSymlink ?? false,
  };
}

export function defaultPlanResponse(): TestPastePlan {
  return {
    mode: "copy",
    sourcePaths: ["/Users/demo/source.txt"],
    destinationDirectoryPath: "/Users/demo/Folder",
    items: [
      {
        sourcePath: "/Users/demo/source.txt",
        destinationPath: "/Users/demo/Folder/source.txt",
        kind: "file",
        status: "ready",
        sizeBytes: 5,
      },
    ],
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: 1,
      totalItemCount: 1,
      totalBytes: 5,
    },
  };
}

export function toAnalysisReport(plan: TestPastePlan): AnalysisReport {
  const fileConflictCount = plan.items.filter(
    (item) => item.status === "conflict" && item.kind !== "directory",
  ).length;
  const directoryConflictCount = plan.items.filter(
    (item) => item.status === "conflict" && item.kind === "directory",
  ).length;
  return {
    analysisId: "analysis-1",
    mode: plan.mode,
    sourcePaths: plan.sourcePaths,
    destinationDirectoryPath: plan.destinationDirectoryPath,
    nodes: plan.items.map((item, index) => ({
      id: `item-${index + 1}`,
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      sourceKind: item.kind,
      destinationKind:
        item.status === "conflict"
          ? item.kind === "directory"
            ? "directory"
            : item.kind
          : "missing",
      disposition: item.status === "ready" ? "new" : item.status,
      conflictClass:
        item.status === "conflict"
          ? item.kind === "directory"
            ? "directory_conflict"
            : "file_conflict"
          : null,
      sourceFingerprint: {
        exists: true,
        kind: item.kind,
        size: item.sizeBytes,
        mtimeMs: 1,
        mode: 0o644,
        ino: null,
        dev: null,
        symlinkTarget: null,
      },
      destinationFingerprint: {
        exists: item.status === "conflict",
        kind:
          item.status === "conflict"
            ? item.kind === "directory"
              ? "directory"
              : item.kind
            : "missing",
        size: item.status === "conflict" ? item.sizeBytes : null,
        mtimeMs: item.status === "conflict" ? 1 : null,
        mode: item.status === "conflict" ? 0o644 : null,
        ino: null,
        dev: null,
        symlinkTarget: null,
      },
      children: [],
      issueCode: null,
      issueMessage: null,
      totalNodeCount: 1,
      conflictNodeCount: item.status === "conflict" ? 1 : 0,
      destinationTotalNodeCount: item.status === "conflict" && item.kind === "directory" ? 0 : null,
      keepBothDestinationPath: null,
      destinationOnly: null,
      replaceBlockedReason: null,
    })),
    issues: plan.issues,
    warnings: plan.warnings,
    summary: {
      topLevelItemCount: plan.summary.topLevelItemCount,
      totalNodeCount: plan.summary.totalItemCount,
      totalBytes: plan.summary.totalBytes,
      fileConflictCount,
      directoryConflictCount,
      mismatchConflictCount: 0,
      blockedCount: 0,
    },
  };
}

export function createNodeFingerprint(kind: "missing" | "file" | "directory" | "symlink"): {
  exists: boolean;
  kind: "missing" | "file" | "directory" | "symlink";
  size: number | null;
  mtimeMs: number | null;
  mode: number | null;
  ino: number | null;
  dev: number | null;
  symlinkTarget: string | null;
} {
  return {
    exists: kind !== "missing",
    kind,
    size: kind === "file" ? 5 : null,
    mtimeMs: kind === "missing" ? null : 1,
    mode: kind === "missing" ? null : 0o755,
    ino: null,
    dev: null,
    symlinkTarget: null,
  };
}

export function createTreeChild(
  path: string,
  kind: IpcResponse<"tree:getChildren">["children"][number]["kind"],
  options: {
    isSymlink?: boolean;
  } = {},
): IpcResponse<"tree:getChildren">["children"][number] {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    kind,
    isHidden: false,
    isSymlink: options.isSymlink ?? false,
  };
}

export function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

export function mergePreferences(
  current: IpcResponse<"app:getPreferences">["preferences"],
  patch: IpcRequestInput<"app:updatePreferences">["preferences"],
): IpcResponse<"app:getPreferences">["preferences"] {
  return Object.assign(
    {},
    current,
    stripUndefined(patch),
  ) as IpcResponse<"app:getPreferences">["preferences"];
}

// jsdom has no DragEvent, so drag events would carry no modifier keys. This one is a mouse
// event, which keeps Option and Command; the data transfer is added by Testing Library.
export function installDragEventWithModifiers(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, "DragEvent");
  class TestDragEvent extends MouseEvent {}
  Object.defineProperty(window, "DragEvent", {
    configurable: true,
    writable: true,
    value: TestDragEvent,
  });
  return () => {
    if (descriptor) {
      Object.defineProperty(window, "DragEvent", descriptor);
    } else {
      Reflect.deleteProperty(window, "DragEvent");
    }
  };
}

export type DragKeys = { altKey?: boolean; metaKey?: boolean };

// Drags `source` over `target`, once per entry of `hovers` (the keys held at that moment),
// and drops it with the keys of `drop`. Returns the cursor shown after each hover.
export async function dragWithKeys(
  source: HTMLElement,
  target: HTMLElement,
  hovers: DragKeys[],
  drop: DragKeys | null = hovers.at(-1) ?? {},
): Promise<{ dataTransfer: DataTransfer; cursors: string[] }> {
  const dataTransfer = createMockDataTransfer();
  const cursors: string[] = [];
  await act(async () => {
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragEnter(target, { dataTransfer, ...hovers[0] });
    for (const keys of hovers) {
      fireEvent.dragOver(target, { dataTransfer, ...keys });
      cursors.push(dataTransfer.dropEffect);
    }
    if (drop) {
      fireEvent.drop(target, { dataTransfer, ...drop });
    }
    fireEvent.dragEnd(source, { dataTransfer });
  });
  return { dataTransfer, cursors };
}

export function analyzeRequests(
  harness: ReturnType<typeof createAppHarness>,
): Array<IpcRequestInput<"copyPaste:analyzeStart">> {
  return harness.invocations
    .filter((call) => call.channel === "copyPaste:analyzeStart")
    .map((call) => call.payload as IpcRequestInput<"copyPaste:analyzeStart">);
}

export function missingSourceIssue(sourcePath: string): CopyPasteIssue {
  return {
    code: "source_missing",
    message: `Source does not exist: ${sourcePath}`,
    sourcePath,
    destinationPath: null,
  };
}

// A plan for the request, with `issuesFor` saying which of its items have a problem.
export function planForRequest(
  request: IpcRequestInput<"copyPaste:analyzeStart">,
  issuesFor: (sourcePath: string) => CopyPasteIssue | null,
): NonNullable<IpcResponse<"copyPaste:analyzeGetUpdate">["report"]> {
  const issues = request.sourcePaths.flatMap((path) => {
    const issue = issuesFor(path);
    return issue ? [issue] : [];
  });
  const plan = cutPlan(request.sourcePaths, request.destinationDirectoryPath, issues);
  return toAnalysisReport({ ...plan, mode: request.mode });
}

export function finishedWriteEvent(args: {
  operationId: string;
  action: WriteOperationProgressEvent["action"];
  targetPath: string | null;
  items: Array<{ sourcePath: string | null; destinationPath: string | null }>;
}): WriteOperationProgressEvent {
  const count = args.items.length;
  return {
    operationId: args.operationId,
    action: args.action,
    status: "completed",
    completedItemCount: count,
    totalItemCount: count,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: {
      operationId: args.operationId,
      action: args.action,
      status: "completed",
      targetPath: args.targetPath,
      startedAt: "2026-10-03T10:00:00.000Z",
      finishedAt: "2026-10-03T10:00:01.000Z",
      summary: {
        topLevelItemCount: count,
        totalItemCount: count,
        completedItemCount: count,
        failedItemCount: 0,
        skippedItemCount: 0,
        cancelledItemCount: 0,
        completedByteCount: 0,
        totalBytes: null,
      },
      items: args.items.map((item) => ({ ...item, status: "completed" as const, error: null })),
      error: null,
    },
  };
}

// The end (or the middle) of a rename of several items, as the main process reports it. A
// failed item is locked and a stopped one wasn't started, unless it gives its own reason.
export function batchRenameEvent(
  status: "running" | "completed" | "partial" | "cancelled",
  items: Array<
    [
      source: string,
      destination: string | null,
      status: "completed" | "failed" | "skipped" | "cancelled",
      error?: string,
    ]
  >,
): WriteOperationProgressEvent {
  const completed = items.filter(([, , itemStatus]) => itemStatus === "completed").length;
  const count = (wanted: string) =>
    items.filter(([, , itemStatus]) => itemStatus === wanted).length;
  return {
    operationId: "write-op-batch-rename",
    action: "batch_rename",
    status,
    completedItemCount: completed,
    totalItemCount: items.length,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    result: {
      operationId: "write-op-batch-rename",
      action: "batch_rename",
      status,
      targetPath: "/Users/demo",
      startedAt: "2026-10-04T10:00:00.000Z",
      finishedAt: "2026-10-04T10:00:01.000Z",
      summary: {
        topLevelItemCount: items.length,
        totalItemCount: items.length,
        completedItemCount: completed,
        failedItemCount: count("failed"),
        skippedItemCount: count("skipped"),
        cancelledItemCount: count("cancelled"),
        completedByteCount: 0,
        totalBytes: null,
      },
      items: items.map(([sourcePath, destinationPath, itemStatus, error]) => ({
        sourcePath,
        destinationPath,
        status: itemStatus,
        error:
          error ??
          (itemStatus === "failed"
            ? `“${sourcePath.slice(sourcePath.lastIndexOf("/") + 1)}” is locked.`
            : itemStatus === "cancelled"
              ? "Not started because the operation was stopped."
              : null),
        skipReason: itemStatus === "skipped" ? "runtime_conflict_resolution" : null,
      })),
      error: completed === items.length ? null : "Some items couldn’t be renamed.",
    },
  };
}

export function renderApp(harness: ReturnType<typeof createAppHarness>): void {
  render(
    <FiletrailClientProvider value={harness.client}>
      <App />
    </FiletrailClientProvider>,
  );
}

export async function pressKey(init: KeyboardEventInit & { key: string }): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(window, init);
  });
}

export async function renameSelectionTo(currentName: string, nextName: string): Promise<void> {
  await pressKey({ key: "F2" });
  const renameInput = await screen.findByLabelText(`Rename ${currentName}`);
  await act(async () => {
    fireEvent.change(renameInput, { target: { value: nextName } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
  });
}
