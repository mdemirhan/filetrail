// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { InfoPanel, describeOwnerAccess } from "./GetInfoPanel";

const baseItem = {
  path: "/Users/demo/projects/filetrail/README.md",
  name: "README.md",
  extension: "md",
  kind: "file" as const,
  kindLabel: "Markdown document",
  isHidden: false,
  isSymlink: false,
  createdAt: "2026-03-01T09:00:00.000Z",
  modifiedAt: "2026-03-02T10:30:00.000Z",
  sizeBytes: 2048,
  sizeStatus: "ready" as const,
  permissionMode: 0o644,
};

const bundleItem = {
  ...baseItem,
  path: "/Applications/File Trail.app",
  name: "File Trail.app",
  extension: "app",
  kind: "bundle" as const,
  kindLabel: "Application",
  sizeBytes: null,
  sizeStatus: "deferred" as const,
  permissionMode: 0o755,
};

describe("InfoPanel", () => {
  it("sums up several selected items instead of describing the first", () => {
    const onNavigateToPath = vi.fn();
    const props = {
      loading: false,
      item: baseItem,
      onClose: () => undefined,
      onNavigateToPath,
      onOpen: () => undefined,
      onOpenInTerminal: () => undefined,
      onShowInFinder: () => undefined,
      onCopyPath: () => true,
    };
    const { rerender } = render(
      <InfoPanel
        {...props}
        selection={{
          count: 3,
          folderCount: 1,
          fileCount: 2,
          totalBytes: null,
          parentPath: "/Users/demo/projects",
        }}
      />,
    );

    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(screen.getByText("1 folder and 2 files")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "projects" }));
    expect(onNavigateToPath).toHaveBeenCalledWith("/Users/demo/projects");

    rerender(
      <InfoPanel
        {...props}
        selection={{ count: 2, folderCount: 0, fileCount: 2, totalBytes: 4000, parentPath: null }}
      />,
    );
    expect(screen.getByText("2 files · 4.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Several folders")).toBeInTheDocument();

    // Folders among them: the Size row offers to calculate, as for one folder.
    const onCalculateFolderSize = vi.fn();
    rerender(
      <InfoPanel
        {...props}
        selection={{ count: 2, folderCount: 1, fileCount: 1, totalBytes: null, parentPath: null }}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={onCalculateFolderSize}
        onCancelFolderSize={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(onCalculateFolderSize).toHaveBeenCalledTimes(1);

    // One item selected: the item itself.
    rerender(
      <InfoPanel
        {...props}
        selection={{ count: 1, folderCount: 0, fileCount: 1, totalBytes: 2048, parentPath: null }}
      />,
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("shows nothing while the first item loads, a spinner only if it takes a while", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <InfoPanel
        loading
        item={null}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
      />,
    );
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
    expect(screen.queryByText("Select a file or folder to show its info.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Loading info")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByLabelText("Loading info")).toBeInTheDocument();

    rerender(
      <InfoPanel
        loading={false}
        item={null}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
      />,
    );
    expect(screen.getByText("Select a file or folder to show its info.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading info")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows a preview in place while the rest of the details load", () => {
    vi.useFakeTimers();
    const preview = {
      ...baseItem,
      createdAt: null,
      permissionMode: null,
    };
    render(
      <InfoPanel
        loading
        pending
        item={preview}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
      />,
    );
    expect(screen.getByText("README.md", { selector: ".get-info-name" })).toBeInTheDocument();
    expect(screen.getByText("Created").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("Permissions").nextElementSibling).toHaveTextContent("—");
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Loading info")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByLabelText("Loading info")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders metadata and action handlers for files", async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const onNavigateToPath = vi.fn();
    const onOpen = vi.fn();
    const onOpenInTerminal = vi.fn();
    const onShowInFinder = vi.fn();
    const onCopyPath = vi.fn().mockResolvedValue(true);

    render(
      <InfoPanel
        loading={false}
        item={baseItem}
        onClose={onClose}
        onNavigateToPath={onNavigateToPath}
        onOpen={onOpen}
        onOpenInTerminal={onOpenInTerminal}
        onShowInFinder={onShowInFinder}
        onCopyPath={onCopyPath}
      />,
    );

    expect(screen.getByText("Markdown document")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Read & Write")).toBeInTheDocument();
    expect(screen.getByText("644")).toHaveAttribute("title", "rw-r--r--");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Open in Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Path" }));

    await act(async () => {});
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpenInTerminal).toHaveBeenCalledTimes(1);
    expect(onShowInFinder).toHaveBeenCalledTimes(1);
    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    // "Where" shows the containing folder and navigates to it.
    fireEvent.click(screen.getByRole("button", { name: "filetrail" }));
    expect(onNavigateToPath).toHaveBeenCalledWith("/Users/demo/projects/filetrail");

    fireEvent.click(screen.getByRole("button", { name: "Hide Info Panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copy Path" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("offers the optional quick actions only when their handlers are given", async () => {
    const onQuickLook = vi.fn();
    const onEdit = vi.fn();
    const onCopyName = vi.fn().mockResolvedValue(true);
    const onToggleFavorite = vi.fn();
    const onRootTree = vi.fn();
    const requiredProps = {
      loading: false,
      item: baseItem,
      onClose: () => undefined,
      onNavigateToPath: () => undefined,
      onOpen: () => undefined,
      onOpenInTerminal: () => undefined,
      onShowInFinder: () => undefined,
      onCopyPath: () => true,
    };

    const { rerender } = render(<InfoPanel {...requiredProps} />);

    for (const name of [
      "Quick Look",
      "Edit in TextEdit",
      "Copy Name",
      "Add to Favorites",
      "Use as Tree Root",
    ]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }

    rerender(
      <InfoPanel
        {...requiredProps}
        onQuickLook={onQuickLook}
        onEdit={onEdit}
        textEditorName="TextEdit"
        onCopyName={onCopyName}
        onToggleFavorite={onToggleFavorite}
        onRootTree={onRootTree}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use as Tree Root" }));
    fireEvent.click(screen.getByRole("button", { name: "Quick Look" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit in TextEdit" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Favorites" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Name" }));
    await act(async () => {});

    expect(onQuickLook).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onRootTree).toHaveBeenCalledTimes(1);
    expect(onCopyName).toHaveBeenCalledTimes(1);
    // Only the row that was used confirms the copy.
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Path" })).toBeInTheDocument();

    rerender(<InfoPanel {...requiredProps} isFavorite onToggleFavorite={onToggleFavorite} />);
    expect(screen.getByRole("button", { name: "Remove from Favorites" })).toBeInTheDocument();
  });

  it("shows directory placeholders instead of file-only metadata", () => {
    render(
      <InfoPanel
        loading={false}
        item={{
          ...baseItem,
          path: "/Users/demo/projects",
          name: "projects",
          extension: "",
          kind: "directory",
          kindLabel: "Folder",
          sizeBytes: null,
          sizeStatus: "deferred",
          createdAt: null,
          modifiedAt: null,
          permissionMode: null,
        }}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
      />,
    );

    expect(screen.getAllByText("Folder").length).toBeGreaterThan(0);
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getAllByText("Not available")).toHaveLength(2);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("shows Calculate button when folder size is idle", () => {
    render(
      <InfoPanel
        loading={false}
        item={{
          ...baseItem,
          path: "/Users/demo/projects",
          name: "projects",
          extension: "",
          kind: "directory",
          kindLabel: "Folder",
          sizeBytes: null,
          sizeStatus: "deferred",
          createdAt: null,
          modifiedAt: null,
          permissionMode: null,
        }}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Calculate" })).toBeInTheDocument();
  });

  it("shows Calculate button for bundles instead of deferred placeholder text", () => {
    render(
      <InfoPanel
        loading={false}
        item={bundleItem}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Calculate" })).toBeInTheDocument();
    expect(screen.queryByText("Not yet available")).not.toBeInTheDocument();
  });

  it("shows spinner when folder size is calculating, once it takes a moment", async () => {
    render(
      <InfoPanel
        loading={false}
        item={{
          ...baseItem,
          path: "/Users/demo/projects",
          name: "projects",
          extension: "",
          kind: "directory",
          kindLabel: "Folder",
          sizeBytes: null,
          sizeStatus: "deferred",
          createdAt: null,
          modifiedAt: null,
          permissionMode: null,
        }}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{ status: "calculating", jobId: "job-1" }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Cancel folder size calculation" }),
    ).toBeInTheDocument();
  });

  it("shows formatted size with disk info and item count when ready", () => {
    render(
      <InfoPanel
        loading={false}
        item={{
          ...baseItem,
          path: "/Users/demo/projects",
          name: "projects",
          extension: "",
          kind: "directory",
          kindLabel: "Folder",
          sizeBytes: null,
          sizeStatus: "deferred",
          createdAt: null,
          modifiedAt: null,
          permissionMode: null,
        }}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 1048576,
          diskBytes: 1572864,
          fileCount: 43016,
          folderCount: 3,
        }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    // Size text should include the logical size and disk size
    expect(screen.getAllByText(/1\.0 MB/).length).toBeGreaterThan(0);
    expect(screen.getByText(/on disk/)).toBeInTheDocument();
    // What it holds, files then folders
    expect(screen.getByText(/^43,016 files, 3 folders$/)).toBeInTheDocument();
    // Recalculate button present
    expect(screen.getByRole("button", { name: "Recalculate folder size" })).toBeInTheDocument();
  });

  it("shows cached bundle size when ready", () => {
    render(
      <InfoPanel
        loading={false}
        item={bundleItem}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 1048576,
          diskBytes: 1572864,
          fileCount: 43016,
          folderCount: 3,
        }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getAllByText(/1\.0 MB/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Recalculate folder size" })).toBeInTheDocument();
  });

  it("Calculate button calls onCalculateFolderSize", () => {
    const onCalculate = vi.fn();
    render(
      <InfoPanel
        loading={false}
        item={{
          ...baseItem,
          path: "/Users/demo/projects",
          name: "projects",
          extension: "",
          kind: "directory",
          kindLabel: "Folder",
          sizeBytes: null,
          sizeStatus: "deferred",
          createdAt: null,
          modifiedAt: null,
          permissionMode: null,
        }}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={onCalculate}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(onCalculate).toHaveBeenCalledTimes(1);
  });

  it("Cancel button calls onCancelFolderSize", async () => {
    const onCancel = vi.fn();
    render(
      <InfoPanel
        loading={false}
        item={{
          ...baseItem,
          path: "/Users/demo/projects",
          name: "projects",
          extension: "",
          kind: "directory",
          kindLabel: "Folder",
          sizeBytes: null,
          sizeStatus: "deferred",
          createdAt: null,
          modifiedAt: null,
          permissionMode: null,
        }}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        folderSizeEntry={{ status: "calculating", jobId: "job-1" }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={onCancel}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Cancel folder size calculation" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("describes permissions from the owner's point of view", () => {
    expect(describeOwnerAccess("rw-r--r--")).toBe("Read & Write");
    expect(describeOwnerAccess("-r--r--r--")).toBe("Read only");
    expect(describeOwnerAccess("drwx------")).toBe("Read & Write");
    expect(describeOwnerAccess("---------")).toBe("No access");
  });

  it("closes the Open With menu on an outside click or Escape and runs the chosen app", () => {
    const onOpenWith = vi.fn();
    render(
      <div>
        <button type="button">Outside</button>
        <InfoPanel
          loading={false}
          item={baseItem}
          onClose={() => undefined}
          onNavigateToPath={() => undefined}
          onOpen={() => undefined}
          onOpenInTerminal={() => undefined}
          onShowInFinder={() => undefined}
          onCopyPath={() => true}
          openWithItems={[
            {
              action: {
                kind: "application",
                id: "zed",
                label: "Zed",
                appPath: "/Applications/Zed.app",
                appName: "Zed",
              },
            },
          ]}
          onOpenWith={onOpenWith}
        />
      </div>,
    );

    const trigger = screen.getByRole("button", { name: /Open With/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Zed" }));
    expect(onOpenWith).toHaveBeenCalledWith(expect.objectContaining({ id: "zed" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("highlights the Open With item under the pointer, as the right-click menu does", () => {
    render(
      <InfoPanel
        loading={false}
        item={baseItem}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onShowInFinder={() => undefined}
        onCopyPath={() => true}
        openWithItems={[
          {
            action: {
              kind: "application",
              id: "zed",
              label: "Zed",
              appPath: "/Applications/Zed.app",
              appName: "Zed",
            },
          },
          {
            action: {
              kind: "application",
              id: "textedit",
              label: "TextEdit",
              appPath: "/System/Applications/TextEdit.app",
              appName: "TextEdit",
            },
          },
        ]}
        onOpenWith={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open With/ }));
    const zed = screen.getByRole("menuitem", { name: "Zed" });
    const textEdit = screen.getByRole("menuitem", { name: "TextEdit" });
    expect(zed).not.toHaveClass("active");

    fireEvent.mouseEnter(zed);
    expect(zed).toHaveClass("active");
    fireEvent.mouseEnter(textEdit);
    expect(zed).not.toHaveClass("active");
    expect(textEdit).toHaveClass("active");

    fireEvent.mouseLeave(screen.getByRole("menu"));
    expect(textEdit).not.toHaveClass("active");
  });
});
