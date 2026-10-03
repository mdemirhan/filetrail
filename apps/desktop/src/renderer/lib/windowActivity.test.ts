// @vitest-environment jsdom

import { installWindowActivity } from "./windowActivity";

describe("installWindowActivity", () => {
  it("marks the window inactive while it does not have the focus", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const uninstall = installWindowActivity();
    try {
      expect(document.body).not.toHaveClass("window-inactive");

      hasFocus.mockReturnValue(false);
      window.dispatchEvent(new Event("blur"));
      expect(document.body).toHaveClass("window-inactive");

      hasFocus.mockReturnValue(true);
      window.dispatchEvent(new Event("focus"));
      expect(document.body).not.toHaveClass("window-inactive");
    } finally {
      uninstall();
      hasFocus.mockRestore();
    }
  });

  it("starts inactive when the window opens in the background", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const uninstall = installWindowActivity();
    expect(document.body).toHaveClass("window-inactive");
    uninstall();
    expect(document.body).not.toHaveClass("window-inactive");
    hasFocus.mockRestore();
  });
});
