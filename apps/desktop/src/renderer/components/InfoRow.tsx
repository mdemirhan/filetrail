import type { ReactNode } from "react";

import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import { isFolderSizeEligibleKind } from "../lib/explorerAppUtils";
import type { DirectoryEntry, DirectoryEntryMetadata, ItemProperties } from "../lib/explorerTypes";
import { FileIcon } from "../lib/fileIcons";
import {
  formatDateTime,
  formatFolderSizeDetail,
  formatPermissionMode,
  formatSize,
} from "../lib/formatting";
import { fallbackKindLabel, folderEntryForPath } from "../lib/infoPreview";

export function InfoRow({
  open,
  currentPath,
  selectedEntry,
  metadata = null,
  item,
  folderSizeEntry,
  onCalculateFolderSize,
  onRecalculateFolderSize,
  onCancelFolderSize,
}: {
  open: boolean;
  currentPath: string;
  selectedEntry: DirectoryEntry | null;
  // What the file list already knows about the selected item: shown at once, so the bar
  // updates in the same frame as the selection.
  metadata?: DirectoryEntryMetadata | null | undefined;
  item: ItemProperties | null;
  folderSizeEntry?: FolderSizeEntry | undefined;
  onCalculateFolderSize?: (() => void) | undefined;
  onRecalculateFolderSize?: (() => void) | undefined;
  onCancelFolderSize?: (() => void) | undefined;
}) {
  const activeEntry = selectedEntry ?? (currentPath ? folderEntryForPath(currentPath) : null);

  if (!activeEntry) {
    return <div className={`info-row${open ? " open" : ""}`} />;
  }

  // Listing metadata first (instant), then the item's own properties once they arrive.
  const activeItem = item?.path === activeEntry.path ? item : null;
  const activeMetadata = metadata?.path === activeEntry.path ? metadata : null;
  const known = activeMetadata ?? activeItem;
  const showFolderSizeForEntry = isFolderSizeEligibleKind(activeEntry.kind);
  const kindLabel = known?.kindLabel ?? fallbackKindLabel(activeEntry);
  const showFolderSizeInteraction =
    showFolderSizeForEntry && folderSizeEntry && onCalculateFolderSize && onCancelFolderSize;

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
  } else if (showFolderSizeForEntry) {
    sizeLabel = "—";
  } else {
    sizeLabel = known ? formatSize(known.sizeBytes, known.sizeStatus) : "—";
  }
  // The size column is narrow; the full folder size text stays available on hover.
  const sizeTitle =
    showFolderSizeForEntry && folderSizeEntry?.status === "ready"
      ? formatFolderSizeText(folderSizeEntry)
      : undefined;
  const modifiedLabel = known ? formatDateTime(known.modifiedAt) : "—";
  const permissionsLabel = known ? formatPermissionMode(known.permissionMode) : "—";

  // Name on the first line, using the full width; the facts on the second, each in a
  // fixed column so switching items only changes the text.
  return (
    <div className={`info-row${open ? " open" : ""}`}>
      <div className="detail-inner">
        <div className="dt-icon">
          <FileIcon entry={activeEntry} />
        </div>
        <div className="dt-body">
          <div className="dt-name" title={activeEntry.name}>
            {activeEntry.name}
          </div>
          <div className="dt-meta">
            <InfoRowFact label="Kind" title={kindLabel}>
              {kindLabel}
            </InfoRowFact>
            <InfoRowFact label="Size" title={sizeTitle}>
              {sizeLabel}
            </InfoRowFact>
            <InfoRowFact label="Modified" title={modifiedLabel}>
              {modifiedLabel}
            </InfoRowFact>
            <InfoRowFact label="Permissions" title={permissionsLabel}>
              {permissionsLabel}
            </InfoRowFact>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRowFact({
  label,
  title,
  children,
}: {
  label: string;
  title?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="dt-pair" title={title}>
      <span className="dt-lbl">{label}</span>
      <span className="dt-val">{children}</span>
    </div>
  );
}

function formatFolderSizeText(entry: Extract<FolderSizeEntry, { status: "ready" }>): string {
  const detail = formatFolderSizeDetail(entry.sizeBytes, entry.diskBytes, entry.fileCount);
  return `${detail.size}${detail.disk ? ` (${detail.disk})` : ""} · ${detail.items}`;
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
    const detail = formatFolderSizeDetail(entry.sizeBytes, entry.diskBytes, entry.fileCount);
    return (
      <span className="folder-size-value">
        <span className="folder-size-detail">
          {detail.size}
          {detail.disk ? ` (${detail.disk})` : ""} &middot; {detail.items}
        </span>
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
