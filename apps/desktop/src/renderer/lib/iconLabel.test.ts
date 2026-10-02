import { fitIconLabel, shortenNameInMiddle } from "./iconLabel";

// Stands in for the browser: a name "fits" when it is at most `limit` characters long.
const fitsWithin = (limit: number) => (text: string) => text.length <= limit;

describe("shortenNameInMiddle", () => {
  it("returns a name that fits unchanged", () => {
    expect(shortenNameInMiddle("notes.txt", "txt", fitsWithin(20))).toBe("notes.txt");
  });

  it("keeps the start, the end of the name and the extension", () => {
    expect(
      shortenNameInMiddle("Panorama Miradouro da Senhora do Monte.jpeg", "jpeg", fitsWithin(35)),
    ).toBe("Panorama Miradouro da Se…Monte.jpeg");
  });

  it("uses all the room there is", () => {
    const shortened = shortenNameInMiddle("a".repeat(80), "", fitsWithin(30));
    expect(shortened).toHaveLength(30);
    expect(shortened).toBe(`${"a".repeat(24)}…${"a".repeat(5)}`);
  });

  it("does not leave a space before the ellipsis", () => {
    expect(shortenNameInMiddle("Quarterly report final version.pdf", "pdf", fitsWithin(20))).toBe(
      "Quarterly…rsion.pdf",
    );
  });

  it("keeps less of the end when the name before the extension is short", () => {
    expect(
      shortenNameInMiddle("abcdef.verylongextension", "verylongextension", fitsWithin(23)),
    ).toBe("a…def.verylongextension");
  });

  it("keeps less of the end when all of it leaves no room for a start", () => {
    expect(
      shortenNameInMiddle("Miradouro da Senhora do Monte at sunset.png", "png", fitsWithin(10)),
    ).toBe("M…nset.png");
    expect(
      shortenNameInMiddle("Miradouro da Senhora do Monte at sunset.png", "png", fitsWithin(6)),
    ).toBe("M….png");
  });

  it("returns the name whole when no shortening fits", () => {
    expect(shortenNameInMiddle("abcdefghij.txt", "txt", fitsWithin(3))).toBe("abcdefghij.txt");
  });

  it("never cuts a character outside the basic plane in half", () => {
    const shortened = shortenNameInMiddle(`${"😀".repeat(20)}.png`, "png", (text) => {
      return Array.from(text).length <= 12;
    });
    expect(Array.from(shortened)).toHaveLength(12);
    expect(shortened).toBe(`${"😀".repeat(2)}…${"😀".repeat(5)}.png`);
  });
});

describe("fitIconLabel", () => {
  it("leaves names whole where nothing can be measured", () => {
    const name = `${"long name ".repeat(12)}.txt`;
    expect(fitIconLabel(name, "txt", false)).toBe(name);
    expect(fitIconLabel(name, "txt", true)).toBe(name);
  });
});
