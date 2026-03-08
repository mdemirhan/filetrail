import { describe, expect, it } from "vitest";

import { resolveExplorerToolbarLayout, resolveSinglePanelLayout } from "./responsiveLayout";

describe("resolveExplorerToolbarLayout", () => {
  it("returns full for wide toolbars", () => {
    expect(resolveExplorerToolbarLayout(1200)).toBe("full");
  });

  it("returns condensed for mid-width toolbars", () => {
    expect(resolveExplorerToolbarLayout(980)).toBe("condensed");
  });

  it("returns narrow for smaller toolbars", () => {
    expect(resolveExplorerToolbarLayout(820)).toBe("narrow");
  });

  it("returns minimal for constrained toolbars", () => {
    expect(resolveExplorerToolbarLayout(680)).toBe("minimal");
  });
});

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
