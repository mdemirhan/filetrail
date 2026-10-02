// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { DEFAULT_APP_PREFERENCES } from "../shared/appPreferences";
import { AcknowledgementsWindowApp } from "./AcknowledgementsWindowApp";
import { type FiletrailClient, FiletrailClientProvider } from "./lib/filetrailClient";

function renderAcknowledgements(getAcknowledgements: () => Promise<unknown>) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === "app:getPreferences") {
      return { preferences: DEFAULT_APP_PREFERENCES };
    }
    if (channel === "app:getAcknowledgements") {
      return getAcknowledgements();
    }
    return { ok: true };
  });
  const client = {
    invoke,
    onPreferencesChanged: () => () => undefined,
  } as unknown as FiletrailClient;
  render(
    <FiletrailClientProvider value={client}>
      <AcknowledgementsWindowApp />
    </FiletrailClientProvider>,
  );
  return invoke;
}

const COMPONENTS = [
  {
    id: "fd",
    name: "fd",
    version: "10.5.0",
    license: "MIT or Apache 2.0",
    url: "https://github.com/sharkdp/fd",
    text: "MIT License\n\nCopyright (c) 2017-present The fd developers",
  },
  {
    id: "chromium",
    name: "Chromium",
    version: "150.0.0.0",
    license: "BSD 3-Clause and others",
    url: "https://www.chromium.org",
    text: null,
  },
];

describe("AcknowledgementsWindowApp", () => {
  it("lists each component with its version, license, site and license text", async () => {
    renderAcknowledgements(async () => ({ components: COMPONENTS }));

    expect(await screen.findByText("MIT or Apache 2.0")).toBeInTheDocument();
    expect(screen.getByText("10.5.0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "github.com/sharkdp/fd" })).toHaveAttribute(
      "href",
      "https://github.com/sharkdp/fd",
    );
    expect(screen.getByText(/The fd developers/)).toBeInTheDocument();
  });

  it("opens the notices that ship as a file of their own", async () => {
    const invoke = renderAcknowledgements(async () => ({ components: COMPONENTS }));
    await screen.findByText("BSD 3-Clause and others");

    // Only Chromium has no text to show in place.
    const buttons = screen.getAllByRole("button", { name: "Open License Notices", hidden: true });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0] as HTMLElement);

    expect(invoke).toHaveBeenCalledWith("app:openAcknowledgementNotices", { id: "chromium" });
  });

  it("says so when the licenses can not be read", async () => {
    renderAcknowledgements(async () => {
      throw new Error("missing");
    });

    expect(await screen.findByText("Unable to load the licenses.")).toBeInTheDocument();
  });
});
