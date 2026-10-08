import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const contractsIndexPath = fileURLToPath(
  new URL("./packages/contracts/src/index.ts", import.meta.url),
);
const contractsDirPath = fileURLToPath(new URL("./packages/contracts/src/", import.meta.url));
const coreIndexPath = fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url));
const coreDirPath = fileURLToPath(new URL("./packages/core/src/", import.meta.url));

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
    ],
    environment: "node",
    globals: true,
    setupFiles: [
      // First, so every temporary folder of the file lands in one that is removed after it.
      "./packages/core/src/testing/tmpdirPerTestFile.ts",
      "./apps/desktop/src/renderer/test/setup.ts",
    ],
    coverage: {
      provider: "v8",
      // Everything that copies, moves, renames, makes, trashes or deletes files, in the core,
      // the main process, the window and the contracts between them. Each file has a floor of
      // its own, so one well-tested file can't hide an untested one.
      include: [
        "packages/core/src/fs/copyPaste{Analysis,Errors,Execution,Fingerprint,Names,Policy,Recovery}.ts",
        "packages/core/src/fs/writeService.ts",
        "packages/core/src/fs/stoppableCopy.ts",
        "packages/core/src/fs/undoLog.ts",
        "packages/contracts/src/{copyPasteChoices,itemName,paths,trash,writeEffects}.ts",
        "apps/desktop/src/main/bootstrap/{writeOperations,replaceJournal,trashItem,diskIds,diskHasTrash,batchRenameExecution,batchRenameInspect,undoHistory,undoPlan,undoExecution}.ts",
        // Folder sizes: what a write does to the sizes shown, and how they are measured.
        "apps/desktop/src/main/bootstrap/{responseCache,folderSizeAdjust}.ts",
        "apps/desktop/src/renderer/hooks/{useFolderSizeCache,useAutoFolderSize}.ts",
        "apps/desktop/src/shared/batchRename.ts",
        "apps/desktop/src/main/ipc.ts",
        // The explorer windows' lives, the menu that follows them, and the IPC that knows
        // which window asks.
        "apps/desktop/src/main/{explorerWindowController,explorerWindows,applicationMenuSync,pageWindows,windowIpcHandlers}.ts",
        "apps/desktop/src/renderer/hooks/{useWriteOperations,useExplorerActions,useExplorerDragAndDrop,useTrashState,useBatchRename,useTextEditingFocus}.ts",
        "apps/desktop/src/renderer/lib/{copyPasteClipboard,copyPasteReview,internalDragAndDrop,undoQuestion}.ts",
        "apps/desktop/src/renderer/components/{CopyPaste*,InlineRenameField,BatchRenameSheet,UndoQuestionAlert}.tsx",
      ],
      thresholds: {
        // The copy engine and the contracts: where a gap can lose data.
        "packages/core/src/fs/**": { statements: 95, branches: 89, functions: 100, lines: 95 },
        "packages/contracts/src/**": { statements: 92, branches: 94, functions: 100, lines: 92 },
        // The main process's file operations.
        "apps/desktop/src/main/{bootstrap/**,ipc.ts}": {
          statements: 95,
          branches: 88,
          functions: 90,
          lines: 95,
        },
        // The explorer windows: opening, closing, merging, quitting, and the menu.
        "apps/desktop/src/main/{explorerWindowController,explorerWindows,applicationMenuSync,pageWindows,windowIpcHandlers}.ts":
          { statements: 95, branches: 88, functions: 95, lines: 95 },
        // Undo and Redo, a floor for each file: a pattern's floor is for all it matches
        // together, so one file well below it could hide among the others.
        "apps/desktop/src/main/bootstrap/undoHistory.ts": {
          statements: 97,
          branches: 90,
          functions: 100,
          lines: 97,
        },
        "apps/desktop/src/main/bootstrap/undoPlan.ts": {
          statements: 97,
          branches: 90,
          functions: 100,
          lines: 97,
        },
        "apps/desktop/src/main/bootstrap/undoExecution.ts": {
          statements: 97,
          branches: 90,
          functions: 100,
          lines: 97,
        },
        // Folder sizes, a floor for each file, from where they are.
        "apps/desktop/src/main/bootstrap/responseCache.ts": {
          statements: 97,
          branches: 92,
          functions: 100,
          lines: 97,
        },
        "apps/desktop/src/main/bootstrap/folderSizeAdjust.ts": {
          statements: 96,
          branches: 95,
          functions: 100,
          lines: 96,
        },
        "apps/desktop/src/renderer/hooks/useFolderSizeCache.ts": {
          statements: 95,
          branches: 84,
          functions: 100,
          lines: 95,
        },
        "apps/desktop/src/renderer/hooks/useAutoFolderSize.ts": {
          statements: 91,
          branches: 92,
          functions: 100,
          lines: 91,
        },
        // The names a rename of several items gives: what the preview shows is what is done.
        "apps/desktop/src/shared/batchRename.ts": {
          statements: 97,
          branches: 92,
          functions: 100,
          lines: 97,
        },
        // The window. The large hooks start from where they are, so they can only go up.
        "apps/desktop/src/renderer/hooks/useExplorerActions.ts": {
          statements: 77,
          branches: 71,
          functions: 81,
          lines: 77,
        },
        "apps/desktop/src/renderer/hooks/useExplorerDragAndDrop.ts": {
          statements: 87,
          branches: 77,
          functions: 93,
          lines: 87,
        },
        "apps/desktop/src/renderer/{lib,components}/**": {
          statements: 93,
          branches: 83,
          functions: 85,
          lines: 93,
        },
        "apps/desktop/src/renderer/hooks/useBatchRename.ts": {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
        "apps/desktop/src/renderer/hooks/{useWriteOperations,useTrashState}.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@filetrail\/contracts\/(.*)$/,
        replacement: `${contractsDirPath}$1`,
      },
      {
        find: "@filetrail/contracts",
        replacement: contractsIndexPath,
      },
      {
        find: /^@filetrail\/core\/(.*)$/,
        replacement: `${coreDirPath}$1`,
      },
      {
        find: "@filetrail/core",
        replacement: coreIndexPath,
      },
    ],
  },
});
