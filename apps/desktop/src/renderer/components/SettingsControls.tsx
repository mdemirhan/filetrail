import type { ReactNode } from "react";

// The building blocks every Settings tab shares: a titled group of rows and a small button.
// They are drawn by `.settings-*` rules in styles.css.

// Every button in Settings is this one, so they all look alike and all answer the pointer.
export function ActionButton({
  label,
  ariaLabel,
  onClick,
  disabled = false,
}: {
  label: string;
  ariaLabel?: string;
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
    >
      {label}
    </button>
  );
}

// A System Settings style group: an optional title above a rounded box of rows. A group the
// window's title already names goes without one.
export function SectionCard({
  title,
  note,
  resetButton,
  resetBelow = false,
  children,
}: {
  title?: string | undefined;
  // A line under the group on how it is used.
  note?: string | undefined;
  resetButton?: ReactNode;
  // The button goes under the group, at its right, as Restore Defaults does on the Mac.
  resetBelow?: boolean;
  children: ReactNode;
}) {
  const headerButton = resetBelow ? null : resetButton;
  return (
    <section className="settings-section">
      {title || headerButton ? (
        <div className="settings-section-header">
          {title ? <h3 className="settings-section-title">{title}</h3> : <span />}
          {headerButton}
        </div>
      ) : null}
      <div className="settings-card">{children}</div>
      {note ? <p className="settings-section-note">{note}</p> : null}
      {resetBelow && resetButton ? (
        <div className="settings-section-footer">{resetButton}</div>
      ) : null}
    </section>
  );
}
