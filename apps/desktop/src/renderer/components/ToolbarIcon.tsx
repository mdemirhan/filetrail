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
    | "settings";
}) {
  const path = (() => {
    if (name === "back") {
      return "M15 5l-7 7 7 7";
    }
    if (name === "forward") {
      return "M9 5l7 7-7 7";
    }
    if (name === "home") {
      return "M4 11.5L12 5l8 6.5V20h-5.5v-5h-5v5H4z";
    }
    if (name === "up") {
      return "M12 5l-5 5h3v8h4v-8h3z";
    }
    if (name === "down") {
      return "M12 19l5-5h-3V6h-4v8H7z";
    }
    if (name === "location") {
      return "M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10m0-8a2 2 0 1 1 0-4a2 2 0 0 1 0 4";
    }
    if (name === "hidden") {
      return "M3 12s3.5-5 9-5s9 5 9 5s-3.5 5-9 5s-9-5-9-5m9-2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5";
    }
    if (name === "refresh") {
      return "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4";
    }
    if (name === "list") {
      return "M4 6h4M10 6h10M4 12h4M10 12h10M4 18h4M10 18h10";
    }
    if (name === "details") {
      return "M4 5h16v14H4zM4 10h16M10 10v9";
    }
    if (name === "drawer") {
      return "M4 5h16v14H4zM14 5v14";
    }
    if (name === "sidebar") {
      return "M4 5h16v14H4zM9 5v14";
    }
    if (name === "edit") {
      return "M4 17.2V20h2.8l8.2-8.2l-2.8-2.8zM16.5 5.7l1.8 1.8";
    }
    if (name === "chevron") {
      return "M9 6l6 6-6 6";
    }
    if (name === "theme") {
      return "M12 3v2m0 14v2m9-9h-2M5 12H3m15.36 6.36l-1.41-1.41M7.05 7.05L5.64 5.64m12.72 0l-1.41 1.41M7.05 16.95l-1.41 1.41M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8";
    }
    if (name === "close") {
      return "M6 6l12 12M18 6l-12 12";
    }
    if (name === "sortAsc") {
      return "M8 17V7m0 0l-3 3m3-3l3 3M13 7h6M13 12h4M13 17h2";
    }
    if (name === "sortDesc") {
      return "M8 7v10m0 0l-3-3m3 3l3-3M13 7h2M13 12h4M13 17h6";
    }
    if (name === "help") {
      return "M12 22a10 10 0 1 0 0-20a10 10 0 0 0 0 20M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4M12 17h.01";
    }
    if (name === "settings") {
      return "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 1 0-6a3 3 0 0 1 0 6z";
    }
    return "M5 12h14M12 5l7 7-7 7";
  })();

  return (
    <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
      <path d={path} />
    </svg>
  );
}
