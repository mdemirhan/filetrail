import { describe, expect, it } from "vitest";

import { resolveSinglePanelLayout } from "./responsiveLayout";

describe("resolveSinglePanelLayout", () => {
  it("returns wide for large single-panel layouts", () => {
    expect(resolveSinglePanelLayout(1280)).toBe("wide");
  });

  it("returns narrow for medium single-panel layouts", () => {
    expect(resolveSinglePanelLayout(920)).toBe("narrow");
  });

  it("returns compact for small single-panel layouts", () => {
    expect(resolveSinglePanelLayout(640)).toBe("compact");
  });
});
