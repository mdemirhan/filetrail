// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";

import { FavoriteItemIcon, FileIcon, FolderIcon, TreeFolderIcon } from "./fileIcons";

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
    expect(container.querySelector(".file-icon.document.binary")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "html" })} />);
    expect(container.querySelector(".file-icon.document.web")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "json" })} />);
    expect(container.querySelector(".file-icon.document.data")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "md" })} />);
    expect(container.querySelector(".file-icon.document.markdown")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "sh" })} />);
    expect(container.querySelector(".file-icon.document.shell")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "mp3" })} />);
    expect(container.querySelector(".file-icon.document.audio")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "svg" })} />);
    expect(container.querySelector(".file-icon.document.svg")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "ttf" })} />);
    expect(container.querySelector(".file-icon.document.font")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "xyz" })} />);
    expect(container.querySelector(".file-icon.document.generic")).not.toBeNull();
  });

  it("classifies new language extensions as code", () => {
    const { container, rerender } = render(<FileIcon entry={createEntry({ extension: "lua" })} />);
    expect(container.querySelector(".file-icon.document.code")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "scala" })} />);
    expect(container.querySelector(".file-icon.document.code")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "hs" })} />);
    expect(container.querySelector(".file-icon.document.code")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "tex" })} />);
    expect(container.querySelector(".file-icon.document.code")).not.toBeNull();
  });

  it("classifies new data/document/config extensions correctly", () => {
    const { container, rerender } = render(<FileIcon entry={createEntry({ extension: "xml" })} />);
    expect(container.querySelector(".file-icon.document.data")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "csv" })} />);
    expect(container.querySelector(".file-icon.document.data")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "sqlite" })} />);
    expect(container.querySelector(".file-icon.document.data")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "docx" })} />);
    expect(container.querySelector(".file-icon.document.text")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "epub" })} />);
    expect(container.querySelector(".file-icon.document.text")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "pem" })} />);
    expect(container.querySelector(".file-icon.document.config")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "wasm" })} />);
    expect(container.querySelector(".file-icon.document.binary")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "avif" })} />);
    expect(container.querySelector(".file-icon.document.image")).not.toBeNull();

    rerender(<FileIcon entry={createEntry({ extension: "iso" })} />);
    expect(container.querySelector(".file-icon.document.archive")).not.toBeNull();
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

  describe("non-classic themes show symlink badge on typed files", () => {
    afterEach(() => {
      delete document.documentElement.dataset.iconTheme;
    });

    it.each(["colorblock", "monoline", "vivid"] as const)(
      "%s theme renders alias badge for symlink files",
      (theme) => {
        document.documentElement.dataset.iconTheme = theme;
        const { container } = render(
          <FileIcon
            entry={createEntry({ kind: "symlink_file", isSymlink: true, extension: "ts", name: "link.ts" })}
          />,
        );
        expect(container.querySelector(`.file-icon.document.${theme}.alias`)).not.toBeNull();
        expect(container.querySelector(".alias-badge")).not.toBeNull();
        expect(container.querySelector(".alias-badge")?.textContent).toBe("↗");
      },
    );

    it.each(["colorblock", "monoline", "vivid"] as const)(
      "%s theme does NOT render alias badge for regular files",
      (theme) => {
        document.documentElement.dataset.iconTheme = theme;
        const { container } = render(
          <FileIcon entry={createEntry({ kind: "file", extension: "ts", name: "app.ts" })} />,
        );
        expect(container.querySelector(`.file-icon.document.${theme}`)).not.toBeNull();
        expect(container.querySelector(".alias")).toBeNull();
        expect(container.querySelector(".alias-badge")).toBeNull();
      },
    );
  });

  it("resolves meaningful labels for name-based extensionless files", () => {
    const { rerender } = render(
      <FileIcon entry={createEntry({ name: "Dockerfile", extension: "" })} />,
    );
    expect(screen.getByText("DOCK")).toBeInTheDocument();

    rerender(<FileIcon entry={createEntry({ name: "Makefile", extension: "" })} />);
    expect(screen.getByText("MAKE")).toBeInTheDocument();

    rerender(<FileIcon entry={createEntry({ name: "LICENSE", extension: "" })} />);
    expect(screen.getByText("LIC")).toBeInTheDocument();

    rerender(<FileIcon entry={createEntry({ name: "CHANGELOG", extension: "" })} />);
    expect(screen.getByText("LOG")).toBeInTheDocument();

    rerender(<FileIcon entry={createEntry({ name: "Gemfile", extension: "" })} />);
    expect(screen.getByText("DEPS")).toBeInTheDocument();
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

describe("vivid favorite fill allowlist", () => {
  // Icons with fully closed SVG paths — safe to apply fill: currentColor.
  const CLOSED_PATH_FAVORITES = new Set([
    "home",
    "applications",
    "folder",
    "star",
    "music",
    "photos",
    "cloud",
    "projects",
    "camera",
  ]);

  // Icons with open stroke paths — fill would create blobs/polygons.
  const OPEN_PATH_FAVORITES = new Set([
    "desktop",
    "documents",
    "downloads",
    "trash",
    "drive",
    "code",
    "terminal",
    "globe",
    "videos",
    "archive",
    "server",
    "books",
    "toolbox",
    "network",
  ]);

  it("CSS only applies vivid fill to closed-path favorites", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf-8");

    // Extract all .favorite-icon-{name} selectors from vivid fill rules.
    // The pattern targets lines like: :root[data-icon-theme="vivid"] .favorite-icon-home .file-icon-favorite-stroke,
    const vividFillSelectors = css.match(
      /\[data-icon-theme="vivid"\]\s+\.favorite-icon-(\w+)\s+\.file-icon-favorite-stroke/g,
    );
    expect(vividFillSelectors).not.toBeNull();

    const iconsWithFill = new Set(
      vividFillSelectors!.map((s) => s.match(/\.favorite-icon-(\w+)/)![1]),
    );

    expect(iconsWithFill).toEqual(CLOSED_PATH_FAVORITES);
  });

  it("closed + open path sets cover all FavoriteIconIds", () => {
    // If a new icon is added to FavoriteIconId, this test forces a decision:
    // is it closed-path (safe to fill) or open-path (stroke only)?
    const ALL_FAVORITE_ICONS: ReadonlyArray<string> = [
      "home", "applications", "desktop", "documents", "downloads", "trash",
      "folder", "star", "drive", "code", "terminal", "globe", "music",
      "photos", "videos", "archive", "cloud", "server", "projects", "books",
      "camera", "toolbox", "network",
    ];

    const covered = new Set([...CLOSED_PATH_FAVORITES, ...OPEN_PATH_FAVORITES]);
    for (const icon of ALL_FAVORITE_ICONS) {
      expect(covered.has(icon)).toBe(true);
    }
    // No overlap
    for (const icon of CLOSED_PATH_FAVORITES) {
      expect(OPEN_PATH_FAVORITES.has(icon)).toBe(false);
    }
  });

  it("FavoriteItemIcon renders targetable class structure for CSS", () => {
    const { container, rerender } = render(<FavoriteItemIcon icon="home" />);
    expect(container.querySelector(".favorite-icon-home .file-icon-favorite-stroke")).not.toBeNull();

    rerender(<FavoriteItemIcon icon="downloads" />);
    expect(container.querySelector(".favorite-icon-downloads .file-icon-favorite-stroke")).not.toBeNull();
  });
});
