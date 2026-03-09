import { ipcContractSchemas } from "./ipc";

describe("ipc contracts", () => {
  it("validates the folder size placeholder channels", () => {
    expect(
      ipcContractSchemas["folderSize:start"].response.parse({
        jobId: "job-1",
        status: "deferred",
      }),
    ).toEqual({
      jobId: "job-1",
      status: "deferred",
    });

    expect(() =>
      ipcContractSchemas["folderSize:getStatus"].response.parse({
        jobId: "job-1",
        status: "unknown",
        sizeBytes: null,
        error: null,
      }),
    ).toThrow();
  });

  it("defaults directory snapshot sorting to name ascending", () => {
    const parsed = ipcContractSchemas["directory:getSnapshot"].request.parse({
      path: "/Users/demo",
    });
    expect(parsed.sortBy).toBe("name");
    expect(parsed.sortDirection).toBe("asc");
    expect(parsed.foldersFirst).toBe(true);
  });

  it("validates app preference payloads", () => {
    expect(
      ipcContractSchemas["app:getPreferences"].response.parse({
        preferences: {
          theme: "tomorrow-night",
          uiFontFamily: "lexend",
          uiFontSize: 13,
          uiFontWeight: 500,
          textPrimaryOverride: "#ffffff",
          textSecondaryOverride: "#cccccc",
          textMutedOverride: "#999999",
          viewMode: "list",
          foldersFirst: true,
          compactListView: false,
          compactDetailsView: false,
          compactTreeView: false,
          detailColumns: {
            size: true,
            modified: true,
            permissions: true,
          },
          detailColumnWidths: {
            name: 320,
            size: 108,
            modified: 168,
            permissions: 148,
          },
          tabSwitchesExplorerPanes: true,
          typeaheadEnabled: true,
          typeaheadDebounceMs: 750,
          propertiesOpen: true,
          detailRowOpen: true,
          terminalApp: null,
          includeHidden: false,
          searchPatternMode: "regex",
          searchMatchScope: "name",
          searchRecursive: true,
          searchIncludeHidden: false,
          searchResultsSortBy: "path",
          searchResultsSortDirection: "asc",
          searchResultsFilterScope: "name",
          treeWidth: 280,
          inspectorWidth: 320,
          restoreLastVisitedFolderOnStartup: false,
          treeRootPath: null,
          lastVisitedPath: null,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "tomorrow-night",
        uiFontFamily: "lexend",
        uiFontSize: 13,
        uiFontWeight: 500,
        textPrimaryOverride: "#ffffff",
        textSecondaryOverride: "#cccccc",
        textMutedOverride: "#999999",
        viewMode: "list",
        foldersFirst: true,
        compactListView: false,
        compactDetailsView: false,
        compactTreeView: false,
        detailColumns: {
          size: true,
          modified: true,
          permissions: true,
        },
        detailColumnWidths: {
          name: 320,
          size: 108,
          modified: 168,
          permissions: 148,
        },
        tabSwitchesExplorerPanes: true,
        typeaheadEnabled: true,
        typeaheadDebounceMs: 750,
        propertiesOpen: true,
        detailRowOpen: true,
        terminalApp: null,
        includeHidden: false,
        searchPatternMode: "regex",
        searchMatchScope: "name",
        searchRecursive: true,
        searchIncludeHidden: false,
        searchResultsSortBy: "path",
        searchResultsSortDirection: "asc",
        searchResultsFilterScope: "name",
        treeWidth: 280,
        inspectorWidth: 320,
        restoreLastVisitedFolderOnStartup: false,
        treeRootPath: null,
        lastVisitedPath: null,
      },
    });

    expect(
      ipcContractSchemas["app:updatePreferences"].request.parse({
        preferences: {
          theme: "dark",
          uiFontFamily: "fira-code",
          uiFontSize: 14,
          uiFontWeight: 400,
          textPrimaryOverride: null,
          includeHidden: true,
          searchPatternMode: "glob",
          searchMatchScope: "path",
          searchRecursive: false,
          searchIncludeHidden: true,
          searchResultsSortBy: "name",
          searchResultsSortDirection: "desc",
          searchResultsFilterScope: "path",
          foldersFirst: false,
          compactListView: true,
          compactDetailsView: true,
          compactTreeView: true,
          detailColumns: {
            size: true,
            modified: false,
            permissions: true,
          },
          detailColumnWidths: {
            name: 360,
            size: 120,
            modified: 180,
            permissions: 160,
          },
          tabSwitchesExplorerPanes: false,
          typeaheadEnabled: false,
          typeaheadDebounceMs: 1000,
          terminalApp: "iTerm",
        },
      }),
    ).toEqual({
      preferences: {
        theme: "dark",
        uiFontFamily: "fira-code",
        uiFontSize: 14,
        uiFontWeight: 400,
        textPrimaryOverride: null,
        includeHidden: true,
        searchPatternMode: "glob",
        searchMatchScope: "path",
        searchRecursive: false,
        searchIncludeHidden: true,
        searchResultsSortBy: "name",
        searchResultsSortDirection: "desc",
        searchResultsFilterScope: "path",
        foldersFirst: false,
        compactListView: true,
        compactDetailsView: true,
        compactTreeView: true,
        detailColumns: {
          size: true,
          modified: false,
          permissions: true,
        },
        detailColumnWidths: {
          name: 360,
          size: 120,
          modified: 180,
          permissions: 160,
        },
        tabSwitchesExplorerPanes: false,
        typeaheadEnabled: false,
        typeaheadDebounceMs: 1000,
        terminalApp: "iTerm",
      },
    });
  });

  it("validates launch context payloads", () => {
    expect(
      ipcContractSchemas["app:getLaunchContext"].response.parse({
        startupFolderPath: "/Users/demo/project",
      }),
    ).toEqual({
      startupFolderPath: "/Users/demo/project",
    });

    expect(
      ipcContractSchemas["app:getLaunchContext"].response.parse({
        startupFolderPath: null,
      }),
    ).toEqual({
      startupFolderPath: null,
    });
  });

  it("validates directory metadata rows with permissions", () => {
    expect(
      ipcContractSchemas["directory:getMetadataBatch"].response.parse({
        directoryPath: "/Users/demo",
        items: [
          {
            path: "/Users/demo/file.txt",
            kindLabel: "TXT File",
            modifiedAt: "2026-03-09T00:00:00.000Z",
            sizeBytes: 42,
            sizeStatus: "ready",
            permissionMode: 0o644,
          },
        ],
      }),
    ).toEqual({
      directoryPath: "/Users/demo",
      items: [
        {
          path: "/Users/demo/file.txt",
          kindLabel: "TXT File",
          modifiedAt: "2026-03-09T00:00:00.000Z",
          sizeBytes: 42,
          sizeStatus: "ready",
          permissionMode: 0o644,
        },
      ],
    });
  });

  it("validates path suggestion responses", () => {
    expect(
      ipcContractSchemas["path:getSuggestions"].response.parse({
        inputPath: "/Users/demo/Do",
        basePath: "/Users/demo",
        suggestions: [{ path: "/Users/demo/Documents", name: "Documents", isDirectory: true }],
      }),
    ).toEqual({
      inputPath: "/Users/demo/Do",
      basePath: "/Users/demo",
      suggestions: [{ path: "/Users/demo/Documents", name: "Documents", isDirectory: true }],
    });
  });

  it("validates resolved path responses", () => {
    expect(
      ipcContractSchemas["path:resolve"].response.parse({
        inputPath: "/tmp/link",
        resolvedPath: "/tmp/target",
      }),
    ).toEqual({
      inputPath: "/tmp/link",
      resolvedPath: "/tmp/target",
    });
  });

  it("defaults file search requests to regex name matching with recursive search", () => {
    const parsed = ipcContractSchemas["search:start"].request.parse({
      rootPath: "/Users/demo/project",
      query: "*.tsx",
    });

    expect(parsed).toEqual({
      rootPath: "/Users/demo/project",
      query: "*.tsx",
      patternMode: "regex",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
    });
  });

  it("validates search update payloads", () => {
    expect(
      ipcContractSchemas["search:getUpdate"].response.parse({
        jobId: "search-1",
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
        ],
        nextCursor: 1,
        done: false,
        truncated: false,
        error: null,
      }),
    ).toEqual({
      jobId: "search-1",
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
      ],
      nextCursor: 1,
      done: false,
      truncated: false,
      error: null,
    });

    expect(() =>
      ipcContractSchemas["search:getUpdate"].response.parse({
        jobId: "search-1",
        status: "unknown",
        items: [],
        nextCursor: 0,
        done: true,
        truncated: false,
        error: null,
      }),
    ).toThrow();
  });
});
