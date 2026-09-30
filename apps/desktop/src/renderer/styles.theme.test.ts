import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  accentTokensToCssVariables,
  generateAccentTokens,
  getFavoriteAccentVariables,
  getToolbarAccentVariables,
} from "./lib/accent";
import { THEME_VARIANT_OVERRIDE_KEYS } from "./lib/themeVariants";

const styles = readFileSync(resolve(import.meta.dirname, "./styles.css"), "utf8");

type Declaration = { selector: string; property: string; value: string };

// A small CSS walker: enough for this stylesheet (plain rules, @media / @keyframes nesting).
function parseDeclarations(css: string): Declaration[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors: string[] = [];
  const declarations: Declaration[] = [];
  let buffer = "";
  for (const char of source) {
    if (char === "{") {
      selectors.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (char === ";" || char === "}") {
      const match = buffer.trim().match(/^([a-zA-Z-]+)\s*:([\s\S]*)$/);
      if (match?.[1] && match[2] !== undefined) {
        declarations.push({
          selector: selectors[selectors.length - 1] ?? "",
          property: match[1],
          value: match[2].trim().replace(/\s+/g, " "),
        });
      }
      buffer = "";
      if (char === "}") {
        selectors.pop();
      }
    } else {
      buffer += char;
    }
  }
  return declarations;
}

function customPropertiesDefinedBy(css: string, selector: string): Set<string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const names = new Set<string>();
  for (const [, selectorList = "", body = ""] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorsInRule = selectorList.split(",").map((part) => part.trim());
    if (!selectorsInRule.includes(selector)) {
      continue;
    }
    for (const [, name = ""] of body.matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
      names.add(name);
    }
  }
  return names;
}

const HARD_CODED_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black)\b/i;

// Colors that intentionally stay the same in every theme. Anything else must come from a
// theme token so light and dark themes both style it.
const ALLOWED_HARD_CODED_COLORS: ReadonlyArray<{ selector: RegExp; reason: string }> = [
  { selector: /^\.action-notice-backdrop$/, reason: "neutral dark scrim, dims in every theme" },
  {
    selector: /^\.copy-paste-progress-card-track-shimmer$/,
    reason: "white sheen over the accent-colored progress fill",
  },
  {
    selector: /\.file-icon\.document\.(?:colorblock|vivid) \.file-icon-document-text$/,
    reason: "file-type icon artwork: white label on a colored icon block",
  },
  { selector: /^\.settings-toggle-track::after$/, reason: "white switch knob, as in macOS" },
  {
    selector: /\.active:not\(\.inactive\)/,
    reason: "focused selection is white text on the accent, as in Finder",
  },
  { selector: /^\.search-result-match$/, reason: "yellow find highlight, as in macOS" },
];

// Shadows and tints derived from a token (a token mixed with white/black) are theme-safe.
function isThemeSafeValue(property: string, value: string): boolean {
  if (/shadow$/.test(property) && !/rgba?\((?!0, 0, 0)/.test(value) && !/#/.test(value)) {
    return true;
  }
  const withoutMixes = value.replace(
    /color-mix\(in srgb, (?:var\([^()]*\)|white|black)(?: \d+%)?, (?:var\([^()]*\)|white|black|transparent)(?: \d+%)?\)/g,
    (mix) => (mix.includes("var(") ? "MIX" : mix),
  );
  return !HARD_CODED_COLOR.test(withoutMixes.replace(/var\([^()]*\)/g, "VAR"));
}

describe("theme styles", () => {
  const declarations = parseDeclarations(styles).filter(
    (declaration) => !declaration.property.startsWith("--"),
  );

  it("keeps the Go to Folder / Move To dialog and text prompts on theme tokens", () => {
    const offenders = declarations.filter(
      (declaration) =>
        /\.(?:go-to-folder|text-prompt|location-sheet)-?/.test(declaration.selector) &&
        HARD_CODED_COLOR.test(declaration.value.replace(/var\([^()]*\)/g, "VAR")),
    );
    expect(offenders).toEqual([]);
  });

  it("uses theme tokens for colors outside the documented exceptions", () => {
    const offenders = declarations
      .filter((declaration) => !isThemeSafeValue(declaration.property, declaration.value))
      .filter(
        (declaration) =>
          !ALLOWED_HARD_CODED_COLORS.some((allowed) => allowed.selector.test(declaration.selector)),
      )
      .map(({ selector, property, value }) => `${selector} { ${property}: ${value} }`);
    expect(offenders).toEqual([]);
  });

  it("gives every dark palette a value for each color token the light palette defines", () => {
    const runtimeTokens = new Set([
      ...Object.keys(accentTokensToCssVariables(generateAccentTokens("#daa520", "dark"))),
    ]);
    const lightTokens = customPropertiesDefinedBy(styles, ":root");
    const lightColorTokens = [...lightTokens].filter((name) => {
      const match = styles.match(new RegExp(`${name}:\\s*([^;]+);`));
      return (
        match?.[1] !== undefined && HARD_CODED_COLOR.test(match[1]) && !runtimeTokens.has(name)
      );
    });
    for (const theme of ["dark", "tomorrow-night", "catppuccin-mocha"]) {
      const darkTokens = customPropertiesDefinedBy(styles, `:root[data-theme="${theme}"]`);
      const missing = lightColorTokens.filter((name) => !darkTokens.has(name));
      expect({ theme, missing }).toEqual({ theme, missing: [] });
    }
  });

  it("only reads custom properties that are defined, set at runtime, or given a fallback", () => {
    const tokens = generateAccentTokens("#daa520", "dark");
    const known = new Set<string>([
      ...[...styles.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1] ?? ""),
      ...Object.keys(accentTokensToCssVariables(tokens)),
      ...Object.keys(getToolbarAccentVariables(tokens)),
      ...Object.keys(getFavoriteAccentVariables(tokens)),
      ...THEME_VARIANT_OVERRIDE_KEYS,
    ]);
    const undefinedReads = [...styles.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)]
      .map((match) => match[1] ?? "")
      .filter((name) => !known.has(name));
    expect([...new Set(undefinedReads)]).toEqual([]);
  });
});
