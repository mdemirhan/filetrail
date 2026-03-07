import { z } from "zod";

export const explorerEntryKindSchema = z.enum([
  "directory",
  "file",
  "symlink_directory",
  "symlink_file",
  "other",
]);

export const themeModeSchema = z.enum(["light", "tomorrow-night", "catppuccin-mocha"]);
export const uiFontFamilySchema = z.enum(["dm-sans", "lexend", "fira-code", "jetbrains-mono"]);
export const colorOverrideSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable();
export const explorerViewModeSchema = z.enum(["list", "details"]);
export const directorySortBySchema = z.enum(["name", "modified", "kind", "size"]);
export const sortDirectionSchema = z.enum(["asc", "desc"]);

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
  sizeStatus: z.enum(["ready", "deferred", "unavailable"]),
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
  sizeStatus: z.enum(["ready", "deferred", "unavailable"]),
});

export const pathSuggestionSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  isDirectory: z.boolean(),
});

export const resolvedPathSchema = z.object({
  inputPath: z.string().min(1),
  resolvedPath: z.string().nullable(),
});

export const appPreferencesSchema = z.object({
  theme: themeModeSchema,
  uiFontFamily: uiFontFamilySchema,
  uiFontSize: z.number().int().min(12).max(15),
  uiFontWeight: z.union([z.literal(400), z.literal(500), z.literal(600)]),
  textPrimaryOverride: colorOverrideSchema,
  textSecondaryOverride: colorOverrideSchema,
  textMutedOverride: colorOverrideSchema,
  viewMode: explorerViewModeSchema,
  propertiesOpen: z.boolean(),
  detailRowOpen: z.boolean(),
  includeHidden: z.boolean(),
  treeWidth: z.number().int().min(220).max(520),
  inspectorWidth: z.number().int().min(260).max(480),
  restoreLastVisitedFolderOnStartup: z.boolean(),
  treeRootPath: z.string().min(1).nullable(),
  lastVisitedPath: z.string().min(1).nullable(),
});

export const folderSizeJobStatusSchema = z.enum([
  "queued",
  "running",
  "deferred",
  "ready",
  "cancelled",
  "error",
]);

export const ipcContractSchemas = {
  "app:getHomeDirectory": {
    request: z.object({}),
    response: z.object({
      path: z.string().min(1),
    }),
  },
  "app:getPreferences": {
    request: z.object({}),
    response: z.object({
      preferences: appPreferencesSchema,
    }),
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
    request: z.object({}),
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
} as const;

export type IpcContractSchemas = typeof ipcContractSchemas;
export type IpcChannel = keyof IpcContractSchemas;
export const ipcChannels = Object.keys(ipcContractSchemas) as IpcChannel[];
export type IpcRequest<C extends IpcChannel> = z.output<IpcContractSchemas[C]["request"]>;
export type IpcRequestInput<C extends IpcChannel> = z.input<IpcContractSchemas[C]["request"]>;
export type IpcResponse<C extends IpcChannel> = z.output<IpcContractSchemas[C]["response"]>;

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IpcValidationError";
  }
}
