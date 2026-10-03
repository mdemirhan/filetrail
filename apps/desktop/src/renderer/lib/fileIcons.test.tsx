// @vitest-environment jsdom

import { act, render } from "@testing-library/react";

import { FavoriteItemIcon, FileIcon, TreeFolderIcon, preloadGenericIcons } from "./fileIcons";
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
    // The stand-ins are a filled folder and a page with a folded corner, like the icons
    // they stand in for.
    expect(container.querySelector(".file-icon.folder .file-icon-folder-front")).not.toBeNull();
    expect(container.querySelector(".file-icon.document .file-icon-document-fold")).not.toBeNull();

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

  it("draws a tree folder without a path", () => {
    const { container } = render(<TreeFolderIcon />);
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

  it("has the plain folder and document icons ready before any item asks for them", async () => {
    // A fresh copy of the module, so icons cached by the tests above play no part.
    vi.resetModules();
    const fresh = await import("./fileIcons");
    const freshClient = await import("./filetrailClient");
    const invoke = vi.fn(async (_channel: string, payload: { generic?: string; size: number }) => ({
      pngBase64: `icon-of-${payload.generic}-${payload.size}`,
    }));
    const client = { invoke } as unknown as FiletrailClient;

    fresh.preloadGenericIcons(client);
    fresh.preloadGenericIcons(client);
    await act(async () => undefined);

    // Each kind once, in the size of rows and in the size of icon view.
    expect(invoke.mock.calls.map(([, payload]) => payload)).toEqual([
      { path: "/", size: 64, generic: "folder" },
      { path: "/", size: 128, generic: "folder" },
      { path: "/", size: 64, generic: "file" },
      { path: "/", size: 128, generic: "file" },
    ]);

    const { container } = render(
      <freshClient.FiletrailClientProvider value={client}>
        <fresh.FileIcon entry={createEntry({ path: "/a/folder", kind: "directory" })} />
        <fresh.FileIcon
          large
          entry={{ ...createEntry({ path: "/a/Makefile", extension: "" }), isExecutable: false }}
        />
      </freshClient.FiletrailClientProvider>,
    );
    // Drawn from the first render, with nothing more asked for.
    const sources = Array.from(container.querySelectorAll("img")).map((image) => image.src);
    expect(sources).toEqual([
      "data:image/png;base64,icon-of-folder-64",
      "data:image/png;base64,icon-of-file-128",
    ]);
    await act(async () => undefined);
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it("does nothing when the icons cannot be asked for", async () => {
    const client = {
      invoke: vi.fn(async () => {
        throw new Error("no bridge");
      }),
    } as unknown as FiletrailClient;
    expect(() => preloadGenericIcons(client)).not.toThrow();
    await act(async () => undefined);
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
