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
  theme,
  resetButton,
  children,
}: {
  icon?: string;
  title: string;
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
          padding: "0 4px 6px",
        }}
      >
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
