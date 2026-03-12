// Monoline icon theme: pure outline strokes with no fills. The document shape,
// fold corner, and symbol are all drawn with uniform colored strokes in the
// type's signature color. Transparent interior. Architectural, minimal aesthetic.

import type { ReactNode } from "react";

// ─── Types ─────────────────────────────────────────────────────────

export type MonolineIconType = keyof typeof MONOLINE_DEFS;

type MonolineDef = {
  /** Signature stroke color for this file type. */
  color: string;
  /** SVG elements rendered as stroke-only outlines in the signature color. */
  symbol: ReactNode;
};

// ─── Symbol Helpers ────────────────────────────────────────────────

/** Text-based labels use fill because stroked text is unreadable at small sizes. */
function textSymbol(label: string, fill: string, size = 7): ReactNode {
  return (
    <text
      x="12"
      y="17.8"
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

function monoSymbol(label: string, fill: string, size = 6.5): ReactNode {
  return (
    <text
      x="12"
      y="17.8"
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

export const MONOLINE_DEFS = {
  // ── Code Languages ──────────────────
  typescript: {
    color: "#3178C6",
    symbol: textSymbol("TS", "#3178C6"),
  },
  javascript: {
    color: "#F0C832",
    symbol: textSymbol("JS", "#1a1a1a"),
  },
  react: {
    color: "#0EA5E9",
    symbol: (
      <>
        <circle cx="12" cy="16.5" r="1.1" fill="none" stroke="#0EA5E9" strokeWidth="0.7" />
        <ellipse cx="12" cy="16.5" rx="5.2" ry="1.8" fill="none" stroke="#0EA5E9" strokeWidth="0.7" />
        <ellipse
          cx="12"
          cy="16.5"
          rx="5.2"
          ry="1.8"
          fill="none"
          stroke="#0EA5E9"
          strokeWidth="0.7"
          transform="rotate(60,12,16.5)"
        />
        <ellipse
          cx="12"
          cy="16.5"
          rx="5.2"
          ry="1.8"
          fill="none"
          stroke="#0EA5E9"
          strokeWidth="0.7"
          transform="rotate(-60,12,16.5)"
        />
      </>
    ),
  },
  python: {
    color: "#306998",
    symbol: (
      <>
        <path
          d="M12 13h-2.5a1.5 1.5 0 00-1.5 1.5v1.5h2.5a1.5 1.5 0 001.5-1.5V13z"
          fill="none"
          stroke="#306998"
          strokeWidth="0.7"
        />
        <path
          d="M12 20h2.5a1.5 1.5 0 001.5-1.5V17h-2.5a1.5 1.5 0 00-1.5 1.5V20z"
          fill="none"
          stroke="#306998"
          strokeWidth="0.7"
        />
        <circle cx="9.7" cy="13.7" r="0.5" fill="none" stroke="#306998" strokeWidth="0.5" />
        <circle cx="14.3" cy="19.3" r="0.5" fill="none" stroke="#306998" strokeWidth="0.5" />
        <line x1="8" y1="16.5" x2="11.5" y2="16.5" stroke="#306998" strokeWidth="0.6" strokeLinecap="round" />
        <line x1="12.5" y1="16.5" x2="16" y2="16.5" stroke="#306998" strokeWidth="0.6" strokeLinecap="round" />
      </>
    ),
  },
  rust: {
    color: "#CE422B",
    symbol: (
      <>
        <circle cx="12" cy="16.5" r="2.8" fill="none" stroke="#CE422B" strokeWidth="1.3" />
        <circle cx="12" cy="16.5" r="1" fill="none" stroke="#CE422B" strokeWidth="0.7" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <rect
            key={deg}
            x="11.3"
            y="12.2"
            width="1.4"
            height="2"
            rx="0.4"
            fill="none"
            stroke="#CE422B"
            strokeWidth="0.7"
            transform={`rotate(${deg},12,16.5)`}
          />
        ))}
      </>
    ),
  },
  go: {
    color: "#00ADD8",
    symbol: textSymbol("Go", "#00ADD8", 8),
  },
  java: {
    color: "#E76F00",
    symbol: (
      <>
        <rect x="8.5" y="14" width="5.5" height="5.5" rx="0.8" fill="none" stroke="#E76F00" strokeWidth="1" />
        <path d="M14 15.5h1.5a1 1 0 011 1v0a1 1 0 01-1 1H14" fill="none" stroke="#E76F00" strokeWidth="0.9" />
        <path d="M10 13.5v-1.5" stroke="#E76F00" strokeWidth="0.6" fill="none" strokeLinecap="round" />
        <path d="M11.5 13v-1.5" stroke="#E76F00" strokeWidth="0.6" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  c: {
    color: "#5C6BC0",
    symbol: textSymbol("C", "#5C6BC0", 10),
  },
  cpp: {
    color: "#00599C",
    symbol: textSymbol("C+", "#00599C", 7.5),
  },
  csharp: {
    color: "#68217A",
    symbol: textSymbol("C#", "#68217A", 7.5),
  },
  ruby: {
    color: "#CC342D",
    symbol: (
      <>
        <polygon
          points="12,12.5 7.5,16.5 9,20 15,20 16.5,16.5"
          fill="none"
          stroke="#CC342D"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <line x1="7.5" y1="16.5" x2="16.5" y2="16.5" stroke="#CC342D" strokeWidth="0.7" />
        <line x1="12" y1="12.5" x2="9.5" y2="16.5" stroke="#CC342D" strokeWidth="0.5" />
        <line x1="12" y1="12.5" x2="14.5" y2="16.5" stroke="#CC342D" strokeWidth="0.5" />
        <line x1="12" y1="20" x2="9.5" y2="16.5" stroke="#CC342D" strokeWidth="0.5" />
        <line x1="12" y1="20" x2="14.5" y2="16.5" stroke="#CC342D" strokeWidth="0.5" />
      </>
    ),
  },
  php: {
    color: "#777BB3",
    symbol: monoSymbol("php", "#777BB3", 6),
  },
  swift: {
    color: "#FA7343",
    symbol: (
      <path
        d="M15.5 13c-2.5 2-5.5 3.5-8 3.5 2.5 1.5 5.5 2 8 .5-.5 2-2.5 3.5-5 4 4 0 7-1.5 7.5-5 .2-1.5-.5-3-2.5-3z"
        fill="none"
        stroke="#FA7343"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    ),
  },
  kotlin: {
    color: "#7F52FF",
    symbol: (
      <>
        <polygon points="8,12 16,16.5 8,21" fill="none" stroke="#7F52FF" strokeWidth="0.8" strokeLinejoin="round" />
        <polygon points="8,12 16,12 8,21" fill="none" stroke="#7F52FF" strokeWidth="0.8" strokeLinejoin="round" />
      </>
    ),
  },
  dart: {
    color: "#0175C2",
    symbol: (
      <>
        <rect x="8" y="14.5" width="7" height="5" rx="0.5" fill="none" stroke="#0175C2" strokeWidth="0.8" />
        <polygon points="15,14 18,17 15,20" fill="none" stroke="#0175C2" strokeWidth="0.8" strokeLinejoin="round" />
        <rect x="8" y="12" width="5" height="2" rx="0.5" fill="none" stroke="#0175C2" strokeWidth="0.7" />
      </>
    ),
  },

  // ── Web & Config ────────────────────
  html: {
    color: "#E44D26",
    symbol: monoSymbol("</>", "#E44D26"),
  },
  css: {
    color: "#264DE4",
    symbol: monoSymbol("{ }", "#264DE4"),
  },
  json: {
    color: "#404040",
    symbol: (
      <>
        <text
          x="12"
          y="17.8"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#404040"
          fontSize="8"
          fontWeight="700"
          fontFamily="ui-monospace, monospace"
        >
          {"{ }"}
        </text>
        <circle cx="11" cy="17.5" r="0.6" fill="none" stroke="#404040" strokeWidth="0.6" />
        <circle cx="13" cy="17.5" r="0.6" fill="none" stroke="#404040" strokeWidth="0.6" />
      </>
    ),
  },
  markdown: {
    color: "#083FA1",
    symbol: (
      <>
        <text x="10" y="18" textAnchor="middle" dominantBaseline="central" fill="#083FA1" fontSize="9" fontWeight="900">
          M
        </text>
        <path
          d="M15 15v4M13.5 17.5L15 19l1.5-1.5"
          stroke="#083FA1"
          strokeWidth="1"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
  yaml: {
    color: "#CB171E",
    symbol: (
      <>
        <line x1="7" y1="14" x2="13" y2="14" stroke="#CB171E" strokeWidth="1.1" strokeLinecap="round" />
        <line x1="9" y1="16.3" x2="17" y2="16.3" stroke="#CB171E" strokeWidth="1.1" strokeLinecap="round" />
        <line x1="9" y1="18.6" x2="14" y2="18.6" stroke="#CB171E" strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="7" cy="16.3" r="0.7" fill="none" stroke="#CB171E" strokeWidth="0.6" />
        <circle cx="7" cy="18.6" r="0.7" fill="none" stroke="#CB171E" strokeWidth="0.6" />
      </>
    ),
  },
  toml: {
    color: "#9C4221",
    symbol: monoSymbol("[T]", "#9C4221"),
  },
  sql: {
    color: "#336791",
    symbol: (
      <>
        <ellipse cx="12" cy="13.5" rx="4" ry="1.5" fill="none" stroke="#336791" strokeWidth="1" />
        <path d="M8 13.5v6c0 .83 1.79 1.5 4 1.5s4-.67 4-1.5v-6" fill="none" stroke="#336791" strokeWidth="1" />
        <ellipse cx="12" cy="16" rx="4" ry="1.2" fill="none" stroke="#336791" strokeWidth="0.5" opacity="0.4" />
      </>
    ),
  },
  shell: {
    color: "#4EAA25",
    symbol: (
      <>
        <path
          d="M8 14l3.5 2.5L8 19"
          stroke="#4EAA25"
          strokeWidth="1.3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="13" y1="19" x2="17" y2="19" stroke="#4EAA25" strokeWidth="1.3" strokeLinecap="round" />
      </>
    ),
  },
  dockerfile: {
    color: "#2496ED",
    symbol: (
      <>
        <rect x="7.5" y="14.5" width="2.5" height="1.8" rx="0.3" fill="none" stroke="#2496ED" strokeWidth="0.7" />
        <rect x="10.5" y="14.5" width="2.5" height="1.8" rx="0.3" fill="none" stroke="#2496ED" strokeWidth="0.7" />
        <rect x="13.5" y="14.5" width="2.5" height="1.8" rx="0.3" fill="none" stroke="#2496ED" strokeWidth="0.7" />
        <rect x="7.5" y="12.2" width="2.5" height="1.8" rx="0.3" fill="none" stroke="#2496ED" strokeWidth="0.7" />
        <rect x="10.5" y="12.2" width="2.5" height="1.8" rx="0.3" fill="none" stroke="#2496ED" strokeWidth="0.7" />
        <path d="M6 17c0 2.5 3 3.5 6 3.5s6-1 6-3.5" stroke="#2496ED" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  config: {
    color: "#0D9488",
    symbol: (
      <>
        <circle cx="12" cy="16.5" r="2" fill="none" stroke="#0D9488" strokeWidth="1.2" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect
            key={deg}
            x="11.5"
            y="12.8"
            width="1"
            height="1.8"
            rx="0.3"
            fill="none"
            stroke="#0D9488"
            strokeWidth="0.7"
            transform={`rotate(${deg},12,16.5)`}
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
        <circle cx="9" cy="14" r="1.3" fill="none" stroke="#16A34A" strokeWidth="0.7" />
        <path d="M6 20l4-5 2.5 2.5L15 14.5 18 20z" fill="none" stroke="#16A34A" strokeWidth="0.8" strokeLinejoin="round" />
      </>
    ),
  },
  svg: {
    color: "#F59E0B",
    symbol: (
      <>
        <path d="M7 19c2-8 9-8 11 0" fill="none" stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="7" cy="19" r="1" fill="none" stroke="#F59E0B" strokeWidth="0.7" />
        <circle cx="18" cy="19" r="1" fill="none" stroke="#F59E0B" strokeWidth="0.7" />
        <line x1="7" y1="19" x2="9" y2="13" stroke="#F59E0B" strokeWidth="0.5" strokeDasharray="1 0.8" />
        <line x1="18" y1="19" x2="15" y2="13" stroke="#F59E0B" strokeWidth="0.5" strokeDasharray="1 0.8" />
        <circle cx="9" cy="13" r="0.7" fill="none" stroke="#F59E0B" strokeWidth="0.5" />
        <circle cx="15" cy="13" r="0.7" fill="none" stroke="#F59E0B" strokeWidth="0.5" />
      </>
    ),
  },
  video: {
    color: "#9333EA",
    symbol: (
      <>
        <circle cx="12" cy="16.5" r="4.5" fill="none" stroke="#9333EA" strokeWidth="1" />
        <polygon points="10.5,14 10.5,19 15.5,16.5" fill="none" stroke="#9333EA" strokeWidth="0.8" strokeLinejoin="round" />
      </>
    ),
  },
  audio: {
    color: "#EC4899",
    symbol: (
      <>
        <circle cx="9" cy="19" r="1.8" fill="none" stroke="#EC4899" strokeWidth="1.1" />
        <line x1="10.8" y1="19" x2="10.8" y2="12.5" stroke="#EC4899" strokeWidth="1.1" />
        <path d="M10.8 12.5l5.5-1v2.5l-5.5 1" fill="none" stroke="#EC4899" strokeWidth="0.8" />
      </>
    ),
  },
  pdf: {
    color: "#DC2626",
    symbol: textSymbol("PDF", "#DC2626", 6.5),
  },

  // ── Other ───────────────────────────
  archive: {
    color: "#D97706",
    symbol: (
      <>
        <rect x="7" y="13" width="10" height="7" rx="1" fill="none" stroke="#D97706" strokeWidth="1" />
        <line x1="12" y1="13" x2="12" y2="20" stroke="#D97706" strokeWidth="0.7" strokeDasharray="1.2 1" />
        <rect x="10" y="15.5" width="4" height="2.5" rx="0.5" fill="none" stroke="#D97706" strokeWidth="0.7" />
        <line x1="12" y1="15.5" x2="12" y2="18" stroke="#D97706" strokeWidth="0.6" />
      </>
    ),
  },
  text: {
    color: "#737373",
    symbol: (
      <>
        <line x1="7.5" y1="14" x2="16.5" y2="14" stroke="#737373" strokeWidth="1" strokeLinecap="round" />
        <line x1="7.5" y1="16.3" x2="14" y2="16.3" stroke="#737373" strokeWidth="1" strokeLinecap="round" />
        <line x1="7.5" y1="18.6" x2="16.5" y2="18.6" stroke="#737373" strokeWidth="1" strokeLinecap="round" />
        <line x1="7.5" y1="20.9" x2="12" y2="20.9" stroke="#737373" strokeWidth="1" strokeLinecap="round" />
      </>
    ),
  },
  font: {
    color: "#7C3AED",
    symbol: (
      <text
        x="12"
        y="18"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#7C3AED"
        fontSize="8"
        fontWeight="300"
        fontStyle="italic"
      >
        Aa
      </text>
    ),
  },
  binary: {
    color: "#374151",
    symbol: monoSymbol("01", "#374151", 8),
  },
  app: {
    color: "#3B82F6",
    symbol: (
      <>
        <rect x="7.5" y="13" width="3.5" height="3.5" rx="0.8" fill="none" stroke="#3B82F6" strokeWidth="0.8" />
        <rect x="13" y="13" width="3.5" height="3.5" rx="0.8" fill="none" stroke="#3B82F6" strokeWidth="0.8" />
        <rect x="7.5" y="18" width="3.5" height="3.5" rx="0.8" fill="none" stroke="#3B82F6" strokeWidth="0.8" />
        <rect x="13" y="18" width="3.5" height="3.5" rx="0.8" fill="none" stroke="#3B82F6" strokeWidth="0.8" opacity="0.6" />
      </>
    ),
  },

  // ── Additional Languages ───────────
  lua: {
    color: "#000080",
    symbol: textSymbol("Lua", "#000080", 6.5),
  },
  r: {
    color: "#2266B8",
    symbol: textSymbol("R", "#2266B8", 10),
  },
  scala: {
    color: "#DC322F",
    symbol: textSymbol("Sc", "#DC322F"),
  },
  perl: {
    color: "#39457E",
    symbol: monoSymbol("pl", "#39457E"),
  },
  elixir: {
    color: "#6B4F9E",
    symbol: (
      <path d="M12 12c-1.5 2-2.5 4.5-1.5 6.5.7 1.4 2 1.8 3.2 1 1.2-.8 1.5-2.8.3-5.2L12 12z" fill="none" stroke="#6B4F9E" strokeWidth="0.9" strokeLinejoin="round" />
    ),
  },
  haskell: {
    color: "#5E5086",
    symbol: textSymbol("λ", "#5E5086", 11),
  },
  zig: {
    color: "#F7A41D",
    symbol: (
      <path d="M8 13h3l-2 7h3l5-7h-3l2-7h-3z" fill="none" stroke="#F7A41D" strokeWidth="0.8" strokeLinejoin="round" />
    ),
  },
  julia: {
    color: "#9558B2",
    symbol: (
      <>
        <circle cx="9.5" cy="19" r="1.4" fill="none" stroke="#9558B2" strokeWidth="0.8" />
        <circle cx="14.5" cy="19" r="1.4" fill="none" stroke="#9558B2" strokeWidth="0.8" />
        <circle cx="12" cy="15" r="1.4" fill="none" stroke="#9558B2" strokeWidth="0.8" />
      </>
    ),
  },
  assembly: {
    color: "#6E4C13",
    symbol: monoSymbol("ASM", "#6E4C13", 5),
  },
  wasm: {
    color: "#654FF0",
    symbol: (
      <polygon points="12,12.5 16.5,14.8 15,19.5 9,19.5 7.5,14.8" fill="none" stroke="#654FF0" strokeWidth="0.8" strokeLinejoin="round" />
    ),
  },

  // ── Document Categories ────────────
  xml: {
    color: "#E37933",
    symbol: monoSymbol("XML", "#E37933", 5),
  },
  spreadsheet: {
    color: "#217346",
    symbol: (
      <>
        <rect x="7" y="13" width="10" height="8" rx="0.5" fill="none" stroke="#217346" strokeWidth="0.8" />
        <line x1="7" y1="15.7" x2="17" y2="15.7" stroke="#217346" strokeWidth="0.6" />
        <line x1="7" y1="18.4" x2="17" y2="18.4" stroke="#217346" strokeWidth="0.6" />
        <line x1="10.3" y1="13" x2="10.3" y2="21" stroke="#217346" strokeWidth="0.6" />
        <line x1="13.7" y1="13" x2="13.7" y2="21" stroke="#217346" strokeWidth="0.6" />
      </>
    ),
  },
  document: {
    color: "#2B579A",
    symbol: (
      <>
        <line x1="7.5" y1="13.5" x2="16.5" y2="13.5" stroke="#2B579A" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="7.5" y1="16" x2="14" y2="16" stroke="#2B579A" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="7.5" y1="18" x2="16.5" y2="18" stroke="#2B579A" strokeWidth="0.8" strokeLinecap="round" />
        <line x1="7.5" y1="20" x2="12" y2="20" stroke="#2B579A" strokeWidth="0.8" strokeLinecap="round" />
      </>
    ),
  },
  presentation: {
    color: "#D04423",
    symbol: (
      <>
        <rect x="7" y="12.5" width="10" height="7" rx="0.8" fill="none" stroke="#D04423" strokeWidth="1" />
        <polygon points="11,14.5 11,18 14,16.25" fill="none" stroke="#D04423" strokeWidth="0.8" strokeLinejoin="round" />
      </>
    ),
  },
  database: {
    color: "#003B57",
    symbol: (
      <>
        <ellipse cx="12" cy="13.5" rx="4" ry="1.3" fill="none" stroke="#003B57" strokeWidth="0.9" />
        <path d="M8 13.5v3c0 .72 1.79 1.3 4 1.3s4-.58 4-1.3v-3" fill="none" stroke="#003B57" strokeWidth="0.9" />
        <path d="M8 16.5v3c0 .72 1.79 1.3 4 1.3s4-.58 4-1.3v-3" fill="none" stroke="#003B57" strokeWidth="0.9" />
      </>
    ),
  },
  certificate: {
    color: "#2D8C3C",
    symbol: (
      <>
        <path d="M12 12.5l-4 2v3c0 1.8 1.8 3.2 4 3.7 2.2-.5 4-1.9 4-3.7v-3z" fill="none" stroke="#2D8C3C" strokeWidth="1" strokeLinejoin="round" />
        <path d="M10 16.5l1.5 1.5 3-3" stroke="#2D8C3C" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  ebook: {
    color: "#7B5427",
    symbol: (
      <>
        <path d="M7 13v7c1.5-1 3-1.5 5-1.5s3.5.5 5 1.5V13c-1.5-1-3-1.5-5-1.5S8.5 12 7 13z" fill="none" stroke="#7B5427" strokeWidth="0.9" />
        <line x1="12" y1="11.5" x2="12" y2="19.5" stroke="#7B5427" strokeWidth="0.6" />
      </>
    ),
  },
  latex: {
    color: "#008080",
    symbol: textSymbol("TeX", "#008080", 6),
  },
  graphql: {
    color: "#E10098",
    symbol: (
      <>
        <polygon points="12,13 15.5,14.8 15.5,18.5 12,20.3 8.5,18.5 8.5,14.8" fill="none" stroke="#E10098" strokeWidth="0.8" strokeLinejoin="round" />
        <circle cx="12" cy="13" r="0.8" fill="none" stroke="#E10098" strokeWidth="0.7" />
        <circle cx="15.5" cy="14.8" r="0.8" fill="none" stroke="#E10098" strokeWidth="0.7" />
        <circle cx="15.5" cy="18.5" r="0.8" fill="none" stroke="#E10098" strokeWidth="0.7" />
        <circle cx="12" cy="20.3" r="0.8" fill="none" stroke="#E10098" strokeWidth="0.7" />
        <circle cx="8.5" cy="18.5" r="0.8" fill="none" stroke="#E10098" strokeWidth="0.7" />
        <circle cx="8.5" cy="14.8" r="0.8" fill="none" stroke="#E10098" strokeWidth="0.7" />
      </>
    ),
  },
  protobuf: {
    color: "#4285F4",
    symbol: (
      <>
        <rect x="8" y="13" width="8" height="2.3" rx="0.4" fill="none" stroke="#4285F4" strokeWidth="0.7" />
        <rect x="8" y="15.8" width="8" height="2.3" rx="0.4" fill="none" stroke="#4285F4" strokeWidth="0.7" />
        <rect x="8" y="18.6" width="8" height="2.3" rx="0.4" fill="none" stroke="#4285F4" strokeWidth="0.7" />
      </>
    ),
  },

  generic: {
    color: "#A3A3A3",
    symbol: null,
  },
} as const satisfies Record<string, MonolineDef>;

// ─── Extension Classification ──────────────────────────────────────

export const MONOLINE_EXTENSION_MAP: Record<string, MonolineIconType> = {
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

/** Map a lowercase file extension to a monoline icon type. */
export function resolveMonolineIconType(extension: string): MonolineIconType {
  return MONOLINE_EXTENSION_MAP[extension] ?? "generic";
}

/** Special-case classification for filename-based types (e.g. Dockerfile). */
export function resolveMonolineIconTypeByName(name: string): MonolineIconType | null {
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

export function MonolineDocumentSvg({
  iconType,
  label,
}: {
  iconType: MonolineIconType;
  label: string;
}) {
  const def = MONOLINE_DEFS[iconType];
  const color = def.color;
  return (
    <svg
      className="file-icon-svg file-icon-document"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Document body — stroke only, no fill */}
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
        fill="none"
        stroke={color}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {/* Fold corner — stroke only */}
      <path
        d="M14 2v6h6"
        fill="none"
        stroke={color}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {/* Symbol */}
      {def.symbol}
      {/* Fallback: show text label when there is no symbol (generic type) */}
      {!def.symbol && (
        <text x="12" y="17" textAnchor="middle" className="file-icon-document-text">
          {label}
        </text>
      )}
    </svg>
  );
}
