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
  /* Icons below are converged with context menu (same SVG in both surfaces) */
  if (name === "copy") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    );
  }
  if (name === "cut") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.5 15.5" />
        <path d="M20 20 10.5 10.5" />
      </svg>
    );
  }
  if (name === "duplicate") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
    );
  }
  if (name === "newFolder") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    );
  }
  if (name === "copyPath") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  /* --- Modernized: drive — stacked disk rectangles --- */
  if (name === "drive") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <rect x="2" y="5" width="20" height="6" rx="2" />
        <rect x="2" y="13" width="20" height="6" rx="2" />
        <circle cx="17" cy="8" r="1" fill="currentColor" />
        <circle cx="17" cy="16" r="1" fill="currentColor" />
      </svg>
    );
  }
  /* --- Modernized: applications — rounded 2×2 grid --- */
  if (name === "applications") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </svg>
    );
  }
  /* --- Modernized: rerootHome — simplified arrow + house --- */
  if (name === "rerootHome") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <path d="M3 12h5M6 9l-3 3 3 3" />
        <path d="M12 9l7-5 7 5v10a1 1 0 0 1-1 1h-4v-5h-4v5h-4a1 1 0 0 1-1-1V9z" />
      </svg>
    );
  }
  /* --- Modernized: actionLog — list lines with clock badge --- */
  if (name === "actionLog") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <path d="M3 6h14M3 10h14M3 14h10M3 18h8" />
        <circle cx="19" cy="17" r="4" />
        <path d="M19 15v2.5l1.5 1" />
      </svg>
    );
  }
  /* --- Modernized: drawer — right-biased panel split --- */
  if (name === "drawer") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <line x1="15" y1="5" x2="15" y2="19" />
      </svg>
    );
  }
  /* --- Modernized: foldersFirst — folder tab above file lines --- */
  if (name === "foldersFirst") {
    return (
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
        <path d="M4 4h4l1.5 2H20v3H4z" />
        <path d="M4 12h16M4 16h16M4 20h12" />
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
    if (name === "sidebar") return "M4 5h16v14H4zM9 5v14";
    /* Converged with context menu */
    if (name === "edit") return "M12 20h9M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z";
    if (name === "theme") {
      return "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8";
    }
    if (name === "chevron") return "M6 4l4 4-4 4";
    if (name === "close") return "M6 6l12 12M18 6l-12 12";
    if (name === "sortAsc") return "M12 5v14M5 12l7-7 7 7";
    if (name === "sortDesc") return "M12 19V5M5 12l7 7 7-7";
    if (name === "help")
      return "M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01";
    if (name === "settings") {
      return "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z";
    }
    /* Converged with context menu */
    if (name === "trash") {
      return "M8 6h8M10 6V4h4v2M6 6h12l-1 13a2 2 0 0 1-2 1.85H9A2 2 0 0 1 7 19L6 6M10 10v6M14 10v6";
    }
    if (name === "infoRow") {
      return "M3 15h18M3 19h18M4 5h16v6H4z";
    }
    /* Converged with context menu */
    if (name === "paste") {
      return "M9 4h6M10 2h4a1 1 0 0 1 1 1v2H9V3a1 1 0 0 1 1-1m-3 4h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2m3 5h6m-6 4h6";
    }
    if (name === "move") {
      return "M3 12h8M8 9l3 3-3 3M14 8h6l2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-2";
    }
    if (name === "terminal") {
      return "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2m3 4l3 3-3 3m5 2h4";
    }
    if (name === "rename") {
      return "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z";
    }
    /* Converged: open — external open (box with arrow out) */
    return "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
      <path d={path} />
    </svg>
  );
}
