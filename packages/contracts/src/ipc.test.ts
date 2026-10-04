import { copyPasteProgressEventSchema, ipcContractSchemas } from "./ipc";

describe("ipc contracts", () => {
  it("accepts per-item review choices and standing runtime answers", () => {
    expect(
      ipcContractSchemas["copyPaste:start"].request.parse({
        analysisId: "analysis-1",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
        overrides: [{ nodeId: "item-1", action: "overwrite" }],
      }),
    ).toMatchObject({ overrides: [{ nodeId: "item-1", action: "overwrite" }] });
    expect(
      ipcContractSchemas["copyPaste:resolveConflict"].request.parse({
        operationId: "copy-op-1",
        conflictId: "runtime-item-1-destination",
        resolution: "keep_both",
        applyToRemaining: true,
      }),
    ).toMatchObject({ applyToRemaining: true });
  });

  it("validates renderer log payloads", () => {
    expect(
      ipcContractSchemas["app:writeLog"].request.parse({
        level: "error",
        namespace: "filetrail.renderer",
        message: "directory navigation failed",
        error: "ENOENT",
        context: {
          path: "/Users/demo/missing",
          retryCount: 1,
          flags: ["initial-load"],
        },
      }),
    ).toEqual({
      level: "error",
      namespace: "filetrail.renderer",
      message: "directory navigation failed",
      error: "ENOENT",
      context: {
        path: "/Users/demo/missing",
        retryCount: 1,
        flags: ["initial-load"],
      },
    });
  });

  it("rejects rename and new folder names that would escape the parent directory", () => {
    const rename = ipcContractSchemas["writeOperation:rename"].request;
    const createFolder = ipcContractSchemas["writeOperation:createFolder"].request;

    expect(rename.parse({ sourcePath: "/Users/demo/a.txt", destinationName: " b.txt " })).toEqual({
      sourcePath: "/Users/demo/a.txt",
      destinationName: "b.txt",
    });
    for (const destinationName of ["../b.txt", "sub/b.txt", "..", "."]) {
      expect(rename.safeParse({ sourcePath: "/Users/demo/a.txt", destinationName }).success).toBe(
        false,
      );
    }
    for (const folderName of ["../../Library/LaunchAgents", "a/b", ".."]) {
      expect(
        createFolder.safeParse({ parentDirectoryPath: "/Users/demo", folderName }).success,
      ).toBe(false);
    }
  });

  it("refuses names longer than 255 bytes with a plain message", () => {
    const rename = ipcContractSchemas["writeOperation:rename"].request;
    // 100 characters, 300 bytes.
    const result = rename.safeParse({
      sourcePath: "/Users/demo/a.txt",
      destinationName: "日".repeat(100),
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(["The name is too long."]);
    expect(
      rename.safeParse({ sourcePath: "/Users/demo/a.txt", destinationName: "日".repeat(85) })
        .success,
    ).toBe(true);
  });

  it("only accepts absolute paths for copies, renames, new folders, and deletes", () => {
    const relative = "Documents/a.txt";
    const requests = [
      [
        "copyPaste:analyzeStart",
        { mode: "copy", sourcePaths: [relative], destinationDirectoryPath: "/x" },
      ],
      [
        "copyPaste:analyzeStart",
        { mode: "copy", sourcePaths: ["/a"], destinationDirectoryPath: "x" },
      ],
      ["copyPaste:plan", { mode: "cut", sourcePaths: [relative], destinationDirectoryPath: "/x" }],
      ["copyPaste:start", { mode: "copy", sourcePaths: ["/a"], destinationDirectoryPath: "x" }],
      ["writeOperation:rename", { sourcePath: relative, destinationName: "b.txt" }],
      ["writeOperation:createFolder", { parentDirectoryPath: "Documents", folderName: "New" }],
      ["writeOperation:trash", { paths: ["/Users/demo/a.txt", relative] }],
      ["writeOperation:deleteImmediately", { paths: [relative] }],
    ] as const;

    for (const [channel, payload] of requests) {
      expect(ipcContractSchemas[channel].request.safeParse(payload).success, channel).toBe(false);
      const absolute = JSON.parse(
        JSON.stringify(payload).replaceAll('"Documents', '"/Documents').replaceAll('"x"', '"/x"'),
      );
      expect(ipcContractSchemas[channel].request.safeParse(absolute).success, channel).toBe(true);
    }
  });

  it("refuses a path with a null character, which macOS would cut short", () => {
    expect(
      ipcContractSchemas["writeOperation:trash"].request.safeParse({
        paths: ["/Users/demo\0/a.txt"],
      }).success,
    ).toBe(false);
  });

  // Selecting everything in a large folder is ordinary; it used to fail past 500 items.
  it("takes thousands of items in one request and in the reports sent back", () => {
    const paths = Array.from({ length: 20_000 }, (_, index) => `/Users/demo/f${index}.txt`);

    expect(ipcContractSchemas["writeOperation:trash"].request.safeParse({ paths }).success).toBe(
      true,
    );
    expect(
      ipcContractSchemas["writeOperation:deleteImmediately"].request.safeParse({ paths }).success,
    ).toBe(true);
    expect(
      ipcContractSchemas["copyPaste:analyzeStart"].request.safeParse({
        mode: "copy",
        sourcePaths: paths,
        destinationDirectoryPath: "/x",
      }).success,
    ).toBe(true);
    expect(
      ipcContractSchemas["copyPaste:analyzeGetUpdate"].response.safeParse({
        analysisId: "analysis-1",
        status: "complete",
        done: true,
        error: null,
        report: {
          analysisId: "analysis-1",
          mode: "copy",
          sourcePaths: paths,
          destinationDirectoryPath: "/x",
          nodes: [],
          issues: [],
          warnings: [],
          summary: {
            topLevelItemCount: 0,
            totalNodeCount: 0,
            totalBytes: 0,
            fileConflictCount: 0,
            directoryConflictCount: 0,
            mismatchConflictCount: 0,
            blockedCount: 0,
          },
        },
      }).success,
    ).toBe(true);
  });

  it("takes an item dated before 1970", () => {
    const fingerprint = {
      exists: true,
      kind: "file",
      size: 1,
      // 1 January 1950; HFS dates go back to 1904.
      mtimeMs: -631152000000,
      mode: 0o644,
      ino: 1,
      dev: 1,
      symlinkTarget: null,
    };
    expect(
      ipcContractSchemas["copyPaste:analyzeGetUpdate"].response.safeParse({
        analysisId: "analysis-1",
        status: "complete",
        done: true,
        error: null,
        report: {
          analysisId: "analysis-1",
          mode: "copy",
          sourcePaths: ["/a.txt"],
          destinationDirectoryPath: "/x",
          nodes: [
            {
              id: "item-1",
              sourcePath: "/a.txt",
              destinationPath: "/x/a.txt",
              sourceKind: "file",
              destinationKind: "missing",
              disposition: "new",
              conflictClass: null,
              sourceFingerprint: fingerprint,
              destinationFingerprint: { ...fingerprint, exists: false, kind: "missing" },
              children: [],
              issueCode: null,
              issueMessage: null,
              totalNodeCount: 1,
              conflictNodeCount: 0,
              destinationTotalNodeCount: null,
              keepBothDestinationPath: null,
              destinationOnly: null,
              replaceBlockedReason: null,
            },
          ],
          issues: [],
          warnings: [],
          summary: {
            topLevelItemCount: 1,
            totalNodeCount: 1,
            totalBytes: 1,
            fileConflictCount: 0,
            directoryConflictCount: 0,
            mismatchConflictCount: 0,
            blockedCount: 0,
          },
        },
      }).success,
    ).toBe(true);
  });

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

    expect(
      ipcContractSchemas["folderSize:getStatus"].response.parse({
        jobId: "job-1",
        status: "ready",
        sizeBytes: 1000,
        diskBytes: 1200,
        fileCount: 42,
        folderCount: 3,
        error: null,
      }),
    ).toEqual({
      jobId: "job-1",
      status: "ready",
      sizeBytes: 1000,
      diskBytes: 1200,
      fileCount: 42,
      folderCount: 3,
      error: null,
    });

    expect(() =>
      ipcContractSchemas["folderSize:getStatus"].response.parse({
        jobId: "job-1",
        status: "unknown",
        sizeBytes: null,
        diskBytes: null,
        fileCount: null,
        folderCount: null,
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

  it("names a copy made by dragging as a copy, not a paste", () => {
    expect(
      ipcContractSchemas["copyPaste:analyzeStart"].request.parse({
        mode: "copy",
        sourcePaths: ["/Users/demo/a.txt"],
        destinationDirectoryPath: "/Volumes/Backup",
        action: "copy_to",
      }).action,
    ).toBe("copy_to");
    expect(
      ipcContractSchemas["copyPaste:start"].request.parse({
        analysisId: "analysis-1",
        action: "copy_to",
        policy: { file: "skip", directory: "skip", mismatch: "skip" },
      }).action,
    ).toBe("copy_to");
  });

  it("accepts overwrite as a folder conflict policy", () => {
    expect(
      ipcContractSchemas["copyPaste:start"].request.parse({
        analysisId: "analysis-1",
        action: "paste",
        policy: {
          file: "skip",
          directory: "overwrite",
          mismatch: "skip",
        },
      }),
    ).toEqual({
      analysisId: "analysis-1",
      action: "paste",
      policy: {
        file: "skip",
        directory: "overwrite",
        mismatch: "skip",
      },
    });
  });

  it("takes a column order only with each optional column once", () => {
    const update = ipcContractSchemas["app:updatePreferences"].request;
    const parse = (detailColumnOrder: unknown) =>
      update.safeParse({ preferences: { detailColumnOrder } }).success;
    expect(parse(["permissions", "kind", "size", "modified", "created"])).toBe(true);
    expect(parse(["kind", "kind", "size", "modified", "created"])).toBe(false);
    expect(parse(["kind", "size", "modified", "created"])).toBe(false);
    expect(parse(["name", "kind", "size", "modified", "created"])).toBe(false);
  });

  it("validates app preference payloads", () => {
    expect(
      ipcContractSchemas["app:getPreferences"].response.parse({
        preferences: {
          theme: "dark",
          returnKeyAction: "rename",
          shortcutOverrides: { newTab: ["Cmd+Option+N"], duplicateSelection: [] },
          accent: "#daa520",
          zoomPercent: 100,
          viewMode: "list",
          searchViewMode: "details",
          sortBy: "name",
          sortDirection: "asc",
          foldersFirst: true,
          compactListView: false,
          compactDetailsView: false,
          compactIconView: false,
          compactTreeView: false,
          singleClickExpandTreeItems: false,
          detailColumns: {
            size: true,
            modified: true,
            permissions: true,
            kind: true,
            created: false,
          },
          detailColumnOrder: ["modified", "size", "kind", "created", "permissions"],
          detailColumnWidths: {
            name: 320,
            size: 108,
            modified: 168,
            permissions: 148,
            kind: 148,
            created: 168,
          },
          searchColumns: {
            folder: true,
            modified: true,
            size: true,
            kind: false,
            created: false,
            permissions: false,
          },
          searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
          searchColumnWidths: {
            name: 300,
            folder: 240,
            modified: 152,
            size: 108,
            kind: 148,
            created: 152,
            permissions: 108,
          },
          notificationsEnabled: true,
          markClipboardItems: true,
          folderTreeOpen: true,
          propertiesOpen: false,
          detailRowOpen: true,
          topToolbarItems: ["back", "forward", "up", "refresh", "title", "view", "sort", "search"],
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
          searchSkipGitFolders: true,
          searchSkipGitIgnored: false,
          searchResultsSortBy: "path",
          searchResultsSortDirection: "asc",
          treeWidth: 280,
          inspectorWidth: 320,
          restoreSessionOnStartup: true,
          openTabs: [],
          activeTabIndex: 0,
          treeRootPath: null,
          lastVisitedPath: null,
          lastVisitedFavoritePath: null,
          favorites: [],
          favoritesPlacement: "integrated",
          favoritesExpanded: true,
          favoritesInitialized: false,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "dark",
        returnKeyAction: "rename",
        shortcutOverrides: { newTab: ["Cmd+Option+N"], duplicateSelection: [] },
        accent: "#daa520",
        zoomPercent: 100,
        viewMode: "list",
        searchViewMode: "details",
        sortBy: "name",
        sortDirection: "asc",
        foldersFirst: true,
        compactListView: false,
        compactDetailsView: false,
        compactIconView: false,
        compactTreeView: false,
        singleClickExpandTreeItems: false,
        detailColumns: {
          size: true,
          modified: true,
          permissions: true,
          kind: true,
          created: false,
        },
        detailColumnOrder: ["modified", "size", "kind", "created", "permissions"],
        detailColumnWidths: {
          name: 320,
          size: 108,
          modified: 168,
          permissions: 148,
          kind: 148,
          created: 168,
        },
        searchColumns: {
          folder: true,
          modified: true,
          size: true,
          kind: false,
          created: false,
          permissions: false,
        },
        searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
        searchColumnWidths: {
          name: 300,
          folder: 240,
          modified: 152,
          size: 108,
          kind: 148,
          created: 152,
          permissions: 108,
        },
        notificationsEnabled: true,
        markClipboardItems: true,
        folderTreeOpen: true,
        propertiesOpen: false,
        detailRowOpen: true,
        topToolbarItems: ["back", "forward", "up", "refresh", "title", "view", "sort", "search"],
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
        searchSkipGitFolders: true,
        searchSkipGitIgnored: false,
        searchResultsSortBy: "path",
        searchResultsSortDirection: "asc",
        treeWidth: 280,
        inspectorWidth: 320,
        restoreSessionOnStartup: true,
        openTabs: [],
        activeTabIndex: 0,
        treeRootPath: null,
        lastVisitedPath: null,
        lastVisitedFavoritePath: null,
        favorites: [],
        favoritesPlacement: "integrated",
        favoritesExpanded: true,
        favoritesInitialized: false,
      },
    });

    expect(
      ipcContractSchemas["app:updatePreferences"].request.parse({
        preferences: {
          theme: "light",
          accent: "#84b840",
          zoomPercent: 125,
          viewMode: "details",
          searchViewMode: "details",
          sortBy: "modified",
          sortDirection: "desc",
          includeHidden: true,
          searchPatternMode: "glob",
          searchMatchScope: "path",
          searchRecursive: false,
          searchSkipGitFolders: true,
          searchSkipGitIgnored: false,
          searchResultsSortBy: "name",
          searchResultsSortDirection: "desc",
          foldersFirst: false,
          compactListView: true,
          compactDetailsView: true,
          compactIconView: true,
          compactTreeView: true,
          singleClickExpandTreeItems: true,
          detailColumns: {
            size: true,
            modified: false,
            permissions: true,
            kind: true,
            created: false,
          },
          detailColumnOrder: ["modified", "size", "kind", "created", "permissions"],
          detailColumnWidths: {
            name: 360,
            size: 120,
            modified: 180,
            permissions: 160,
            kind: 148,
            created: 168,
          },
          searchColumns: {
            folder: true,
            modified: true,
            size: true,
            kind: false,
            created: false,
            permissions: false,
          },
          searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
          searchColumnWidths: {
            name: 300,
            folder: 240,
            modified: 152,
            size: 108,
            kind: 148,
            created: 152,
            permissions: 108,
          },
          topToolbarItems: ["back", "search", "copyPath"],
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
          favoritesExpanded: false,
          favoritesInitialized: true,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "light",
        accent: "#84b840",
        zoomPercent: 125,
        viewMode: "details",
        searchViewMode: "details",
        sortBy: "modified",
        sortDirection: "desc",
        includeHidden: true,
        searchPatternMode: "glob",
        searchMatchScope: "path",
        searchRecursive: false,
        searchSkipGitFolders: true,
        searchSkipGitIgnored: false,
        searchResultsSortBy: "name",
        searchResultsSortDirection: "desc",
        foldersFirst: false,
        compactListView: true,
        compactDetailsView: true,
        compactIconView: true,
        compactTreeView: true,
        singleClickExpandTreeItems: true,
        detailColumns: {
          size: true,
          modified: false,
          permissions: true,
          kind: true,
          created: false,
        },
        detailColumnOrder: ["modified", "size", "kind", "created", "permissions"],
        detailColumnWidths: {
          name: 360,
          size: 120,
          modified: 180,
          permissions: 160,
          kind: 148,
          created: 168,
        },
        searchColumns: {
          folder: true,
          modified: true,
          size: true,
          kind: false,
          created: false,
          permissions: false,
        },
        searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
        searchColumnWidths: {
          name: 300,
          folder: 240,
          modified: 152,
          size: 108,
          kind: 148,
          created: 152,
          permissions: 108,
        },
        topToolbarItems: ["back", "search", "copyPath"],
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
            createdAt: null,
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
          createdAt: null,
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

  it("defaults search requests to plain-text name matching with recursive search", () => {
    const parsed = ipcContractSchemas["search:start"].request.parse({
      rootPath: "/Users/demo/project",
      query: "*.tsx",
    });

    expect(parsed).toEqual({
      rootPath: "/Users/demo/project",
      query: "*.tsx",
      patternMode: "text",
      matchScope: "name",
      recursive: true,
      includeHidden: false,
      skipGitFolders: true,
      skipGitIgnored: false,
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
