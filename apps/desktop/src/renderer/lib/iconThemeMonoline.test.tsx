// @vitest-environment jsdom

import { render } from "@testing-library/react";

import {
  MONOLINE_DEFS,
  MonolineDocumentSvg,
  type MonolineIconType,
  resolveMonolineIconType,
  resolveMonolineIconTypeByName,
} from "./iconThemeMonoline";

describe("resolveMonolineIconType", () => {
  it("maps common extensions to the expected icon type", () => {
    const cases: Array<[string, MonolineIconType]> = [
      ["ts", "typescript"],
      ["js", "javascript"],
      ["tsx", "react"],
      ["py", "python"],
      ["rs", "rust"],
      ["go", "go"],
      ["java", "java"],
      ["c", "c"],
      ["cpp", "cpp"],
      ["html", "html"],
      ["css", "css"],
      ["json", "json"],
      ["md", "markdown"],
      ["yml", "yaml"],
      ["sh", "shell"],
      ["png", "image"],
      ["svg", "svg"],
      ["mp4", "video"],
      ["mp3", "audio"],
      ["pdf", "pdf"],
      ["zip", "archive"],
      ["txt", "text"],
      ["ttf", "font"],
      ["exe", "binary"],
      // New language types
      ["lua", "lua"],
      ["r", "r"],
      ["rmd", "r"],
      ["scala", "scala"],
      ["pl", "perl"],
      ["ex", "elixir"],
      ["hs", "haskell"],
      ["zig", "zig"],
      ["jl", "julia"],
      ["asm", "assembly"],
      ["wasm", "wasm"],
      // New document category types
      ["xml", "xml"],
      ["plist", "xml"],
      ["xlsx", "spreadsheet"],
      ["csv", "spreadsheet"],
      ["docx", "document"],
      ["rtf", "document"],
      ["pptx", "presentation"],
      ["keynote", "presentation"],
      ["sqlite", "database"],
      ["pem", "certificate"],
      ["key", "certificate"],
      ["epub", "ebook"],
      ["tex", "latex"],
      ["graphql", "graphql"],
      ["proto", "protobuf"],
      // Extensions added to existing types
      ["avif", "image"],
      ["psd", "image"],
      ["flv", "video"],
      ["midi", "audio"],
      ["ndjson", "json"],
      ["iso", "archive"],
      ["deb", "archive"],
    ];

    for (const [ext, expected] of cases) {
      expect(resolveMonolineIconType(ext)).toBe(expected);
    }
  });

  it("falls back to generic for unknown extensions", () => {
    expect(resolveMonolineIconType("xyz")).toBe("generic");
    expect(resolveMonolineIconType("")).toBe("generic");
  });
});

describe("resolveMonolineIconTypeByName", () => {
  it("recognises Dockerfile variants", () => {
    expect(resolveMonolineIconTypeByName("Dockerfile")).toBe("dockerfile");
    expect(resolveMonolineIconTypeByName("Dockerfile.dev")).toBe("dockerfile");
  });

  it("recognises .env variants", () => {
    expect(resolveMonolineIconTypeByName(".env")).toBe("config");
    expect(resolveMonolineIconTypeByName(".env.local")).toBe("config");
  });

  it("recognises build/config file names", () => {
    expect(resolveMonolineIconTypeByName("Makefile")).toBe("config");
    expect(resolveMonolineIconTypeByName("CMakeLists.txt")).toBe("config");
    expect(resolveMonolineIconTypeByName("Rakefile")).toBe("config");
    expect(resolveMonolineIconTypeByName("Gemfile")).toBe("config");
    expect(resolveMonolineIconTypeByName("Podfile")).toBe("config");
  });

  it("recognises dotfile config names", () => {
    expect(resolveMonolineIconTypeByName(".gitignore")).toBe("config");
    expect(resolveMonolineIconTypeByName(".gitattributes")).toBe("config");
    expect(resolveMonolineIconTypeByName(".editorconfig")).toBe("config");
  });

  it("recognises LICENSE and CHANGELOG as text", () => {
    expect(resolveMonolineIconTypeByName("LICENSE")).toBe("text");
    expect(resolveMonolineIconTypeByName("CHANGELOG")).toBe("text");
  });

  it("returns null for unrecognised names", () => {
    expect(resolveMonolineIconTypeByName("README.md")).toBeNull();
  });
});

describe("MONOLINE_DEFS", () => {
  it("every icon type has a valid hex color", () => {
    for (const [, def] of Object.entries(MONOLINE_DEFS)) {
      expect(def.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("generic type has null symbol", () => {
    expect(MONOLINE_DEFS.generic.symbol).toBeNull();
  });

  it("all non-generic types have a non-null symbol", () => {
    for (const [key, def] of Object.entries(MONOLINE_DEFS)) {
      if (key === "generic") continue;
      expect(def.symbol).not.toBeNull();
    }
  });
});

describe("MonolineDocumentSvg", () => {
  it("renders an svg with no document fill (stroke only)", () => {
    const { container } = render(<MonolineDocumentSvg iconType="typescript" label="TS" />);
    const svg = container.querySelector("svg.file-icon-document");
    expect(svg).not.toBeNull();
    // Document body path should have fill="none"
    const paths = container.querySelectorAll("path");
    const bodyPath = paths[0];
    expect(bodyPath?.getAttribute("fill")).toBe("none");
    expect(bodyPath?.getAttribute("stroke")).toBe("#3178C6");
  });

  it("renders a fallback text label for the generic type", () => {
    const { container } = render(<MonolineDocumentSvg iconType="generic" label="XYZ" />);
    const text = container.querySelector(".file-icon-document-text");
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe("XYZ");
  });

  it("does not render fallback text for typed icons with symbols", () => {
    const { container } = render(<MonolineDocumentSvg iconType="python" label="PY" />);
    const text = container.querySelector(".file-icon-document-text");
    expect(text).toBeNull();
  });
});
