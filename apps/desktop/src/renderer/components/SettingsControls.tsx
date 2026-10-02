import type { ReactNode } from "react";

import { uiSansFontStack as sans } from "../lib/viewFonts";

// The parts of the Settings palette these controls paint with.
export type SettingsControlTheme = {
  card: { bg: string; border: string; shadow: string };
  section: { title: string };
  input: { bg: string; border: string };
  label: { primary: string; secondary: string };
};

// The building blocks every Settings tab shares: a titled group of rows and a small button.
// Every button in Settings is this one, so they all look alike and all answer the pointer:
// the colours come from the Settings palette here, the hover and pressed states from
// `.settings-button` in styles.css.
export function ActionButton({
  label,
  ariaLabel,
  theme,
  onClick,
  disabled = false,
}: {
  label: string;
  ariaLabel?: string;
  theme: SettingsControlTheme;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="settings-button"
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      onClick={onClick}
      style={{
        height: "28px",
        padding: "0 10px",
        borderRadius: "6px",
        border: `1px solid ${theme.input.border}`,
        background: theme.input.bg,
        color: disabled ? theme.label.secondary : theme.label.primary,
        fontSize: "11px",
        fontFamily: sans,
        fontWeight: 500,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

export function SectionCard({
  title,
  note,
  theme,
  resetButton,
  children,
}: {
  icon?: string;
  title: string;
  // A few words after the title on how the group is used.
  note?: string | undefined;
  theme: SettingsControlTheme;
  resetButton?: ReactNode;
  children: ReactNode;
}) {
  // A System Settings style group: a sentence-case title above a rounded box of rows.
  return (
    <section style={{ marginBottom: "18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          // The same height with and without a button, so every group's title sits alike.
          minHeight: "28px",
          padding: "0 4px 6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: "13px",
              fontFamily: sans,
              fontWeight: 600,
              color: theme.section.title,
            }}
          >
            {title}
          </h3>
          {note ? (
            <span style={{ fontSize: "11px", fontFamily: sans, color: theme.label.secondary }}>
              {note}
            </span>
          ) : null}
        </div>
        {resetButton}
      </div>
      <div
        style={{
          background: theme.card.bg,
          border: `0.5px solid ${theme.card.border}`,
          borderRadius: "10px",
          boxShadow: theme.card.shadow,
          overflow: "hidden",
          padding: "2px 14px 4px",
        }}
      >
        {children}
      </div>
    </section>
  );
}
