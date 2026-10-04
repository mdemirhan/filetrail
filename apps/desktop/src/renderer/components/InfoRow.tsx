import type { ReactNode } from "react";

import { useDelayedFlag } from "../hooks/useDelayedFlag";
import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import { useRelativeDate } from "../hooks/useRelativeDate";
import { isFolderSizeEligibleKind } from "../lib/explorerAppUtils";
import type { DirectoryEntry, DirectoryEntryMetadata, ItemProperties } from "../lib/explorerTypes";
import { FileIcon } from "../lib/fileIcons";
import { formatFolderSizeDetail, formatSize } from "../lib/formatting";
import { fallbackKindLabel, folderEntryForPath } from "../lib/infoPreview";
import { ClearButton } from "./ClearButton";

// One quiet line under the path bar: the item's icon and name, then what it is, its size and
// when it changed, separated by dots and without labels. Facts not known yet are left out
// rather than drawn as dashes; permissions are in the Info panel.
export function InfoRow({
  open,
  currentPath,
  selectedEntry,
  metadata = null,
  item,
  selectionCount = selectedEntry ? 1 : 0,
  selectionTotalBytes = null,
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
  // With several items selected the row sums them up instead of describing one.
  selectionCount?: number;
  // Their total size, once the size of every one of them is known.
  selectionTotalBytes?: number | null;
  // For one item, its folder size; for several, their folders' sizes summed up (see
  // summarizeSelectionSize), with handlers that work on all of those folders.
  folderSizeEntry?: FolderSizeEntry | undefined;
  onCalculateFolderSize?: (() => void) | undefined;
  onRecalculateFolderSize?: (() => void) | undefined;
  onCancelFolderSize?: (() => void) | undefined;
}) {
  const activeEntry = selectedEntry ?? (currentPath ? folderEntryForPath(currentPath) : null);

  if (!activeEntry) {
    return <div className={`info-row${open ? " open" : ""}`} />;
  }

  if (selectionCount > 1) {
    // Selected folders bring the same Calculate, spinner and totals as one folder does.
    const selectionSize =
      folderSizeEntry && onCalculateFolderSize && onCancelFolderSize ? (
        <InfoRowFact
          title={
            folderSizeEntry.status === "ready" ? formatFolderSizeText(folderSizeEntry) : undefined
          }
        >
          <InfoRowFolderSize
            entry={folderSizeEntry}
            onCalculate={onCalculateFolderSize}
            onRecalculate={onRecalculateFolderSize ?? onCalculateFolderSize}
            onCancel={onCancelFolderSize}
          />
        </InfoRowFact>
      ) : selectionTotalBytes !== null ? (
        <InfoRowFact>{formatSize(selectionTotalBytes, "ready")}</InfoRowFact>
      ) : null;
    return (
      <div className={`info-row${open ? " open" : ""}`}>
        <div className="info-row-line">
          <span className="info-row-icon">
            <FileIcon entry={activeEntry} deferLoad />
          </span>
          <span className="info-row-name">{`${selectionCount.toLocaleString()} items`}</span>
          <span className="info-row-facts">{selectionSize}</span>
        </div>
      </div>
    );
  }

  // Listing metadata first (instant), then the item's own properties once they arrive.
  const activeItem = item?.path === activeEntry.path ? item : null;
  const activeMetadata = metadata?.path === activeEntry.path ? metadata : null;
  const known = activeMetadata ?? activeItem;
  const showFolderSizeForEntry = isFolderSizeEligibleKind(activeEntry.kind);
  const kindLabel = known?.kindLabel ?? fallbackKindLabel(activeEntry);
  const showFolderSizeInteraction =
    showFolderSizeForEntry && folderSizeEntry && onCalculateFolderSize && onCancelFolderSize;

  let size: ReactNode = null;
  if (showFolderSizeInteraction) {
    size = (
      <InfoRowFolderSize
        entry={folderSizeEntry}
        onCalculate={onCalculateFolderSize}
        onRecalculate={onRecalculateFolderSize ?? onCalculateFolderSize}
        onCancel={onCancelFolderSize}
      />
    );
  } else if (!showFolderSizeForEntry && known && known.sizeStatus === "ready") {
    size = formatSize(known.sizeBytes, known.sizeStatus);
  }
  const sizeTitle =
    showFolderSizeForEntry && folderSizeEntry?.status === "ready"
      ? formatFolderSizeText(folderSizeEntry)
      : undefined;

  return (
    <div className={`info-row${open ? " open" : ""}`}>
      <div className="info-row-line">
        <span className="info-row-icon">
          <FileIcon entry={activeEntry} deferLoad />
        </span>
        <span className="info-row-name" title={activeEntry.name}>
          {activeEntry.name}
        </span>
        <span className="info-row-facts">
          <InfoRowFact title={kindLabel}>{kindLabel}</InfoRowFact>
          {size !== null ? <InfoRowFact title={sizeTitle}>{size}</InfoRowFact> : null}
          <InfoRowModified value={known?.modifiedAt} />
        </span>
      </div>
    </div>
  );
}

// "Modified today, 9:12 AM", with the whole date as the tooltip; left out until it is known.
function InfoRowModified({ value }: { value: string | null | undefined }) {
  const date = useRelativeDate(value);
  if (!date) {
    return null;
  }
  return <InfoRowFact title={date.exact}>{`Modified ${date.text}`}</InfoRowFact>;
}

function InfoRowFact({
  title,
  children,
}: {
  title?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span className="info-row-fact" title={title}>
      {children}
    </span>
  );
}

function formatFolderSizeText(entry: Extract<FolderSizeEntry, { status: "ready" }>): string {
  const detail = formatFolderSizeDetail(
    entry.sizeBytes,
    entry.diskBytes,
    entry.fileCount,
    entry.folderCount,
  );
  return `${detail.size}${detail.disk ? ` (${detail.disk})` : ""} · ${detail.items}`;
}

const CALCULATING_DELAY_MS = 300;
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
  // A small folder is measured in a moment: the spinner shows only for one that takes longer.
  const showCalculating = useDelayedFlag(entry.status === "calculating", CALCULATING_DELAY_MS);
  if (entry.status === "ready") {
    const detail = formatFolderSizeDetail(
      entry.sizeBytes,
      entry.diskBytes,
      entry.fileCount,
      entry.folderCount,
    );
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
          title="Calculate Size Again"
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
    if (!showCalculating) {
      return <span className="folder-size-calculating" />;
    }
    return (
      <span className="folder-size-calculating">
        <span className="spinner" />
        <ClearButton
          onClick={onCancel}
          title="Stop Calculating"
          aria-label="Cancel folder size calculation"
        />
      </span>
    );
  }
  return (
    <button type="button" className="folder-size-calculate-btn" onClick={onCalculate}>
      Calculate size
    </button>
  );
}
