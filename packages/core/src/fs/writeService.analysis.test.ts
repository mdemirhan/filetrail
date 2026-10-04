import { MockWriteServiceFileSystem } from "./testUtils";
import {
  ANALYSIS_BUSY_ERROR,
  type CopyPasteProgressEvent,
  DEFAULT_COPY_PASTE_POLICY,
  WRITE_OPERATION_BUSY_ERROR,
  createWriteService,
} from "./writeService";

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
        const conflictId = event.runtimeConflict.conflictId;
        setTimeout(() => {
          service.resolveRuntimeConflict(event.operationId, conflictId, "overwrite");
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
      "/source/file.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
      "/target/file.txt": { kind: "file", size: 1 },
    });
    // No name for "Keep Both" can be checked, so none can be offered.
    fileSystem.lstatImpl = async (path) => {
      if (path.startsWith("/target/file copy")) {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      }
      return fileSystem.stat(path);
    };
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
      fileSystem,
    });

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1")).toMatchObject({
        status: "error",
        done: true,
        error: "Couldn't find a free name for “file.txt”.",
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
      createAnalysisId: () => "analysis-1",
      createOperationId: () => "copy-op-1",
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
    service.startCopyPaste({ analysisId: "analysis-1", policy: DEFAULT_COPY_PASTE_POLICY });

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

  it("cancels operations that are paused on a runtime conflict", async () => {
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
  });

  it("isolates listener failures so later subscribers still receive terminal events", async () => {
    const service = createWriteService({
      createAnalysisId: () => "analysis-1",
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

    service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate("analysis-1").status).toBe("complete");
    });
    service.startCopyPaste({ analysisId: "analysis-1", policy: DEFAULT_COPY_PASTE_POLICY });

    await vi.waitFor(() => {
      expect(observedStatuses).toContain("completed");
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
