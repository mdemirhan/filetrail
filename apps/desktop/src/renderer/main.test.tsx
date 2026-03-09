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
vi.mock("@fontsource/dm-sans/400.css", () => ({}));
vi.mock("@fontsource/dm-sans/500.css", () => ({}));
vi.mock("@fontsource/dm-sans/600.css", () => ({}));
vi.mock("@fontsource/fira-code/400.css", () => ({}));
vi.mock("@fontsource/fira-code/500.css", () => ({}));
vi.mock("@fontsource/fira-code/600.css", () => ({}));
vi.mock("@fontsource/jetbrains-mono/400.css", () => ({}));
vi.mock("@fontsource/jetbrains-mono/500.css", () => ({}));
vi.mock("@fontsource/jetbrains-mono/600.css", () => ({}));
vi.mock("@fontsource/lexend/400.css", () => ({}));
vi.mock("@fontsource/lexend/500.css", () => ({}));
vi.mock("@fontsource/lexend/600.css", () => ({}));

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
    expect(mainEntryMock.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(mainEntryMock.render).toHaveBeenCalledTimes(1);
  });

  it("throws when the renderer root element is missing", async () => {
    await expect(import("./main")).rejects.toThrow("Missing root element");
  });
});
