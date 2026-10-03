// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_APP_PREFERENCES } from "../shared/appPreferences";
import { SettingsWindowApp } from "./SettingsWindowApp";
import { type FiletrailClient, FiletrailClientProvider } from "./lib/filetrailClient";

function renderSettings() {
  const client = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === "app:getPreferences") {
        return {
          preferences: {
            ...DEFAULT_APP_PREFERENCES,
            // One favorite, so the Explorer tab has an icon picker (a pop-up) to open.
            favorites: [{ path: "/Users/demo", icon: "home" }],
          },
        };
      }
      if (channel === "app:getHomeDirectory") {
        return { path: "/Users/demo" };
      }
      return {};
    }),
    onPreferencesChanged: () => () => undefined,
  } as unknown as FiletrailClient;
  return render(
    <FiletrailClientProvider value={client}>
      <SettingsWindowApp />
    </FiletrailClientProvider>,
  );
}

describe("SettingsWindowApp", () => {
  let close: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    close = vi.spyOn(window, "close").mockImplementation(() => undefined);
  });

  afterEach(() => {
    close.mockRestore();
  });

  it("closes with Escape", async () => {
    renderSettings();
    await screen.findByText("Reopen the last folder and tabs");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);

    // Other keys, and an Escape something else already used, leave the window open.
    fireEvent.keyDown(window, { key: "Enter" });
    const used = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    used.preventDefault();
    window.dispatchEvent(used);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("lets Escape close an open pop-up before it closes the window", async () => {
    renderSettings();
    await screen.findByText("Reopen the last folder and tabs");
    fireEvent.click(screen.getByRole("button", { name: "Browsing" }));

    const trigger = screen
      .getAllByRole("button")
      .find(
        (button) =>
          button.getAttribute("aria-haspopup") === "dialog" &&
          !(button as HTMLButtonElement).disabled,
      );
    if (!trigger) {
      throw new Error("No pop-up trigger found on the Browsing tab.");
    }
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(close).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the tab on screen in the window's address, where the app reads it to reopen there", async () => {
    window.history.replaceState(null, "", "#settings");
    renderSettings();
    await screen.findByText("Reopen the last folder and tabs");
    expect(window.location.hash).toBe("#settings/general");

    fireEvent.click(screen.getByRole("button", { name: "Shortcuts" }));
    expect(window.location.hash).toBe("#settings/shortcuts");
  });

  it("opens on the tab named in its address", async () => {
    window.history.replaceState(null, "", "#settings/shortcuts");
    renderSettings();

    expect(await screen.findByRole("textbox", { name: "Search shortcuts" })).toBeInTheDocument();
    window.history.replaceState(null, "", "#settings");
  });
});
