// The column at the start of a menu row that holds a checkmark when the item is on.
export function MenuCheck({ checked }: { checked: boolean }) {
  return (
    <span className="toolbar-menu-check" aria-hidden="true">
      {checked ? (
        <svg className="toolbar-menu-check-svg" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.3 5 8.8l4.6-5.6" />
        </svg>
      ) : null}
    </span>
  );
}
