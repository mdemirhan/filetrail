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
    await expect(detectCaseSensitivity(sensitive, "/target")).resolves.toBe(false);

    // The mock answers from its setting; without an answer, looking decides.
    Object.defineProperty(sensitive, "isCaseSensitive", { value: undefined });
    await expect(detectCaseSensitivity(sensitive, "/target")).resolves.toBe(true);

    const insensitive = new MockWriteServiceFileSystem({ "/target/Readme": { kind: "file" } });
    Object.defineProperty(insensitive, "isCaseSensitive", { value: async () => null });
    // Like APFS: any letter case finds the same item.
    const lookUp: typeof insensitive.lstatImpl = async (path) => {
      insensitive.lstatImpl = null;
      try {
        return await insensitive.lstat(
          path.toLowerCase() === "/target/readme" ? "/target/Readme" : path,
        );
      } finally {
        insensitive.lstatImpl = lookUp;
      }
    };
    insensitive.lstatImpl = lookUp;
    await expect(detectCaseSensitivity(insensitive, "/target")).resolves.toBe(false);
  });
});
