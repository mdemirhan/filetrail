import type { IpcResponse } from "@filetrail/contracts";
import type { FavoriteIconId } from "../../shared/appPreferences";

type Entry = IpcResponse<"directory:getSnapshot">["entries"][number];

// Icon rendering is intentionally lightweight and CSS-driven. We classify entries into a
// small visual vocabulary here and let theme styles handle the final appearance.
export function FileIcon({ entry }: { entry: Entry }) {
  const type = resolveIconType(entry);
  if (type === "folder") {
    return (
      <span className="file-icon folder" aria-hidden>
        <FolderSvg />
      </span>
    );
  }
  if (type === "alias-folder") {
    return (
      <span className="file-icon folder alias" aria-hidden>
        <FolderSvg open />
        <span className="alias-badge">↗</span>
      </span>
    );
  }
  return (
    <span className={`file-icon document ${type}`} aria-hidden>
      <DocumentSvg label={resolveDocumentLabel(entry)} />
    </span>
  );
}

export function FolderIcon({
  alias = false,
  className = "",
  open = false,
  variant = "filled",
  showCue = false,
}: {
  alias?: boolean;
  className?: string;
  open?: boolean;
  variant?: "filled" | "outline";
  showCue?: boolean;
}) {
  const iconClassName = className.length > 0 ? `file-icon folder ${className}` : "file-icon folder";
  if (alias) {
    return (
      <span className={`${iconClassName} alias`} aria-hidden>
        <FolderSvg open />
        <span className="alias-badge">↗</span>
      </span>
    );
  }
  return (
    <span className={iconClassName} aria-hidden>
      <FolderSvg open={open} variant={variant} showCue={showCue} />
    </span>
  );
}

export function TreeFolderIcon({
  open = false,
  alias = false,
}: { open?: boolean; alias?: boolean }) {
  if (alias) {
    return (
      <span className="file-icon folder alias" aria-hidden>
        <FolderSvg open />
        <span className="alias-badge">↗</span>
      </span>
    );
  }
  return (
    <span className="file-icon folder" aria-hidden>
      <FolderSvg open={open} />
    </span>
  );
}

export function FavoriteItemIcon({ icon }: { icon: FavoriteIconId }) {
  return (
    <span className={`file-icon favorite favorite-icon-${icon}`} aria-hidden>
      <svg
        className="file-icon-svg file-icon-favorite"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d={resolveFavoriteIconPath(icon)} className="file-icon-favorite-stroke" />
      </svg>
    </span>
  );
}

function FolderSvg({
  open = false,
  variant = "filled",
  showCue = false,
}: {
  open?: boolean;
  variant?: "filled" | "outline";
  showCue?: boolean;
}) {
  if (open) {
    return (
      <svg
        className="file-icon-svg file-icon-folder"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4 8V6a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.88l.82 1.24A2 2 0 0 0 14.07 7H20a2 2 0 0 1 2 2v1"
          className="file-icon-folder-stroke"
          strokeLinecap="round"
        />
        <path
          d="M3.5 20h15.13a2 2 0 0 0 1.95-1.57l1.42-6.5A1 1 0 0 0 21.03 10H5.47a2 2 0 0 0-1.95 1.57L2 19"
          className="file-icon-folder-open-fill"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (variant === "outline") {
    return (
      <svg
        className="file-icon-svg file-icon-folder"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.93a2 2 0 0 1-1.66-.88l-.82-1.24A2 2 0 0 0 7.93 4H5a2 2 0 0 0-2 2v1z"
          className="file-icon-folder-outline"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {showCue ? <circle cx="17.5" cy="16.5" r="2.25" className="file-icon-folder-cue" /> : null}
      </svg>
    );
  }

  return (
    <svg
      className="file-icon-svg file-icon-folder"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6.93a2 2 0 0 1-1.66-.88l-.82-1.24A2 2 0 0 0 7.93 4H5a2 2 0 0 0-2 2v1z"
        className="file-icon-folder-fill"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Documents render a short in-icon label based on extension/category rather than unique
// per-type artwork. This keeps icon rendering cheap in heavily virtualized views.
function DocumentSvg({ label }: { label: string }) {
  return (
    <svg
      className="file-icon-svg file-icon-document"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
        className="file-icon-document-fill"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" className="file-icon-document-fold" strokeLinejoin="round" />
      <text x="12" y="17" textAnchor="middle" className="file-icon-document-text">
        {label}
      </text>
    </svg>
  );
}

function resolveDocumentLabel(entry: Entry): string {
  // Symlinked files are called out explicitly because their extension may not reveal that
  // following the item leaves the current directory context.
  if (entry.kind === "symlink_file") {
    return "AL";
  }
  const extension = entry.extension.toUpperCase();
  if (extension.length === 0) {
    return "TXT";
  }
  return extension.slice(0, 4);
}

function resolveIconType(entry: Entry): string {
  // The classification is intentionally coarse. It exists to provide enough visual grouping
  // for common file types without introducing a large per-extension icon registry.
  if (entry.kind === "directory") {
    return "folder";
  }
  if (entry.kind === "symlink_directory") {
    return "alias-folder";
  }
  const extension = entry.extension.toLowerCase();
  if (
    ["ts", "tsx", "js", "jsx", "json", "css", "html", "md", "py", "rs", "go"].includes(extension)
  ) {
    return "code";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(extension)) {
    return "image";
  }
  if (["mov", "mp4", "mkv", "avi"].includes(extension)) {
    return "video";
  }
  if (["zip", "tar", "gz", "xz", "rar"].includes(extension)) {
    return "archive";
  }
  if (extension === "pdf") {
    return "pdf";
  }
  if (extension === "app") {
    return "app";
  }
  if (["txt", "rtf", "log"].includes(extension)) {
    return "text";
  }
  return "generic";
}

function resolveFavoriteIconPath(icon: FavoriteIconId): string {
  if (icon === "home") {
    return "M4 10.2L12 4l8 6.2V20a1.5 1.5 0 0 1-1.5 1.5h-4.25V14h-4.5v7.5H5.5A1.5 1.5 0 0 1 4 20z";
  }
  if (icon === "applications") {
    return "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z";
  }
  if (icon === "desktop") {
    return "M4 5.5h16v10H4zM9 18.5h6M12 15.5v3";
  }
  if (icon === "documents") {
    return "M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1.5-1.5zM14 3.5V8h4";
  }
  if (icon === "downloads") {
    return "M12 4v10M8.5 10.5L12 14l3.5-3.5M5 18.5h14";
  }
  if (icon === "trash") {
    return "M8 6.5h8M9 6.5V5h6v1.5M7 6.5l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 6.5M10 10v6M14 10v6";
  }
  if (icon === "folder") {
    return "M3.5 7.5V18A1.5 1.5 0 0 0 5 19.5h14A1.5 1.5 0 0 0 20.5 18V9.5A1.5 1.5 0 0 0 19 8h-7.2a1.5 1.5 0 0 1-1.25-.67l-.6-.9A1.5 1.5 0 0 0 8.7 5.5H5A1.5 1.5 0 0 0 3.5 7z";
  }
  if (icon === "star") {
    return "M12 4.5l2.2 4.45 4.9.7-3.55 3.46.84 4.89L12 15.7 7.6 18l.84-4.89L4.9 9.65l4.9-.7z";
  }
  if (icon === "drive") {
    return "M5 7.5h14l1.5 4.5H3.5zM5.5 12h13l-1 5.5a1.5 1.5 0 0 1-1.47 1.23H7.97A1.5 1.5 0 0 1 6.5 17.5zM16.5 15.75h.01M13.5 15.75h.01";
  }
  if (icon === "code") {
    return "M9.5 8L5 12l4.5 4M14.5 8L19 12l-4.5 4M13 6l-2 12";
  }
  if (icon === "terminal") {
    return "M4.5 5.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5zM7 9l3 3-3 3M12.5 15h4";
  }
  if (icon === "music") {
    return "M14 5v10.5a2.5 2.5 0 1 1-1.5-2.3V7.4l6-1.4v8.1a2.5 2.5 0 1 1-1.5-2.3V4.2z";
  }
  if (icon === "photos") {
    return "M12 4.5l1.7 2.8 3.2-.3-.8 3.1 2.7 1.7-2.7 1.7.8 3.1-3.2-.3L12 19.5l-1.7-2.8-3.2.3.8-3.1-2.7-1.7 2.7-1.7-.8-3.1 3.2.3z";
  }
  if (icon === "videos") {
    return "M5.5 6.5h9A1.5 1.5 0 0 1 16 8v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16V8a1.5 1.5 0 0 1 1.5-1.5zM16 10l4-2v8l-4-2";
  }
  if (icon === "archive") {
    return "M5 6.5h14v3H5zM6.5 9.5h11v9A1.5 1.5 0 0 1 16 20h-8A1.5 1.5 0 0 1 6.5 18.5zM10 12h4";
  }
  if (icon === "cloud") {
    return "M8.5 18.5h8a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.2 9.6A4 4 0 0 0 8.5 18.5z";
  }
  if (icon === "server") {
    return "M5.5 6.5h13a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 10V8a1.5 1.5 0 0 1 1.5-1.5zM5.5 12.5h13A1.5 1.5 0 0 1 20 14v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16v-2a1.5 1.5 0 0 1 1.5-1.5zM7.5 9h.01M7.5 15h.01";
  }
  if (icon === "projects") {
    return "M4.5 7.5h6v9h-6zM13.5 7.5h6v4h-6zM13.5 13.5h6v3h-6z";
  }
  if (icon === "books") {
    return "M6 5.5h4.5A1.5 1.5 0 0 1 12 7v11.5H7.5A1.5 1.5 0 0 1 6 17zM12 7a1.5 1.5 0 0 1 1.5-1.5H18V18.5h-4.5A1.5 1.5 0 0 0 12 20";
  }
  if (icon === "camera") {
    return "M7.5 7.5L9 5.5h6l1.5 2h2A1.5 1.5 0 0 1 20 9v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17V9a1.5 1.5 0 0 1 1.5-1.5zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z";
  }
  if (icon === "toolbox") {
    return "M4.5 8.5h15A1.5 1.5 0 0 1 21 10v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17v-7a1.5 1.5 0 0 1 1.5-1.5zM9 8.5V7A1.5 1.5 0 0 1 10.5 5.5h3A1.5 1.5 0 0 1 15 7v1.5M3 13h18";
  }
  if (icon === "network") {
    return "M12 5.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4zM6 14.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4zM18 14.5a2 2 0 1 1 0 4a2 2 0 0 1 0-4zM12 9.5v3M10.5 14h-3M13.5 14h3";
  }
  return "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16M4.5 12h15M12 4.5a12.8 12.8 0 0 1 0 15M12 4.5a12.8 12.8 0 0 0 0 15";
}
