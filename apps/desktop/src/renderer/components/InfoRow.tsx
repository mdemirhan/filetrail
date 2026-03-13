import type { ReactNode } from "react";

import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import type { DirectoryEntry, ItemProperties } from "../lib/explorerTypes";
import { FileIcon } from "../lib/fileIcons";
import { formatDateTime, formatPermissionMode, formatSize } from "../lib/formatting";

export function InfoRow({
  open,
  currentPath,
  selectedEntry,
  item,
  folderSizeEntry,
  onCalculateFolderSize,
  onRecalculateFolderSize,
  onCancelFolderSize,
}: {
  open: boolean;
  currentPath: string;
  selectedEntry: DirectoryEntry | null;
  item: ItemProperties | null;
  folderSizeEntry?: FolderSizeEntry | undefined;
  onCalculateFolderSize?: (() => void) | undefined;
  onRecalculateFolderSize?: (() => void) | undefined;
  onCancelFolderSize?: (() => void) | undefined;
}) {
  const activeEntry =
    selectedEntry ??
    (currentPath
      ? {
          path: currentPath,
          name: currentPath.split("/").filter(Boolean).at(-1) ?? "Macintosh HD",
          extension: "",
          kind: "directory" as const,
          isHidden: false,
          isSymlink: false,
        }
      : null);

  if (!activeEntry) {
    return <div className={`info-row${open ? " open" : ""}`} />;
  }

  const activeItem = item?.path === activeEntry.path ? item : null;
  const isDirectoryLike =
    activeEntry.kind === "directory" || activeEntry.kind === "symlink_directory";
  const kindLabel =
    activeItem?.kindLabel ??
    (activeEntry.kind === "directory"
      ? "Folder"
      : activeEntry.kind === "symlink_directory"
        ? "Alias Folder"
        : activeEntry.extension
          ? `${activeEntry.extension.toUpperCase()} File`
          : "File");
  const showFolderSizeInteraction =
    isDirectoryLike && folderSizeEntry && onCalculateFolderSize && onCancelFolderSize;

  let sizeLabel: ReactNode;
  if (showFolderSizeInteraction) {
    sizeLabel = (
      <InfoRowFolderSize
        entry={folderSizeEntry}
        onCalculate={onCalculateFolderSize}
        onRecalculate={onRecalculateFolderSize ?? onCalculateFolderSize}
        onCancel={onCancelFolderSize}
      />
    );
  } else if (isDirectoryLike) {
    sizeLabel = "—";
  } else {
    sizeLabel = activeItem ? formatSize(activeItem.sizeBytes, activeItem.sizeStatus) : "—";
  }
  const modifiedLabel = activeItem ? formatDateTime(activeItem.modifiedAt) : "—";
  const permissionsLabel = activeItem ? formatPermissionMode(activeItem.permissionMode) : "—";

  return (
    <div className={`info-row${open ? " open" : ""}`}>
      <div className="detail-inner">
        <div className="dt-hero">
          <div>
            <FileIcon entry={activeEntry} />
          </div>
          <div>
            <div className="dt-name">{activeEntry.name}</div>
            <div className="dt-type">{kindLabel}</div>
          </div>
        </div>
        <div className="dt-meta">
          <div className="dt-pair">
            <div className="dt-lbl">Size</div>
            <div className="dt-val">{sizeLabel}</div>
          </div>
          <div className="dt-pair">
            <div className="dt-lbl">Modified</div>
            <div className="dt-val">{modifiedLabel}</div>
          </div>
          <div className="dt-pair">
            <div className="dt-lbl">Permissions</div>
            <div className="dt-val">{permissionsLabel}</div>
          </div>
          <div className="dt-pair dt-pair-path">
            <div className="dt-lbl">Path</div>
            <div className="dt-val pth">{activeEntry.path}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRowFolderSize({
  entry,
  onCalculate,
  onRecalculate,
  onCancel,
}: {
  entry: FolderSizeEntry;
  onCalculate: () => void;
  onRecalculate: () => void;
  onCancel: () => void;
}) {
  if (entry.status === "ready") {
    return (
      <span className="folder-size-value">
        {formatSize(entry.sizeBytes, "ready")}
        <button
          type="button"
          className="folder-size-refresh-btn"
          onClick={onRecalculate}
          aria-label="Recalculate folder size"
        >
          <svg className="folder-size-refresh-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M1 4v6h6" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
      </span>
    );
  }
  if (entry.status === "calculating") {
    return (
      <span className="folder-size-calculating">
        <span className="folder-size-spinner" />
        <button
          type="button"
          className="folder-size-cancel-btn"
          onClick={onCancel}
          aria-label="Cancel folder size calculation"
        >
          ×
        </button>
      </span>
    );
  }
  return (
    <button type="button" className="folder-size-calculate-btn" onClick={onCalculate}>
      Calculate
    </button>
  );
}
