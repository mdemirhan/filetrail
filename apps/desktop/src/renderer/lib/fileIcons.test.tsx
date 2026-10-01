// @vitest-environment jsdom

import { act, render } from "@testing-library/react";

import { FavoriteItemIcon, FileIcon, FolderIcon, TreeFolderIcon } from "./fileIcons";
import { type FiletrailClient, FiletrailClientProvider } from "./filetrailClient";

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error("Expected value to be defined.");
  }
  return value;
}

function createEntry(
  overrides: Partial<{
    path: string;
    name: string;
    extension: string;
    kind: "file" | "directory" | "symlink_file" | "symlink_directory";
    isHidden: boolean;
    isSymlink: boolean;
    isExecutable: boolean;
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
  it("shows a plain folder or document until the icon from macOS arrives", async () => {
    let deliver: (value: { pngBase64: string | null }) => void = () => undefined;
    const invoke = vi.fn(
      () =>
        new Promise<{ pngBase64: string | null }>((resolve) => {
          deliver = resolve;
        }),
    );
    const client = { invoke } as unknown as FiletrailClient;
    const { container, rerender } = render(
      <FiletrailClientProvider value={client}>
        <FileIcon entry={createEntry({ path: "/a/pending-folder", kind: "directory" })} />
        <FileIcon
          entry={createEntry({ path: "/a/pending.placeholder", extension: "placeholder" })}
        />
      </FiletrailClientProvider>,
    );
    expect(container.querySelectorAll(".file-icon.folder")).toHaveLength(1);
    expect(container.querySelectorAll(".file-icon.document")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();

    // No icon from macOS: the placeholder stays.
    await act(async () => {
      deliver({ pngBase64: null });
    });
    rerender(
      <FiletrailClientProvider value={client}>
        <FileIcon entry={createEntry({ path: "/a/pending-folder", kind: "directory" })} />
      </FiletrailClientProvider>,
    );
    expect(container.querySelector(".file-icon.folder")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the empty-list folder and a tree folder without a path as drawn folders", () => {
    const { container, rerender } = render(<FolderIcon className="custom" />);
    expect(container.querySelector(".file-icon.folder.custom")).not.toBeNull();

    rerender(<FolderIcon open />);
    expect(container.querySelector(".file-icon.folder .file-icon-folder-open-fill")).not.toBeNull();

    rerender(<TreeFolderIcon />);
    expect(container.querySelector(".file-icon.folder")).not.toBeNull();
  });
});

describe("native icons", () => {
  function renderWithClient() {
    const invoke = vi.fn(async (_channel: string, payload: { path: string }) => ({
      pngBase64: `icon-of-${payload.path}`,
    }));
    const client = { invoke } as unknown as FiletrailClient;
    const wrap = (node: React.ReactNode) => (
      <FiletrailClientProvider value={client}>{node}</FiletrailClientProvider>
    );
    return { invoke, wrap };
  }
  // A file without an extension has an icon of its own, so each one is its own request.
  const tool = (name: string) =>
    createEntry({ path: `/usr/bin/${name}`, name, extension: "", kind: "file" });

  it("asks for an icon once and reuses it", async () => {
    const { invoke, wrap } = renderWithClient();
    const first = render(wrap(<FileIcon entry={tool("icon-once")} />));
    await act(async () => undefined);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(first.container.querySelector("img")?.getAttribute("src")).toContain(
      "icon-of-/usr/bin/icon-once",
    );
    first.unmount();

    const second = render(wrap(<FileIcon entry={tool("icon-once")} />));
    await act(async () => undefined);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(second.container.querySelector("img")).not.toBeNull();
  });

  it("shares one icon among executables without an extension and another among the rest", async () => {
    const { invoke, wrap } = renderWithClient();
    const { container } = render(
      wrap(
        <>
          <FileIcon entry={{ ...tool("ls"), isExecutable: true }} />
          <FileIcon entry={{ ...tool("zip"), isExecutable: true }} />
          <FileIcon entry={{ ...tool("hosts"), isExecutable: false }} />
          <FileIcon entry={{ ...tool("Makefile"), isExecutable: false }} />
          <FileIcon entry={createEntry({ path: "/a/one.txt", name: "one.txt" })} />
          <FileIcon entry={createEntry({ path: "/a/two.txt", name: "two.txt" })} />
        </>,
      ),
    );
    await act(async () => undefined);

    // Six files, three icons: asked for by kind, not by each file.
    expect(invoke.mock.calls.map(([, payload]) => payload)).toEqual([
      { path: "/usr/bin/ls", size: 64, generic: "executable" },
      { path: "/usr/bin/hosts", size: 64, generic: "file" },
      { path: "/a/one.txt", size: 64 },
    ]);
    expect(container.querySelectorAll("img")).toHaveLength(6);
  });

  it("asks for each symlink by path, since macOS draws it as what it points to", async () => {
    const { invoke, wrap } = renderWithClient();
    const { container } = render(
      wrap(
        <>
          <FileIcon
            entry={createEntry({
              path: "/a/link-one.txt",
              name: "link-one.txt",
              kind: "symlink_file",
              isSymlink: true,
            })}
          />
          <FileIcon
            entry={createEntry({
              path: "/a/link-two.txt",
              name: "link-two.txt",
              kind: "symlink_file",
              isSymlink: true,
            })}
          />
          <TreeFolderIcon alias path="/a/link-to-folder" />
        </>,
      ),
    );
    await act(async () => undefined);

    expect(invoke.mock.calls.map(([, payload]) => payload)).toEqual([
      { path: "/a/link-one.txt", size: 64 },
      { path: "/a/link-two.txt", size: 64 },
      { path: "/a/link-to-folder", size: 64 },
    ]);
    expect(container.querySelectorAll("img")).toHaveLength(3);
  });

  it("waits before asking when deferred, so items passed quickly are never asked for", async () => {
    vi.useFakeTimers();
    try {
      const { invoke, wrap } = renderWithClient();
      const { rerender } = render(wrap(<FileIcon deferLoad entry={tool("passed-1")} />));
      for (const name of ["passed-2", "passed-3", "landed"]) {
        await act(async () => {
          vi.advanceTimersByTime(25);
        });
        rerender(wrap(<FileIcon deferLoad entry={tool(name)} />));
      }
      expect(invoke).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(80);
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith("system:getFileIcon", {
        path: "/usr/bin/landed",
        size: 64,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("favorite icons", () => {
  it("draws each favorite as a line icon", () => {
    const { container, rerender } = render(<FavoriteItemIcon icon="home" />);
    expect(
      container.querySelector(".file-icon.favorite .file-icon-favorite-stroke"),
    ).not.toBeNull();
    const homePath = container.querySelector("path")?.getAttribute("d");

    rerender(<FavoriteItemIcon icon="downloads" />);
    expect(container.querySelector("path")?.getAttribute("d")).not.toBe(homePath);
  });
});
