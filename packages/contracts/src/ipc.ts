import { z } from "zod";
import { getItemNameError } from "./itemName";

// These schemas are the single source of truth for renderer <-> main IPC payloads.
// Keep the runtime validators and the inferred TypeScript types aligned here so the
// transport contract cannot silently drift between processes.
// The length limit is part of getItemNameError: it counts bytes, the way the disk does.
const itemNameSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((name, context) => {
    const message = getItemNameError(name);
    if (message) {
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

// A path the main process reads or writes for a copy, rename, or delete. A relative path
// would be resolved against the main process's own working folder, not anything the window
// shows, so only absolute paths are accepted.
const absolutePathSchema = z
  .string()
  .min(1)
  .refine((path) => path.startsWith("/"), { message: "Expected an absolute path." })
  .refine((path) => !path.includes("\0"), { message: "A path can't contain a null character." });
// Enough for selecting everything in a large folder; the bound only keeps a runaway
// payload out.
export const MAX_PATHS_PER_REQUEST = 100_000;
const absolutePathListSchema = z.array(absolutePathSchema).min(1).max(MAX_PATHS_PER_REQUEST);

export const explorerEntryKindSchema = z.enum([
  "directory",
  "file",
  "symlink_directory",
  "symlink_file",
  "bundle",
  "other",
]);

export const themeModeSchema = z.enum(["light", "dark"]);
export const accentModeSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const explorerViewModeSchema = z.enum(["icons", "list", "details"]);
export const directorySortBySchema = z.enum(["name", "modified", "kind", "size"]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);
export const searchPatternModeSchema = z.enum(["text", "glob", "regex"]);
export const searchMatchScopeSchema = z.enum(["name", "path"]);
export const searchResultsSortBySchema = z.enum(["name", "path", "kind"]);
export const detailColumnVisibilitySchema = z.object({
  modified: z.boolean(),
  size: z.boolean(),
  kind: z.boolean(),
  created: z.boolean(),
  permissions: z.boolean(),
});
// The optional columns in display order, each exactly once.
export const detailColumnOrderSchema = z
  .array(z.enum(["modified", "size", "kind", "created", "permissions"]))
  .length(5)
  .refine((keys) => new Set(keys).size === keys.length, "Each column appears once");
export const detailColumnWidthsSchema = z.object({
  name: z.number().int().min(140).max(720),
  modified: z.number().int().min(80).max(280),
  size: z.number().int().min(60).max(240),
  kind: z.number().int().min(60).max(320),
  created: z.number().int().min(80).max(280),
  permissions: z.number().int().min(36).max(260),
});
export const searchColumnVisibilitySchema = z.object({
  folder: z.boolean(),
  modified: z.boolean(),
  size: z.boolean(),
  kind: z.boolean(),
  created: z.boolean(),
  permissions: z.boolean(),
});
// Search results' optional columns in display order, each exactly once.
export const searchColumnOrderSchema = z
  .array(z.enum(["folder", "modified", "size", "kind", "created", "permissions"]))
  .length(6)
  .refine((keys) => new Set(keys).size === keys.length, "Each column appears once");
export const searchColumnWidthsSchema = detailColumnWidthsSchema.extend({
  folder: z.number().int().min(80).max(720),
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
// A disk mounted besides the startup disk: a drive, a disk image or a network share.
export const volumeSchema = z.object({
  // Where it is mounted: /Volumes/<name>.
  path: z.string().min(1),
  name: z.string().min(1),
  // False for a network share.
  isLocal: z.boolean(),
  isReadOnly: z.boolean(),
  // apfs, hfs, exfat, smbfs…; empty when not known.
  fileSystem: z.string(),
});
// A change made to the folder a window watches (see `folder:watch`).
export const folderChangeSchema = z.object({
  path: z.string().min(1),
  // The items in the folder that changed, or null when that isn't known (too many, or a
  // change noticed only by the folder's modification time).
  changedPaths: z.array(z.string().min(1)).nullable(),
});
export const applicationSelectionSchema = z.object({
  appPath: z.string().trim().min(1),
  appName: z.string().trim().min(1),
});
export const toolbarItemIdSchema = z.enum([
  "back",
  "forward",
  "up",
  "refresh",
  "topSeparator",
  "view",
  "sort",
  "title",
  "clipboard",
  "viewOptions",
  "search",
  "goToFolder",
  "foldersFirst",
  "hidden",
  "folderTree",
  "infoPanel",
  "infoRow",
  "newTab",
  "openSelection",
  "quickLook",
  "editSelection",
  "moveSelection",
  "renameSelection",
  "duplicateSelection",
  "newFolder",
  "trashSelection",
  "copySelection",
  "cutSelection",
  "pasteSelection",
  "openInTerminal",
  "showInFinder",
  "revealInFolder",
  "calculateSize",
  "copyPath",
  "theme",
  "settings",
  "help",
]);
export const searchJobStatusSchema = z.enum([
  "running",
  "complete",
  "cancelled",
  "error",
  "truncated",
]);
export const nativeEditActionSchema = z.enum(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
export const copyPasteModeSchema = z.enum(["copy", "cut"]);
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
export const copyPastePolicyDirectoryActionSchema = z.enum([
  "overwrite",
  "merge",
  "skip",
  "keep_both",
]);
export const copyPastePolicyMismatchActionSchema = z.enum(["overwrite", "skip", "keep_both"]);
export const copyPasteRuntimeResolutionActionSchema = z.enum([
  "overwrite",
  "skip",
  "keep_both",
  "merge",
]);
// "trash_unavailable": Replace couldn't move the existing item to the Trash (for example on
// a network or FAT volume), so the only way to replace it is to delete it permanently.
export const copyPasteRuntimeConflictReasonSchema = z.enum([
  "destination_changed",
  "destination_created",
  "destination_deleted",
  "source_changed",
  "source_deleted",
  "trash_unavailable",
]);
export const copyPastePlanIssueCodeSchema = z.enum([
  "destination_missing",
  "destination_not_directory",
  "source_missing",
  "same_path",
  "parent_into_child",
  "duplicate_destination_name",
  "source_unreadable",
]);
export const copyPastePlanWarningCodeSchema = z.enum(["large_batch", "cut_requires_delete"]);
export const copyPasteNodeKindSchema = z.enum(["missing", "file", "directory", "symlink"]);
export const copyPasteConflictClassSchema = z.enum([
  "file_conflict",
  "directory_conflict",
  "type_mismatch",
]);
export const copyPasteAnalysisNodeDispositionSchema = z.enum(["new", "conflict", "blocked"]);
export const undoDirectionSchema = z.enum(["undo", "redo"]);

export const writeOperationActionSchema = z.enum([
  "paste",
  // A copy made some other way than pasting: a drag that copies.
  "copy_to",
  "move_to",
  "duplicate",
  "trash",
  "delete_immediately",
  "rename",
  "new_folder",
  // Several items renamed at once, from the Rename sheet.
  "batch_rename",
  // The last operation undone, or the last undone one done again.
  "undo",
  "redo",
]);

// A date and time as the clock of this Mac reads it, without a zone: "2026-05-14T18:02:11".
const localDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u);
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
  // Only for a file without an extension: whether it can be run. macOS draws such files
  // with one of two icons, and this says which.
  isExecutable: z.boolean().optional(),
  // Only when listed sorted by size, and only for files: the renderer merges these with
  // the folder sizes it learns later to keep the whole list in size order.
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
});

export const directoryEntryMetadataSchema = z.object({
  path: z.string().min(1),
  kindLabel: z.string().min(1),
  createdAt: z.string().nullable(),
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

export const visitedFolderSchema = z.object({
  path: z.string().min(1),
  // Newest first; empty for a folder only passed through.
  visits: z.array(
    z.object({
      at: z.number().nonnegative(),
      kind: z.enum(["goTo", "stay"]),
    }),
  ),
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
  // Negative before 1970 (old archives, HFS dates from 1904).
  mtimeMs: z.number().nullable(),
  mode: z.number().int().nonnegative().nullable(),
  ino: z.number().int().nonnegative().nullable(),
  dev: z.number().int().nonnegative().nullable(),
  symlinkTarget: z.string().nullable(),
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
  destinationTotalNodeCount: number | null;
  keepBothDestinationPath: string | null;
  destinationOnly: z.infer<typeof copyPasteDestinationOnlySummarySchema> | null;
  replaceBlockedReason: string | null;
};
export const copyPasteDestinationOnlySummarySchema = z.object({
  count: z.number().int().nonnegative(),
  samplePaths: z.array(z.string().min(1)),
});
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
    destinationTotalNodeCount: z.number().int().nonnegative().nullable(),
    keepBothDestinationPath: z.string().min(1).nullable(),
    destinationOnly: copyPasteDestinationOnlySummarySchema.nullable(),
    replaceBlockedReason: z.string().min(1).nullable(),
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
  sourcePaths: z.array(z.string().min(1)).min(1).max(MAX_PATHS_PER_REQUEST),
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
  reason: copyPasteRuntimeConflictReasonSchema,
  sourceFingerprint: nodeFingerprintSchema,
  destinationFingerprint: nodeFingerprintSchema,
  currentSourceFingerprint: nodeFingerprintSchema,
  currentDestinationFingerprint: nodeFingerprintSchema,
});
export const copyPasteItemResultSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  status: z.enum(["completed", "skipped", "failed", "cancelled"]),
  error: z.string().nullable(),
  skipReason: z
    .enum(["planned_conflict_policy", "runtime_conflict_resolution"])
    .nullable()
    .optional(),
  // For a folder: how many items inside it failed. A folder whose only problem is failures
  // inside it has status "failed" and a null error.
  childFailureCount: z.number().int().nonnegative().optional(),
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
  skipReason: z
    .enum(["planned_conflict_policy", "runtime_conflict_resolution"])
    .nullable()
    .optional(),
  // An item that couldn't go to the Trash because its disk has none: it can only be
  // deleted immediately (the window asks first).
  noTrash: z.literal(true).optional(),
  // For a folder: how many items inside it failed. A folder whose only problem is failures
  // inside it has status "failed" and a null error.
  childFailureCount: z.number().int().nonnegative().optional(),
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

// The pages of Help, as lib/helpContent.ts names them.
export const helpTopicSchema = z.enum(["navigation", "files", "search", "views", "shortcuts"]);
export type HelpTopic = z.infer<typeof helpTopicSchema>;

export const settingsTabSchema = z.enum(["general", "browsing", "search", "files", "shortcuts"]);

export const themePreferenceSchema = z.union([z.literal("auto"), themeModeSchema]);

export const openTabPreferenceSchema = z.object({
  path: z.string().min(1).nullable(),
  treeRootPath: z.string().min(1).nullable(),
  favoritePath: z.string().min(1).nullable(),
  viewMode: explorerViewModeSchema,
  searchViewMode: explorerViewModeSchema,
  sortBy: directorySortBySchema,
  sortDirection: sortDirectionSchema,
  includeHidden: z.boolean(),
  foldersFirst: z.boolean(),
  favoritesExpanded: z.boolean(),
  locationsExpanded: z.boolean(),
});

// The Rename sheet's settings for several items (see apps/desktop/src/shared/batchRename.ts,
// which reads saved ones leniently; these are the values it can hold).
const batchRenameSettingsSchema = z.object({
  mode: z.enum(["replace", "add", "format", "case"]),
  find: z.string().max(255),
  replaceWith: z.string().max(255),
  matchCase: z.boolean(),
  useRegex: z.boolean(),
  addText: z.string().max(255),
  addWhere: z.enum(["after", "before"]),
  nameFormat: z.enum(["index", "counter", "date"]),
  formatWhere: z.enum(["after", "before"]),
  customName: z.string().max(255),
  keepNames: z.boolean(),
  startAt: z.number().int().min(0).max(999_999_999),
  step: z.number().int().min(1).max(999_999_999),
  digits: z.union([z.literal("auto"), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  separator: z.enum([" ", "-", "_", ""]),
  dateSource: z.enum(["created", "modified", "taken", "today"]),
  dateFormat: z.enum(["ymd", "ymd_hm", "ymd_hms", "dmy", "dmyy", "mdy", "yymd", "ym", "custom"]),
  dateSeparator: z.enum(["-", "_", ".", " ", ""]),
  customDatePattern: z.string().max(255),
  caseStyle: z.enum(["lower", "upper", "title"]),
  applyTo: z.enum(["name", "extension", "both"]),
  onConflict: z.enum(["number", "skip", "block"]),
});

export const appPreferencesSchema = z.object({
  theme: themePreferenceSchema,
  accent: accentModeSchema,
  zoomPercent: z.number().int().min(75).max(150),
  viewMode: explorerViewModeSchema,
  searchViewMode: explorerViewModeSchema,
  sortBy: directorySortBySchema,
  sortDirection: sortDirectionSchema,
  foldersFirst: z.boolean(),
  compactListView: z.boolean(),
  compactDetailsView: z.boolean(),
  compactIconView: z.boolean(),
  compactTreeView: z.boolean(),
  singleClickExpandTreeItems: z.boolean(),
  detailColumns: detailColumnVisibilitySchema,
  detailColumnOrder: detailColumnOrderSchema,
  detailColumnWidths: detailColumnWidthsSchema,
  searchColumns: searchColumnVisibilitySchema,
  searchColumnOrder: searchColumnOrderSchema,
  searchColumnWidths: searchColumnWidthsSchema,
  notificationsEnabled: z.boolean(),
  markClipboardItems: z.boolean(),
  folderTreeOpen: z.boolean(),
  propertiesOpen: z.boolean(),
  detailRowOpen: z.boolean(),
  topToolbarItems: z.array(toolbarItemIdSchema),
  terminalApp: applicationSelectionSchema.nullable(),
  defaultTextEditor: applicationSelectionSchema,
  openWithApplications: z.array(openWithApplicationSchema),
  fileActivationAction: z.enum(["open", "edit"]),
  returnKeyAction: z.enum(["rename", "open"]),
  // Command names and shortcuts are the app's own; unknown ones are dropped when saved.
  shortcutOverrides: z.record(z.string().min(1).max(64), z.array(z.string().min(1).max(64)).max(2)),
  openItemLimit: z.number().int().min(1).max(50),
  includeHidden: z.boolean(),
  searchPatternMode: searchPatternModeSchema,
  searchMatchScope: searchMatchScopeSchema,
  searchRecursive: z.boolean(),
  searchSkipGitFolders: z.boolean(),
  searchSkipGitIgnored: z.boolean(),
  searchResultsSortBy: searchResultsSortBySchema,
  searchResultsSortDirection: sortDirectionSchema,
  treeWidth: z.number().int().min(220).max(520),
  inspectorWidth: z.number().int().min(260).max(480),
  restoreSessionOnStartup: z.boolean(),
  openTabs: z.array(openTabPreferenceSchema).max(100),
  activeTabIndex: z.number().int().min(0),
  treeRootPath: z.string().min(1).nullable(),
  lastVisitedPath: z.string().min(1).nullable(),
  lastVisitedFavoritePath: z.string().min(1).nullable(),
  favorites: z.array(favoritePreferenceSchema),
  favoritesPlacement: favoritesPlacementSchema,
  favoritesExpanded: z.boolean(),
  // The sidebar's Locations (the disks), shown or folded.
  locationsExpanded: z.boolean(),
  favoritesInitialized: z.boolean(),
  batchRenameSettings: batchRenameSettingsSchema,
  batchRenamePresets: z
    .array(
      z.object({ name: z.string().trim().min(1).max(80), settings: batchRenameSettingsSchema }),
    )
    .max(50),
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
  // `tab` opens Settings on that tab, or switches an open Settings window to it.
  "app:openSettingsWindow": {
    request: z.object({
      tab: settingsTabSchema.optional(),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  // Help lives in its own window; `topic` opens it on that page, or turns an open Help
  // window to it.
  "app:openHelpWindow": {
    request: z.object({
      topic: helpTopicSchema.optional(),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  // What the About window shows, and what its Copy Details button copies.
  "app:getAboutInfo": {
    request: emptyRequestSchema,
    response: z.object({
      version: z.string().min(1),
      // The commit the app was built from; null for a build made outside the repository.
      commit: z.string().min(1).nullable(),
      macosVersion: z.string().min(1),
      architecture: z.enum(["Apple silicon", "Intel"]),
      electronVersion: z.string().min(1),
      fdVersion: z.string().min(1),
    }),
  },
  "app:openAcknowledgementsWindow": {
    request: emptyRequestSchema,
    response: z.object({
      ok: z.boolean(),
    }),
  },
  // The open-source software shipped inside the app, with each license as shipped.
  "app:getAcknowledgements": {
    request: emptyRequestSchema,
    response: z.object({
      components: z.array(
        z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          version: z.string().min(1).nullable(),
          license: z.string().min(1),
          url: z.string().url(),
          // Null when the notices are a file of their own (Chromium's), opened with
          // `app:openAcknowledgementNotices`.
          text: z.string().nullable(),
        }),
      ),
    }),
  },
  "app:openAcknowledgementNotices": {
    request: z.object({
      id: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  // The explorer window tells the application menu which commands can run and which of
  // its checkmarks are on. Command names are the app's own; unknown ones are ignored.
  "app:setMenuState": {
    request: z.object({
      state: z.object({
        disabledCommands: z.array(z.string().min(1)).max(200),
        viewMode: explorerViewModeSchema,
        sortBy: directorySortBySchema,
        foldersFirst: z.boolean(),
        hiddenFilesShown: z.boolean(),
        folderTreeOpen: z.boolean(),
        infoPanelOpen: z.boolean(),
        infoRowOpen: z.boolean(),
        favoriteIsSet: z.boolean(),
        textEditing: z.boolean(),
      }),
    }),
    response: z.object({
      ok: z.boolean(),
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
  // The folders that have been opened, for the Go To box (⌘K).
  "places:list": {
    request: emptyRequestSchema,
    response: z.object({
      folders: z.array(visitedFolderSchema),
    }),
  },
  "places:recordVisit": {
    request: z.object({
      path: z.string().min(1),
      // How the folder was come to, which says how much the visit counts.
      kind: z.enum(["goTo", "stay", "passThrough"]),
    }),
    response: z.object({
      ok: z.literal(true),
    }),
  },
  "places:forget": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      folders: z.array(visitedFolderSchema),
    }),
  },
  "app:clearCaches": {
    request: emptyRequestSchema,
    response: z.object({
      ok: z.literal(true),
    }),
  },
  // The folder the window has on screen, watched for changes made outside the app; null
  // stops watching. Each change is sent back as `filetrail:folderChanged`.
  "folder:watch": {
    request: z.object({
      path: z.string().min(1).nullable(),
    }),
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
      patternMode: searchPatternModeSchema.default("text"),
      matchScope: searchMatchScopeSchema.default("name"),
      recursive: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
      // Leave out `.git` folders, and anything Git ignores (.gitignore and friends).
      skipGitFolders: z.boolean().default(true),
      skipGitIgnored: z.boolean().default(false),
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
      sourcePaths: absolutePathListSchema,
      destinationDirectoryPath: absolutePathSchema,
      action: writeOperationActionSchema
        .extract(["paste", "copy_to", "move_to", "duplicate"])
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
  "copyPaste:start": {
    request: z.object({
      analysisId: z.string().min(1),
      action: writeOperationActionSchema
        .extract(["paste", "copy_to", "move_to", "duplicate"])
        .default("paste"),
      policy: copyPastePolicySchema,
      // Per-item choices from the review, overriding the policy for those items.
      overrides: z
        .array(
          z.object({
            nodeId: z.string().min(1),
            action: copyPasteRuntimeResolutionActionSchema,
          }),
        )
        .max(100_000)
        .optional(),
    }),
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
      // Answer later changes during the same operation the same way, where that applies.
      applyToRemaining: z.boolean().optional(),
    }),
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "writeOperation:rename": {
    request: z.object({
      sourcePath: absolutePathSchema,
      destinationName: itemNameSchema,
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  // What the Rename sheet needs to show the new names of several items and check them: each
  // item's dates (when it was taken only when asked: that reads the files), whether it can
  // be renamed at all, and every name in the folders they are in.
  "batchRename:inspect": {
    request: z.object({
      paths: absolutePathListSchema,
      includeDateTaken: z.boolean(),
    }),
    response: z.object({
      items: z.array(
        z.object({
          path: z.string().min(1),
          createdAt: localDateTimeSchema.nullable(),
          modifiedAt: localDateTimeSchema.nullable(),
          takenAt: localDateTimeSchema.nullable(),
          // Why the item can't be renamed (gone, locked, its folder read-only), or null.
          cannotRename: z.string().nullable(),
        }),
      ),
      folders: z.array(
        z.object({
          path: z.string().min(1),
          names: z.array(z.string()),
          caseSensitive: z.boolean(),
        }),
      ),
    }),
  },
  // Renames several items, each in its own folder, to the names the sheet settled. A name
  // found taken while renaming is handled as the sheet's setting says.
  "writeOperation:batchRename": {
    request: z.object({
      items: z
        .array(
          z.object({
            sourcePath: absolutePathSchema,
            destinationName: itemNameSchema,
            // Folders have no extension: a number added to a taken name goes at the end.
            isFolder: z.boolean(),
          }),
        )
        .min(1)
        .max(MAX_PATHS_PER_REQUEST),
      onConflict: z.enum(["number", "skip", "block"]),
      // What goes before a number added to a taken name.
      numberSeparator: z.enum([" ", "-", "_"]),
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "writeOperation:createFolder": {
    request: z.object({
      parentDirectoryPath: absolutePathSchema,
      folderName: itemNameSchema,
      // The name is only a suggestion ("New Folder"): when it is taken (by something the
      // window hasn't listed yet), the next free one ("New Folder 2") is used.
      nextFreeName: z.boolean().optional(),
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "writeOperation:trash": {
    request: z.object({
      paths: absolutePathListSchema,
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  "writeOperation:deleteImmediately": {
    request: z.object({
      paths: absolutePathListSchema,
    }),
    response: z.object({
      operationId: z.string().min(1),
      status: z.literal("queued"),
    }),
  },
  // Looks at what undoing (or redoing) the last operation would do, changing nothing: what
  // to ask first, or why it can't be done now. The ticket starts it with "undo:start".
  "undo:prepare": {
    request: z.object({
      direction: undoDirectionSchema,
    }),
    response: z.object({
      ticket: z.string().min(1).nullable(),
      refusal: z.enum(["busy", "nothing", "cant_undo"]).nullable(),
      // What the Edit menu calls it ("Move of “a.txt”"), for saying what was undone.
      label: z.string().nullable(),
      // The operation it undoes (or redoes), for asking in its words.
      action: writeOperationActionSchema.nullable(),
      // Items whose old name is taken by another item now: they go back with a number.
      nameTaken: z.array(z.string()),
      // Items that changed since and would go to the Trash: put back from the Trash, the
      // new item of a Replace, or one the operation made.
      changed: z.array(z.object({ name: z.string(), putBack: z.boolean(), replaced: z.boolean() })),
    }),
  },
  // Starts what "undo:prepare" looked at, once anything it asked was agreed to: all of it,
  // never part.
  "undo:start": {
    request: z.object({
      ticket: z.string().min(1),
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
      recalculate: z.boolean().optional(),
      probeOnly: z.boolean().optional(),
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
      diskBytes: z.number().int().nonnegative().nullable(),
      fileCount: z.number().int().nonnegative().nullable(),
      folderCount: z.number().int().nonnegative().nullable(),
      // The folders inside it whose sizes are known so far: goes up while it runs.
      measuredFolderCount: z.number().int().nonnegative(),
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
  // The size of the volume holding `path` and the space left on it.
  "system:getVolumeInfo": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      availableBytes: z.number().nonnegative().nullable(),
      totalBytes: z.number().nonnegative().nullable(),
    }),
  },
  // Which disk each path is on (its device number, symlinks followed; null when unreadable),
  // in the order asked: a drag moves on one disk and copies to another.
  "system:getDiskIds": {
    request: z.object({
      paths: absolutePathListSchema,
    }),
    response: z.object({
      ids: z.array(z.number().int().nonnegative().nullable()),
    }),
  },
  "system:quickLook": {
    request: z.object({
      path: z.string().min(1),
    }),
    response: z.object({
      ok: z.boolean(),
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
  "system:emptyTrash": {
    request: emptyRequestSchema,
    response: z.object({
      ok: z.boolean(),
      error: z.string().nullable(),
    }),
  },
  // The disks mounted besides the startup disk, by name. They are sent again to every window
  // as `filetrail:volumesChanged` whenever one is mounted or unmounted.
  "system:listVolumes": {
    request: emptyRequestSchema,
    response: z.object({
      volumes: z.array(volumeSchema),
    }),
  },
  // Whether there is anything to empty: the home folder's Trash and other disks' Trashes.
  // null when that can't be told (macOS keeps the Trash from apps without Full Disk Access).
  "system:getTrashState": {
    request: emptyRequestSchema,
    response: z.object({
      empty: z.boolean().nullable(),
    }),
  },
  // Opens Privacy & Security at Full Disk Access, which macOS requires before an app can
  // list the Trash.
  "system:openFullDiskAccessSettings": {
    request: emptyRequestSchema,
    response: z.object({
      ok: z.boolean(),
    }),
  },
  "system:getFileIcon": {
    request: z.object({
      path: z.string().min(1),
      size: z.number().int().min(16).max(512),
      // Return the ordinary icon for a kind of item, regardless of `path`: a folder (which
      // may itself have a custom icon), or a file without an extension, plain or executable.
      generic: z.enum(["folder", "file", "executable"]).optional(),
    }),
    response: z.object({
      pngBase64: z.string().nullable(),
    }),
  },
  // The picture Quick Look draws of a file's content, shown in icon view. `version` stands
  // for the file's state (size and modification time): a caller that holds the picture
  // for a version passes it as `knownVersion` and gets `unchanged` instead of the picture
  // again. `dataUrl` is null when the file has no preview, or cannot be read.
  "system:getFileThumbnail": {
    request: z.object({
      path: z.string().min(1),
      // Longest side in pixels.
      size: z.number().int().min(16).max(1024),
      knownVersion: z.string().min(1).optional(),
    }),
    response: z.object({
      version: z.string().nullable(),
      unchanged: z.boolean(),
      dataUrl: z.string().nullable(),
    }),
  },
} as const;

export type IpcContractSchemas = typeof ipcContractSchemas;
export type IpcChannel = keyof IpcContractSchemas;
export const ipcChannels = Object.keys(ipcContractSchemas) as IpcChannel[];
export type IpcRequest<C extends IpcChannel> = z.output<IpcContractSchemas[C]["request"]>;
export type IpcRequestInput<C extends IpcChannel> = z.input<IpcContractSchemas[C]["request"]>;
export type IpcResponse<C extends IpcChannel> = z.output<IpcContractSchemas[C]["response"]>;
export type CopyPasteOperationResult = z.output<typeof copyPasteOperationResultSchema>;
export type CopyPasteProgressEvent = z.output<typeof copyPasteProgressEventSchema>;
export type CopyPasteRuntimeResolutionAction = z.output<
  typeof copyPasteRuntimeResolutionActionSchema
>;
export type WriteOperationAction = z.output<typeof writeOperationActionSchema>;
export type UndoDirection = z.output<typeof undoDirectionSchema>;
export type WriteOperationResult = z.output<typeof writeOperationResultSchema>;
export type WriteOperationProgressEvent = z.output<typeof writeOperationProgressEventSchema>;
export type SettingsTab = z.output<typeof settingsTabSchema>;
export type Volume = z.output<typeof volumeSchema>;
export type FolderChange = z.output<typeof folderChangeSchema>;
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
