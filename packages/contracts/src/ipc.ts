import { z } from "zod";

// These schemas are the single source of truth for renderer <-> main IPC payloads.
// Keep the runtime validators and the inferred TypeScript types aligned here so the
// transport contract cannot silently drift between processes.
export const explorerEntryKindSchema = z.enum([
  "directory",
  "file",
  "symlink_directory",
  "symlink_file",
  "other",
]);

export const themeModeSchema = z.enum([
  "dark",
  "tomorrow-night",
  "catppuccin-mocha",
  "obsidian",
  "graphite",
  "midnight",
  "onyx",
  "light",
  "clean-white",
  "warm-paper",
  "stone",
  "sand",
]);
export const accentModeSchema = z.enum([
  "gold",
  "teal",
  "blue",
  "violet",
  "rose",
  "emerald",
  "copper",
  "sky",
  "lavender",
  "coral",
  "indigo",
  "lime",
]);
export const uiFontFamilySchema = z.enum(["dm-sans", "lexend", "fira-code", "jetbrains-mono"]);
export const colorOverrideSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable();
export const explorerViewModeSchema = z.enum(["list", "details"]);
export const directorySortBySchema = z.enum(["name", "modified", "kind", "size"]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);
export const searchPatternModeSchema = z.enum(["glob", "regex"]);
export const searchMatchScopeSchema = z.enum(["name", "path"]);
export const searchResultsSortBySchema = z.enum(["name", "path"]);
export const searchResultsFilterScopeSchema = z.enum(["name", "path"]);
export const detailColumnVisibilitySchema = z.object({
  size: z.boolean(),
  modified: z.boolean(),
  permissions: z.boolean(),
});
export const detailColumnWidthsSchema = z.object({
  name: z.number().int().min(220).max(720),
  size: z.number().int().min(84).max(240),
  modified: z.number().int().min(132).max(280),
  permissions: z.number().int().min(132).max(260),
});
export const openWithApplicationSchema = z.object({
  id: z.string().trim().min(1),
  appPath: z.string().trim().min(1),
  appName: z.string().trim().min(1),
});
export const favoriteIconIdSchema = z.enum([
  "home",
  "applications",
  "desktop",
  "documents",
  "downloads",
  "trash",
  "folder",
  "star",
  "drive",
  "code",
  "terminal",
  "globe",
  "music",
  "photos",
  "videos",
  "archive",
  "cloud",
  "server",
  "projects",
  "books",
  "camera",
  "toolbox",
  "network",
]);
export const favoritePreferenceSchema = z.object({
  path: z.string().trim().min(1),
  icon: favoriteIconIdSchema,
});
export const favoritesPlacementSchema = z.enum(["integrated", "separate"]);
export const applicationSelectionSchema = z.object({
  appPath: z.string().trim().min(1),
  appName: z.string().trim().min(1),
});
export const copyPasteReviewDialogSizeSchema = z.object({
  width: z.number().int().min(520).max(3200),
  height: z.number().int().min(420).max(2400),
});
export const searchJobStatusSchema = z.enum([
  "running",
  "complete",
  "cancelled",
  "error",
  "truncated",
]);
export const nativeEditActionSchema = z.enum(["cut", "copy", "paste", "selectAll"]);
export const copyPasteModeSchema = z.enum(["copy", "cut"]);
export const copyPasteConflictResolutionSchema = z.enum(["error", "skip"]);
export const copyPasteAnalysisJobStatusSchema = z.enum([
  "queued",
  "analyzing",
  "complete",
  "cancelled",
  "error",
]);
export const copyPasteOperationStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_resolution",
  "completed",
  "failed",
  "cancelled",
  "partial",
]);
export const copyPastePolicyFileActionSchema = z.enum(["overwrite", "skip", "keep_both"]);
export const copyPastePolicyDirectoryActionSchema = z.enum(["merge", "skip", "keep_both"]);
export const copyPastePolicyMismatchActionSchema = z.enum(["overwrite", "skip", "keep_both"]);
export const copyPasteRuntimeResolutionActionSchema = z.enum([
  "overwrite",
  "skip",
  "keep_both",
  "merge",
]);
export const copyPastePlanItemStatusSchema = z.enum(["ready", "conflict", "blocked"]);
export const copyPastePlanIssueCodeSchema = z.enum([
  "destination_missing",
  "destination_not_directory",
  "source_missing",
  "same_path",
  "parent_into_child",
]);
export const copyPastePlanWarningCodeSchema = z.enum(["large_batch", "cut_requires_delete"]);
export const copyPasteNodeKindSchema = z.enum(["missing", "file", "directory", "symlink"]);
export const copyPasteConflictClassSchema = z.enum([
  "file_conflict",
  "directory_conflict",
  "type_mismatch",
]);
export const copyPasteAnalysisNodeDispositionSchema = z.enum(["new", "conflict", "blocked"]);
export const writeOperationActionSchema = z.enum([
  "paste",
  "move_to",
  "duplicate",
  "trash",
  "rename",
  "new_folder",
]);
export const actionLogActionSchema = z.enum([
  "open",
  "open_with",
  "open_in_terminal",
  "paste",
  "move_to",
  "duplicate",
  "trash",
  "rename",
  "new_folder",
]);
export const actionLogStatusSchema = z.enum(["completed", "failed", "cancelled", "partial"]);
export const appLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export const sizeStatusSchema = z.enum(["ready", "deferred", "unavailable"]);
const emptyRequestSchema = z.object({});
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const treeChildSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(["directory", "symlink_directory"]),
  isHidden: z.boolean(),
  isSymlink: z.boolean(),
});

export const directoryEntrySchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  extension: z.string(),
  kind: explorerEntryKindSchema,
  isHidden: z.boolean(),
  isSymlink: z.boolean(),
});

export const directoryEntryMetadataSchema = z.object({
  path: z.string().min(1),
  kindLabel: z.string().min(1),
  modifiedAt: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  // Directories intentionally report `deferred` while folder size calculation is skipped
  // or backgrounded; the renderer maps that to `-` or an empty loading state instead of
  // implying the data is unavailable forever.
  sizeStatus: sizeStatusSchema,
  permissionMode: z.number().int().nonnegative().nullable(),
});

export const itemPropertiesSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  extension: z.string(),
  kind: explorerEntryKindSchema,
  kindLabel: z.string().min(1),
  isHidden: z.boolean(),
  isSymlink: z.boolean(),
  createdAt: z.string().nullable(),
  modifiedAt: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  sizeStatus: sizeStatusSchema,
  permissionMode: z.number().int().nonnegative().nullable(),
});

export const pathSuggestionSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  isDirectory: z.boolean(),
});

export const searchResultItemSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  extension: z.string(),
  kind: explorerEntryKindSchema,
  isHidden: z.boolean(),
  isSymlink: z.boolean(),
  // `parentPath` is the absolute parent directory. `relativeParentPath` is precomputed
  // relative to the search root so the renderer can render dense rows without repeatedly
  // re-slicing long absolute paths during virtualization.
  parentPath: z.string().min(1),
  relativeParentPath: z.string(),
});

export const resolvedPathSchema = z.object({
  inputPath: z.string().min(1),
  resolvedPath: z.string().nullable(),
});
export const copyPastePolicySchema = z.object({
  file: copyPastePolicyFileActionSchema,
  directory: copyPastePolicyDirectoryActionSchema,
  mismatch: copyPastePolicyMismatchActionSchema,
});
export const nodeFingerprintSchema = z.object({
  exists: z.boolean(),
  kind: copyPasteNodeKindSchema,
  size: z.number().int().nonnegative().nullable(),
  mtimeMs: z.number().nonnegative().nullable(),
  mode: z.number().int().nonnegative().nullable(),
  ino: z.number().int().nonnegative().nullable(),
  dev: z.number().int().nonnegative().nullable(),
  symlinkTarget: z.string().nullable(),
});
export const copyPastePlanItemSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  kind: z.enum(["file", "directory", "symlink"]),
  status: copyPastePlanItemStatusSchema,
  sizeBytes: z.number().int().nonnegative().nullable(),
});
export const copyPastePlanConflictSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  reason: z.literal("destination_exists"),
});
export const copyPastePlanIssueSchema = z.object({
  code: copyPastePlanIssueCodeSchema,
  message: z.string().min(1),
  sourcePath: z.string().nullable(),
  destinationPath: z.string().nullable(),
});
export const copyPastePlanWarningSchema = z.object({
  code: copyPastePlanWarningCodeSchema,
  message: z.string().min(1),
});
type CopyPasteAnalysisNodeContract = {
  id: string;
  sourcePath: string;
  destinationPath: string;
  sourceKind: "file" | "directory" | "symlink";
  destinationKind: z.infer<typeof copyPasteNodeKindSchema>;
  disposition: z.infer<typeof copyPasteAnalysisNodeDispositionSchema>;
  conflictClass: z.infer<typeof copyPasteConflictClassSchema> | null;
  sourceFingerprint: z.infer<typeof nodeFingerprintSchema>;
  destinationFingerprint: z.infer<typeof nodeFingerprintSchema>;
  children: CopyPasteAnalysisNodeContract[];
  issueCode: z.infer<typeof copyPastePlanIssueCodeSchema> | null;
  issueMessage: string | null;
  totalNodeCount: number;
  conflictNodeCount: number;
};
export const copyPasteAnalysisNodeSchema: z.ZodType<CopyPasteAnalysisNodeContract> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    sourcePath: z.string().min(1),
    destinationPath: z.string().min(1),
    sourceKind: z.enum(["file", "directory", "symlink"]),
    destinationKind: copyPasteNodeKindSchema,
    disposition: copyPasteAnalysisNodeDispositionSchema,
    conflictClass: copyPasteConflictClassSchema.nullable(),
    sourceFingerprint: nodeFingerprintSchema,
    destinationFingerprint: nodeFingerprintSchema,
    children: z.array(copyPasteAnalysisNodeSchema),
    issueCode: copyPastePlanIssueCodeSchema.nullable(),
    issueMessage: z.string().nullable(),
    totalNodeCount: z.number().int().nonnegative(),
    conflictNodeCount: z.number().int().nonnegative(),
  }),
);
export const copyPasteAnalysisSummarySchema = z.object({
  topLevelItemCount: z.number().int().nonnegative(),
  totalNodeCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  fileConflictCount: z.number().int().nonnegative(),
  directoryConflictCount: z.number().int().nonnegative(),
  mismatchConflictCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
});
export const copyPasteAnalysisReportSchema = z.object({
  analysisId: z.string().min(1),
  mode: copyPasteModeSchema,
  sourcePaths: z.array(z.string().min(1)).min(1).max(500),
  destinationDirectoryPath: z.string().min(1),
  nodes: z.array(copyPasteAnalysisNodeSchema),
  issues: z.array(copyPastePlanIssueSchema),
  warnings: z.array(copyPastePlanWarningSchema),
  summary: copyPasteAnalysisSummarySchema,
});
export const copyPasteRuntimeConflictSchema = z.object({
  conflictId: z.string().min(1),
  analysisId: z.string().min(1),
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  sourceKind: z.enum(["file", "directory", "symlink"]),
  destinationKind: copyPasteNodeKindSchema,
  conflictClass: copyPasteConflictClassSchema,
  reason: z.enum([
    "destination_changed",
    "destination_created",
    "destination_deleted",
    "source_changed",
    "source_deleted",
  ]),
  sourceFingerprint: nodeFingerprintSchema,
  destinationFingerprint: nodeFingerprintSchema,
  currentSourceFingerprint: nodeFingerprintSchema,
  currentDestinationFingerprint: nodeFingerprintSchema,
});
export const copyPastePlanSchema = z.object({
  mode: copyPasteModeSchema,
  sourcePaths: z.array(z.string().min(1)).min(1).max(500),
  destinationDirectoryPath: z.string().min(1),
  conflictResolution: copyPasteConflictResolutionSchema,
  items: z.array(copyPastePlanItemSchema),
  conflicts: z.array(copyPastePlanConflictSchema),
  issues: z.array(copyPastePlanIssueSchema),
  warnings: z.array(copyPastePlanWarningSchema),
  requiresConfirmation: z.object({
    largeBatch: z.boolean(),
    cutDelete: z.boolean(),
  }),
  summary: z.object({
    topLevelItemCount: z.number().int().nonnegative(),
    totalItemCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative().nullable(),
    skippedConflictCount: z.number().int().nonnegative(),
  }),
  canExecute: z.boolean(),
});
export const copyPasteItemResultSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  status: z.enum(["completed", "skipped", "failed", "cancelled"]),
  error: z.string().nullable(),
});
export const copyPasteOperationResultSchema = z.object({
  operationId: z.string().min(1),
  mode: copyPasteModeSchema,
  status: copyPasteOperationStatusSchema,
  destinationDirectoryPath: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  summary: z.object({
    topLevelItemCount: z.number().int().nonnegative(),
    totalItemCount: z.number().int().nonnegative(),
    completedItemCount: z.number().int().nonnegative(),
    failedItemCount: z.number().int().nonnegative(),
    skippedItemCount: z.number().int().nonnegative(),
    cancelledItemCount: z.number().int().nonnegative(),
    completedByteCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative().nullable(),
  }),
  items: z.array(copyPasteItemResultSchema),
  error: z.string().nullable(),
});
export const copyPasteProgressEventSchema = z.object({
  action: writeOperationActionSchema.default("paste"),
  operationId: z.string().min(1),
  analysisId: z.string().min(1).nullable().optional(),
  mode: copyPasteModeSchema,
  status: copyPasteOperationStatusSchema,
  completedItemCount: z.number().int().nonnegative(),
  totalItemCount: z.number().int().nonnegative(),
  completedByteCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  currentSourcePath: z.string().nullable(),
  currentDestinationPath: z.string().nullable(),
  runtimeConflict: copyPasteRuntimeConflictSchema.nullable().optional(),
  result: copyPasteOperationResultSchema.nullable(),
});
export const writeOperationItemResultSchema = z.object({
  sourcePath: z.string().nullable(),
  destinationPath: z.string().nullable(),
  status: z.enum(["completed", "skipped", "failed", "cancelled"]),
  error: z.string().nullable(),
});
export const writeOperationResultSchema = z.object({
  operationId: z.string().min(1),
  action: writeOperationActionSchema,
  status: copyPasteOperationStatusSchema,
  targetPath: z.string().nullable(),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  summary: z.object({
    topLevelItemCount: z.number().int().nonnegative(),
    totalItemCount: z.number().int().nonnegative(),
    completedItemCount: z.number().int().nonnegative(),
    failedItemCount: z.number().int().nonnegative(),
    skippedItemCount: z.number().int().nonnegative(),
    cancelledItemCount: z.number().int().nonnegative(),
    completedByteCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative().nullable(),
  }),
  items: z.array(writeOperationItemResultSchema),
  error: z.string().nullable(),
});
export const writeOperationProgressEventSchema = z.object({
  operationId: z.string().min(1),
  action: writeOperationActionSchema,
  status: copyPasteOperationStatusSchema,
  completedItemCount: z.number().int().nonnegative(),
  totalItemCount: z.number().int().nonnegative(),
  completedByteCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative().nullable(),
  currentSourcePath: z.string().nullable(),
  currentDestinationPath: z.string().nullable(),
  runtimeConflict: copyPasteRuntimeConflictSchema.nullable().optional(),
  result: writeOperationResultSchema.nullable(),
});
export const actionLogItemSchema = z.object({
  sourcePath: z.string().nullable(),
  destinationPath: z.string().nullable(),
  status: z.enum(["completed", "skipped", "failed", "cancelled"]),
  error: z.string().nullable(),
});
export const actionLogEntrySchema = z.object({
  id: z.string().min(1),
  occurredAt: z.string().min(1),
  action: actionLogActionSchema,
  status: actionLogStatusSchema,
  operationId: z.string().min(1).nullable(),
  sourcePaths: z.array(z.string().min(1)),
  destinationPaths: z.array(z.string().min(1)),
  sourceSummary: z.string().min(1).nullable(),
  destinationSummary: z.string().min(1).nullable(),
  title: z.string().min(1),
  message: z.string().min(1),
  durationMs: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  summary: z.object({
    totalItemCount: z.number().int().nonnegative(),
    completedItemCount: z.number().int().nonnegative(),
    failedItemCount: z.number().int().nonnegative(),
    skippedItemCount: z.number().int().nonnegative(),
    cancelledItemCount: z.number().int().nonnegative(),
  }),
  items: z.array(actionLogItemSchema),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export const launchContextSchema = z.object({
  startupFolderPath: z.string().min(1).nullable(),
});

export const appLogEntrySchema = z.object({
  level: appLogLevelSchema,
  namespace: z.string().trim().min(1),
  message: z.string().trim().min(1),
  error: z.string().nullable().default(null),
  context: z.record(z.string(), jsonValueSchema).default({}),
});

export const appPreferencesSchema = z.object({
  theme: themeModeSchema,
  accent: accentModeSchema,
  accentToolbarButtons: z.boolean(),
  accentFavoriteItems: z.boolean(),
  accentFavoriteText: z.boolean(),
  favoriteAccent: accentModeSchema,
  zoomPercent: z.number().int().min(75).max(150),
  uiFontFamily: uiFontFamilySchema,
  uiFontSize: z.number().int().min(12).max(15),
  uiFontWeight: z.union([z.literal(400), z.literal(500), z.literal(600)]),
  textPrimaryOverride: colorOverrideSchema,
  textSecondaryOverride: colorOverrideSchema,
  textMutedOverride: colorOverrideSchema,
  viewMode: explorerViewModeSchema,
  foldersFirst: z.boolean(),
  compactListView: z.boolean(),
  compactDetailsView: z.boolean(),
  compactTreeView: z.boolean(),
  singleClickExpandTreeItems: z.boolean(),
  highlightHoveredItems: z.boolean(),
  detailColumns: detailColumnVisibilitySchema,
  detailColumnWidths: detailColumnWidthsSchema,
  tabSwitchesExplorerPanes: z.boolean(),
  typeaheadEnabled: z.boolean(),
  typeaheadDebounceMs: z.number().int().min(250).max(1500),
  notificationsEnabled: z.boolean(),
  notificationDurationSeconds: z.number().int().min(2).max(10),
  actionLogEnabled: z.boolean(),
  propertiesOpen: z.boolean(),
  detailRowOpen: z.boolean(),
  terminalApp: applicationSelectionSchema.nullable(),
  defaultTextEditor: applicationSelectionSchema,
  openWithApplications: z.array(openWithApplicationSchema),
  fileActivationAction: z.enum(["open", "edit"]),
  openItemLimit: z.number().int().min(1).max(50),
  includeHidden: z.boolean(),
  searchPatternMode: searchPatternModeSchema,
  searchMatchScope: searchMatchScopeSchema,
  searchRecursive: z.boolean(),
  searchIncludeHidden: z.boolean(),
  searchResultsSortBy: searchResultsSortBySchema,
  searchResultsSortDirection: sortDirectionSchema,
  searchResultsFilterScope: searchResultsFilterScopeSchema,
  treeWidth: z.number().int().min(220).max(520),
  inspectorWidth: z.number().int().min(260).max(480),
  restoreLastVisitedFolderOnStartup: z.boolean(),
  treeRootPath: z.string().min(1).nullable(),
  lastVisitedPath: z.string().min(1).nullable(),
  lastVisitedFavoritePath: z.string().min(1).nullable(),
  favorites: z.array(favoritePreferenceSchema),
  favoritesPlacement: favoritesPlacementSchema,
  favoritesPaneHeight: z.number().int().min(96).max(2400).nullable(),
  favoritesExpanded: z.boolean(),
  favoritesInitialized: z.boolean(),
  copyPasteReviewDialogSize: copyPasteReviewDialogSizeSchema.nullable(),
});

export const folderSizeJobStatusSchema = z.enum([
  "queued",
  "running",
  "deferred",
  "ready",
  "cancelled",
  "error",
]);

// Each channel entry defines both request and response validation.
// The renderer-side generic helpers derive their compile-time types directly from this map.
export const ipcContractSchemas = {
  "app:getHomeDirectory": {
    request: emptyRequestSchema,
    response: z.object({
      path: z.string().min(1),
    }),
  },
  "app:getPreferences": {
    request: emptyRequestSchema,
    response: z.object({
      preferences: appPreferencesSchema,
    }),
  },
  "app:getLaunchContext": {
    request: emptyRequestSchema,
    response: launchContextSchema,
  },
  "app:updatePreferences": {
    request: z.object({
      preferences: appPreferencesSchema.partial(),
    }),
    response: z.object({
      preferences: appPreferencesSchema,
    }),
  },
  "app:clearCaches": {
    request: emptyRequestSchema,
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "app:writeLog": {
    request: appLogEntrySchema,
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "actionLog:list": {
    request: emptyRequestSchema,
    response: z.object({
      items: z.array(actionLogEntrySchema),
    }),
  },
  "tree:getChildren": {
    request: z.object({
      path: z.string().min(1),
      includeHidden: z.boolean().default(false),
    }),
    response: z.object({
      path: z.string().min(1),
      children: z.array(treeChildSchema),
    }),
  },
  "directory:getSnapshot": {
    request: z.object({
      path: z.string().min(1),
      includeHidden: z.boolean().default(false),
      sortBy: directorySortBySchema.default("name"),
      sortDirection: sortDirectionSchema.default("asc"),
      foldersFirst: z.boolean().default(true),
    }),
    response: z.object({
      path: z.string().min(1),
      parentPath: z.string().nullable(),
      entries: z.array(directoryEntrySchema),
    }),
  },
  "directory:getMetadataBatch": {
    request: z.object({
      directoryPath: z.string().min(1),
      paths: z.array(z.string().min(1)).max(500),
    }),
    response: z.object({
      directoryPath: z.string().min(1),
      items: z.array(directoryEntryMetadataSchema),
    }),
  },
  "item:getProperties": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      item: itemPropertiesSchema,
    }),
  },
  "path:getSuggestions": {
    request: z.object({
      inputPath: z.string(),
      includeHidden: z.boolean().default(false),
      limit: z.number().int().positive().max(50).default(12),
    }),
    response: z.object({
      inputPath: z.string(),
      basePath: z.string().nullable(),
      suggestions: z.array(pathSuggestionSchema),
    }),
  },
  "path:resolve": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: resolvedPathSchema,
  },
  "search:start": {
    request: z.object({
      rootPath: z.string().min(1),
      query: z.string().min(1),
      patternMode: searchPatternModeSchema.default("regex"),
      matchScope: searchMatchScopeSchema.default("name"),
      recursive: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
    }),
    response: z.object({
      jobId: z.string().min(1),
      status: searchJobStatusSchema,
    }),
  },
  "search:getUpdate": {
    request: z.object({
      jobId: z.string().min(1),
      cursor: z.number().int().nonnegative().default(0),
    }),
    response: z.object({
      jobId: z.string().min(1),
      status: searchJobStatusSchema,
      items: z.array(searchResultItemSchema),
      nextCursor: z.number().int().nonnegative(),
      done: z.boolean(),
      truncated: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  "search:cancel": {
    request: z.object({
      jobId: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "copyPaste:analyzeStart": {
    request: z.object({
      mode: copyPasteModeSchema,
      sourcePaths: z.array(z.string().min(1)).min(1).max(500),
      destinationDirectoryPath: z.string().min(1),
      action: writeOperationActionSchema
        .extract(["paste", "move_to", "duplicate"])
        .default("paste"),
    }),
    response: z.object({
      analysisId: z.string().min(1),
      status: copyPasteAnalysisJobStatusSchema.extract(["queued", "analyzing"]),
    }),
  },
  "copyPaste:analyzeGetUpdate": {
    request: z.object({
      analysisId: z.string().min(1),
    }),
    response: z.object({
      analysisId: z.string().min(1),
      status: copyPasteAnalysisJobStatusSchema,
      done: z.boolean(),
      report: copyPasteAnalysisReportSchema.nullable(),
      error: z.string().nullable(),
    }),
  },
  "copyPaste:analyzeCancel": {
    request: z.object({
      analysisId: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "copyPaste:plan": {
    request: z.object({
      mode: copyPasteModeSchema,
      sourcePaths: z.array(z.string().min(1)).min(1).max(500),
      destinationDirectoryPath: z.string().min(1),
      conflictResolution: copyPasteConflictResolutionSchema.default("error"),
      action: writeOperationActionSchema
        .extract(["paste", "move_to", "duplicate"])
        .default("paste"),
    }),
    response: copyPastePlanSchema,
  },
  "copyPaste:start": {
    request: z.union([
      z.object({
        mode: copyPasteModeSchema,
        sourcePaths: z.array(z.string().min(1)).min(1).max(500),
        destinationDirectoryPath: z.string().min(1),
        conflictResolution: copyPasteConflictResolutionSchema.default("error"),
        action: writeOperationActionSchema
          .extract(["paste", "move_to", "duplicate"])
          .default("paste"),
      }),
      z.object({
        analysisId: z.string().min(1),
        action: writeOperationActionSchema
          .extract(["paste", "move_to", "duplicate"])
          .default("paste"),
        policy: copyPastePolicySchema,
      }),
    ]),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "copyPaste:cancel": {
    request: z.object({
      operationId: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "copyPaste:resolveConflict": {
    request: z.object({
      operationId: z.string().min(1),
      conflictId: z.string().min(1),
      resolution: copyPasteRuntimeResolutionActionSchema,
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "writeOperation:rename": {
    request: z.object({
      sourcePath: z.string().min(1),
      destinationName: z.string().trim().min(1).max(255),
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "writeOperation:createFolder": {
    request: z.object({
      parentDirectoryPath: z.string().min(1),
      folderName: z.string().trim().min(1).max(255),
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "writeOperation:trash": {
    request: z.object({
      paths: z.array(z.string().min(1)).min(1).max(500),
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "writeOperation:cancel": {
    request: z.object({
      operationId: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "folderSize:start": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      jobId: z.string().min(1),
      status: folderSizeJobStatusSchema,
    }),
  },
  "folderSize:getStatus": {
    request: z.object({
      jobId: z.string().min(1),
    }),
    response: z.object({
      jobId: z.string().min(1),
      status: folderSizeJobStatusSchema,
      sizeBytes: z.number().int().nonnegative().nullable(),
      error: z.string().nullable(),
    }),
  },
  "folderSize:cancel": {
    request: z.object({
      jobId: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "system:openPath": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  "system:pickApplication": {
    request: emptyRequestSchema,
    response: z.object({
      canceled: z.boolean(),
      appPath: z.string().min(1).nullable(),
      appName: z.string().min(1).nullable(),
    }),
  },
  "system:pickDirectory": {
    request: z.object({
      defaultPath: z.string().min(1).nullable().optional(),
    }),
    response: z.object({
      canceled: z.boolean(),
      path: z.string().min(1).nullable(),
    }),
  },
  "system:openPathsWithApplication": {
    request: z.object({
      applicationPath: z.string().min(1),
      paths: z.array(z.string().min(1)).min(1).max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  "system:openInTerminal": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  "system:copyText": {
    request: z.object({
      text: z.string(),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "system:performEditAction": {
    request: z.object({
      action: nativeEditActionSchema,
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
} as const;

export type IpcContractSchemas = typeof ipcContractSchemas;
export type IpcChannel = keyof IpcContractSchemas;
export const ipcChannels = Object.keys(ipcContractSchemas) as IpcChannel[];
export type IpcRequest<C extends IpcChannel> = z.output<IpcContractSchemas[C]["request"]>;
export type IpcRequestInput<C extends IpcChannel> = z.input<IpcContractSchemas[C]["request"]>;
export type IpcResponse<C extends IpcChannel> = z.output<IpcContractSchemas[C]["response"]>;
export type CopyPastePlan = z.output<typeof copyPastePlanSchema>;
export type CopyPasteOperationResult = z.output<typeof copyPasteOperationResultSchema>;
export type CopyPasteProgressEvent = z.output<typeof copyPasteProgressEventSchema>;
export type WriteOperationAction = z.output<typeof writeOperationActionSchema>;
export type WriteOperationResult = z.output<typeof writeOperationResultSchema>;
export type WriteOperationProgressEvent = z.output<typeof writeOperationProgressEventSchema>;
export type ActionLogAction = z.output<typeof actionLogActionSchema>;
export type ActionLogStatus = z.output<typeof actionLogStatusSchema>;
export type ActionLogItem = z.output<typeof actionLogItemSchema>;
export type ActionLogEntry = z.output<typeof actionLogEntrySchema>;
export type AppLogLevel = z.output<typeof appLogLevelSchema>;
export type AppLogEntry = z.output<typeof appLogEntrySchema>;

// Validation failures are surfaced with a dedicated error type so transport bugs can be
// distinguished from domain failures such as "path not found" or "search cancelled".
export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcValidationError";
  }
}
