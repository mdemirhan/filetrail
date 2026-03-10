import { copyPasteProgressEventSchema, ipcContractSchemas } from "./ipc";

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
          theme: "dark",
          accent: "gold",
          accentToolbarButtons: false,
          accentFavoriteItems: true,
          accentFavoriteText: false,
          favoriteAccent: "rose",
          zoomPercent: 100,
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
          singleClickExpandTreeItems: false,
          highlightHoveredItems: false,
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
          typeaheadDebounceMs: 1000,
          notificationsEnabled: true,
          notificationDurationSeconds: 4,
          propertiesOpen: false,
          detailRowOpen: true,
          terminalApp: null,
          defaultTextEditor: {
            appPath: "/System/Applications/TextEdit.app",
            appName: "TextEdit",
          },
          openWithApplications: [
            {
              id: "visual-studio-code",
              appPath: "/Applications/Visual Studio Code.app",
              appName: "Visual Studio Code",
            },
            {
              id: "sublime-text",
              appPath: "/Applications/Sublime Text.app",
              appName: "Sublime Text",
            },
            {
              id: "zed",
              appPath: "/Applications/Zed.app",
              appName: "Zed",
            },
          ],
          fileActivationAction: "open",
          openItemLimit: 5,
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
          lastVisitedFavoritePath: null,
          favorites: [],
          favoritesPlacement: "integrated",
          favoritesPaneHeight: null,
          favoritesExpanded: true,
          favoritesInitialized: false,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "dark",
        accent: "gold",
        accentToolbarButtons: false,
        accentFavoriteItems: true,
        accentFavoriteText: false,
        favoriteAccent: "rose",
        zoomPercent: 100,
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
        singleClickExpandTreeItems: false,
        highlightHoveredItems: false,
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
        typeaheadDebounceMs: 1000,
        notificationsEnabled: true,
        notificationDurationSeconds: 4,
        propertiesOpen: false,
        detailRowOpen: true,
        terminalApp: null,
        defaultTextEditor: {
          appPath: "/System/Applications/TextEdit.app",
          appName: "TextEdit",
        },
        openWithApplications: [
          {
            id: "visual-studio-code",
            appPath: "/Applications/Visual Studio Code.app",
            appName: "Visual Studio Code",
          },
          {
            id: "sublime-text",
            appPath: "/Applications/Sublime Text.app",
            appName: "Sublime Text",
          },
          {
            id: "zed",
            appPath: "/Applications/Zed.app",
            appName: "Zed",
          },
        ],
        fileActivationAction: "open",
        openItemLimit: 5,
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
        lastVisitedFavoritePath: null,
        favorites: [],
        favoritesPlacement: "integrated",
        favoritesPaneHeight: null,
        favoritesExpanded: true,
        favoritesInitialized: false,
      },
    });

    expect(
      ipcContractSchemas["app:updatePreferences"].request.parse({
        preferences: {
          theme: "obsidian",
          accent: "lime",
          accentToolbarButtons: false,
          accentFavoriteItems: true,
          accentFavoriteText: true,
          favoriteAccent: "coral",
          zoomPercent: 125,
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
          singleClickExpandTreeItems: true,
          highlightHoveredItems: false,
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
          terminalApp: {
            appPath: "/Applications/iTerm.app",
            appName: "iTerm",
          },
          defaultTextEditor: {
            appPath: "/Applications/Zed.app",
            appName: "Zed",
          },
          openWithApplications: [
            {
              id: "zed",
              appPath: "/Applications/Zed.app",
              appName: "Zed",
            },
          ],
          fileActivationAction: "edit",
          openItemLimit: 12,
          favorites: [
            { path: "/Users/demo/Documents", icon: "documents" },
            { path: "/Applications", icon: "applications" },
          ],
          lastVisitedFavoritePath: "/Users/demo/Documents",
          favoritesPlacement: "separate",
          favoritesPaneHeight: 224,
          favoritesExpanded: false,
          favoritesInitialized: true,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "obsidian",
        accent: "lime",
        accentToolbarButtons: false,
        accentFavoriteItems: true,
        accentFavoriteText: true,
        favoriteAccent: "coral",
        zoomPercent: 125,
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
        singleClickExpandTreeItems: true,
        highlightHoveredItems: false,
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
        terminalApp: {
          appPath: "/Applications/iTerm.app",
          appName: "iTerm",
        },
        defaultTextEditor: {
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
        openWithApplications: [
          {
            id: "zed",
            appPath: "/Applications/Zed.app",
            appName: "Zed",
          },
        ],
        fileActivationAction: "edit",
        openItemLimit: 12,
        favorites: [
          { path: "/Users/demo/Documents", icon: "documents" },
          { path: "/Applications", icon: "applications" },
        ],
        lastVisitedFavoritePath: "/Users/demo/Documents",
        favoritesPlacement: "separate",
        favoritesPaneHeight: 224,
        favoritesExpanded: false,
        favoritesInitialized: true,
      },
    });
  });

  it("validates application picker and open with channels", () => {
    expect(
      ipcContractSchemas["system:pickApplication"].response.parse({
        canceled: false,
        appPath: "/Applications/Zed.app",
        appName: "Zed",
      }),
    ).toEqual({
      canceled: false,
      appPath: "/Applications/Zed.app",
      appName: "Zed",
    });

    expect(
      ipcContractSchemas["system:pickDirectory"].response.parse({
        canceled: false,
        path: "/Users/demo/Folder",
      }),
    ).toEqual({
      canceled: false,
      path: "/Users/demo/Folder",
    });

    expect(
      ipcContractSchemas["system:openPathsWithApplication"].request.parse({
        applicationPath: "Finder",
        paths: ["/Users/demo/file.txt"],
      }),
    ).toEqual({
      applicationPath: "Finder",
      paths: ["/Users/demo/file.txt"],
    });

    expect(
      ipcContractSchemas["system:performEditAction"].request.parse({
        action: "selectAll",
      }),
    ).toEqual({
      action: "selectAll",
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

  it("validates copy/paste planning and progress payloads", () => {
    expect(
      ipcContractSchemas["copyPaste:plan"].response.parse({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/target",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/target/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 42,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 42,
          skippedConflictCount: 0,
        },
        canExecute: true,
      }),
    ).toEqual(
      expect.objectContaining({
        mode: "copy",
        canExecute: true,
      }),
    );

    expect(
      copyPasteProgressEventSchema.parse({
        operationId: "copy-op-1",
        mode: "copy",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 42,
        totalBytes: 42,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/target",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 42,
            totalBytes: 42,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/target/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        operationId: "copy-op-1",
        status: "completed",
      }),
    );
  });
});
