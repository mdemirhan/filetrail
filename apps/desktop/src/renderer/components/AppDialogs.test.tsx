// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import type { WriteOperationsState } from "../hooks/useWriteOperations";
import { ExplorerStoreProvider } from "../state/explorerStoreContext";
import type {
  NavigationStore,
  PreferencesStore,
  WriteOperationsStore,
} from "../state/explorerStores";
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
  function createNavigationStore(): NavigationStore {
    return {
      locationSheetOpen: false,
      locationSubmitting: false,
      locationError: null,
      setLocationSheetOpen: vi.fn(),
    } as unknown as NavigationStore;
  }

  function createDialogStore(overrides: Partial<WriteOperationsState> = {}): WriteOperationsStore {
    return {
      contextMenuState: null,
      actionNotice: null,
      toasts: [],
      copyPasteDialogState: null,
      writeOperationCardState: null,
      writeOperationProgressEvent: null,
      renameDialogState: null,
      newFolderDialogState: null,
      moveDialogState: null,
      setMoveDialogState: vi.fn(),
      setRenameDialogState: vi.fn(),
      setNewFolderDialogState: vi.fn(),
      ...overrides,
    } as unknown as WriteOperationsStore;
  }

  function createPreferencesStore(): PreferencesStore {
    return {} as unknown as PreferencesStore;
  }

  function renderAppDialogs(
    overrides: Partial<Parameters<typeof AppDialogs>[0]> = {},
    dialogOverrides: Partial<WriteOperationsState> = {},
  ) {
    return render(
      <ExplorerStoreProvider
        navigation={createNavigationStore()}
        dialogs={createDialogStore(dialogOverrides)}
        preferences={createPreferencesStore()}
      >
        <AppDialogs
          currentPath="/tmp"
          places={[]}
          onForgetPlace={() => undefined}
          onRequestPathSuggestions={async (inputPath) => ({
            inputPath,
            basePath: null,
            suggestions: [],
          })}
          onSubmitLocationPath={() => undefined}
          onBrowseForDirectoryPath={async () => null}
          onSubmitMoveDialog={() => undefined}
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
          onDismissActionNotice={() => undefined}
          onSubmitRenameDialog={() => undefined}
          onSubmitNewFolderDialog={() => undefined}
          onRequestCopyLikePlanStart={() => Promise.resolve(true)}
          onUpdateCopyPasteChoices={() => undefined}
          onCloseCopyPasteDialog={() => undefined}
          onCloseConfirmationDialog={() => undefined}
          onConfirmTrashDialog={() => undefined}
          onConfirmDeleteImmediatelyDialog={() => undefined}
          onConfirmEmptyTrashDialog={() => undefined}
          onConfirmDotNameDialog={() => undefined}
          showCopyPasteProgressCard={false}
          onCancelWriteOperation={() => undefined}
          showCopyPasteResultDialog={false}
          onResolveRuntimeConflict={() => undefined}
          onRetryFailedCopyPasteItems={() => undefined}
          onDismissToast={() => undefined}
          {...overrides}
        />
      </ExplorerStoreProvider>,
    );
  }

  it("opts New Folder into select-all on open", () => {
    renderAppDialogs(
      {},
      {
        newFolderDialogState: {
          parentDirectoryPath: "/tmp",
          initialName: "New Folder",
          error: null,
          selectInTreeOnSuccess: false,
        },
      },
    );

    expect(screen.getByTestId("text-prompt-dialog-New Folder")).toHaveAttribute(
      "data-select-all-on-open",
      "true",
    );
  });

  it("keeps rename on the default prompt behavior", () => {
    renderAppDialogs(
      {},
      {
        renameDialogState: {
          sourcePath: "/tmp/demo.txt",
          currentName: "demo.txt",
          error: null,
          refusalCount: 0,
          inline: false,
          sessionId: 1,
        },
      },
    );

    expect(screen.getByTestId("text-prompt-dialog-Rename “demo.txt”")).toHaveAttribute(
      "data-select-all-on-open",
      "false",
    );
  });

  it("starts Delete Immediately on Cancel so Enter cannot permanently delete", async () => {
    const onConfirmDeleteImmediatelyDialog = vi.fn();
    renderAppDialogs(
      { onConfirmDeleteImmediatelyDialog },
      {
        copyPasteDialogState: {
          type: "confirmDeleteImmediately",
          paths: ["/tmp/demo.txt"],
          itemLabel: "demo.txt",
        },
      },
    );

    await act(async () => {});
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Are you sure you want to delete “demo.txt”?" }),
      {
        key: "Enter",
      },
    );
    expect(onConfirmDeleteImmediatelyDialog).not.toHaveBeenCalled();
  });

  it("keeps Move to Trash confirmable with Enter because it can be undone", async () => {
    renderAppDialogs(
      {},
      {
        copyPasteDialogState: {
          type: "confirmTrash",
          paths: ["/tmp/demo.txt"],
          itemLabel: "demo.txt",
        },
      },
    );

    await act(async () => {});
    expect(screen.getByRole("button", { name: "Move to Trash" })).toHaveFocus();
  });
  it("asks before a name that begins with a dot, with Cancel as the default", async () => {
    const onConfirmDotNameDialog = vi.fn();
    const onCloseConfirmationDialog = vi.fn();
    renderAppDialogs(
      { onConfirmDotNameDialog, onCloseConfirmationDialog },
      {
        copyPasteDialogState: {
          type: "confirmDotName",
          request: { kind: "rename", sourcePath: "/tmp/foo", name: ".foo" },
        },
      },
    );

    await act(async () => {});
    const dialog = screen.getByRole("dialog", {
      name: "Are you sure you want to use a name that begins with a dot (“.”)?",
    });
    expect(dialog).toHaveTextContent(
      "These names are reserved for the system. If you continue, the item will be hidden.",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    // Return on the dialog itself presses Cancel, the default, and does not take the dot name.
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onConfirmDotNameDialog).not.toHaveBeenCalled();
    expect(onCloseConfirmationDialog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Use “.”" }));
    expect(onConfirmDotNameDialog).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCloseConfirmationDialog).toHaveBeenCalledTimes(2);
  });
});
