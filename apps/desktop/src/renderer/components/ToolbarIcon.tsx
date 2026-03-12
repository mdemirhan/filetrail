import type { ToolbarIconName } from "../../shared/toolbarItems";

export function ToolbarIcon({
  name,
}: {
  name: ToolbarIconName;
}) {
  if (name === "list") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <line x1="1.5" y1="3" x2="14.5" y2="3" />
        <line x1="1.5" y1="8" x2="14.5" y2="8" />
        <line x1="1.5" y1="13" x2="14.5" y2="13" />
      </svg>
    );
  }
  if (name === "details") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <line x1="1.5" y1="5" x2="14.5" y2="5" />
        <line x1="5.5" y1="5" x2="5.5" y2="14.5" />
        <line x1="1.5" y1="10" x2="14.5" y2="10" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <circle cx="11" cy="11" r="7" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" />
      </svg>
    );
  }
  if (name === "clear") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <circle cx="8" cy="8" r="6" />
        <line x1="5.7" y1="5.7" x2="10.3" y2="10.3" />
        <line x1="10.3" y1="5.7" x2="5.7" y2="10.3" />
      </svg>
    );
  }
  if (name === "stop") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <rect x="4" y="4" width="8" height="8" rx="1.5" />
      </svg>
    );
  }
  if (name === "separatorVertical") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <line x1="8" y1="2.5" x2="8" y2="13.5" />
      </svg>
    );
  }
  if (name === "separatorHorizontal") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" role="presentation">
        <line x1="2.5" y1="8" x2="13.5" y2="8" />
      </svg>
    );
  }

  const path = (() => {
    if (name === "back") return "M15 18l-6-6 6-6";
    if (name === "forward") return "M9 18l6-6-6-6";
    if (name === "home") return "M3 9.5l9-7 9 7V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9.5zM9 22V12h6v10";
    if (name === "up") return "M18 15l-6-6-6 6";
    if (name === "down") return "M6 9l6 6 6-6";
    if (name === "location")
      return "M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10m0-8a2 2 0 1 1 0-4a2 2 0 0 1 0 4";
    if (name === "hidden") {
      return "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M14.12 14.12A3 3 0 0 1 9.88 9.88M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22";
    }
    if (name === "refresh") return "M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10";
    if (name === "drawer") return "M3 3h18v18H3zM12 3v18";
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
    if (name === "actionLog") {
      return "M7 4h10M7 8h10M7 12h7M5 4h.01M5 8h.01M5 12h.01M5 16h.01M7 16h10M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2";
    }
    if (name === "settings") {
      return "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z";
    }
    if (name === "applications") {
      return "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z";
    }
    if (name === "drive") {
      return "M4 7h16l2 5H2zM5 12h14l-1.1 5.2A2 2 0 0 1 15.94 19H8.06a2 2 0 0 1-1.96-1.8zM16.5 15.5h.01M13 15.5h.01";
    }
    if (name === "trash") {
      return "M8 6h8M10 6V4h4v2M6 6h12l-1 13a2 2 0 0 1-2 1.85H9A2 2 0 0 1 7 19L6 6M10 10v6M14 10v6";
    }
    if (name === "rerootHome") {
      return "M10 9.5l7-5.5 7 5.5V20a2 2 0 0 1-2 2h-4v-6h-4v6h-4a2 2 0 0 1-2-2V9.5M2 12h7M2 12l3-3M2 12l3 3";
    }
    if (name === "infoRow") {
      return "M3 15h18M3 19h18M4 5h16v6H4z";
    }
    if (name === "foldersFirst") {
      return "M3 6h8M3 12h18M3 18h18M14 4h7v4h-7z";
    }
    if (name === "copy") {
      return "M9 9h11v11H9zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1";
    }
    if (name === "cut") {
      return "M9.5 4.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5m7 10a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5M8 8l8 8M16 8l-8 8";
    }
    if (name === "paste") {
      return "M9 4h6M10 2h4a1 1 0 0 1 1 1v2H9V3a1 1 0 0 1 1-1m-3 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2m3 5h6m-6 4h6";
    }
    if (name === "move") {
      return "M15 5h6v6M9 19H3v-6M21 5L9 17M3 9V3h6";
    }
    if (name === "duplicate") {
      return "M8 8h11v11H8zM5 5h11v11H5z";
    }
    if (name === "newFolder") {
      return "M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 13v6M13 16h6";
    }
    if (name === "terminal") {
      return "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2m3 4l3 3-3 3m5 2h4";
    }
    return "M5 12h14M12 5l7 7-7 7";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
      <path d={path} />
    </svg>
  );
}
