// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { DEFAULT_APP_PREFERENCES } from "../../shared/appPreferences";
import { useAppPreferences } from "./useAppPreferences";

describe("useAppPreferences", () => {
  it("puts every Appearance setting back as a new install has it", () => {
    const { result } = renderHook(() => useAppPreferences());

    act(() => {
      result.current.setTheme("dark");
      result.current.setAccent("#d84a4a");
      result.current.setZoomPercent(125);
    });
    act(() => {
      result.current.resetAppearanceSettings();
    });

    const { theme, accent, zoomPercent } = result.current;
    expect({ theme, accent, zoomPercent }).toEqual({
      theme: DEFAULT_APP_PREFERENCES.theme,
      accent: DEFAULT_APP_PREFERENCES.accent,
      zoomPercent: DEFAULT_APP_PREFERENCES.zoomPercent,
    });
  });

  it("paints Light or Dark as chosen, and follows macOS on Auto", () => {
    const { result } = renderHook(() => useAppPreferences());

    act(() => result.current.setTheme("dark"));
    expect(result.current.effectiveTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => result.current.setTheme("light"));
    expect(result.current.effectiveTheme).toBe("light");

    // jsdom has no dark appearance, so Auto is light here.
    act(() => result.current.setTheme("auto"));
    expect(result.current.effectiveTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("shows favorites in the folder tree unless told otherwise", () => {
    expect(DEFAULT_APP_PREFERENCES.favoritesPlacement).toBe("integrated");
  });
});
