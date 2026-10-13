import { join } from "node:path";

import { RENDERER_ORIGIN, resolveRendererFile } from "./rendererProtocol";

describe("resolveRendererFile", () => {
  const rendererDir = "/Applications/File Trail.app/Contents/Resources/app/dist/renderer";

  it("serves the renderer's files from the scheme's address", () => {
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/index.html`)).toBe(
      join(rendererDir, "index.html"),
    );
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/main.js`)).toBe(
      join(rendererDir, "main.js"),
    );
  });

  it("leaves out the page's #… and ?…, and reads escaped names", () => {
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/index.html#settings/general`)).toBe(
      join(rendererDir, "index.html"),
    );
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/main.css?v=1`)).toBe(
      join(rendererDir, "main.css"),
    );
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/assets/a%20b.png`)).toBe(
      join(rendererDir, "assets", "a b.png"),
    );
  });

  it("serves nothing outside the renderer's folder", () => {
    // The address itself can't climb out: "/../" stops at its top.
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/../main/main.js`)).toBe(
      join(rendererDir, "main", "main.js"),
    );
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/%2e%2e/main/main.js`)).toBe(
      join(rendererDir, "main", "main.js"),
    );
    // Escaped slashes are read only after the address is parsed: they are checked here.
    expect(
      resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/..%2f..%2fbuild-info.json`),
    ).toBeNull();
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/`)).toBeNull();
  });

  it("serves nothing for another scheme or host, or an address it can't read", () => {
    expect(resolveRendererFile(rendererDir, "file:///etc/passwd")).toBeNull();
    expect(resolveRendererFile(rendererDir, "filetrail://other/index.html")).toBeNull();
    expect(resolveRendererFile(rendererDir, `${RENDERER_ORIGIN}/%E0%A4%A`)).toBeNull();
    expect(resolveRendererFile(rendererDir, "not a url")).toBeNull();
  });
});
