import { draftReleaseNotes } from "./releaseNotes";

describe("draftReleaseNotes", () => {
  it("lists the commits since the last release under What's new", () => {
    expect(
      draftReleaseNotes([
        "Spring into folders in the content pane under a held drag",
        "Merge branch 'claude/spring-loaded-folders'",
        "",
        "Gather dragged items into a stack under the pointer",
      ]),
    ).toBe(
      [
        "<!-- Draft: one line per commit since the last release. Rewrite it for people, then publish. -->",
        "### What's new",
        "- Spring into folders in the content pane under a held drag",
        "- Gather dragged items into a stack under the pointer",
        "",
      ].join("\n"),
    );
  });

  it("leaves a line to fill in when there is nothing to list", () => {
    expect(draftReleaseNotes([""])).toContain("### What's new\n- \n");
  });
});
