import { EMPTY_CONTENT_SELECTION } from "./contentSelection";
import { type FolderViewMemory, rememberFolderView } from "./folderViewMemory";

const VIEW: FolderViewMemory = {
  selection: EMPTY_CONTENT_SELECTION,
  contentScroll: { top: 120, left: 0 },
};

describe("rememberFolderView", () => {
  it("keeps the folders in the history and replaces the one left", () => {
    const memories = {
      "/a": VIEW,
      "/b": VIEW,
      "/gone": VIEW,
    };
    const left = { ...VIEW, contentScroll: { top: 300, left: 0 } };
    expect(rememberFolderView(memories, "/b", left, ["/a", "/b"])).toEqual({
      "/a": VIEW,
      "/b": left,
    });
  });
});
