import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ThemeMode } from "../shared/appPreferences";
import { accentTokensToCssVariables, generateAccentTokens } from "./lib/accent";
import {
  THEME_VARIANT_OVERRIDE_KEYS,
  getThemeVariantCssOverrides,
  resolveThemeCssBase,
} from "./lib/themeVariants";

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
  { selector: /^\.settings-toggle-track::after$/, reason: "white switch knob, as in macOS" },
  {
    selector: /\.active:not\(\.inactive\)/,
    reason: "focused selection is white text on the accent, as in Finder",
  },
  { selector: /^\.search-result-match$/, reason: "yellow find highlight, as in macOS" },
  {
    selector: /\.file-icon-(?:folder-(?:back|front|edge)|document-(?:page|fold))\b/,
    reason: "stand-ins for macOS icons, which keep their colors in every theme",
  },
  {
    selector: /\.filesystem-tree-section \.tree-scroll$/,
    reason: "alpha mask, not a color: black keeps the rows, transparent fades them out",
  },
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
      ...Object.keys(accentTokensToCssVariables(generateAccentTokens("#daa520", "macos-dark"))),
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
    const tokens = generateAccentTokens("#daa520", "macos-dark");
    const known = new Set<string>([
      ...[...styles.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((match) => match[1] ?? ""),
      ...Object.keys(accentTokensToCssVariables(tokens)),
      ...THEME_VARIANT_OVERRIDE_KEYS,
    ]);
    const undefinedReads = [...styles.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)]
      .map((match) => match[1] ?? "")
      .filter((name) => !known.has(name));
    expect([...new Set(undefinedReads)]).toEqual([]);
  });

  it("takes every font from the Font preference (icon artwork aside)", () => {
    // The stylesheet only uses the font tokens that `applyAppearance` sets.
    for (const { selector, value } of declarations.filter((d) => d.property === "font-family")) {
      expect(`${selector}: ${value}`).toMatch(/: (var\(--font-(sans|mono)\)|inherit)$/u);
    }
    // Components that style inline go through `viewFonts` instead of naming fonts.
    const componentsDir = resolve(import.meta.dirname, "./components");
    for (const file of readdirSync(componentsDir).filter((name) => name.endsWith(".tsx"))) {
      if (file.endsWith(".test.tsx")) {
        continue;
      }
      const source = readFileSync(join(componentsDir, file), "utf8");
      for (const match of source.matchAll(/fontFamily[=:]\s*([^,}\n]+)/gu)) {
        expect(`${file}: ${match[1]?.trim()}`).toMatch(/: (sans|mono|monoText \? mono : sans)$/u);
      }
    }
  });

  it("always shows the clipboard list's scrollbar, and leaves the panes' to come and go", () => {
    const backgroundOf = (selector: string) =>
      parseDeclarations(styles)
        .filter(
          (declaration) =>
            declaration.property === "background" &&
            declaration.selector.split(",").some((part) => part.trim() === selector),
        )
        .map((declaration) => declaration.value);

    // A thumb with a colour of its own is drawn whenever the list overflows.
    const clipboardThumb = backgroundOf(".clipboard-menu-list::-webkit-scrollbar-thumb");
    expect(clipboardThumb).toHaveLength(1);
    expect(clipboardThumb[0]).not.toBe("transparent");
    expect(
      parseDeclarations(styles).some(
        (declaration) =>
          declaration.selector === ".clipboard-menu-list::-webkit-scrollbar" &&
          declaration.property === "width",
      ),
    ).toBe(true);
    // The folder tree's and the file list's stay hidden until they are in use.
    expect(backgroundOf(".tree-scroll::-webkit-scrollbar-thumb")).toEqual(["transparent"]);
    expect(backgroundOf(".content-scroll::-webkit-scrollbar-thumb")).toEqual(["transparent"]);
  });

  it("keeps menus and popovers that hang off the toolbar clickable", () => {
    // The toolbar drags the window, and descendants inherit that unless they opt out.
    // Every menu shares one rule, so the selector may be one of a list.
    for (const selector of [".toolbar-search-options-button", ".toolbar-menu", ".toolbar-search"]) {
      expect(
        declarations.some(
          (d) =>
            d.selector.split(", ").includes(selector) &&
            d.property === "-webkit-app-region" &&
            d.value === "no-drag",
        ),
        selector,
      ).toBe(true);
    }
  });

  it("gives every menu the same surface, rows and highlight", () => {
    const shared = (property: string, selectors: string[]) =>
      declarations.filter(
        (d) =>
          d.property === property && selectors.every((s) => d.selector.split(", ").includes(s)),
      );
    // One rule each: a menu that needs its own look is a menu that looks different.
    for (const surface of [".toolbar-menu", ".context-menu", ".context-submenu"]) {
      for (const property of ["background", "border", "border-radius", "box-shadow"]) {
        expect(shared(property, [surface]), `${surface} ${property}`).toHaveLength(1);
      }
    }
    expect(shared("padding", [".toolbar-menu", ".context-menu", ".context-submenu"])).toHaveLength(
      1,
    );
    expect(
      shared("font-size", [".toolbar-menu-item", ".context-menu-item", ".context-submenu-item"]),
    ).toHaveLength(1);
    expect(
      shared("background", [
        '.toolbar-menu-item:hover:not(:disabled):not([aria-disabled="true"])',
        ".toolbar-menu-item.active",
        ".context-menu-item.active:not(.disabled)",
        ".context-submenu-item.active",
      ]).map((d) => d.value),
    ).toEqual(["var(--ft-accent-solid-button)"]);
  });

  it("fills the default button with the accent, and never draws it in the destructive red", () => {
    const all = parseDeclarations(styles);
    const defaultRules = all.filter((d) =>
      d.selector.split(",").some((part) => /\.push-button\.is-default(?![-\w])/.test(part)),
    );
    expect(defaultRules.some((d) => d.value.includes("--danger"))).toBe(false);
    const background = all.find(
      (d) => d.property === "background" && d.selector === ".push-button.is-default",
    );
    expect(background?.value).toBe("var(--ft-accent-solid-button)");
    const destructive = all.find(
      (d) => d.property === "color" && d.selector === ".push-button.is-destructive",
    );
    expect(destructive?.value).toBe("var(--danger-text)");
  });

  it("keeps menu shortcuts and disabled items readable in every theme", () => {
    const all = parseDeclarations(styles);
    const themes: ThemeMode[] = [
      "macos-light",
      "warm-paper",
      "sand",
      "macos-dark",
      "catppuccin-mocha",
      "tomorrow-night",
    ];
    for (const theme of themes) {
      const base = resolveThemeCssBase(theme);
      const block = base === "light" ? ":root" : `:root[data-theme="${base}"]`;
      const token = (name: string) =>
        getThemeVariantCssOverrides(theme)[name] ??
        all.find((d) => d.selector === block && d.property === name)?.value ??
        "";
      const menu = hexToRgb(token("--context-menu-bg"));
      const shortcut = hexToRgb(token("--context-menu-shortcut"));
      const disabled = hexToRgb(token("--context-menu-disabled"));
      expect(contrast(shortcut, menu), `${theme}: shortcut`).toBeGreaterThanOrEqual(3);
      expect(contrast(disabled, menu), `${theme}: disabled`).toBeGreaterThanOrEqual(2);
      expect(contrast(disabled, menu), `${theme}: disabled vs shortcut`).toBeLessThan(
        contrast(shortcut, menu),
      );
    }
  });

  it("shows a toolbar toggle that is on, in every theme, apart from off and from hover", () => {
    const all = parseDeclarations(styles);
    const percentOf = (property: string) => {
      const value = all.find((d) => d.selector === ":root" && d.property === property)?.value;
      const match = value?.match(
        /^color-mix\(in srgb, var\(--text-primary\) (\d+)%, transparent\)$/,
      );
      expect(match, property).not.toBeNull();
      return Number(match?.[1]) / 100;
    };
    const hover = percentOf("--toolbar-button-hover-bg");
    const on = percentOf("--toolbar-toggle-on-bg");
    const onHover = percentOf("--toolbar-toggle-on-hover-bg");
    const themes: ThemeMode[] = [
      "macos-light",
      "warm-paper",
      "sand",
      "macos-dark",
      "catppuccin-mocha",
      "tomorrow-night",
    ];
    for (const theme of themes) {
      const base = resolveThemeCssBase(theme);
      const block = base === "light" ? ":root" : `:root[data-theme="${base}"]`;
      const token = (name: string) =>
        getThemeVariantCssOverrides(theme)[name] ??
        all.find((d) => d.selector === block && d.property === name)?.value ??
        "";
      const toolbar = hexToRgb(token("--toolbar-bg"));
      const text = hexToRgb(token("--text-primary"));
      const fill = (amount: number) =>
        toolbar.map((channel, i) => channel + ((text[i] ?? 0) - channel) * amount);
      expect(contrast(fill(on), toolbar), `${theme}: on vs toolbar`).toBeGreaterThanOrEqual(1.25);
      expect(contrast(fill(on), fill(hover)), `${theme}: on vs hover`).toBeGreaterThanOrEqual(1.2);
      expect(contrast(fill(onHover), fill(on)), `${theme}: on hover vs on`).toBeGreaterThan(1.05);
    }
  });
});

function hexToRgb(hex: string): number[] {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  expect(match, hex).not.toBeNull();
  return [1, 2, 3].map((index) => Number.parseInt(match?.[index] ?? "0", 16));
}

// WCAG contrast ratio between two sRGB colors.
function contrast(left: number[], right: number[]): number {
  const luminance = (rgb: number[]) => {
    const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}
