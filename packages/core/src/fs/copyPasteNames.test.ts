import { resolveDuplicateName, resolveKeepBothDestinationPath } from "./copyPasteNames";
import { MockWriteServiceFileSystem } from "./testUtils";

describe("copyPasteNames", () => {
  it("resolves keep-both paths from the source basename", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
      "/target/report copy.txt": { kind: "file", size: 1 },
    });

    await expect(
      resolveKeepBothDestinationPath("/source/report.txt", "/target/report.txt", fileSystem),
    ).resolves.toBe("/target/report copy 2.txt");
  });

  it("generates duplicate names for files with and without extensions", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
      "/target/notes copy.txt": { kind: "file", size: 1 },
      "/target/archive copy": { kind: "file", size: 1 },
    });

    await expect(resolveDuplicateName("notes.txt", "/target", fileSystem)).resolves.toBe(
      "/target/notes copy 2.txt",
    );
    await expect(resolveDuplicateName("archive", "/target", fileSystem)).resolves.toBe(
      "/target/archive copy 2",
    );
  });

  it("uses the first copy suffix when the destination is still free", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
    });

    await expect(resolveDuplicateName("fresh.txt", "/target", fileSystem)).resolves.toBe(
      "/target/fresh copy.txt",
    );
  });
});
