// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { AppDialogs } from "./AppDialogs";

vi.mock("./TextPromptDialog", () => ({
  TextPromptDialog: (props: {
    open: boolean;
    title: string;
    selectAllOnOpen?: boolean;
    value: string;
    label: string;
  }) =>
    props.open ? (
      <div
        data-testid={`text-prompt-dialog-${props.title}`}
        data-label={props.label}
        data-select-all-on-open={props.selectAllOnOpen ? "true" : "false"}
        data-value={props.value}
      />
    ) : null,
}));

describe("AppDialogs", () => {
  function renderAppDialogs(
    overrides: Partial<Parameters<typeof AppDialogs>[0]> = {},
  ) {
    return render(
      <AppDialogs
        locationSheetOpen={false}
        currentPath="/tmp"
        locationSubmitting={false}
        locationError={null}
        tabSwitchesExplorerPanes={false}
        onRequestPathSuggestions={async (inputPath) => ({
          inputPath,
          basePath: null,
          suggestions: [],
        })}
        onCloseLocationSheet={() => undefined}
        onSubmitLocationPath={() => undefined}
        moveDialogState={null}
        onBrowseForDirectoryPath={async () => null}
        onCloseMoveDialog={() => undefined}
        onSubmitMoveDialog={() => undefined}
        contextMenuState={null}
        contextMenuDisabledActionIds={[]}
        contextMenuFavoriteToggleLabel={null}
        contextMenuHiddenActionIds={[]}
        contextMenuSubmenuItems={[]}
        shortcutContext={{
          actionNoticeOpen: false,
          copyPasteModalOpen: false,
          focusedPane: "content",
          locationSheetOpen: false,
          mainView: "explorer",
          selectedTreeTargetKind: null,
        }}
        onRunContextMenuAction={() => undefined}
        onRunContextSubmenuAction={() => undefined}
        actionNotice={null}
        onDismissActionNotice={() => undefined}
        renameDialogState={null}
        onCloseRenameDialog={() => undefined}
        onSubmitRenameDialog={() => undefined}
        newFolderDialogState={null}
        onCloseNewFolderDialog={() => undefined}
        onSubmitNewFolderDialog={() => undefined}
        copyPasteDialogState={null}
        onRequestCopyLikePlanStart={() => undefined}
        onUpdateCopyPastePolicy={() => undefined}
        onCloseCopyPasteDialog={() => undefined}
        onConfirmTrashDialog={() => undefined}
        showCopyPasteProgressCard={false}
        writeOperationCardState={null}
        onCancelWriteOperation={() => undefined}
        showCopyPasteResultDialog={false}
        writeOperationProgressEvent={null}
        onResolveRuntimeConflict={() => undefined}
        onRetryFailedCopyPasteItems={() => undefined}
        toasts={[]}
        onDismissToast={() => undefined}
        copyPasteReviewDialogSize={null}
        onCopyPasteReviewDialogSizeChange={() => undefined}
        {...overrides}
      />,
    );
  }

  it("opts New Folder into select-all on open", () => {
    renderAppDialogs({
      newFolderDialogState: {
        parentDirectoryPath: "/tmp",
        initialName: "New Folder",
        error: null,
      },
    });

    expect(screen.getByTestId("text-prompt-dialog-New Folder")).toHaveAttribute(
      "data-select-all-on-open",
      "true",
    );
  });

  it("keeps rename on the default prompt behavior", () => {
    renderAppDialogs({
      renameDialogState: {
        sourcePath: "/tmp/demo.txt",
        currentName: "demo.txt",
        error: null,
      },
    });

    expect(screen.getByTestId("text-prompt-dialog-Rename")).toHaveAttribute(
      "data-select-all-on-open",
      "false",
    );
  });
});
