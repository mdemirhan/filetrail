import { readSettingsTabFromUrl } from "./settingsWindowTab";

describe("readSettingsTabFromUrl", () => {
  it("reads the tab a Settings window is on from its address", () => {
    expect(readSettingsTabFromUrl("file:///app/renderer/index.html#settings/toolbars")).toBe(
      "toolbars",
    );
    expect(readSettingsTabFromUrl("file:///app/renderer/index.html#settings/shortcuts")).toBe(
      "shortcuts",
    );
  });

  it("finds no tab in an address without one, or with one Settings does not have", () => {
    expect(readSettingsTabFromUrl("file:///app/renderer/index.html#settings")).toBeNull();
    expect(readSettingsTabFromUrl("file:///app/renderer/index.html")).toBeNull();
    expect(readSettingsTabFromUrl("file:///app/renderer/index.html#settings/rails")).toBeNull();
    expect(readSettingsTabFromUrl("file:///app/renderer/index.html#about")).toBeNull();
  });
});
