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
    const onCopyPath = vi.fn().mockResolvedValue(true);

    render(
      <InfoPanel
        loading={false}
        item={baseItem}
        onClose={onClose}
        onNavigateToPath={onNavigateToPath}
        onOpen={onOpen}
        onOpenInTerminal={onOpenInTerminal}
        onCopyPath={onCopyPath}
      />,
    );

    expect(screen.getByText("Markdown document")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Read & Write")).toBeInTheDocument();
    expect(screen.getByText("644")).toHaveAttribute("title", "rw-r--r--");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Path" }));

    await act(async () => {});
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpenInTerminal).toHaveBeenCalledTimes(1);
    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    // "Where" shows the containing folder and navigates to it.
    fireEvent.click(screen.getByRole("button", { name: "filetrail" }));
    expect(onNavigateToPath).toHaveBeenCalledWith("/Users/demo/projects/filetrail");

    fireEvent.click(screen.getByRole("button", { name: "Close Toggle Info Panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copy Path" })).toBeInTheDocument();
    vi.useRealTimers();
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
        onCopyPath={() => true}
      />,
    );

    expect(screen.getAllByText("Folder").length).toBeGreaterThan(0);
    expect(screen.getByText("-")).toBeInTheDocument();
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

  it("shows spinner when folder size is calculating", () => {
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
        onCopyPath={() => true}
        folderSizeEntry={{ status: "calculating", jobId: "job-1" }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Cancel folder size calculation" }),
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
        onCopyPath={() => true}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 1048576,
          diskBytes: 1572864,
          fileCount: 43016,
        }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    // Size text should include the logical size and disk size
    expect(screen.getAllByText(/1\.0 MB/).length).toBeGreaterThan(0);
    expect(screen.getByText(/on disk/)).toBeInTheDocument();
    // Item count
    const itemsText = screen.getByText(/items/);
    expect(itemsText).toBeInTheDocument();
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
        onCopyPath={() => true}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 1048576,
          diskBytes: 1572864,
          fileCount: 43016,
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

  it("Cancel button calls onCancelFolderSize", () => {
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
        onCopyPath={() => true}
        folderSizeEntry={{ status: "calculating", jobId: "job-1" }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel folder size calculation" }));
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
});
