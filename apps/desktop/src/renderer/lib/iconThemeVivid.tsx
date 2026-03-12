// Vivid icon theme: full-bleed saturated color fills the entire document silhouette.
// White fold corner for depth. White symbols on the colored body. Maximum color
// presence — like colored index cards.
//
// Classification matches the colorblock theme so all 36 icon types are visually
// distinct rather than grouped under a single "code" bucket.

import type { ReactNode } from "react";

// ─── Types ─────────────────────────────────────────────────────────

export type VividIconType = keyof typeof VIVID_DEFS;

type VividDef = {
  /** Primary fill color for the document body. */
  color: string;
  /** SVG elements rendered on top of the colored body (white on saturated background). */
  symbol: ReactNode;
};

// ─── Symbol Helpers ────────────────────────────────────────────────

function textSymbol(label: string, fill = "white", size = 7): ReactNode {
  return (
    <text
      x="12"
      y="15.3"
      textAnchor="middle"
      dominantBaseline="central"
      fill={fill}
      fontSize={size}
      fontWeight="800"
    >
      {label}
    </text>
  );
}

function monoSymbol(label: string, fill = "white", size = 6.5): ReactNode {
  return (
    <text
      x="12"
      y="15.3"
      textAnchor="middle"
      dominantBaseline="central"
      fill={fill}
      fontSize={size}
      fontWeight="700"
      fontFamily="ui-monospace, monospace"
    >
      {label}
    </text>
  );
}

// ─── Icon Definitions ──────────────────────────────────────────────

export const VIVID_DEFS = {
  // ── Code Languages ──────────────────
  typescript: {
    color: "#3178C6",
    symbol: textSymbol("TS"),
  },
  javascript: {
    color: "#EAB308",
    symbol: textSymbol("JS", "#1a1a1a"),
  },
  react: {
    color: "#0EA5E9",
    symbol: (
      <>
        <circle cx="12" cy="14" r="1.1" fill="white" />
        <ellipse cx="12" cy="14" rx="5.2" ry="1.8" fill="none" stroke="white" strokeWidth="0.7" />
        <ellipse
          cx="12"
          cy="14"
          rx="5.2"
          ry="1.8"
          fill="none"
          stroke="white"
          strokeWidth="0.7"
          transform="rotate(60,12,14)"
        />
        <ellipse
          cx="12"
          cy="14"
          rx="5.2"
          ry="1.8"
          fill="none"
          stroke="white"
          strokeWidth="0.7"
          transform="rotate(-60,12,14)"
        />
      </>
    ),
  },
  python: {
    color: "#306998",
    symbol: (
      <>
        <path d="M12 10.5h-2.5a1.5 1.5 0 00-1.5 1.5v1.5h2.5a1.5 1.5 0 001.5-1.5V10.5z" fill="white" opacity="0.75" />
        <path d="M12 17.5h2.5a1.5 1.5 0 001.5-1.5V14.5h-2.5a1.5 1.5 0 00-1.5 1.5V17.5z" fill="white" />
        <circle cx="9.7" cy="11.2" r="0.5" fill="#306998" />
        <circle cx="14.3" cy="16.8" r="0.5" fill="#306998" />
        <rect x="8" y="13.5" width="3.5" height="1" rx="0.3" fill="white" opacity="0.6" />
        <rect x="12.5" y="13.5" width="3.5" height="1" rx="0.3" fill="white" opacity="0.85" />
      </>
    ),
  },
  rust: {
    color: "#CE422B",
    symbol: (
      <>
        <circle cx="12" cy="14" r="2.8" fill="none" stroke="white" strokeWidth="1.3" />
        <circle cx="12" cy="14" r="1" fill="white" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <rect
            key={deg}
            x="11.3"
            y="9.7"
            width="1.4"
            height="2"
            rx="0.4"
            fill="white"
            transform={`rotate(${deg},12,14)`}
          />
        ))}
      </>
    ),
  },
  go: {
    color: "#00ADD8",
    symbol: textSymbol("Go", "white", 8),
  },
  java: {
    color: "#E76F00",
    symbol: (
      <>
        <rect x="8.5" y="11.5" width="5.5" height="5.5" rx="0.8" fill="none" stroke="white" strokeWidth="1" />
        <path d="M14 13h1.5a1 1 0 011 1v0a1 1 0 01-1 1H14" fill="none" stroke="white" strokeWidth="0.9" />
        <path d="M10 11v-1.5" stroke="white" strokeWidth="0.6" strokeLinecap="round" />
        <path d="M11.5 10.5v-1.5" stroke="white" strokeWidth="0.6" strokeLinecap="round" />
      </>
    ),
  },
  c: {
    color: "#5C6BC0",
    symbol: textSymbol("C", "white", 10),
  },
  cpp: {
    color: "#00599C",
    symbol: textSymbol("C+", "white", 7.5),
  },
  csharp: {
    color: "#68217A",
    symbol: textSymbol("C#", "white", 7.5),
  },
  ruby: {
    color: "#CC342D",
    symbol: (
      <>
        <polygon points="12,10 7.5,14 9,17.5 15,17.5 16.5,14" fill="none" stroke="white" strokeWidth="1" strokeLinejoin="round" />
        <line x1="7.5" y1="14" x2="16.5" y2="14" stroke="white" strokeWidth="0.7" />
        <line x1="12" y1="10" x2="9.5" y2="14" stroke="white" strokeWidth="0.5" />
        <line x1="12" y1="10" x2="14.5" y2="14" stroke="white" strokeWidth="0.5" />
        <line x1="12" y1="17.5" x2="9.5" y2="14" stroke="white" strokeWidth="0.5" />
        <line x1="12" y1="17.5" x2="14.5" y2="14" stroke="white" strokeWidth="0.5" />
      </>
    ),
  },
  php: {
    color: "#777BB3",
    symbol: monoSymbol("php", "white", 6),
  },
  swift: {
    color: "#FA7343",
    symbol: (
      <path
        d="M15.5 10.5c-2.5 2-5.5 3.5-8 3.5 2.5 1.5 5.5 2 8 .5-.5 2-2.5 3.5-5 4 4 0 7-1.5 7.5-5 .2-1.5-.5-3-2.5-3z"
        fill="white"
      />
    ),
  },
  kotlin: {
    color: "#7F52FF",
    symbol: (
      <>
        <polygon points="8,9.5 16,14 8,18.5" fill="white" opacity="0.5" />
        <polygon points="8,9.5 16,9.5 8,18.5" fill="white" />
      </>
    ),
  },
  dart: {
    color: "#0175C2",
    symbol: (
      <>
        <rect x="8" y="12" width="7" height="5" rx="0.5" fill="white" />
        <polygon points="15,11.5 18,14.5 15,17.5" fill="white" />
        <rect x="8" y="9.5" width="5" height="2" rx="0.5" fill="white" opacity="0.6" />
      </>
    ),
  },

  // ── Web & Config ────────────────────
  html: {
    color: "#E44D26",
    symbol: monoSymbol("</>"),
  },
  css: {
    color: "#264DE4",
    symbol: monoSymbol("{ }"),
  },
  json: {
    color: "#404040",
    symbol: (
      <>
        <text
          x="12"
          y="15.3"
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize="8"
          fontWeight="700"
          fontFamily="ui-monospace, monospace"
        >
          {"{ }"}
        </text>
        <circle cx="11" cy="15" r="0.6" fill="white" />
        <circle cx="13" cy="15" r="0.6" fill="white" />
      </>
    ),
  },
  markdown: {
    color: "#083FA1",
    symbol: (
      <>
        <text x="10" y="15.5" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="9" fontWeight="900">
          M
        </text>
        <path d="M15 12.5v4M13.5 15L15 16.5l1.5-1.5" stroke="white" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  yaml: {
    color: "#CB171E",
    symbol: (
      <>
        <line x1="7" y1="11.5" x2="13" y2="11.5" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
        <line x1="9" y1="13.8" x2="17" y2="13.8" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
        <line x1="9" y1="16.1" x2="14" y2="16.1" stroke="white" strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="7" cy="13.8" r="0.7" fill="white" opacity="0.5" />
        <circle cx="7" cy="16.1" r="0.7" fill="white" opacity="0.5" />
      </>
    ),
  },
  toml: {
    color: "#9C4221",
    symbol: monoSymbol("[T]"),
  },
  sql: {
    color: "#336791",
    symbol: (
      <>
        <ellipse cx="12" cy="11" rx="4" ry="1.5" fill="none" stroke="white" strokeWidth="1" />
        <path d="M8 11v6c0 .83 1.79 1.5 4 1.5s4-.67 4-1.5v-6" fill="none" stroke="white" strokeWidth="1" />
        <ellipse cx="12" cy="13.5" rx="4" ry="1.2" fill="none" stroke="white" strokeWidth="0.5" opacity="0.4" />
      </>
    ),
  },
  shell: {
    color: "#4EAA25",
    symbol: (
      <>
        <path d="M8 11.5l3.5 2.5L8 16.5" stroke="white" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="13" y1="16.5" x2="17" y2="16.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
      </>
    ),
  },
  dockerfile: {
    color: "#2496ED",
    symbol: (
      <>
        <rect x="7.5" y="12" width="2.5" height="1.8" rx="0.3" fill="white" />
        <rect x="10.5" y="12" width="2.5" height="1.8" rx="0.3" fill="white" />
        <rect x="13.5" y="12" width="2.5" height="1.8" rx="0.3" fill="white" />
        <rect x="7.5" y="9.7" width="2.5" height="1.8" rx="0.3" fill="white" />
        <rect x="10.5" y="9.7" width="2.5" height="1.8" rx="0.3" fill="white" />
        <path d="M6 14.5c0 2.5 3 3.5 6 3.5s6-1 6-3.5" stroke="white" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  config: {
    color: "#0D9488",
    symbol: (
      <>
        <circle cx="12" cy="14" r="2" fill="none" stroke="white" strokeWidth="1.2" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="11.5"
            y="10.3"
            width="1"
            height="1.8"
            rx="0.3"
            fill="white"
            transform={`rotate(${deg},12,14)`}
          />
        ))}
      </>
    ),
  },

  // ── Media ───────────────────────────
  image: {
    color: "#16A34A",
    symbol: (
      <>
        <circle cx="9" cy="11.5" r="1.3" fill="white" opacity="0.7" />
        <path d="M6 17.5l4-5 2.5 2.5L15 12 18 17.5z" fill="white" />
      </>
    ),
  },
  svg: {
    color: "#F59E0B",
    symbol: (
      <>
        <path d="M7 16.5c2-8 9-8 11 0" fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="7" cy="16.5" r="1" fill="white" />
        <circle cx="18" cy="16.5" r="1" fill="white" />
        <line x1="7" y1="16.5" x2="9" y2="10.5" stroke="white" strokeWidth="0.5" strokeDasharray="1 0.8" />
        <line x1="18" y1="16.5" x2="15" y2="10.5" stroke="white" strokeWidth="0.5" strokeDasharray="1 0.8" />
        <circle cx="9" cy="10.5" r="0.7" fill="white" opacity="0.6" />
        <circle cx="15" cy="10.5" r="0.7" fill="white" opacity="0.6" />
      </>
    ),
  },
  video: {
    color: "#9333EA",
    symbol: (
      <>
        <circle cx="12" cy="14" r="4.5" fill="none" stroke="white" strokeWidth="1" />
        <polygon points="10.5,11.5 10.5,16.5 15.5,14" fill="white" />
      </>
    ),
  },
  audio: {
    color: "#EC4899",
    symbol: (
      <>
        <circle cx="9" cy="16.5" r="1.8" fill="none" stroke="white" strokeWidth="1.1" />
        <line x1="10.8" y1="16.5" x2="10.8" y2="10" stroke="white" strokeWidth="1.1" />
        <path d="M10.8 10l5.5-1v2.5l-5.5 1" fill="white" opacity="0.6" />
      </>
    ),
  },
  pdf: {
    color: "#DC2626",
    symbol: textSymbol("PDF", "white", 6.5),
  },

  // ── Other ───────────────────────────
  archive: {
    color: "#D97706",
    symbol: (
      <>
        <rect x="7" y="10.5" width="10" height="7" rx="1" fill="none" stroke="white" strokeWidth="1" />
        <line x1="12" y1="10.5" x2="12" y2="17.5" stroke="white" strokeWidth="0.7" strokeDasharray="1.2 1" />
        <rect x="10" y="13" width="4" height="2.5" rx="0.5" fill="white" />
        <line x1="12" y1="13" x2="12" y2="15.5" stroke="#D97706" strokeWidth="0.6" />
      </>
    ),
  },
  text: {
    color: "#737373",
    symbol: (
      <>
        <line x1="7.5" y1="11.5" x2="16.5" y2="11.5" stroke="white" strokeWidth="1" strokeLinecap="round" />
        <line x1="7.5" y1="13.8" x2="14" y2="13.8" stroke="white" strokeWidth="1" strokeLinecap="round" />
        <line x1="7.5" y1="16.1" x2="16.5" y2="16.1" stroke="white" strokeWidth="1" strokeLinecap="round" />
        <line x1="7.5" y1="18.4" x2="12" y2="18.4" stroke="white" strokeWidth="1" strokeLinecap="round" />
      </>
    ),
  },
  font: {
    color: "#7C3AED",
    symbol: (
      <text x="12" y="15.5" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="8" fontWeight="300" fontStyle="italic">
        Aa
      </text>
    ),
  },
  binary: {
    color: "#374151",
    symbol: monoSymbol("01", "white", 8),
  },
  app: {
    color: "#3B82F6",
    symbol: (
      <>
        <rect x="7.5" y="10.5" width="3.5" height="3.5" rx="0.8" fill="white" />
        <rect x="13" y="10.5" width="3.5" height="3.5" rx="0.8" fill="white" />
        <rect x="7.5" y="15.5" width="3.5" height="3.5" rx="0.8" fill="white" />
        <rect x="13" y="15.5" width="3.5" height="3.5" rx="0.8" fill="white" opacity="0.6" />
      </>
    ),
  },

  // ── Additional Languages ───────────
  lua: {
    color: "#000080",
    symbol: textSymbol("Lua", "white", 6.5),
  },
  r: {
    color: "#2266B8",
    symbol: textSymbol("R", "white", 10),
  },
  scala: {
    color: "#DC322F",
    symbol: textSymbol("Sc"),
  },
  perl: {
    color: "#39457E",
    symbol: monoSymbol("pl"),
  },
  elixir: {
    color: "#6B4F9E",
    symbol: (
      <path d="M12 9.5c-1.5 2-2.5 4.5-1.5 6.5.7 1.4 2 1.8 3.2 1 1.2-.8 1.5-2.8.3-5.2L12 9.5z" fill="white" />
    ),
  },
  haskell: {
    color: "#5E5086",
    symbol: textSymbol("λ", "white", 11),
  },
  zig: {
    color: "#F7A41D",
    symbol: (
      <path d="M8 10.5h3l-2 7h3l5-7h-3l2-7h-3z" fill="white" />
    ),
  },
  julia: {
    color: "#9558B2",
    symbol: (
      <>
        <circle cx="9.5" cy="16.5" r="1.4" fill="white" />
        <circle cx="14.5" cy="16.5" r="1.4" fill="white" />
        <circle cx="12" cy="12.5" r="1.4" fill="white" />
      </>
    ),
  },
  assembly: {
    color: "#6E4C13",
    symbol: monoSymbol("ASM", "white", 5),
  },
  wasm: {
    color: "#654FF0",
    symbol: (
      <polygon points="12,10 16.5,12.3 15,17 9,17 7.5,12.3" fill="white" />
    ),
  },

  // ── Document Categories ────────────
  xml: {
    color: "#E37933",
    symbol: monoSymbol("XML", "white", 5),
  },
  spreadsheet: {
    color: "#217346",
    symbol: (
      <>
        <rect x="7" y="10.5" width="10" height="8" rx="0.5" fill="none" stroke="white" strokeWidth="0.8" />
        <line x1="7" y1="13.2" x2="17" y2="13.2" stroke="white" strokeWidth="0.6" />
        <line x1="7" y1="15.9" x2="17" y2="15.9" stroke="white" strokeWidth="0.6" />
        <line x1="10.3" y1="10.5" x2="10.3" y2="18.5" stroke="white" strokeWidth="0.6" />
        <line x1="13.7" y1="10.5" x2="13.7" y2="18.5" stroke="white" strokeWidth="0.6" />
      </>
    ),
  },
  document: {
    color: "#2B579A",
    symbol: (
      <>
        <line x1="7.5" y1="11" x2="16.5" y2="11" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="7.5" y1="13.5" x2="14" y2="13.5" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="7.5" y1="15.5" x2="16.5" y2="15.5" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="7.5" y1="17.5" x2="12" y2="17.5" stroke="white" strokeWidth="0.8" strokeLinecap="round" />
      </>
    ),
  },
  presentation: {
    color: "#D04423",
    symbol: (
      <>
        <rect x="7" y="10" width="10" height="7" rx="0.8" fill="none" stroke="white" strokeWidth="1" />
        <polygon points="11,12 11,15.5 14,13.75" fill="white" />
      </>
    ),
  },
  database: {
    color: "#003B57",
    symbol: (
      <>
        <ellipse cx="12" cy="11" rx="4" ry="1.3" fill="none" stroke="white" strokeWidth="0.9" />
        <path d="M8 11v3c0 .72 1.79 1.3 4 1.3s4-.58 4-1.3v-3" fill="none" stroke="white" strokeWidth="0.9" />
        <path d="M8 14v3c0 .72 1.79 1.3 4 1.3s4-.58 4-1.3v-3" fill="none" stroke="white" strokeWidth="0.9" />
      </>
    ),
  },
  certificate: {
    color: "#2D8C3C",
    symbol: (
      <>
        <path d="M12 10l-4 2v3c0 1.8 1.8 3.2 4 3.7 2.2-.5 4-1.9 4-3.7v-3z" fill="none" stroke="white" strokeWidth="1" strokeLinejoin="round" />
        <path d="M10 14l1.5 1.5 3-3" stroke="white" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  ebook: {
    color: "#7B5427",
    symbol: (
      <>
        <path d="M7 10.5v7c1.5-1 3-1.5 5-1.5s3.5.5 5 1.5V10.5c-1.5-1-3-1.5-5-1.5S8.5 9.5 7 10.5z" fill="none" stroke="white" strokeWidth="0.9" />
        <line x1="12" y1="9" x2="12" y2="17" stroke="white" strokeWidth="0.6" />
      </>
    ),
  },
  latex: {
    color: "#008080",
    symbol: textSymbol("TeX", "white", 6),
  },
  graphql: {
    color: "#E10098",
    symbol: (
      <>
        <polygon points="12,10.5 15.5,12.3 15.5,16 12,17.8 8.5,16 8.5,12.3" fill="none" stroke="white" strokeWidth="0.8" strokeLinejoin="round" />
        <circle cx="12" cy="10.5" r="0.8" fill="white" />
        <circle cx="15.5" cy="12.3" r="0.8" fill="white" />
        <circle cx="15.5" cy="16" r="0.8" fill="white" />
        <circle cx="12" cy="17.8" r="0.8" fill="white" />
        <circle cx="8.5" cy="16" r="0.8" fill="white" />
        <circle cx="8.5" cy="12.3" r="0.8" fill="white" />
      </>
    ),
  },
  protobuf: {
    color: "#4285F4",
    symbol: (
      <>
        <rect x="8" y="10.5" width="8" height="2.3" rx="0.4" fill="white" opacity="0.5" />
        <rect x="8" y="13.3" width="8" height="2.3" rx="0.4" fill="white" opacity="0.75" />
        <rect x="8" y="16.1" width="8" height="2.3" rx="0.4" fill="white" />
      </>
    ),
  },

  generic: {
    color: "#A3A3A3",
    symbol: null,
  },
} as const satisfies Record<string, VividDef>;

// ─── Extension Classification ──────────────────────────────────────

export const VIVID_EXTENSION_MAP: Record<string, VividIconType> = {
  // TypeScript
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  // JavaScript
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  // React
  tsx: "react",
  jsx: "react",
  // Python
  py: "python",
  pyw: "python",
  pyi: "python",
  // Rust
  rs: "rust",
  // Go
  go: "go",
  // Java
  java: "java",
  jar: "java",
  class: "java",
  // C
  c: "c",
  h: "c",
  // C++
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hxx: "cpp",
  // C#
  cs: "csharp",
  csx: "csharp",
  // Ruby
  rb: "ruby",
  erb: "ruby",
  rake: "ruby",
  // PHP
  php: "php",
  phtml: "php",
  // Swift
  swift: "swift",
  // Kotlin
  kt: "kotlin",
  kts: "kotlin",
  // Dart
  dart: "dart",
  // HTML
  html: "html",
  htm: "html",
  // CSS
  css: "css",
  scss: "css",
  less: "css",
  sass: "css",
  // JSON
  json: "json",
  jsonc: "json",
  json5: "json",
  ndjson: "json",
  jsonl: "json",
  // Markdown
  md: "markdown",
  mdx: "markdown",
  // YAML
  yml: "yaml",
  yaml: "yaml",
  // TOML
  toml: "toml",
  // SQL
  sql: "sql",
  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  // Config
  env: "config",
  ini: "config",
  cfg: "config",
  conf: "config",
  // Image
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  ico: "image",
  bmp: "image",
  tiff: "image",
  avif: "image",
  raw: "image",
  psd: "image",
  ai: "image",
  cr2: "image",
  nef: "image",
  arw: "image",
  // SVG
  svg: "svg",
  // Video
  mp4: "video",
  mov: "video",
  mkv: "video",
  avi: "video",
  webm: "video",
  flv: "video",
  wmv: "video",
  m4v: "video",
  // Audio
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  m4a: "audio",
  ogg: "audio",
  mid: "audio",
  midi: "audio",
  aiff: "audio",
  wma: "audio",
  // PDF
  pdf: "pdf",
  // Archive
  zip: "archive",
  tar: "archive",
  gz: "archive",
  xz: "archive",
  rar: "archive",
  "7z": "archive",
  bz2: "archive",
  iso: "archive",
  deb: "archive",
  rpm: "archive",
  pkg: "archive",
  cab: "archive",
  // Text
  txt: "text",
  log: "text",
  // Font
  ttf: "font",
  otf: "font",
  woff: "font",
  woff2: "font",
  // Binary
  exe: "binary",
  bin: "binary",
  dll: "binary",
  dylib: "binary",
  so: "binary",
  // Lua
  lua: "lua",
  // R
  r: "r",
  rmd: "r",
  // Scala
  scala: "scala",
  sc: "scala",
  // Perl
  pl: "perl",
  pm: "perl",
  // Elixir
  ex: "elixir",
  exs: "elixir",
  // Haskell
  hs: "haskell",
  lhs: "haskell",
  // Zig
  zig: "zig",
  // Julia
  jl: "julia",
  // Assembly
  asm: "assembly",
  s: "assembly",
  // WebAssembly
  wasm: "wasm",
  wat: "wasm",
  // XML
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  xsd: "xml",
  plist: "xml",
  // Spreadsheet
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  ods: "spreadsheet",
  numbers: "spreadsheet",
  // Document
  doc: "document",
  docx: "document",
  odt: "document",
  pages: "document",
  rtf: "document",
  // Presentation
  ppt: "presentation",
  pptx: "presentation",
  odp: "presentation",
  keynote: "presentation",
  // Database
  db: "database",
  sqlite: "database",
  sqlite3: "database",
  // Certificate
  pem: "certificate",
  crt: "certificate",
  cer: "certificate",
  key: "certificate",
  p12: "certificate",
  pfx: "certificate",
  // Ebook
  epub: "ebook",
  mobi: "ebook",
  // LaTeX
  tex: "latex",
  sty: "latex",
  bib: "latex",
  cls: "latex",
  // GraphQL
  graphql: "graphql",
  gql: "graphql",
  // Protocol Buffers
  proto: "protobuf",
};

/** Map a lowercase file extension to a vivid icon type. */
export function resolveVividIconType(extension: string): VividIconType {
  return VIVID_EXTENSION_MAP[extension] ?? "generic";
}

/** Special-case classification for filename-based types (e.g. Dockerfile). */
export function resolveVividIconTypeByName(name: string): VividIconType | null {
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (lower === ".env" || lower.startsWith(".env.")) {
    return "config";
  }
  if (
    lower === "makefile" ||
    lower === "cmakelists.txt" ||
    lower === "rakefile" ||
    lower === "gemfile" ||
    lower === "podfile"
  ) {
    return "config";
  }
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".editorconfig") {
    return "config";
  }
  if (lower === "license" || lower.startsWith("license.") || lower === "changelog" || lower.startsWith("changelog.")) {
    return "text";
  }
  return null;
}

// ─── SVG Rendering ─────────────────────────────────────────────────

export function VividDocumentSvg({
  iconType,
  label,
}: {
  iconType: VividIconType;
  label: string;
}) {
  const def = VIVID_DEFS[iconType];
  const color = def.color;
  return (
    <svg
      className="file-icon-svg file-icon-document"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Full-bleed document body */}
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        fill={color}
        className="file-icon-vivid-fill"
      />
      {/* White fold for depth */}
      <path d="M14 2v6h6" fill="white" fillOpacity={0.3} />
      {/* Symbol */}
      {def.symbol}
      {/* Fallback: show text label when there is no symbol (generic type) */}
      {!def.symbol && (
        <text x="12" y="15" textAnchor="middle" className="file-icon-document-text">
          {label}
        </text>
      )}
    </svg>
  );
}
