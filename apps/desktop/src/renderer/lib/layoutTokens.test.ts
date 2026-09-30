import { readFileSync } from "node:fs";

import { EXPLORER_LAYOUT, TREE_LAYOUT, getTreeRowHeight } from "./layoutTokens";

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

  it("pages the sidebar tree by the row heights the stylesheet draws", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    const heightOf = (selector: string) =>
      Number(
        new RegExp(`${selector.replace(/[.]/g, "\\.")} \\{[^}]*?\\bheight: (\\d+)px`, "u").exec(
          styles,
        )?.[1],
      );
    expect(heightOf("\n.sidebar-main-native .tree-row")).toBe(TREE_LAYOUT.regularRowHeight);
    expect(heightOf(".compact-tree-view .sidebar-main-native .tree-row")).toBe(
      TREE_LAYOUT.compactRowHeight,
    );
    expect(getTreeRowHeight(false)).toBe(26);
    expect(getTreeRowHeight(true)).toBe(21);
  });
});
