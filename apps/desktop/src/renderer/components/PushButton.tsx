import { type ButtonHTMLAttributes, forwardRef } from "react";

// The one push button of the alerts, sheets and panels, as macOS draws it: a bezel with the
// label, filled with the accent when it is the default (the one Return presses), and with
// red text when it destroys something (it is then never the default).
export type PushButtonVariant = "plain" | "default" | "destructive";

export const PushButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: PushButtonVariant }
>(function PushButton({ variant = "plain", className, type = "button", ...props }, ref) {
  const variantClass =
    variant === "default" ? " is-default" : variant === "destructive" ? " is-destructive" : "";
  return (
    <button
      ref={ref}
      type={type}
      className={`push-button${variantClass}${className ? ` ${className}` : ""}`}
      {...props}
    />
  );
});
