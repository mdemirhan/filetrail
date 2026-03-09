// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { InfoPanel } from "./GetInfoPanel";

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

describe("InfoPanel", () => {
  it("renders nothing when closed and shows loading/empty states when open", () => {
    const { rerender } = render(
      <InfoPanel
        open={false}
        loading={false}
        item={null}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onCopyPath={() => true}
      />,
    );
    expect(screen.queryByText("Get Info")).toBeNull();

    rerender(
      <InfoPanel
        open
        loading
        item={null}
        onClose={() => undefined}
        onNavigateToPath={() => undefined}
        onOpen={() => undefined}
        onOpenInTerminal={() => undefined}
        onCopyPath={() => true}
      />,
    );
    expect(screen.getByText("Loading Info Panel…")).toBeInTheDocument();

    rerender(
      <InfoPanel
        open
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
        open
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
    expect(screen.getByText("rw-r--r-- (644)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Path" }));

    await act(async () => {});
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpenInTerminal).toHaveBeenCalledTimes(1);
    expect(onCopyPath).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "demo" }));
    expect(onNavigateToPath).toHaveBeenCalledWith("/Users/demo");

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
        open
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

    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getAllByText("Not available")).toHaveLength(2);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });
});
