// @vitest-environment jsdom

const mainEntryMock = vi.hoisted(() => ({
  createRoot: vi.fn(),
  render: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  createRoot: mainEntryMock.createRoot,
}));

vi.mock("./App", () => ({
  App: () => <div data-testid="app-root">App</div>,
}));

vi.mock("./styles.css", () => ({}));

describe("renderer main entry", () => {
  beforeEach(() => {
    vi.resetModules();
    mainEntryMock.createRoot.mockReset();
    mainEntryMock.render.mockReset();
    mainEntryMock.createRoot.mockReturnValue({
      render: mainEntryMock.render,
    });
    document.body.className = "";
    document.body.innerHTML = "";
  });

  it("mounts the app into the root element and marks the platform class", async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import("./main");

    expect(document.body).toHaveClass("platform-macos");
    // The explorer window shows the macOS sidebar material through its sidebar.
    expect(document.body).toHaveClass("vibrant-window");
    expect(mainEntryMock.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(mainEntryMock.render).toHaveBeenCalledTimes(1);
  });

  it("keeps the Settings window opaque", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.location.hash = "#settings";
    try {
      await import("./main");
      expect(document.body).toHaveClass("platform-macos");
      expect(document.body).not.toHaveClass("vibrant-window");
    } finally {
      window.location.hash = "";
    }
  });

  it("keeps the About and Acknowledgements windows opaque", async () => {
    for (const hash of ["#about", "#acknowledgements"]) {
      vi.resetModules();
      document.body.className = "";
      document.body.innerHTML = '<div id="root"></div>';
      window.location.hash = hash;
      try {
        await import("./main");
        expect(document.body).not.toHaveClass("vibrant-window");
      } finally {
        window.location.hash = "";
      }
    }
  });

  it("throws when the renderer root element is missing", async () => {
    await expect(import("./main")).rejects.toThrow("Missing root element");
  });
});
