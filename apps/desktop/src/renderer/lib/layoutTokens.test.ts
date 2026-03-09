import { EXPLORER_LAYOUT } from "./layoutTokens";

describe("layoutTokens", () => {
  it("defines stable explorer pane constraints", () => {
    expect(EXPLORER_LAYOUT).toEqual({
      treeMinWidth: 220,
      treeMaxWidth: 520,
      inspectorMinWidth: 260,
      inspectorMaxWidth: 480,
      resizerWidth: 8,
      paneResizeStep: 12,
      paneResizeStepLarge: 24,
      minContentWidth: 420,
    });
  });
});
