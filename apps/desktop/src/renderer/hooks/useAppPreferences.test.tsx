// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { useAppPreferences } from "./useAppPreferences";

describe("useAppPreferences", () => {
  it("puts every Appearance setting back as a new install has it", () => {
    const { result } = renderHook(() => useAppPreferences());

    act(() => {
      result.current.setTheme("tomorrow-night");
      result.current.setAutoLightTheme("sand");
      result.current.setAutoDarkTheme("catppuccin-mocha");
      result.current.setAccent("#d84a4a");
      result.current.setZoomPercent(125);
      result.current.setUiFontFamily("lexend");
      result.current.setTabStyle(
        DEFAULT_APP_PREFERENCES.tabStyle === "cards" ? "accentLine" : "cards",
      );
    });
    act(() => {
      result.current.resetAppearanceSettings();
    });

    const { theme, autoLightTheme, autoDarkTheme, accent, zoomPercent, uiFontFamily, tabStyle } =
      result.current;
    expect({
      theme,
      autoLightTheme,
      autoDarkTheme,
      accent,
      zoomPercent,
      uiFontFamily,
      tabStyle,
    }).toEqual({
      theme: DEFAULT_APP_PREFERENCES.theme,
      autoLightTheme: DEFAULT_APP_PREFERENCES.autoLightTheme,
      autoDarkTheme: DEFAULT_APP_PREFERENCES.autoDarkTheme,
      accent: DEFAULT_APP_PREFERENCES.accent,
      zoomPercent: DEFAULT_APP_PREFERENCES.zoomPercent,
      uiFontFamily: DEFAULT_APP_PREFERENCES.uiFontFamily,
      tabStyle: DEFAULT_APP_PREFERENCES.tabStyle,
    });
  });

  it("shows favorites in the folder tree unless told otherwise", () => {
    expect(DEFAULT_APP_PREFERENCES.favoritesPlacement).toBe("integrated");
  });
});
