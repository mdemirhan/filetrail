import { describe, expect, it } from "vitest";

import { resolveSearchResultsColumnLayout, resolveSinglePanelLayout } from "./responsiveLayout";

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

describe("resolveSearchResultsColumnLayout", () => {
  it("keeps every column in a wide pane and before the pane is measured", () => {
    expect(resolveSearchResultsColumnLayout(900)).toBe("full");
    expect(resolveSearchResultsColumnLayout(601)).toBe("full");
    expect(resolveSearchResultsColumnLayout(0)).toBe("full");
  });

  it("drops the date first, then the size", () => {
    expect(resolveSearchResultsColumnLayout(600)).toBe("no-date");
    expect(resolveSearchResultsColumnLayout(381)).toBe("no-date");
    expect(resolveSearchResultsColumnLayout(380)).toBe("names");
    expect(resolveSearchResultsColumnLayout(264)).toBe("names");
  });
});
