// @vitest-environment jsdom

import { render } from "@testing-library/react";

import { findNameMatch, mapMatchToLabel, renderMarkedText } from "./nameHighlight";

describe("marking a search's match in names", () => {
  it("finds the match, and nothing for an empty one", () => {
    expect(findNameMatch(/rep/i, "Annual Report.pdf")).toEqual({ start: 7, end: 10 });
    expect(findNameMatch(/x*/, "Report.pdf")).toBeNull();
    expect(findNameMatch(null, "Report.pdf")).toBeNull();
  });

  it("marks the match where it shows in a label shortened in the middle", () => {
    const name = "Panorama from the Miradouro do Monte.jpeg";
    const label = "Panorama from the…Monte.jpeg";
    const at = (text: string) => ({
      start: name.indexOf(text),
      end: name.indexOf(text) + text.length,
    });
    const shown = (text: string) =>
      mapMatchToLabel(name, label, at(text)).map((range) => label.slice(range.start, range.end));
    // Before the "…" and after it, as they are.
    expect(shown("Panorama")).toEqual(["Panorama"]);
    expect(shown("Monte")).toEqual(["Monte"]);
    // Gone in the middle: the "…" stands for it.
    expect(shown("Miradouro")).toEqual(["…"]);
    // Across the cut: what shows of it, and the "…", as one mark.
    expect(shown("the Miradouro")).toEqual(["the…"]);
    expect(shown("do Monte")).toEqual(["…Monte"]);
    // A label that is the whole name.
    expect(mapMatchToLabel("a.txt", "a.txt", { start: 0, end: 1 })).toEqual([{ start: 0, end: 1 }]);
  });

  it("draws the marks", () => {
    const { container } = render(
      <span>{renderMarkedText("report.ts", [{ start: 0, end: 3 }])}</span>,
    );
    expect(container.querySelector("mark")?.textContent).toBe("rep");
    expect(container.textContent).toBe("report.ts");
  });
});
