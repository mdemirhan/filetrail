// @vitest-environment jsdom

import { render } from "@testing-library/react";

import {
  VIVID_DEFS,
  VividDocumentSvg,
  type VividIconType,
  resolveVividIconType,
  resolveVividIconTypeByName,
} from "./iconThemeVivid";

describe("resolveVividIconType", () => {
  it("maps common extensions to the expected icon type", () => {
    const cases: Array<[string, VividIconType]> = [
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
      expect(resolveVividIconType(ext)).toBe(expected);
    }
  });

  it("falls back to generic for unknown extensions", () => {
    expect(resolveVividIconType("xyz")).toBe("generic");
    expect(resolveVividIconType("")).toBe("generic");
  });
});

describe("resolveVividIconTypeByName", () => {
  it("recognises Dockerfile variants", () => {
    expect(resolveVividIconTypeByName("Dockerfile")).toBe("dockerfile");
    expect(resolveVividIconTypeByName("Dockerfile.dev")).toBe("dockerfile");
  });

  it("recognises .env variants", () => {
    expect(resolveVividIconTypeByName(".env")).toBe("config");
    expect(resolveVividIconTypeByName(".env.local")).toBe("config");
  });

  it("recognises build/config file names", () => {
    expect(resolveVividIconTypeByName("Makefile")).toBe("config");
    expect(resolveVividIconTypeByName("CMakeLists.txt")).toBe("config");
    expect(resolveVividIconTypeByName("Rakefile")).toBe("config");
    expect(resolveVividIconTypeByName("Gemfile")).toBe("config");
    expect(resolveVividIconTypeByName("Podfile")).toBe("config");
  });

  it("recognises dotfile config names", () => {
    expect(resolveVividIconTypeByName(".gitignore")).toBe("config");
    expect(resolveVividIconTypeByName(".gitattributes")).toBe("config");
    expect(resolveVividIconTypeByName(".editorconfig")).toBe("config");
  });

  it("recognises LICENSE and CHANGELOG as text", () => {
    expect(resolveVividIconTypeByName("LICENSE")).toBe("text");
    expect(resolveVividIconTypeByName("CHANGELOG")).toBe("text");
  });

  it("returns null for unrecognised names", () => {
    expect(resolveVividIconTypeByName("README.md")).toBeNull();
  });
});

describe("VIVID_DEFS", () => {
  it("every icon type has a valid hex color", () => {
    for (const [, def] of Object.entries(VIVID_DEFS)) {
      expect(def.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("generic type has null symbol", () => {
    expect(VIVID_DEFS.generic.symbol).toBeNull();
  });

  it("all non-generic types have a non-null symbol", () => {
    for (const [key, def] of Object.entries(VIVID_DEFS)) {
      if (key === "generic") continue;
      expect(def.symbol).not.toBeNull();
    }
  });
});

describe("VividDocumentSvg", () => {
  it("renders an svg with the vivid fill covering the whole document", () => {
    const { container } = render(<VividDocumentSvg iconType="typescript" label="TS" />);
    const svg = container.querySelector("svg.file-icon-document");
    expect(svg).not.toBeNull();
    const vividFill = container.querySelector(".file-icon-vivid-fill");
    expect(vividFill).not.toBeNull();
    expect(vividFill?.getAttribute("fill")).toBe("#3178C6");
  });

  it("renders a fallback text label for the generic type", () => {
    const { container } = render(<VividDocumentSvg iconType="generic" label="XYZ" />);
    const text = container.querySelector(".file-icon-document-text");
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe("XYZ");
  });

  it("does not render fallback text for typed icons with symbols", () => {
    const { container } = render(<VividDocumentSvg iconType="python" label="PY" />);
    const text = container.querySelector(".file-icon-document-text");
    expect(text).toBeNull();
  });
});
