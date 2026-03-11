import {
  ANALYSIS_BUSY_ERROR,
  createWriteService,
  DEFAULT_COPY_PASTE_POLICY,
  type CopyPasteProgressEvent,
  WRITE_OPERATION_BUSY_ERROR,
} from "./writeService";
import { MockWriteServiceFileSystem } from "./testUtils";

describe("writeService analysis and runtime coordination", () => {
  it("runs and reports a copy/paste analysis job to completion", async () => {
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      }),
    });

    const handle = service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    expect(handle).toEqual({
      analysisId: "analysis-1",
      status: "queued",
    });

    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1")).toMatchObject({
        status: "complete",
        done: true,
        report: expect.objectContaining({
          destinationDirectoryPath: "/target",
        }),
      });
    });
  });

  it("cancels in-flight analysis jobs", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/folder": { kind: "directory" },
      "/source/folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.readdirImpl = async (path) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return path === "/source/folder" ? ["file.txt"] : ["folder"];
    };
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      fileSystem,
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/folder"],
      destinationDirectoryPath: "/target",
    });
    expect(service.cancelCopyPasteAnalysis("analysis-1")).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1")).toMatchObject({
        status: "cancelled",
        done: true,
      });
    });
  });

  it("starts execution from an existing analysis id and resolves runtime conflicts", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      createOperationId: () => "copy-op-1",
      fileSystem,
    });
    const events: Array<{ operationId: string; status: string; conflictId: string | null }> = [];
    service.subscribe((event) => {
      events.push({
        operationId: event.operationId,
        status: event.status,
        conflictId: event.runtimeConflict?.conflictId ?? null,
      });
      if (event.status === "awaiting_resolution" && event.runtimeConflict) {
        setTimeout(() => {
          service.resolveRuntimeConflict(
            event.operationId,
            event.runtimeConflict!.conflictId,
            "overwrite",
          );
        }, 0);
      }
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1").status).toBe("complete");
    });

    fileSystem.addFile("/target/file.txt", { size: 99 });
    expect(
      service.startCopyPaste({
        analysisId: "analysis-1",
        policy: DEFAULT_COPY_PASTE_POLICY,
      }),
    ).toEqual({
      operationId: "copy-op-1",
      status: "queued",
    });

    await vi.waitFor(() => {
      expect(
        events.some((event) => event.operationId === "copy-op-1" && event.status === "completed"),
      ).toBe(true);
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: "copy-op-1",
          status: "awaiting_resolution",
        }),
        expect.objectContaining({
          operationId: "copy-op-1",
          status: "completed",
        }),
      ]),
    );
    expect(fileSystem.readNode("/target/file.txt")?.size).toBe(5);
  });

  it("rejects runtime conflict resolutions for unknown conflicts", () => {
    const service = createWriteService();

    expect(service.resolveRuntimeConflict("missing-op", "missing-conflict", "skip")).toEqual({
      ok: false,
    });
    expect(service.cancelCopyPasteAnalysis("missing-analysis")).toEqual({ ok: false });
    expect(service.cancelOperation("missing-op")).toEqual({ ok: false });
    expect(() => service.getCopyPasteAnalysisUpdate("missing-analysis")).toThrow(
      "Unknown copy/paste analysis job: missing-analysis",
    );
  });

  it("reports analysis errors and rejects execution for unknown analysis ids", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/folder": { kind: "directory" },
      "/target": { kind: "directory" },
    });
    fileSystem.readdirImpl = async () => {
      throw new Error("readdir failed");
    };
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      fileSystem,
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/folder"],
      destinationDirectoryPath: "/target",
    });

    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1")).toMatchObject({
        status: "error",
        done: true,
        error: "readdir failed",
      });
    });

    expect(() =>
      service.startCopyPaste({
        analysisId: "missing-analysis",
        policy: DEFAULT_COPY_PASTE_POLICY,
      }),
    ).toThrow("Unknown copy/paste analysis job: missing-analysis");
  });

  it("rejects starting a second analysis while another analysis is still running", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/folder": { kind: "directory" },
      "/source/folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.readdirImpl = async (path) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return path === "/source/folder" ? ["file.txt"] : ["folder"];
    };
    const service = createWriteService({
      createAnalysisId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `analysis-${index}`;
        };
      })(),
      fileSystem,
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/folder"],
      destinationDirectoryPath: "/target",
    });

    expect(() =>
      service.startCopyPasteAnalysis({
        mode: "copy",
        sourcePaths: ["/source/folder"],
        destinationDirectoryPath: "/target",
      }),
    ).toThrow(ANALYSIS_BUSY_ERROR);
  });

  it("rejects starting analysis while a write operation is active", async () => {
    const service = createWriteService({
      createOperationId: () => "copy-op-1",
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      }),
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    expect(() =>
      service.startCopyPasteAnalysis({
        mode: "copy",
        sourcePaths: ["/source/file.txt"],
        destinationDirectoryPath: "/target",
      }),
    ).toThrow(WRITE_OPERATION_BUSY_ERROR);
  });

  it("prunes terminal analysis jobs when a new analysis starts", async () => {
    const service = createWriteService({
      createAnalysisId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `analysis-${index}`;
        };
      })(),
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      }),
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1").status).toBe("complete");
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    expect(() => service.getCopyPasteAnalysisUpdate("analysis-1")).toThrow(
      "Unknown copy/paste analysis job: analysis-1",
    );
  });

  it("cancels operations that are paused on a runtime conflict and supports legacy skip requests", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      createOperationId: () => "copy-op-1",
      fileSystem,
    });
    const statuses: string[] = [];
    service.subscribe((event) => {
      statuses.push(event.status);
      if (event.status === "awaiting_resolution") {
        setTimeout(() => {
          service.cancelOperation(event.operationId);
        }, 0);
      }
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1").status).toBe("complete");
    });
    fileSystem.addFile("/target/file.txt", { size: 99 });

    service.startCopyPaste({
      analysisId: "analysis-1",
      policy: DEFAULT_COPY_PASTE_POLICY,
    });

    await vi.waitFor(() => {
      expect(statuses).toContain("cancelled");
    });

    const legacyService = createWriteService({
      createOperationId: () => "legacy-op-1",
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/file.txt": { kind: "file", size: 1 },
      }),
    });
    const legacyEvents: string[] = [];
    legacyService.subscribe((event) => {
      legacyEvents.push(event.status);
    });

    legacyService.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      conflictResolution: "skip",
    });

    await vi.waitFor(() => {
      expect(legacyEvents).toContain("partial");
    });
  });

  it("fails legacy error requests instead of silently skipping analysis-time conflicts", async () => {
    const service = createWriteService({
      createOperationId: () => "legacy-error-op",
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/file.txt": { kind: "file", size: 1 },
      }),
    });
    const statuses: string[] = [];
    service.subscribe((event) => {
      statuses.push(event.status);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      conflictResolution: "error",
    });

    await vi.waitFor(() => {
      expect(statuses).toContain("failed");
    });
  });

  it("reports the correct failed item count for pre-execution legacy failures", async () => {
    const events: CopyPasteProgressEvent[] = [];
    const service = createWriteService({
      createOperationId: () => "legacy-error-op",
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/one.txt": { kind: "file", size: 5 },
        "/source/two.txt": { kind: "file", size: 7 },
        "/target": { kind: "directory" },
        "/target/one.txt": { kind: "file", size: 1 },
        "/target/two.txt": { kind: "file", size: 1 },
      }),
    });
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/one.txt", "/source/two.txt"],
      destinationDirectoryPath: "/target",
      conflictResolution: "error",
    });

    await vi.waitFor(() => {
      const terminal = events.find((event) => event.status === "failed");
      expect(terminal?.result?.summary.failedItemCount).toBe(2);
      expect(terminal?.result?.items).toHaveLength(2);
    });
  });

  it("fails legacy error requests when a runtime conflict appears after analysis", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      createOperationId: () => "legacy-runtime-op",
      fileSystem,
    });
    const terminalStatuses: string[] = [];
    service.subscribe((event) => {
      if (event.operationId === "legacy-runtime-op") {
        terminalStatuses.push(event.status);
      }
    });

    let destinationSeenMissing = false;
    const callThroughLstat = async (path: string) => {
      const currentOverride = fileSystem.lstatImpl;
      fileSystem.lstatImpl = null;
      try {
        return await fileSystem.lstat(path);
      } finally {
        fileSystem.lstatImpl = currentOverride;
      }
    };
    fileSystem.lstatImpl = async (path) => {
      if (path === "/target/file.txt" && !destinationSeenMissing) {
        destinationSeenMissing = true;
        const error = new Error(`ENOENT: no such file or directory, lstat '${path}'`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      if (path === "/target/file.txt" && !fileSystem.exists(path)) {
        fileSystem.addFile(path, { size: 99 });
      }
      return callThroughLstat(path);
    };

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      conflictResolution: "error",
    });

    await vi.waitFor(() => {
      expect(terminalStatuses).toContain("failed");
    });
  });

  it("emits a terminal cancelled event when legacy inline analysis is aborted", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/folder": { kind: "directory" },
      "/source/folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.readdirImpl = async (path) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return path === "/source/folder" ? ["file.txt"] : ["folder"];
    };
    const service = createWriteService({
      createOperationId: () => "legacy-cancel-op",
      fileSystem,
    });
    const statuses: string[] = [];
    service.subscribe((event) => {
      if (event.operationId === "legacy-cancel-op") {
        statuses.push(event.status);
      }
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/folder"],
      destinationDirectoryPath: "/target",
      conflictResolution: "skip",
    });
    expect(service.cancelOperation("legacy-cancel-op")).toEqual({ ok: true });

    await vi.waitFor(() => {
      expect(statuses).toContain("cancelled");
    });
  });

  it("isolates listener failures so later subscribers still receive terminal events", async () => {
    const service = createWriteService({
      createOperationId: () => "listener-op",
      fileSystem: new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      }),
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const observedStatuses: string[] = [];

    service.subscribe(() => {
      throw new Error("listener boom");
    });
    service.subscribe((event) => {
      observedStatuses.push(event.status);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      conflictResolution: "skip",
    });

    await vi.waitFor(() => {
      expect(observedStatuses).toContain("completed");
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
