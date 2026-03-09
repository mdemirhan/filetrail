import { useMemo, useState } from "react";

import type { ThemeMode } from "../../shared/appPreferences";

type ShortcutItem = {
  group: string;
  shortcut: string;
  description: string;
};

type ReferenceItem = {
  label: string;
  description: string;
};

const mono = "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace";
const sans = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', system-ui, sans-serif";

const helpThemes = {
  light: {
    name: "Light",
    page: "#edeef4",
    card: "#f7f8fb",
    cardBorder: "rgba(0,0,0,0.06)",
    title: "#2a2a34",
    subtitle: "#daa520",
    desc: "#8a8c9a",
    sectionIcon: "rgba(218,165,32,0.1)",
    sectionTitle: "#2a2a34",
    category: "#b8860b",
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
    callout: {
      bg: "rgba(218,165,32,0.06)",
      border: "rgba(218,165,32,0.15)",
      icon: "#daa520",
      text: "#5a5a6a",
      bold: "#3a3a4a",
    },
    tabActive: {
      bg: "rgba(218,165,32,0.12)",
      border: "rgba(218,165,32,0.3)",
      text: "#b8860b",
    },
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
    subtitle: "#daa520",
    desc: "#6a6d78",
    sectionIcon: "rgba(218,165,32,0.08)",
    sectionTitle: "#dcdee8",
    category: "#daa520",
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
    callout: {
      bg: "rgba(218,165,32,0.06)",
      border: "rgba(218,165,32,0.12)",
      icon: "#daa520",
      text: "#7a7d8e",
      bold: "#c0c4d0",
    },
    tabActive: {
      bg: "rgba(218,165,32,0.1)",
      border: "rgba(218,165,32,0.3)",
      text: "#daa520",
    },
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
    subtitle: "#daa520",
    desc: "#62636a",
    sectionIcon: "rgba(218,165,32,0.07)",
    sectionTitle: "#d8d9e0",
    category: "#daa520",
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
    callout: {
      bg: "rgba(218,165,32,0.05)",
      border: "rgba(218,165,32,0.1)",
      icon: "#daa520",
      text: "#74757c",
      bold: "#b8b9c2",
    },
    tabActive: {
      bg: "rgba(218,165,32,0.09)",
      border: "rgba(218,165,32,0.25)",
      text: "#daa520",
    },
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
    subtitle: "#daa520",
    desc: "#585878",
    sectionIcon: "rgba(218,165,32,0.07)",
    sectionTitle: "#dde4ff",
    category: "#daa520",
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
    callout: {
      bg: "rgba(218,165,32,0.05)",
      border: "rgba(218,165,32,0.1)",
      icon: "#daa520",
      text: "#707090",
      bold: "#b8bee0",
    },
    tabActive: {
      bg: "rgba(218,165,32,0.08)",
      border: "rgba(218,165,32,0.22)",
      text: "#daa520",
    },
    tabInactive: {
      bg: "transparent",
      border: "rgba(255,255,255,0.04)",
      text: "#50506e",
    },
  },
} as const satisfies Record<ThemeMode, unknown>;

const PREFERRED_LEFT_GROUPS = ["Navigation", "Panels"];
const PREFERRED_RIGHT_GROUPS = ["Search", "Views"];

export function HelpView({
  shortcutItems,
  referenceItems,
  layoutMode = "wide",
  theme,
}: {
  shortcutItems: readonly ShortcutItem[];
  referenceItems: readonly ReferenceItem[];
  layoutMode?: "wide" | "narrow" | "compact";
  theme?: ThemeMode;
}) {
  const resolvedTheme = resolveHelpTheme(theme);
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
        padding: layoutMode === "compact" ? "20px 16px 16px" : "28px 24px 20px",
        minHeight: "100%",
        overflowY: "auto",
      }}
    >
      <div style={{ marginBottom: "20px" }}>
        <span
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
            margin: "2px 0 3px",
            letterSpacing: "-0.02em",
          }}
        >
          Help &amp; Reference
        </h1>
        <span
          style={{
            fontSize: "11.5px",
            fontFamily: sans,
            color: resolvedTheme.desc,
            fontWeight: 400,
          }}
        >
          Keyboard shortcuts and navigation guide
        </span>
      </div>

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

function cardStyle(theme: (typeof helpThemes)[ThemeMode]) {
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
  theme: (typeof helpThemes)[ThemeMode];
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
  theme: (typeof helpThemes)[ThemeMode];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
          {index > 0 ? (
            <span style={{ fontSize: "9px", color: theme.plus, fontFamily: mono }}>+</span>
          ) : null}
          <Kbd theme={theme}>{key}</Kbd>
        </span>
      ))}
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
  theme: (typeof helpThemes)[ThemeMode];
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
  theme: (typeof helpThemes)[ThemeMode];
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
  theme: (typeof helpThemes)[ThemeMode];
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

function resolveHelpTheme(theme: ThemeMode | undefined): (typeof helpThemes)[ThemeMode] {
  if (theme) {
    return helpThemes[theme];
  }
  if (typeof document !== "undefined") {
    const documentTheme = document.documentElement.dataset.theme as ThemeMode | undefined;
    if (documentTheme && documentTheme in helpThemes) {
      return helpThemes[documentTheme];
    }
  }
  return helpThemes.dark;
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
