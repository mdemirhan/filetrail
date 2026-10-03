import {
  destinationPathKey,
  detectCaseSensitivity,
  resolveDuplicateName,
  resolveKeepBothDestinationPath,
} from "./copyPasteNames";
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

  it("numbers a copy of a copy instead of adding another “copy”, like Finder", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
      "/target/notes copy.txt": { kind: "file", size: 1 },
      "/target/notes copy 2.txt": { kind: "file", size: 1 },
      "/target/plan copy 2.md": { kind: "file", size: 1 },
    });

    await expect(resolveDuplicateName("notes copy.txt", "/target", fileSystem)).resolves.toBe(
      "/target/notes copy 3.txt",
    );
    await expect(resolveDuplicateName("plan copy 2.md", "/target", fileSystem)).resolves.toBe(
      "/target/plan copy 3.md",
    );
    await expect(
      resolveDuplicateName("Photos copy", "/target", fileSystem, undefined, { isDirectory: true }),
    ).resolves.toBe("/target/Photos copy 2");
    await expect(resolveDuplicateName("big copy 99999", "/target", fileSystem)).resolves.toBe(
      "/target/big copy 100000",
    );
  });

  it("keeps names that only look a little like copies", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
    });

    // A file called "copy", a "copy 1" (Finder never makes one) and "copycat".
    await expect(resolveDuplicateName("copy.txt", "/target", fileSystem)).resolves.toBe(
      "/target/copy copy.txt",
    );
    await expect(resolveDuplicateName("draft copy 1.txt", "/target", fileSystem)).resolves.toBe(
      "/target/draft copy 1 copy.txt",
    );
    await expect(resolveDuplicateName("a copycat.txt", "/target", fileSystem)).resolves.toBe(
      "/target/a copycat copy.txt",
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

  it("keeps folder names whole, except for bundles", async () => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target": { kind: "directory" } });

    await expect(
      resolveDuplicateName("Photos 2024.v2", "/target", fileSystem, undefined, {
        isDirectory: true,
      }),
    ).resolves.toBe("/target/Photos 2024.v2 copy");
    await expect(
      resolveDuplicateName("Tool.app", "/target", fileSystem, undefined, { isDirectory: true }),
    ).resolves.toBe("/target/Tool copy.app");
    await expect(resolveDuplicateName("report.v2", "/target", fileSystem)).resolves.toBe(
      "/target/report copy.v2",
    );
  });

  it("treats compressed tar archives as having one extension", async () => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target": { kind: "directory" } });

    for (const extension of [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".TAR.GZ"]) {
      await expect(resolveDuplicateName(`backup${extension}`, "/target", fileSystem)).resolves.toBe(
        `/target/backup copy${extension}`,
      );
    }
  });

  it.each([
    ["decomposed accents", "e\u0301".repeat(90)],
    ["emoji", "👩‍👩‍👧‍👦".repeat(12)],
    ["multibyte letters", "日本語".repeat(28)],
  ])("never splits a character when shortening a long name (%s)", async (_label, base) => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target": { kind: "directory" } });
    const name = `${base}.txt`;
    expect(Buffer.byteLength(name)).toBeGreaterThan(240);

    const copyPath = await resolveDuplicateName(name, "/target", fileSystem);
    const copyName = copyPath.slice("/target/".length);

    expect(Buffer.byteLength(copyName)).toBeLessThanOrEqual(255);
    expect(copyName.endsWith(" copy.txt")).toBe(true);
    const kept = copyName.slice(0, -" copy.txt".length);
    expect(base.startsWith(kept)).toBe(true);
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const unit = [...segmenter.segment(base)][0]?.segment ?? "";
    // Whole characters only: what is kept is a run of complete repeats of the character.
    expect(kept.length % unit.length).toBe(0);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("treats a name as taken when looking it up fails for any reason other than it missing", async () => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target": { kind: "directory" } });
    fileSystem.lstatImpl = async (path) => {
      if (path === "/target/a copy.txt") {
        throw new Error("the volume stopped answering");
      }
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    };

    await expect(resolveDuplicateName("a.txt", "/target", fileSystem)).resolves.toBe(
      "/target/a copy 2.txt",
    );
  });

  it("folds letter case only on case-insensitive volumes", () => {
    expect(destinationPathKey("/T/Caf\u00e9.TXT")).toBe(destinationPathKey("/t/cafe\u0301.txt"));
    expect(destinationPathKey("/T/Caf\u00e9.TXT", true)).not.toBe(
      destinationPathKey("/t/cafe\u0301.txt", true),
    );
    // Normalization never matters on APFS or HFS+.
    expect(destinationPathKey("/t/caf\u00e9", true)).toBe(
      destinationPathKey("/t/cafe\u0301", true),
    );
  });

  it("finds out whether a volume is case-sensitive by looking up a swapped name", async () => {
    const sensitive = new MockWriteServiceFileSystem({ "/target/Readme": { kind: "file" } });
    sensitive.caseSensitive = true;
    await expect(detectCaseSensitivity(sensitive, "/target")).resolves.toBe(true);

    // The mock answers from its setting; without an answer, looking decides.
    Object.defineProperty(sensitive, "isCaseSensitive", { value: undefined });
    await expect(detectCaseSensitivity(sensitive, "/target")).resolves.toBe(true);

    // Like APFS: any letter case finds the same item.
    const insensitive = new MockWriteServiceFileSystem({ "/target/Readme": { kind: "file" } });
    Object.defineProperty(insensitive, "isCaseSensitive", { value: async () => null });
    await expect(detectCaseSensitivity(insensitive, "/target")).resolves.toBe(false);
  });
});
