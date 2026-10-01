// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { InfoRow } from "./InfoRow";

const baseItem = {
  path: "/Users/demo/projects",
  name: "projects",
  extension: "",
  kind: "directory" as const,
  kindLabel: "Folder",
  isHidden: false,
  isSymlink: false,
  createdAt: "2026-03-01T09:00:00.000Z",
  modifiedAt: "2026-03-02T10:30:00.000Z",
  sizeBytes: null,
  sizeStatus: "deferred" as const,
  permissionMode: 0o755,
};

const baseEntry = {
  path: "/Users/demo/projects",
  name: "projects",
  extension: "",
  kind: "directory" as const,
  isHidden: false,
  isSymlink: false,
};

const fileItem = {
  path: "/Users/demo/file.txt",
  name: "file.txt",
  extension: "txt",
  kind: "file" as const,
  kindLabel: "TXT File",
  isHidden: false,
  isSymlink: false,
  createdAt: "2026-03-01T09:00:00.000Z",
  modifiedAt: "2026-03-02T10:30:00.000Z",
  sizeBytes: 2048,
  sizeStatus: "ready" as const,
  permissionMode: 0o644,
};

const fileEntry = {
  path: "/Users/demo/file.txt",
  name: "file.txt",
  extension: "txt",
  kind: "file" as const,
  isHidden: false,
  isSymlink: false,
};

const bundleItem = {
  path: "/Applications/File Trail.app",
  name: "File Trail.app",
  extension: "app",
  kind: "bundle" as const,
  kindLabel: "Application",
  isHidden: false,
  isSymlink: false,
  createdAt: "2026-03-01T09:00:00.000Z",
  modifiedAt: "2026-03-02T10:30:00.000Z",
  sizeBytes: null,
  sizeStatus: "deferred" as const,
  permissionMode: 0o755,
};

const bundleEntry = {
  path: "/Applications/File Trail.app",
  name: "File Trail.app",
  extension: "app",
  kind: "bundle" as const,
  isHidden: false,
  isSymlink: false,
};

describe("InfoRow", () => {
  it("shows Calculate when folder size is idle", () => {
    render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={baseEntry}
        item={baseItem}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Calculate" })).toBeInTheDocument();
  });

  it("shows spinner when folder size is calculating", () => {
    render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={baseEntry}
        item={baseItem}
        folderSizeEntry={{ status: "calculating", jobId: "job-1" }}
        onCalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Cancel folder size calculation" }),
    ).toBeInTheDocument();
  });

  it("shows formatted size with disk and items when ready", () => {
    render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={baseEntry}
        item={baseItem}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 1048576,
          diskBytes: 1572864,
          fileCount: 500,
        }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/on disk/)).toBeInTheDocument();
    expect(screen.getByText(/items/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recalculate folder size" })).toBeInTheDocument();
  });

  it("shows regular size for file entries (no Calculate button)", () => {
    render(<InfoRow open currentPath="/Users/demo" selectedEntry={fileEntry} item={fileItem} />);

    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calculate" })).not.toBeInTheDocument();
  });

  it("shows Calculate for bundle entries", () => {
    render(
      <InfoRow
        open
        currentPath="/Applications"
        selectedEntry={bundleEntry}
        item={bundleItem}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "Calculate" })).toBeInTheDocument();
    expect(screen.queryByText("Not yet available")).not.toBeInTheDocument();
  });

  it("shows cached bundle size when ready", () => {
    render(
      <InfoRow
        open
        currentPath="/Applications"
        selectedEntry={bundleEntry}
        item={bundleItem}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 1048576,
          diskBytes: 1572864,
          fileCount: 500,
        }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recalculate folder size" })).toBeInTheDocument();
  });

  it("Calculate button triggers onCalculateFolderSize", () => {
    const onCalculate = vi.fn();
    render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={baseEntry}
        item={baseItem}
        folderSizeEntry={{ status: "idle" }}
        onCalculateFolderSize={onCalculate}
        onCancelFolderSize={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Calculate" }));
    expect(onCalculate).toHaveBeenCalledTimes(1);
  });
});

describe("InfoRow with list metadata", () => {
  it("shows the selected file's details from the listing before its properties arrive", () => {
    render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={fileEntry}
        metadata={{
          path: fileEntry.path,
          kindLabel: "Plain Text Document",
          createdAt: null,
          modifiedAt: "2026-03-02T10:30:00.000Z",
          sizeBytes: 2048,
          sizeStatus: "ready",
          permissionMode: 0o644,
        }}
        // Still the previous item's properties.
        item={baseItem}
      />,
    );

    expect(screen.getByText("Plain Text Document")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("rw-r--r-- (644)")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("keeps the full name available as a tooltip", () => {
    const longName = `${"a very long file name ".repeat(8)}.txt`;
    render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={{ ...fileEntry, path: `/Users/demo/${longName}`, name: longName }}
        item={null}
      />,
    );
    expect(screen.getByTitle(longName)).toHaveClass("dt-name");
  });
});
