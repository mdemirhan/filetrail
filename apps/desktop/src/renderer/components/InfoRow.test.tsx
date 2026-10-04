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

    expect(screen.getByRole("button", { name: "Calculate size" })).toBeInTheDocument();
  });

  it("shows spinner when folder size is calculating, once it takes a moment", async () => {
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
      await screen.findByRole("button", { name: "Cancel folder size calculation" }),
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
          folderCount: 3,
        }}
        onCalculateFolderSize={() => undefined}
        onRecalculateFolderSize={() => undefined}
        onCancelFolderSize={() => undefined}
      />,
    );

    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/on disk/)).toBeInTheDocument();
    expect(screen.getByText(/500 files, 3 folders/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recalculate folder size" })).toBeInTheDocument();
  });

  it("shows regular size for file entries (no Calculate button)", () => {
    render(<InfoRow open currentPath="/Users/demo" selectedEntry={fileEntry} item={fileItem} />);

    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Calculate size" })).not.toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "Calculate size" })).toBeInTheDocument();
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
          folderCount: 3,
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

    fireEvent.click(screen.getByRole("button", { name: "Calculate size" }));
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
    expect(screen.getByText(/^Modified /)).toBeInTheDocument();
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
    expect(screen.getByTitle(longName)).toHaveClass("info-row-name");
  });
});

describe("InfoRow as one line", () => {
  it("lists the facts without labels, and leaves out permissions and unknowns", () => {
    const { container } = render(
      <InfoRow open currentPath="/Users/demo" selectedEntry={fileEntry} item={fileItem} />,
    );

    const facts = Array.from(container.querySelectorAll(".info-row-fact")).map(
      (fact) => fact.textContent,
    );
    expect(facts).toEqual(["TXT File", "2.0 KB", expect.stringMatching(/^Modified /)]);
    expect(container.querySelector(".info-row-name")).toHaveTextContent("file.txt");
    for (const label of ["Kind", "Size", "Permissions", "644"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("leaves out a size that isn't known yet instead of a dash", () => {
    const { container } = render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={fileEntry}
        item={{ ...fileItem, sizeBytes: null, sizeStatus: "deferred" }}
      />,
    );

    expect(
      Array.from(container.querySelectorAll(".info-row-fact")).map((fact) => fact.textContent),
    ).toEqual(["TXT File", expect.stringMatching(/^Modified /)]);
  });

  it("sums up several selected items", () => {
    const { container, rerender } = render(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={fileEntry}
        item={fileItem}
        selectionCount={3}
        selectionTotalBytes={3_000_000}
      />,
    );
    expect(container.querySelector(".info-row-name")).toHaveTextContent("3 items");
    expect(screen.getByText("3.0 MB")).toBeInTheDocument();

    // A folder among them: no total.
    rerender(
      <InfoRow
        open
        currentPath="/Users/demo"
        selectedEntry={fileEntry}
        item={fileItem}
        selectionCount={3}
        selectionTotalBytes={null}
      />,
    );
    expect(container.querySelectorAll(".info-row-fact")).toHaveLength(0);
  });

  it("offers to calculate the size of several items with folders among them", () => {
    const onCalculate = vi.fn();
    const props = {
      open: true,
      currentPath: "/Users/demo",
      selectedEntry: fileEntry,
      item: fileItem,
      selectionCount: 3,
      onCalculateFolderSize: onCalculate,
      onCancelFolderSize: () => undefined,
    };
    const { container, rerender } = render(
      <InfoRow {...props} selectionTotalBytes={null} folderSizeEntry={{ status: "idle" }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Calculate size" }));
    expect(onCalculate).toHaveBeenCalledTimes(1);

    // Every size known: the total, and what it holds.
    rerender(
      <InfoRow
        {...props}
        selectionTotalBytes={5_000_000}
        folderSizeEntry={{
          status: "ready",
          sizeBytes: 5_000_000,
          diskBytes: 5_000_000,
          fileCount: 12,
          folderCount: 2,
        }}
      />,
    );
    expect(container.querySelector(".folder-size-detail")).toHaveTextContent(
      "5.0 MB · 12 files, 2 folders",
    );
  });
});
