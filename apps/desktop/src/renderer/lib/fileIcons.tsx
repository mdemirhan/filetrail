import { useEffect, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";
import type { FavoriteIconId } from "../../shared/appPreferences";
import { useFiletrailClient } from "./filetrailClient";

type Entry = IpcResponse<"directory:getSnapshot">["entries"][number];

// The icons macOS draws (base64 PNG data), most recently used last. Large enough for every
// row of a big folder whose items each have their own icon (apps, files without an
// extension); a cache smaller than what is on screen drops icons still in use, and they are
// then asked for again.
const nativeIconCache = new Map<string, string | null>();
const NATIVE_ICON_CACHE_MAX = 2048;
// The info panel's icon changes with the selection. Its request waits this long, so
// holding an arrow key does not ask for the icon of every item passed on the way.
const DEFERRED_ICON_LOAD_DELAY_MS = 80;

function readNativeIcon(cacheKey: string): string | null | undefined {
  const cached = nativeIconCache.get(cacheKey);
  if (cached !== undefined) {
    nativeIconCache.delete(cacheKey);
    nativeIconCache.set(cacheKey, cached);
  }
  return cached;
}

function rememberNativeIcon(cacheKey: string, base64: string | null) {
  nativeIconCache.delete(cacheKey);
  if (nativeIconCache.size >= NATIVE_ICON_CACHE_MAX) {
    const oldestKey = nativeIconCache.keys().next().value;
    if (oldestKey !== undefined) nativeIconCache.delete(oldestKey);
  }
  nativeIconCache.set(cacheKey, base64);
}

// Runs `load` now, or after the short delay when `deferLoad` is set; the returned function
// calls it off.
function scheduleIconLoad(load: () => void, deferLoad: boolean): () => void {
  if (!deferLoad) {
    load();
    return () => undefined;
  }
  const timer = window.setTimeout(load, DEFERRED_ICON_LOAD_DELAY_MS);
  return () => window.clearTimeout(timer);
}

// Files and folders are shown with the icons macOS itself draws for them. Until an icon
// arrives (or if macOS has none), a plain folder or document shape stands in.
export function FileIcon({
  entry,
  deferLoad = false,
}: {
  entry: Entry;
  /** Wait a moment before asking for an icon that is not known yet (see above). */
  deferLoad?: boolean;
}) {
  const client = useFiletrailClient();
  const cacheKey = nativeIconCacheKey(entry);
  const [iconSrc, setIconSrc] = useState<string | null>(
    () => nativeIconCache.get(cacheKey) ?? null,
  );

  useEffect(() => {
    const cached = readNativeIcon(cacheKey);
    if (cached !== undefined) {
      setIconSrc(cached);
      return;
    }
    let cancelled = false;
    const cancelLoad = scheduleIconLoad(() => {
      let request = pendingNativeIconRequests.get(cacheKey);
      if (!request) {
        request = client
          .invoke("system:getFileIcon", {
            path: entry.path,
            size: 64,
            ...(cacheKey in GENERIC_ICON_KINDS
              ? { generic: GENERIC_ICON_KINDS[cacheKey as keyof typeof GENERIC_ICON_KINDS] }
              : {}),
          })
          .then((response) => response.pngBase64)
          .catch(() => null)
          .then((base64) => {
            pendingNativeIconRequests.delete(cacheKey);
            rememberNativeIcon(cacheKey, base64);
            return base64;
          });
        pendingNativeIconRequests.set(cacheKey, request);
      }
      void request.then((base64) => {
        if (!cancelled) {
          setIconSrc(base64);
        }
      });
    }, deferLoad);
    return () => {
      cancelled = true;
      cancelLoad();
    };
  }, [cacheKey, client, deferLoad, entry.path]);

  if (iconSrc) {
    return (
      <span className="file-icon native-file-icon" aria-hidden>
        <img
          src={`data:image/png;base64,${iconSrc}`}
          alt=""
          className="file-icon-native-img"
          draggable={false}
        />
      </span>
    );
  }
  if (entry.kind === "directory" || entry.kind === "symlink_directory") {
    return (
      <span className="file-icon folder" aria-hidden>
        <FolderSvg />
      </span>
    );
  }
  return (
    <span className="file-icon document" aria-hidden>
      <DocumentSvg />
    </span>
  );
}

const pendingNativeIconRequests = new Map<string, Promise<string | null>>();

// Files share one icon per extension, files without an extension one of two (a document, or
// an executable), and folders one generic icon, so a directory costs a handful of lookups
// instead of one per entry. Apps, bundles and symlinks are asked for one by one: each app
// has its own icon, and macOS draws a symlink as what it points to, with an arrow.
// Folders macOS draws with their own icon; everything else shares the plain folder icon.
const SPECIAL_FOLDER_NAMES = new Set([
  "Applications",
  "Desktop",
  "Developer",
  "Documents",
  "Downloads",
  "Library",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  "System",
  "Users",
]);
// Cache keys for the icons shared by a whole kind of item, and what to ask the main process
// for to get each (see `generic` in the `system:getFileIcon` contract).
const GENERIC_ICON_KINDS = {
  "kind:directory": "folder",
  "kind:file": "file",
  "kind:executable": "executable",
} as const;

function nativeIconCacheKey(entry: Entry): string {
  if (
    entry.kind === "bundle" ||
    entry.kind === "other" ||
    entry.kind === "symlink_file" ||
    entry.kind === "symlink_directory"
  ) {
    return `path:${entry.path}`;
  }
  if (entry.kind === "directory") {
    const name = entry.name || entry.path.split("/").filter(Boolean).at(-1) || "";
    return entry.path === "/" || SPECIAL_FOLDER_NAMES.has(name)
      ? `path:${entry.path}`
      : "kind:directory";
  }
  const extension = entry.extension.toLowerCase();
  if (extension.length > 0) {
    return `ext:${extension}`;
  }
  // A listing says whether such a file is executable; anything else (a search result) does
  // not, and is asked for by path.
  if (entry.kind === "file" && entry.isExecutable !== undefined) {
    return entry.isExecutable ? "kind:executable" : "kind:file";
  }
  return `path:${entry.path}`;
}

// The folder drawn in an empty file list.
export function FolderIcon({
  className = "",
  open = false,
  variant = "filled",
  showCue = false,
}: {
  className?: string;
  open?: boolean;
  variant?: "filled" | "outline";
  showCue?: boolean;
}) {
  const iconClassName = className.length > 0 ? `file-icon folder ${className}` : "file-icon folder";
  return (
    <span className={iconClassName} aria-hidden>
      <FolderSvg open={open} variant={variant} showCue={showCue} />
    </span>
  );
}

// A folder in the tree: the same icon the file list shows for it.
export function TreeFolderIcon({ alias = false, path }: { alias?: boolean; path?: string | null }) {
  if (!path) {
    return (
      <span className="file-icon folder" aria-hidden>
        <FolderSvg />
      </span>
    );
  }
  return (
    <FileIcon
      entry={{
        path,
        name: "",
        extension: "",
        kind: alias ? "symlink_directory" : "directory",
        isHidden: false,
        isSymlink: alias,
      }}
    />
  );
}

export function FavoriteItemIcon({ icon }: { icon: FavoriteIconId }) {
  return (
    <span className="file-icon favorite" aria-hidden>
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

// The plain document that stands in for a file whose icon has not arrived.
function DocumentSvg() {
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
    </svg>
  );
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
