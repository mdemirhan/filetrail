import type { IpcResponse } from "@filetrail/contracts";

type Entry = IpcResponse<"directory:getSnapshot">["entries"][number];

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

export function FolderIcon({ alias = false }: { alias?: boolean }) {
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
      <FolderSvg />
    </span>
  );
}

function FolderSvg({ open = false }: { open?: boolean }) {
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
  if (["pdf"].includes(extension)) {
    return "pdf";
  }
  if (["app"].includes(extension)) {
    return "app";
  }
  if (["txt", "rtf", "log"].includes(extension)) {
    return "text";
  }
  return "generic";
}
