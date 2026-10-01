import { findTreeTypeaheadMatch, isTypeaheadCharacterKey } from "./typeahead";

describe("typeahead helpers", () => {
  it("detects printable character keys", () => {
    expect(isTypeaheadCharacterKey("a")).toBe(true);
    expect(isTypeaheadCharacterKey(" ")).toBe(false);
    expect(isTypeaheadCharacterKey("ArrowDown")).toBe(false);
  });

  it("matches the first visible tree node by prefix", () => {
    expect(
      findTreeTypeaheadMatch({
        rootPath: "/Users/demo",
        query: "doc",
        nodes: {
          "/Users/demo": {
            path: "/Users/demo",
            name: "demo",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: ["/Users/demo/Desktop", "/Users/demo/Documents"],
          },
          "/Users/demo/Desktop": {
            path: "/Users/demo/Desktop",
            name: "Desktop",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: false,
            loading: false,
            loaded: false,
            error: null,
            childPaths: [],
          },
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            name: "Documents",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: false,
            loading: false,
            loaded: false,
            error: null,
            childPaths: [],
          },
        },
      })?.path,
    ).toBe("/Users/demo/Documents");
  });
});
