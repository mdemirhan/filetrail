import { withoutNestedPaths } from "./paths";

describe("withoutNestedPaths", () => {
  it("keeps a folder and drops what is inside it, and repeats", () => {
    expect(
      withoutNestedPaths(["/a/F/x.txt", "/a/F", "/a/G", "/a/F/sub/y.txt", "/a/G", "/a/Fx"]),
    ).toEqual(["/a/F", "/a/G", "/a/Fx"]);
  });

  it("drops everything under the startup disk when it is picked", () => {
    expect(withoutNestedPaths(["/Users/demo", "/"])).toEqual(["/"]);
  });
});
