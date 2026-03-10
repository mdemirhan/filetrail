import { useMemo, useState } from "react";

import {
  ACCENT_OPTIONS,
  type AccentMode,
  type ThemeMode,
  getThemeLabel,
} from "../../shared/appPreferences";
import { generateAccentTokens } from "../lib/accent";
import { type ThemeCssBase, getThemeVariant, resolveThemeCssBase } from "../lib/themeVariants";
import { uiMonoFontStack as mono, uiSansFontStack as sans } from "../lib/viewFonts";

type ShortcutItem = {
  group: string;
  shortcut: string;
  description: string;
};

type ReferenceItem = {
  label: string;
  description: string;
};

const helpBaseThemes = {
  light: {
    name: "Light",
    page: "#edeef4",
    card: "#f7f8fb",
    cardBorder: "rgba(0,0,0,0.06)",
    title: "#2a2a34",
    desc: "#8a8c9a",
    sectionTitle: "#2a2a34",
    text: "#4a4a5a",
    textMuted: "#8a8c9a",
    kbd: {
      bg: "#fff",
      border: "rgba(0,0,0,0.12)",
      text: "#3a3a4a",
      shadow: "0 1px 0 rgba(0,0,0,0.08)",
    },
    plus: "#c0c2ce",
    sep: "rgba(0,0,0,0.05)",
    interaction: { label: "#2a2a34", desc: "#6e7080" },
    callout: { text: "#5a5a6a", bold: "#3a3a4a" },
    tabInactive: {
      bg: "transparent",
      border: "rgba(0,0,0,0.06)",
      text: "#9a9ca8",
    },
  },
  dark: {
    name: "Dark",
    page: "#181b22",
    card: "#1f222a",
    cardBorder: "rgba(255,255,255,0.05)",
    title: "#dcdee8",
    desc: "#6a6d78",
    sectionTitle: "#dcdee8",
    text: "#c0c4d0",
    textMuted: "#7a7d8e",
    kbd: {
      bg: "rgba(255,255,255,0.06)",
      border: "rgba(255,255,255,0.1)",
      text: "#c0c4d0",
      shadow: "0 1px 0 rgba(0,0,0,0.3)",
    },
    plus: "#484b54",
    sep: "rgba(255,255,255,0.04)",
    interaction: { label: "#dcdee8", desc: "#7a7d8e" },
    callout: { text: "#7a7d8e", bold: "#c0c4d0" },
    tabInactive: {
      bg: "transparent",
      border: "rgba(255,255,255,0.06)",
      text: "#555868",
    },
  },
  "tomorrow-night": {
    name: "Tomorrow Night",
    page: "#151617",
    card: "#1c1d1f",
    cardBorder: "rgba(255,255,255,0.04)",
    title: "#d8d9e0",
    desc: "#62636a",
    sectionTitle: "#d8d9e0",
    text: "#b8b9c2",
    textMuted: "#74757c",
    kbd: {
      bg: "rgba(255,255,255,0.05)",
      border: "rgba(255,255,255,0.08)",
      text: "#b8b9c2",
      shadow: "0 1px 0 rgba(0,0,0,0.35)",
    },
    plus: "#44454a",
    sep: "rgba(255,255,255,0.035)",
    interaction: { label: "#d8d9e0", desc: "#74757c" },
    callout: { text: "#74757c", bold: "#b8b9c2" },
    tabInactive: {
      bg: "transparent",
      border: "rgba(255,255,255,0.05)",
      text: "#505158",
    },
  },
  "catppuccin-mocha": {
    name: "Catppuccin Mocha",
    page: "#0e0e18",
    card: "#141420",
    cardBorder: "rgba(255,255,255,0.04)",
    title: "#dde4ff",
    desc: "#585878",
    sectionTitle: "#dde4ff",
    text: "#b8bee0",
    textMuted: "#707090",
    kbd: {
      bg: "rgba(255,255,255,0.04)",
      border: "rgba(255,255,255,0.07)",
      text: "#b8bee0",
      shadow: "0 1px 0 rgba(0,0,0,0.4)",
    },
    plus: "#3a3a52",
    sep: "rgba(255,255,255,0.03)",
    interaction: { label: "#dde4ff", desc: "#707090" },
    callout: { text: "#707090", bold: "#b8bee0" },
    tabInactive: {
      bg: "transparent",
      border: "rgba(255,255,255,0.04)",
      text: "#50506e",
    },
  },
} as const satisfies Record<ThemeCssBase, unknown>;

type ResolvedHelpTheme = ReturnType<typeof resolveHelpTheme>;

function resolveHelpTheme(theme: ThemeMode | undefined, accent: AccentMode | undefined) {
  const resolvedTheme = resolveThemeMode(theme);
  const resolvedAccent = resolveAccentMode(accent);
  const base = resolveHelpBaseTheme(resolvedTheme);
  const accentTokens = generateAccentTokens(resolvedAccent, resolvedTheme);

  return {
    ...base,
    subtitle: accentTokens.solid,
    sectionIcon: accentTokens.heroIconBg,
    category: accentTokens.pathCrumbHover,
    callout: {
      ...base.callout,
      bg: accentTokens.calloutBg,
      border: accentTokens.calloutBorder,
      icon: accentTokens.solid,
    },
    tabActive: {
      bg: accentTokens.pillBg,
      border: accentTokens.pillBorder,
      text: accentTokens.pillText,
    },
  };
}

function resolveHelpBaseTheme(theme: ThemeMode) {
  const cssBase = resolveThemeCssBase(theme);
  const base = helpBaseThemes[cssBase];
  const variant = getThemeVariant(theme);
  if (!variant) {
    return base;
  }
  return {
    ...base,
    name: getThemeLabel(theme),
    page: variant.surfaces.page,
    card: variant.surfaces.card,
    cardBorder: variant.surfaces.cardBorder,
    title: variant.text.primary,
    desc: variant.text.muted,
    sectionTitle: variant.text.primary,
    text: variant.text.secondary,
    textMuted: variant.text.muted,
    kbd: {
      ...base.kbd,
      bg: variant.controls.inputBg,
      border: variant.controls.inputBorder,
      text: variant.text.secondary,
    },
    plus: variant.text.placeholder,
    sep: variant.separator,
    interaction: {
      label: variant.text.primary,
      desc: variant.text.muted,
    },
    callout: {
      text: variant.text.secondary,
      bold: variant.text.primary,
    },
    tabInactive: {
      bg: "transparent",
      border: variant.pills.inactiveBorder,
      text: variant.pills.inactiveText,
    },
  };
}

const PREFERRED_LEFT_GROUPS = ["Navigation", "Panels"];
const PREFERRED_RIGHT_GROUPS = ["Search", "Views"];

export function HelpView({
  shortcutItems,
  referenceItems,
  layoutMode = "wide",
  theme,
  accent,
}: {
  shortcutItems: readonly ShortcutItem[];
  referenceItems: readonly ReferenceItem[];
  layoutMode?: "wide" | "narrow" | "compact";
  theme?: ThemeMode;
  accent?: AccentMode;
}) {
  const resolvedTheme = resolveHelpTheme(theme, accent);
  const [activeTab, setActiveTab] = useState<"shortcuts" | "explorer">("shortcuts");
  const groupedShortcuts = useMemo(() => groupShortcuts(shortcutItems), [shortcutItems]);
  const { leftGroups, rightGroups } = useMemo(
    () => splitShortcutGroups(groupedShortcuts),
    [groupedShortcuts],
  );
  const stackedColumns = layoutMode !== "wide";
  const interactionLabelWidth = layoutMode === "compact" ? "100%" : "160px";

  return (
    <div
      className="help-view"
      data-layout={layoutMode}
      style={{
        background: resolvedTheme.page,
        padding:
          layoutMode === "compact"
            ? "26px 16px 16px"
            : layoutMode === "narrow"
              ? "30px 18px 18px"
              : "34px 24px 20px",
        minHeight: "100%",
        overflowY: "auto",
      }}
    >
      <header className="help-header" style={{ marginBottom: "20px" }}>
        <div className="help-header-left">
        <span
          className="help-header-eyebrow"
          style={{
            fontSize: "10px",
            fontFamily: mono,
            fontWeight: 600,
            color: resolvedTheme.subtitle,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          FILE TRAIL
        </span>
        <h1
          style={{
            fontSize: "20px",
            fontFamily: sans,
            fontWeight: 700,
            color: resolvedTheme.title,
            margin: "2px 0 0",
            letterSpacing: "-0.02em",
          }}
        >
          Help &amp; Reference
        </h1>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Help sections"
        style={{ display: "flex", gap: "4px", marginBottom: "16px", flexWrap: "wrap" }}
      >
        {[
          { id: "shortcuts", label: "⌨ Keyboard Shortcuts" },
          { id: "explorer", label: "ℹ Explorer Reference" },
        ].map((tab) => {
          const active = activeTab === tab.id;
          const tabStyle = active ? resolvedTheme.tabActive : resolvedTheme.tabInactive;
          return (
            <button
              key={tab.id}
              id={`help-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`help-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id as "shortcuts" | "explorer")}
              style={{
                padding: "6px 14px",
                borderRadius: "6px",
                border: `1px solid ${tabStyle.border}`,
                background: tabStyle.bg,
                color: tabStyle.text,
                fontSize: "11.5px",
                fontFamily: sans,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                transition: "all 0.12s ease",
                outline: "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "shortcuts" ? (
        <section
          id="help-panel-shortcuts"
          role="tabpanel"
          aria-labelledby="help-tab-shortcuts"
          style={cardStyle(resolvedTheme)}
        >
          <div
            style={{
              display: "flex",
              flexDirection: stackedColumns ? "column" : "row",
              gap: stackedColumns ? "12px" : "32px",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {leftGroups.map((group) => (
                <div key={group.name}>
                  <CategoryLabel theme={resolvedTheme}>{group.name}</CategoryLabel>
                  {group.items.map((item, index) => (
                    <ShortcutRow
                      key={`${item.group}-${item.shortcut}-${item.description}`}
                      desc={item.description}
                      keys={shortcutParts(item.shortcut)}
                      theme={resolvedTheme}
                      isLast={index === group.items.length - 1}
                    />
                  ))}
                </div>
              ))}
            </div>

            {leftGroups.length > 0 && rightGroups.length > 0 ? (
              <div
                aria-hidden
                style={{
                  width: stackedColumns ? "100%" : "1px",
                  height: stackedColumns ? "1px" : "auto",
                  background: resolvedTheme.sep,
                  flexShrink: 0,
                  margin: stackedColumns ? "0" : "12px 0",
                }}
              />
            ) : null}

            <div style={{ flex: 1, minWidth: 0 }}>
              {rightGroups.map((group) => (
                <div key={group.name}>
                  <CategoryLabel theme={resolvedTheme}>{group.name}</CategoryLabel>
                  {group.items.map((item, index) => (
                    <ShortcutRow
                      key={`${item.group}-${item.shortcut}-${item.description}`}
                      desc={item.description}
                      keys={shortcutParts(item.shortcut)}
                      theme={resolvedTheme}
                      isLast={index === group.items.length - 1}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section
          id="help-panel-explorer"
          role="tabpanel"
          aria-labelledby="help-tab-explorer"
          style={cardStyle(resolvedTheme)}
        >
          <CategoryLabel theme={resolvedTheme}>Interaction</CategoryLabel>
          {referenceItems.map((item, index) => (
            <InteractionRow
              key={item.label}
              label={item.label}
              desc={item.description}
              theme={resolvedTheme}
              isLast={index === referenceItems.length - 1}
              stacked={layoutMode === "compact"}
              labelWidth={interactionLabelWidth}
            />
          ))}

          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              borderRadius: "8px",
              background: resolvedTheme.callout.bg,
              border: `1px solid ${resolvedTheme.callout.border}`,
              display: "flex",
              gap: "10px",
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: resolvedTheme.callout.icon,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: "1px",
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  color: resolvedTheme.card,
                  lineHeight: 1,
                }}
              >
                i
              </span>
            </div>
            <div
              style={{
                fontSize: "12px",
                fontFamily: sans,
                color: resolvedTheme.callout.text,
                lineHeight: "1.55",
              }}
            >
              <strong style={{ color: resolvedTheme.callout.bold }}>Path Bar Editing</strong> uses
              live filesystem suggestions from the typed parent folder, and{" "}
              <Kbd theme={resolvedTheme}>Esc</Kbd> always returns it to clickable mode.
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function cardStyle(theme: ResolvedHelpTheme) {
  return {
    background: theme.card,
    border: `1px solid ${theme.cardBorder}`,
    borderRadius: "10px",
    padding: "4px 20px 16px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  } as const;
}

function Kbd({
  children,
  theme,
}: {
  children: string;
  theme: ResolvedHelpTheme;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "22px",
        height: "20px",
        padding: "0 6px",
        borderRadius: "4px",
        fontSize: "10.5px",
        fontFamily: mono,
        fontWeight: 600,
        color: theme.kbd.text,
        background: theme.kbd.bg,
        border: `1px solid ${theme.kbd.border}`,
        boxShadow: theme.kbd.shadow,
        lineHeight: 1,
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </span>
  );
}

function Keys({
  keys,
  theme,
}: {
  keys: string[];
  theme: ResolvedHelpTheme;
}) {
  const keyOccurrences = new Map<string, number>();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
      {keys.map((key, index) => {
        const occurrenceCount = keyOccurrences.get(key) ?? 0;
        keyOccurrences.set(key, occurrenceCount + 1);
        return (
          <span
            key={`${keys.join("::")}-${key}-${occurrenceCount}`}
            style={{ display: "flex", alignItems: "center", gap: "3px" }}
          >
            {index > 0 ? (
              <span style={{ fontSize: "9px", color: theme.plus, fontFamily: mono }}>+</span>
            ) : null}
            <Kbd theme={theme}>{key}</Kbd>
          </span>
        );
      })}
    </div>
  );
}

function ShortcutRow({
  desc,
  keys,
  theme,
  isLast,
}: {
  desc: string;
  keys: string[];
  theme: ResolvedHelpTheme;
  isLast: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 0",
        gap: "16px",
        borderBottom: isLast ? "none" : `1px solid ${theme.sep}`,
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontFamily: sans,
          fontWeight: 430,
          color: theme.text,
          lineHeight: "1.4",
          flex: 1,
        }}
      >
        {desc}
      </span>
      <Keys keys={keys} theme={theme} />
    </div>
  );
}

function InteractionRow({
  label,
  desc,
  theme,
  isLast,
  stacked,
  labelWidth,
}: {
  label: string;
  desc: string;
  theme: ResolvedHelpTheme;
  isLast: boolean;
  stacked: boolean;
  labelWidth: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: stacked ? "column" : "row",
        gap: stacked ? "4px" : "16px",
        padding: "10px 0",
        borderBottom: isLast ? "none" : `1px solid ${theme.sep}`,
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontFamily: sans,
          fontWeight: 600,
          color: theme.interaction.label,
          width: stacked ? "100%" : labelWidth,
          flexShrink: 0,
          lineHeight: "1.4",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "12px",
          fontFamily: sans,
          fontWeight: 400,
          color: theme.interaction.desc,
          lineHeight: "1.5",
          flex: 1,
        }}
      >
        {desc}
      </span>
    </div>
  );
}

function CategoryLabel({
  children,
  theme,
}: {
  children: string;
  theme: ResolvedHelpTheme;
}) {
  return (
    <div
      style={{
        fontSize: "10px",
        fontFamily: mono,
        fontWeight: 700,
        color: theme.category,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        padding: "12px 0 4px",
      }}
    >
      {children}
    </div>
  );
}

function groupShortcuts(
  shortcuts: readonly ShortcutItem[],
): Array<{ name: string; items: ShortcutItem[] }> {
  const map = new Map<string, ShortcutItem[]>();
  for (const item of shortcuts) {
    const existing = map.get(item.group);
    if (existing) {
      existing.push(item);
      continue;
    }
    map.set(item.group, [item]);
  }
  return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
}

function splitShortcutGroups(groups: Array<{ name: string; items: ShortcutItem[] }>): {
  leftGroups: Array<{ name: string; items: ShortcutItem[] }>;
  rightGroups: Array<{ name: string; items: ShortcutItem[] }>;
} {
  const byName = new Map(groups.map((group) => [group.name, group]));
  const leftGroups = PREFERRED_LEFT_GROUPS.map((name) => byName.get(name)).filter(isPresent);
  const rightGroups = PREFERRED_RIGHT_GROUPS.map((name) => byName.get(name)).filter(isPresent);
  const leftovers = groups.filter(
    (group) =>
      !PREFERRED_LEFT_GROUPS.includes(group.name) && !PREFERRED_RIGHT_GROUPS.includes(group.name),
  );

  for (const leftover of leftovers) {
    if (leftGroups.length <= rightGroups.length) {
      leftGroups.push(leftover);
      continue;
    }
    rightGroups.push(leftover);
  }

  return { leftGroups, rightGroups };
}

function shortcutParts(shortcut: string): string[] {
  const normalized = shortcut.endsWith("++") ? `${shortcut.slice(0, -2)}+Plus` : shortcut;
  return normalized
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function resolveThemeMode(theme: ThemeMode | undefined): ThemeMode {
  if (theme) {
    return theme;
  }
  if (typeof document !== "undefined") {
    const documentThemeVariant = document.documentElement.dataset.themeVariant as
      | ThemeMode
      | undefined;
    if (
      documentThemeVariant &&
      (documentThemeVariant in helpBaseThemes || getThemeVariant(documentThemeVariant) !== null)
    ) {
      return documentThemeVariant;
    }
    const documentTheme = document.documentElement.dataset.theme as ThemeMode | undefined;
    if (documentTheme && documentTheme in helpBaseThemes) {
      return documentTheme;
    }
  }
  return "dark";
}

function resolveAccentMode(accent: AccentMode | undefined): AccentMode {
  if (accent) {
    return accent;
  }
  if (typeof document !== "undefined") {
    const documentAccent = document.documentElement.dataset.accent as AccentMode | undefined;
    const resolvedDocumentAccent = ACCENT_OPTIONS.find((option) => option.value === documentAccent);
    if (resolvedDocumentAccent) {
      return resolvedDocumentAccent.value;
    }
  }
  return "gold";
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
