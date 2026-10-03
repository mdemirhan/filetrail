import type { ButtonHTMLAttributes } from "react";

// The × that empties a field or takes something away: a small grey disc with the cross cut
// out of it, as in a macOS search field. Every field and filter that can be cleared uses
// this one; `className` only places it.
export function ClearButton({
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`clear-button${className ? ` ${className}` : ""}`} {...props}>
      <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
        <path d="M1 1l8 8M9 1l-8 8" />
      </svg>
    </button>
  );
}
