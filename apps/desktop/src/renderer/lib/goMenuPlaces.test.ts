import { describe, expect, it } from "vitest";

import { isGoMenuPlaceCommand, resolveGoMenuPlace } from "./goMenuPlaces";

describe("goMenuPlaces", () => {
  it("finds the folders in Home, and the places outside it", () => {
    expect(resolveGoMenuPlace("goDocuments", "/Users/demo")).toEqual({
      path: "/Users/demo/Documents",
      asLocation: false,
    });
    expect(resolveGoMenuPlace("goLibrary", "/Users/demo")?.path).toBe("/Users/demo/Library");
    expect(resolveGoMenuPlace("goApplications", "/Users/demo")).toEqual({
      path: "/Applications",
      asLocation: false,
    });
    // Rows of the sidebar's Locations.
    expect(resolveGoMenuPlace("goMacintoshHD", "/Users/demo")).toEqual({
      path: "/",
      asLocation: true,
    });
    expect(resolveGoMenuPlace("goTrash", "/Users/demo")).toEqual({
      path: "/Users/demo/.Trash",
      asLocation: true,
    });
  });

  it("has no place in Home until Home is known", () => {
    expect(resolveGoMenuPlace("goDownloads", "")).toBeNull();
    expect(resolveGoMenuPlace("goTrash", "")).toBeNull();
    expect(resolveGoMenuPlace("goMacintoshHD", "")?.path).toBe("/");
  });

  it("tells the place commands from the others", () => {
    expect(isGoMenuPlaceCommand("goDesktop")).toBe(true);
    expect(isGoMenuPlaceCommand("goTrash")).toBe(true);
    expect(isGoMenuPlaceCommand("goHomeRootTree")).toBe(false);
    expect(isGoMenuPlaceCommand("emptyTrash")).toBe(false);
  });
});
