// @vitest-environment jsdom

import { render } from "@testing-library/react";

import {
  COLORBLOCK_DEFS,
  ColorblockDocumentSvg,
  type ColorblockIconType,
  resolveColorblockIconType,
  resolveColorblockIconTypeByName,
} from "./iconThemeColorblock";
import { MONOLINE_DEFS } from "./iconThemeMonoline";
import { VIVID_DEFS } from "./iconThemeVivid";

describe("resolveColorblockIconType", () => {
  it("maps common extensions to the expected icon type", () => {
    const cases: Array<[string, ColorblockIconType]> = [
      ["ts", "typescript"],
      ["mts", "typescript"],
      ["js", "javascript"],
      ["tsx", "react"],
      ["jsx", "react"],
      ["py", "python"],
      ["rs", "rust"],
      ["go", "go"],
      ["java", "java"],
      ["c", "c"],
      ["cpp", "cpp"],
      ["cs", "csharp"],
      ["rb", "ruby"],
      ["php", "php"],
      ["swift", "swift"],
      ["kt", "kotlin"],
      ["dart", "dart"],
      ["html", "html"],
      ["htm", "html"],
      ["css", "css"],
      ["scss", "css"],
      ["json", "json"],
      ["md", "markdown"],
      ["yml", "yaml"],
      ["yaml", "yaml"],
      ["toml", "toml"],
      ["sql", "sql"],
      ["sh", "shell"],
      ["bash", "shell"],
      ["zsh", "shell"],
      ["env", "config"],
      ["ini", "config"],
      ["png", "image"],
      ["jpg", "image"],
      ["svg", "svg"],
      ["mp4", "video"],
      ["mp3", "audio"],
      ["pdf", "pdf"],
      ["zip", "archive"],
      ["tar", "archive"],
      ["txt", "text"],
      ["log", "text"],
      ["ttf", "font"],
      ["woff2", "font"],
      ["exe", "binary"],
      ["dylib", "binary"],
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
      expect(resolveColorblockIconType(ext)).toBe(expected);
    }
  });

  it("falls back to generic for unknown extensions", () => {
    expect(resolveColorblockIconType("xyz")).toBe("generic");
    expect(resolveColorblockIconType("")).toBe("generic");
  });
});

describe("resolveColorblockIconTypeByName", () => {
  it("recognises Dockerfile variants", () => {
    expect(resolveColorblockIconTypeByName("Dockerfile")).toBe("dockerfile");
    expect(resolveColorblockIconTypeByName("dockerfile")).toBe("dockerfile");
    expect(resolveColorblockIconTypeByName("Dockerfile.dev")).toBe("dockerfile");
  });

  it("recognises .env variants", () => {
    expect(resolveColorblockIconTypeByName(".env")).toBe("config");
    expect(resolveColorblockIconTypeByName(".env.local")).toBe("config");
    expect(resolveColorblockIconTypeByName(".env.production")).toBe("config");
  });

  it("recognises build/config file names", () => {
    expect(resolveColorblockIconTypeByName("Makefile")).toBe("config");
    expect(resolveColorblockIconTypeByName("CMakeLists.txt")).toBe("config");
    expect(resolveColorblockIconTypeByName("Rakefile")).toBe("config");
    expect(resolveColorblockIconTypeByName("Gemfile")).toBe("config");
    expect(resolveColorblockIconTypeByName("Podfile")).toBe("config");
  });

  it("recognises dotfile config names", () => {
    expect(resolveColorblockIconTypeByName(".gitignore")).toBe("config");
    expect(resolveColorblockIconTypeByName(".gitattributes")).toBe("config");
    expect(resolveColorblockIconTypeByName(".editorconfig")).toBe("config");
  });

  it("recognises LICENSE and CHANGELOG as text", () => {
    expect(resolveColorblockIconTypeByName("LICENSE")).toBe("text");
    expect(resolveColorblockIconTypeByName("LICENSE.md")).toBe("text");
    expect(resolveColorblockIconTypeByName("CHANGELOG")).toBe("text");
    expect(resolveColorblockIconTypeByName("CHANGELOG.md")).toBe("text");
  });

  it("returns null for unrecognised names", () => {
    expect(resolveColorblockIconTypeByName("README.md")).toBeNull();
    expect(resolveColorblockIconTypeByName("package.json")).toBeNull();
  });
});

describe("COLORBLOCK_DEFS", () => {
  it("every icon type has a non-empty color string", () => {
    for (const [key, def] of Object.entries(COLORBLOCK_DEFS)) {
      expect(def.color).toBeTruthy();
      expect(typeof def.color).toBe("string");
      // Should be a hex color
      expect(def.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("generic type has null symbol", () => {
    expect(COLORBLOCK_DEFS.generic.symbol).toBeNull();
  });

  it("all non-generic types have a non-null symbol", () => {
    for (const [key, def] of Object.entries(COLORBLOCK_DEFS)) {
      if (key === "generic") continue;
      expect(def.symbol).not.toBeNull();
    }
  });
});

describe("ColorblockDocumentSvg", () => {
  it("renders an svg with the colorblock fill for a typed icon", () => {
    const { container } = render(<ColorblockDocumentSvg iconType="typescript" label="TS" />);
    const svg = container.querySelector("svg.file-icon-document");
    expect(svg).not.toBeNull();
    const colorFill = container.querySelector(".file-icon-colorblock-fill");
    expect(colorFill).not.toBeNull();
    expect(colorFill?.getAttribute("fill")).toBe("#3178C6");
  });

  it("renders a fallback text label for the generic type", () => {
    const { container } = render(<ColorblockDocumentSvg iconType="generic" label="XYZ" />);
    const text = container.querySelector(".file-icon-document-text");
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe("XYZ");
  });

  it("does not render fallback text for typed icons with symbols", () => {
    const { container } = render(<ColorblockDocumentSvg iconType="python" label="PY" />);
    const text = container.querySelector(".file-icon-document-text");
    expect(text).toBeNull();
  });
});

describe("cross-module consistency", () => {
  it("all three themed DEFS have the same icon type keys", () => {
    const cbTypes = Object.keys(COLORBLOCK_DEFS).sort();
    const mlTypes = Object.keys(MONOLINE_DEFS).sort();
    const vTypes = Object.keys(VIVID_DEFS).sort();
    expect(cbTypes).toEqual(mlTypes);
    expect(cbTypes).toEqual(vTypes);
  });
});
