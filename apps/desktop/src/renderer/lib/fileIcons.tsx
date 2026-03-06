import type { IpcResponse } from "@filetrail/contracts";

type Entry = IpcResponse<"directory:getSnapshot">["entries"][number];

export function FileIcon({ entry }: { entry: Entry }) {
  const type = resolveIconType(entry);
  if (type === "folder") {
    return (
      <span className="file-icon folder" aria-hidden>
        <span className="folder-tab" />
        <span className="folder-body" />
      </span>
    );
  }
  if (type === "alias-folder") {
    return (
      <span className="file-icon folder alias" aria-hidden>
        <span className="folder-tab" />
        <span className="folder-body" />
        <span className="alias-badge">↗</span>
      </span>
    );
  }
  return <span className={`file-icon document ${type}`} aria-hidden />;
}

export function FolderIcon({ alias = false }: { alias?: boolean }) {
  if (alias) {
    return (
      <span className="file-icon folder alias" aria-hidden>
        <span className="folder-tab" />
        <span className="folder-body" />
        <span className="alias-badge">↗</span>
      </span>
    );
  }
  return (
    <span className="file-icon folder" aria-hidden>
      <span className="folder-tab" />
      <span className="folder-body" />
    </span>
  );
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
