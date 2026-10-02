import type { IpcResponse } from "@filetrail/contracts";

export type AboutInfo = IpcResponse<"app:getAboutInfo">;

export const APP_NAME = "File Trail";
export const APP_TAGLINE = "A file browser that stays out of your way.";
export const APP_COPYRIGHT = "© 2026 Mustafa Demirhan";
export const APP_REPOSITORY_URL = "https://github.com/mdemirhan/filetrail";
export const APP_ISSUES_URL = `${APP_REPOSITORY_URL}/issues`;

// The version as the About window shows it: "0.1.0 (df11088)", or "0.1.0" when the build
// does not know its commit.
export function formatAppVersion(info: Pick<AboutInfo, "version" | "commit">): string {
  return info.commit ? `${info.version} (${info.commit})` : info.version;
}

// What Copy Details puts on the clipboard: the lines a bug report needs.
export function formatAboutDetails(info: AboutInfo): string {
  return [
    `${APP_NAME} ${formatAppVersion(info)}`,
    `macOS ${info.macosVersion}, ${info.architecture}`,
    `Electron ${info.electronVersion}`,
    `fd ${info.fdVersion}`,
  ].join("\n");
}
