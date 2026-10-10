// Finder's eject symbol: a triangle over a bar, drawn in the current text color.
export function EjectIcon({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.5l7 8H5z" />
      <path d="M5 18.5h14" />
    </svg>
  );
}
