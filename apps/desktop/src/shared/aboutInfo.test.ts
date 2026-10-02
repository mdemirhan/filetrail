import { type AboutInfo, formatAboutDetails, formatAppVersion } from "./aboutInfo";

const INFO: AboutInfo = {
  version: "0.1.0",
  commit: "df11088",
  macosVersion: "27.0",
  architecture: "Apple silicon",
  electronVersion: "44.4.5",
  fdVersion: "10.5.0",
};

describe("formatAppVersion", () => {
  it("adds the commit the app was built from, when the build knows it", () => {
    expect(formatAppVersion(INFO)).toBe("0.1.0 (df11088)");
    expect(formatAppVersion({ ...INFO, commit: null })).toBe("0.1.0");
  });
});

describe("formatAboutDetails", () => {
  it("lists what a bug report needs, one line each", () => {
    expect(formatAboutDetails(INFO)).toBe(
      [
        "File Trail 0.1.0 (df11088)",
        "macOS 27.0, Apple silicon",
        "Electron 44.4.5",
        "fd 10.5.0",
      ].join("\n"),
    );
  });
});
