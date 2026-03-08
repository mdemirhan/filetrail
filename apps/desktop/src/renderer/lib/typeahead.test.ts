import {
  findContentTypeaheadMatch,
  findTreeTypeaheadMatch,
  isTypeaheadCharacterKey,
} from "./typeahead";

describe("typeahead helpers", () => {
  it("detects printable character keys", () => {
    expect(isTypeaheadCharacterKey("a")).toBe(true);
    expect(isTypeaheadCharacterKey(" ")).toBe(false);
    expect(isTypeaheadCharacterKey("ArrowDown")).toBe(false);
  });

  it("matches the first content entry by prefix case-insensitively", () => {
    expect(
      findContentTypeaheadMatch(
        [
          {
            path: "/Users/demo/Downloads",
            name: "Downloads",
            extension: "",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
          },
          {
            path: "/Users/demo/Documents",
            name: "Documents",
            extension: "",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
          },
        ],
        "do",
      )?.path,
    ).toBe("/Users/demo/Downloads");
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
