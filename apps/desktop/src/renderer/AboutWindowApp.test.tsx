// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_APP_PREFERENCES } from "../shared/appPreferences";
import { AboutWindowApp } from "./AboutWindowApp";
import { type FiletrailClient, FiletrailClientProvider } from "./lib/filetrailClient";

function renderAbout() {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "app:getPreferences") {
      return { preferences: DEFAULT_APP_PREFERENCES };
    }
    if (channel === "app:getAboutInfo") {
      return {
        version: "0.1.0",
        commit: "df11088",
        macosVersion: "27.0",
        architecture: "Apple silicon",
        electronVersion: "44.4.5",
        fdVersion: "10.5.0",
      };
    }
    return { ok: true };
  });
  const client = {
    invoke,
    onPreferencesChanged: () => () => undefined,
  } as unknown as FiletrailClient;
  render(
    <FiletrailClientProvider value={client}>
      <AboutWindowApp />
    </FiletrailClientProvider>,
  );
  return invoke;
}

describe("AboutWindowApp", () => {
  it("shows the app, its icon and the versions a bug report needs", async () => {
    renderAbout();

    expect(screen.getByRole("heading", { name: "File Trail" })).toBeInTheDocument();
    expect(screen.getByText("A file browser that stays out of your way.")).toBeInTheDocument();
    expect(document.querySelector("img.about-icon")).toHaveAttribute(
      "src",
      "../assets/icons/filetrail.svg",
    );
    expect(await screen.findByText("0.1.0 (df11088)")).toBeInTheDocument();
    expect(screen.getByText("27.0, Apple silicon")).toBeInTheDocument();
    expect(screen.getByText("44.4.5")).toBeInTheDocument();
    expect(screen.getByText("fd 10.5.0")).toBeInTheDocument();
    expect(screen.getByText("© 2026 Mustafa Demirhan")).toBeInTheDocument();
  });

  it("copies the details and says so", async () => {
    const invoke = renderAbout();
    await screen.findByText("0.1.0 (df11088)");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Details" }));
    });

    expect(invoke).toHaveBeenCalledWith("system:copyText", {
      text: "File Trail 0.1.0 (df11088)\nmacOS 27.0, Apple silicon\nElectron 44.4.5\nfd 10.5.0",
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("links to the project and opens Acknowledgements", async () => {
    const invoke = renderAbout();
    await screen.findByText("0.1.0 (df11088)");

    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/mdemirhan/filetrail",
    );
    expect(screen.getByRole("link", { name: "Report an Issue" })).toHaveAttribute(
      "href",
      "https://github.com/mdemirhan/filetrail/issues",
    );

    fireEvent.click(screen.getByRole("button", { name: "Acknowledgements" }));
    expect(invoke).toHaveBeenCalledWith("app:openAcknowledgementsWindow", {});
  });

  it("closes with Escape", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    try {
      renderAbout();
      await screen.findByText("0.1.0 (df11088)");

      fireEvent.keyDown(window, { key: "Escape" });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }
  });
});
