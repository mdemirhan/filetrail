// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { FileIcon, FolderIcon, TreeFolderIcon } from "./fileIcons";

function createEntry(
  overrides: Partial<{
    path: string;
    name: string;
    extension: string;
    kind: "file" | "directory" | "symlink_file" | "symlink_directory";
    isHidden: boolean;
    isSymlink: boolean;
  }> = {},
) {
  return {
    path: "/Users/demo/file.txt",
    name: "file.txt",
    extension: "txt",
    kind: "file" as const,
    isHidden: false,
    isSymlink: false,
    ...overrides,
  };
}

describe("fileIcons", () => {
  it("renders folder and alias-folder variants", () => {
    const { container, rerender } = render(<FileIcon entry={createEntry({ kind: "directory" })} />);
    expect(container.querySelector(".file-icon.folder")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ kind: "symlink_directory", isSymlink: true })} />);
    expect(container.querySelector(".file-icon.folder.alias")).not.toBeNull();
    expect(screen.getByText("↗")).toBeInTheDocument();
  });

  it("classifies common document categories by extension", () => {
    const { container, rerender } = render(<FileIcon entry={createEntry({ extension: "ts" })} />);
    expect(container.querySelector(".file-icon.document.code")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "png" })} />);
    expect(container.querySelector(".file-icon.document.image")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "mp4" })} />);
    expect(container.querySelector(".file-icon.document.video")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "zip" })} />);
    expect(container.querySelector(".file-icon.document.archive")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "pdf" })} />);
    expect(container.querySelector(".file-icon.document.pdf")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "app" })} />);
    expect(container.querySelector(".file-icon.document.app")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "log" })} />);
    expect(container.querySelector(".file-icon.document.text")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "bin" })} />);
    expect(container.querySelector(".file-icon.document.generic")).not.toBeNull();
  });

  it("renders symlink and extension labels inside document icons", () => {
    const { rerender } = render(
      <FileIcon entry={createEntry({ kind: "symlink_file", isSymlink: true, extension: "txt" })} />,
    );
    expect(screen.getByText("AL")).toBeInTheDocument();

    rerender(<FileIcon entry={createEntry({ extension: "" })} />);
    expect(screen.getByText("TXT")).toBeInTheDocument();

    rerender(<FileIcon entry={createEntry({ extension: "markdown" })} />);
    expect(screen.getByText("MARK")).toBeInTheDocument();
  });

  it("renders standalone folder icons with alias and open states", () => {
    const { container, rerender } = render(<FolderIcon className="custom" />);
    expect(container.querySelector(".file-icon.folder.custom")).not.toBeNull();

    rerender(<FolderIcon alias />);
    expect(container.querySelector(".file-icon.folder.alias")).not.toBeNull();

    rerender(<TreeFolderIcon open />);
    expect(container.querySelector(".file-icon.folder")).not.toBeNull();

    rerender(<TreeFolderIcon alias />);
    expect(container.querySelector(".file-icon.folder.alias")).not.toBeNull();
  });
});
