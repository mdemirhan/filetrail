export function ToolbarIcon({
  name,
}: {
  name:
    | "back"
    | "forward"
    | "home"
    | "up"
    | "down"
    | "location"
    | "hidden"
    | "refresh"
    | "list"
    | "details"
    | "drawer"
    | "sidebar"
    | "edit"
    | "chevron"
    | "open"
    | "theme"
    | "close"
    | "sortAsc"
    | "sortDesc"
    | "help"
    | "settings"
    | "search"
    | "desktop"
    | "downloads"
    | "documents"
    | "source"
    | "detailRow";
}) {
  if (name === "list") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <line x1="1" y1="3" x2="15" y2="3" />
        <line x1="1" y1="8" x2="15" y2="8" />
        <line x1="1" y1="13" x2="15" y2="13" />
      </svg>
    );
  }
  if (name === "details") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <rect x="1" y="2" width="14" height="11" rx="1.5" />
        <line x1="1" y1="6" x2="15" y2="6" />
        <line x1="10" y1="6" x2="10" y2="13" />
      </svg>
    );
  }

  const path = (() => {
    if (name === "back") return "M19 12H5M12 19l-7-7 7-7";
    if (name === "forward") return "M5 12h14M12 5l7 7-7 7";
    if (name === "home") return "M3 9.5l9-7 9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5zM9 22V12h6v10";
    if (name === "up") return "M17 11l-5-5-5 5M12 6v12";
    if (name === "down") return "M7 13l5 5 5-5M12 18V6";
    if (name === "location")
      return "M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10m0-8a2 2 0 1 1 0-4a2 2 0 0 1 0 4";
    if (name === "hidden") {
      return "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M14.12 14.12A3 3 0 0 1 9.88 9.88M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22";
    }
    if (name === "refresh") return "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4";
    if (name === "drawer") return "M3 3h18v18H3zM12 16v-4M12 8h.01";
    if (name === "sidebar") return "M4 5h16v14H4zM9 5v14";
    if (name === "edit") return "M4 17.2V20h2.8l8.2-8.2-2.8-2.8zM16.5 5.7l1.8 1.8";
    if (name === "chevron") return "M6 4l4 4-4 4";
    if (name === "theme") {
      return "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8";
    }
    if (name === "close") return "M6 6l12 12M18 6l-12 12";
    if (name === "sortAsc") return "M12 5v14M5 12l7-7 7 7";
    if (name === "sortDesc") return "M12 19V5M5 12l7 7 7-7";
    if (name === "help")
      return "M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01";
    if (name === "settings") {
      return "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z";
    }
    if (name === "search") return "M11 11a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm10 10l-4.35-4.35";
    if (name === "desktop") {
      return "M2 3h20v14H2zM8 21h8M12 17v4";
    }
    if (name === "downloads") {
      return "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3";
    }
    if (name === "documents") {
      return "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6M14 2v6h6";
    }
    if (name === "source") {
      return "M16 18l6-6-6-6M8 6l-6 6 6 6";
    }
    if (name === "detailRow") {
      return "M3 15h18M3 19h18M4 5h16v6H4z";
    }
    return "M5 12h14M12 5l7 7-7 7";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
      <path d={path} />
    </svg>
  );
}
