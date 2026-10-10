import {
  type HdiutilResult,
  createDiskImageOpener,
  readAttachFailure,
  readPlistBoolean,
  readPlistStrings,
} from "./diskImages";

const DEPRECATED = "hdiutil: WARNING: 'hdiutil attach ...' is deprecated.\n";

function plist(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

// What hdiutil attach -plist prints for an APFS image: the partition map and container
// without a mount point, the volume with one.
function attachOutput(...mountPoints: string[]): string {
  const volumes = mountPoints
    .map(
      (mountPoint) => `
		<dict>
			<key>dev-entry</key>
			<string>/dev/disk6s1</string>
			<key>mount-point</key>
			<string>${mountPoint}</string>
			<key>potentially-mountable</key>
			<true/>
			<key>volume-kind</key>
			<string>apfs</string>
		</dict>`,
    )
    .join("");
  return plist(`	<key>system-entities</key>
	<array>
		<dict>
			<key>content-hint</key>
			<string>GUID_partition_scheme</string>
			<key>dev-entry</key>
			<string>/dev/disk5</string>
			<key>potentially-mountable</key>
			<false/>
		</dict>${volumes}
	</array>`);
}

const ok = (stdout: string): HdiutilResult => ({ ok: true, stdout, stderr: DEPRECATED });
const failed = (stderr: string): HdiutilResult => ({
  ok: false,
  stdout: "",
  stderr: `${DEPRECATED}${stderr}`,
});

function setUp(answers: {
  encrypted?: boolean;
  licence?: boolean;
  attach: HdiutilResult | (() => Promise<HdiutilResult>);
}) {
  const calls: string[][] = [];
  const onMounted = vi.fn();
  const openWithDiskImageMounter = vi.fn(async () => undefined);
  const opener = createDiskImageOpener({
    runHdiutil: async (args) => {
      calls.push(args);
      switch (args[0]) {
        case "isencrypted":
          return ok(plist(`<key>encrypted</key>\n<${answers.encrypted ? "true" : "false"}/>`));
        case "imageinfo":
          return ok(
            plist(
              `<key>Software License Agreement</key>\n<${answers.licence ? "true" : "false"}/>`,
            ),
          );
        default:
          return typeof answers.attach === "function" ? answers.attach() : answers.attach;
      }
    },
    openWithDiskImageMounter,
    onMounted,
  });
  return { opener, calls, onMounted, openWithDiskImageMounter };
}

describe("createDiskImageOpener", () => {
  it("mounts the image without a Finder window and says where its disk is", async () => {
    const { opener, calls, onMounted } = setUp({ attach: ok(attachOutput("/Volumes/Install")) });

    await expect(opener.open("/Users/demo/Install.dmg")).resolves.toEqual({
      status: "opened",
      volumePath: "/Volumes/Install",
      reason: null,
    });
    expect(calls.at(-1)).toEqual(["attach", "-plist", "-noautoopen", "/Users/demo/Install.dmg"]);
    expect(onMounted).toHaveBeenCalledTimes(1);
  });

  it("opens the first volume by name when the image has several", async () => {
    const { opener } = setUp({
      attach: ok(attachOutput("/Volumes/Tools 10", "/Volumes/Tools 9", "/Volumes/apps")),
    });

    expect((await opener.open("/Users/demo/Bundle.dmg")).volumePath).toBe("/Volumes/apps");
  });

  it("hands an image that asks for a password to DiskImageMounter without mounting it", async () => {
    const { opener, calls, openWithDiskImageMounter } = setUp({
      encrypted: true,
      attach: ok(attachOutput("/Volumes/Secret")),
    });

    await expect(opener.open("/Users/demo/Secret.dmg")).resolves.toEqual({
      status: "handedOff",
      volumePath: null,
      reason: null,
    });
    expect(openWithDiskImageMounter).toHaveBeenCalledWith("/Users/demo/Secret.dmg");
    // Only the check that never asks for the password ran.
    expect(calls.map((args) => args[0])).toEqual(["isencrypted"]);
  });

  it("hands an image with a licence to agree to to DiskImageMounter", async () => {
    const { opener, calls, openWithDiskImageMounter } = setUp({
      licence: true,
      attach: ok(attachOutput("/Volumes/Licensed")),
    });

    expect((await opener.open("/Users/demo/Licensed.dmg")).status).toBe("handedOff");
    expect(openWithDiskImageMounter).toHaveBeenCalledTimes(1);
    expect(calls.map((args) => args[0])).toEqual(["isencrypted", "imageinfo"]);
  });

  it("hands it over when hdiutil gives up on a question the checks didn't foresee", async () => {
    const { opener, openWithDiskImageMounter, onMounted } = setUp({
      attach: failed("hdiutil: attach canceled\n"),
    });

    expect((await opener.open("/Users/demo/Odd.dmg")).status).toBe("handedOff");
    expect(openWithDiskImageMounter).toHaveBeenCalledTimes(1);
    expect(onMounted).not.toHaveBeenCalled();
  });

  it("says why an image couldn't be mounted", async () => {
    const { opener, openWithDiskImageMounter } = setUp({
      attach: failed("hdiutil: attach failed - no mountable file systems\n"),
    });

    await expect(opener.open("/Users/demo/Broken.dmg")).resolves.toEqual({
      status: "failed",
      volumePath: null,
      reason: "no mountable file systems",
    });
    expect(openWithDiskImageMounter).not.toHaveBeenCalled();
  });

  it("does nothing for an image opened again while it is being mounted", async () => {
    const held: { finish: ((result: HdiutilResult) => void) | null } = { finish: null };
    const { opener, calls } = setUp({
      // The first attach waits until it is let go; later ones answer at once.
      attach: () =>
        held.finish
          ? Promise.resolve(ok(attachOutput("/Volumes/Install")))
          : new Promise<HdiutilResult>((resolve) => {
              held.finish = resolve;
            }),
    });

    const first = opener.open("/Users/demo/Install.dmg");
    await expect(opener.open("/Users/demo/Install.dmg")).resolves.toMatchObject({
      status: "busy",
    });
    await vi.waitFor(() => expect(calls.some((args) => args[0] === "attach")).toBe(true));
    held.finish?.(ok(attachOutput("/Volumes/Install")));
    expect((await first).status).toBe("opened");
    // Once mounted it can be opened again: its disk opens once more.
    expect((await opener.open("/Users/demo/Install.dmg")).status).toBe("opened");
  });
});

describe("hdiutil output", () => {
  it("reads every value of a key, with XML escapes undone", () => {
    expect(
      readPlistStrings(attachOutput("/Volumes/Tom &amp; Jerry", "/Volumes/A&#38;B"), "mount-point"),
    ).toEqual(["/Volumes/Tom & Jerry", "/Volumes/A&B"]);
    expect(readPlistStrings(attachOutput(), "mount-point")).toEqual([]);
  });

  it("reads a boolean, or null when the key isn't there", () => {
    expect(readPlistBoolean(plist("<key>encrypted</key>\n\t<true/>"), "encrypted")).toBe(true);
    expect(readPlistBoolean(plist("<key>encrypted</key><false/>"), "encrypted")).toBe(false);
    expect(readPlistBoolean(plist(""), "encrypted")).toBeNull();
  });

  it("reads why an attach failed, past the deprecation warning", () => {
    expect(
      readAttachFailure(`${DEPRECATED}hdiutil: attach failed - image not recognized\n`),
    ).toEqual({ canceled: false, reason: "image not recognized" });
    expect(readAttachFailure(`${DEPRECATED}hdiutil: attach canceled\n`)).toEqual({
      canceled: true,
      reason: null,
    });
    expect(readAttachFailure("")).toEqual({ canceled: false, reason: null });
  });
});
