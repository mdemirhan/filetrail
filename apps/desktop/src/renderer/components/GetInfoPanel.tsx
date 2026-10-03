import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { useDelayedFlag } from "../hooks/useDelayedFlag";
import type { FolderSizeEntry } from "../hooks/useFolderSizeCache";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import type { ContextMenuSubmenuAction, ContextMenuSubmenuItem } from "../lib/contextMenu";
import { isFolderSizeEligibleKind } from "../lib/explorerAppUtils";
import { FileIcon } from "../lib/fileIcons";
import {
  formatDateTime,
  formatFolderSizeDetail,
  formatSize,
  splitPermissionMode,
} from "../lib/formatting";
import { formatTooltip } from "../lib/tooltips";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { ClipboardItemsIcon } from "./ClipboardItemsIcon";

type ItemProperties = IpcResponse<"item:getProperties">["item"];

// Several selected items, which the panel sums up as Finder's inspector does.
export type InfoPanelSelection = {
  count: number;
  folderCount: number;
  fileCount: number;
  // Known when every item is a file whose size the list has.
  totalBytes: number | null;
  // The folder they are all in, or null when they are in different folders.
  parentPath: string | null;
};

// The info panel is display-only. It reflects the selected item and exposes a small action
// set, but it does not own filesystem state itself.
export function InfoPanel({
  loading,
  item,
  selection = null,
  pending = false,
  onClose,
  onNavigateToPath,
  onOpen,
  onOpenInTerminal,
  onShowInFinder,
  onCopyPath,
  onCopyName,
  onQuickLook,
  onEdit,
  isFavorite = false,
  onToggleFavorite,
  onRootTree,
  copyPathDisabled = false,
  folderSizeEntry,
  onCalculateFolderSize,
  onRecalculateFolderSize,
  onCancelFolderSize,
  openWithItems = [],
  onOpenWith,
}: {
  loading: boolean;
  item: ItemProperties | null;
  // Given while more than one item is selected: the panel then describes them together.
  selection?: InfoPanelSelection | null;
  // `item` is a preview from the file list; the rest of its details are still loading.
  pending?: boolean;
  onClose: () => void;
  onNavigateToPath: (path: string) => void;
  onOpen: () => void;
  onOpenInTerminal: () => void;
  onShowInFinder: () => void;
  onCopyPath: () => Promise<boolean> | boolean;
  onCopyName?: (() => Promise<boolean> | boolean) | undefined;
  onQuickLook?: (() => void) | undefined;
  // Given only for files, which the text editor can open.
  onEdit?: (() => void) | undefined;
  isFavorite?: boolean;
  // Given only for folders that can be added to or removed from Favorites.
  onToggleFavorite?: (() => void) | undefined;
  // Given only for folders, which the folder tree can be rooted at.
  onRootTree?: (() => void) | undefined;
  copyPathDisabled?: boolean | undefined;
  folderSizeEntry?: FolderSizeEntry | undefined;
  onCalculateFolderSize?: (() => void) | undefined;
  onRecalculateFolderSize?: (() => void) | undefined;
  onCancelFolderSize?: (() => void) | undefined;
  openWithItems?: readonly ContextMenuSubmenuItem[];
  onOpenWith?: ((action: ContextMenuSubmenuAction) => void) | undefined;
}) {
  const shortcutDisplay = useShortcutDisplay();
  const [copied, setCopied] = useState<"path" | "name" | null>(null);
  const showSpinner = useDelayedFlag(pending || (loading && !item), SPINNER_DELAY_MS);
  const permissionParts = useMemo(() => splitPermissionMode(item?.permissionMode ?? null), [item]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopyPath() {
    if (await onCopyPath()) {
      setCopied("path");
    }
  }

  async function handleCopyName() {
    if (await onCopyName?.()) {
      setCopied("name");
    }
  }

  return (
    <aside className="get-info-panel">
      <div className="get-info-header">
        <strong>Info</strong>
        {showSpinner ? (
          <output className="get-info-pending" aria-label="Loading info">
            <span className="folder-size-spinner" />
          </output>
        ) : null}
        <button
          type="button"
          className="get-info-close"
          onClick={onClose}
          title={formatTooltip("Hide Info Panel", shortcutDisplay.written("toggleInfoPanel"))}
          aria-label="Hide Info Panel"
        >
          <InfoPanelGlyph name="close" />
        </button>
      </div>
      {selection && selection.count > 1 ? (
        <InfoPanelSelectionContent selection={selection} onNavigateToPath={onNavigateToPath} />
      ) : item ? (
        <GetInfoPanelContent
          copied={copied}
          item={item}
          pending={pending}
          permissionParts={permissionParts}
          copyPathDisabled={copyPathDisabled}
          onCopyPath={handleCopyPath}
          onCopyName={onCopyName ? handleCopyName : undefined}
          onQuickLook={onQuickLook}
          onEdit={onEdit}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          onRootTree={onRootTree}
          onNavigateToPath={onNavigateToPath}
          onOpen={onOpen}
          onOpenInTerminal={onOpenInTerminal}
          onShowInFinder={onShowInFinder}
          folderSizeEntry={folderSizeEntry}
          onCalculateFolderSize={onCalculateFolderSize}
          onRecalculateFolderSize={onRecalculateFolderSize}
          onCancelFolderSize={onCancelFolderSize}
          openWithItems={openWithItems}
          onOpenWith={onOpenWith}
        />
      ) : loading ? null : (
        <div className="get-info-empty">Select a file or folder to show its info.</div>
      )}
    </aside>
  );
}

// "3 folders and 2 files", "4 files".
function describeSelectionKinds(selection: InfoPanelSelection): string {
  const count = (value: number, one: string, many: string) =>
    `${value.toLocaleString()} ${value === 1 ? one : many}`;
  const parts = [
    selection.folderCount > 0 ? count(selection.folderCount, "folder", "folders") : null,
    selection.fileCount > 0 ? count(selection.fileCount, "file", "files") : null,
  ].filter((part): part is string => part !== null);
  return parts.join(" and ");
}

function InfoPanelSelectionContent({
  selection,
  onNavigateToPath,
}: {
  selection: InfoPanelSelection;
  onNavigateToPath: (path: string) => void;
}) {
  const contains =
    selection.fileCount === 0 ? "folders" : selection.folderCount === 0 ? "files" : "mixed";
  const size = selection.totalBytes === null ? null : formatSize(selection.totalBytes, "ready");
  const { parentPath } = selection;
  return (
    <div className="get-info-content">
      <div className="get-info-hero">
        <div className="get-info-hero-icon get-info-hero-items">
          <ClipboardItemsIcon icon={{ type: "items", contains }} />
        </div>
        <div className="get-info-name">{`${selection.count.toLocaleString()} items`}</div>
        <div className="get-info-subtitle">
          {size
            ? `${describeSelectionKinds(selection)} · ${size}`
            : describeSelectionKinds(selection)}
        </div>
      </div>
      <section className="get-info-section">
        <h3 className="get-info-section-title">Information</h3>
        <dl className="get-info-meta">
          <div className="get-info-meta-row">
            <dt className="get-info-meta-label">Size</dt>
            <dd className={`get-info-meta-value${size ? "" : " muted"}`}>{size ?? "--"}</dd>
          </div>
          <div className="get-info-meta-row last">
            <dt className="get-info-meta-label">Where</dt>
            <dd className={`get-info-meta-value${parentPath ? "" : " muted"}`}>
              {parentPath ? (
                <button
                  type="button"
                  className="get-info-where"
                  title={parentPath}
                  onClick={() => onNavigateToPath(parentPath)}
                >
                  {getFolderLabel(parentPath)}
                </button>
              ) : (
                "Several folders"
              )}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function GetInfoPanelContent({
  copied,
  item,
  pending,
  permissionParts,
  copyPathDisabled,
  onCopyPath,
  onCopyName,
  onQuickLook,
  onEdit,
  isFavorite,
  onToggleFavorite,
  onRootTree,
  onNavigateToPath,
  onOpen,
  onOpenInTerminal,
  onShowInFinder,
  folderSizeEntry,
  onCalculateFolderSize,
  onRecalculateFolderSize,
  onCancelFolderSize,
  openWithItems,
  onOpenWith,
}: {
  copied: "path" | "name" | null;
  item: ItemProperties;
  pending: boolean;
  permissionParts: { symbolic: string; octal: string } | null;
  copyPathDisabled: boolean;
  onCopyPath: () => Promise<void>;
  onCopyName?: (() => Promise<void>) | undefined;
  onQuickLook?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  isFavorite: boolean;
  onToggleFavorite?: (() => void) | undefined;
  onRootTree?: (() => void) | undefined;
  onNavigateToPath: (path: string) => void;
  onOpen: () => void;
  onOpenInTerminal: () => void;
  onShowInFinder: () => void;
  folderSizeEntry?: FolderSizeEntry | undefined;
  onCalculateFolderSize?: (() => void) | undefined;
  onRecalculateFolderSize?: (() => void) | undefined;
  onCancelFolderSize?: (() => void) | undefined;
  openWithItems: readonly ContextMenuSubmenuItem[];
  onOpenWith?: ((action: ContextMenuSubmenuAction) => void) | undefined;
}) {
  const shortcutDisplay = useShortcutDisplay();
  const [openWithMenuOpen, setOpenWithMenuOpen] = useState(false);
  const openWithRef = useRef<HTMLDivElement | null>(null);
  const openWithMenuRef = useRef<HTMLDivElement | null>(null);
  useKeepInViewport(openWithMenuRef, openWithMenuOpen);

  // Close the Open With menu on any click outside it (focus does not move when clicking
  // empty panel space, so blur alone is not enough) and on Escape.
  useEffect(() => {
    if (!openWithMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && openWithRef.current?.contains(event.target)) {
        return;
      }
      setOpenWithMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenWithMenuOpen(false);
      }
    };
    const close = () => setOpenWithMenuOpen(false);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", close);
    };
  }, [openWithMenuOpen]);
  const showFolderSizeForItem = isFolderSizeEligibleKind(item.kind);

  let sizeValue: ReactNode;
  let sizeMuted = false;
  if (showFolderSizeForItem && folderSizeEntry && onCalculateFolderSize && onCancelFolderSize) {
    sizeValue = (
      <FolderSizeCell
        entry={folderSizeEntry}
        onCalculate={onCalculateFolderSize}
        onRecalculate={onRecalculateFolderSize ?? onCalculateFolderSize}
        onCancel={onCancelFolderSize}
      />
    );
    sizeMuted = folderSizeEntry.status === "idle" || folderSizeEntry.status === "error";
  } else if (showFolderSizeForItem) {
    sizeValue = "--";
    sizeMuted = true;
  } else if (pending && item.sizeBytes === null) {
    sizeValue = PENDING_VALUE;
    sizeMuted = true;
  } else {
    sizeValue = formatSize(item.sizeBytes, item.sizeStatus);
  }

  const parentPath = getParentPath(item.path);
  const metadataRows: { label: string; value: ReactNode; muted: boolean }[] = [
    {
      label: "Kind",
      value: item.kindLabel,
      muted: false,
    },
    {
      label: "Size",
      value: sizeValue,
      muted: sizeMuted,
    },
    {
      label: "Created",
      value: pendingOr(item.createdAt, formatDateTime),
      muted: item.createdAt === null,
    },
    {
      label: "Modified",
      value: pendingOr(item.modifiedAt, formatDateTime),
      muted: item.modifiedAt === null,
    },
    {
      label: "Permissions",
      value: permissionParts ? (
        <span className="get-info-permissions">
          <span>{describeOwnerAccess(permissionParts.symbolic)}</span>
          <span className="get-info-permissions-code" title={permissionParts.symbolic}>
            {permissionParts.octal}
          </span>
        </span>
      ) : pending ? (
        PENDING_VALUE
      ) : (
        "Unavailable"
      ),
      muted: permissionParts === null,
    },
    {
      label: "Where",
      value: parentPath ? (
        <button
          type="button"
          className="get-info-where"
          title={parentPath}
          onClick={() => onNavigateToPath(parentPath)}
        >
          {getFolderLabel(parentPath)}
        </button>
      ) : (
        "—"
      ),
      muted: parentPath === null,
    },
  ];
  const sizeSummary = showFolderSizeForItem
    ? folderSizeEntry?.status === "ready"
      ? formatSize(folderSizeEntry.sizeBytes, "ready")
      : null
    : pending && item.sizeBytes === null
      ? null
      : formatSize(item.sizeBytes, item.sizeStatus);

  // A value that hasn't arrived yet keeps its row, with a placeholder, so nothing moves
  // when it does.
  function pendingOr(value: string | null, format: (value: string | null) => string): string {
    return value === null && pending ? PENDING_VALUE : format(value);
  }

  return (
    <div className="get-info-content">
      <div className="get-info-hero">
        <div className="get-info-hero-icon">
          <FileIcon
            deferLoad
            entry={{
              path: item.path,
              name: item.name,
              extension: item.extension,
              kind: item.kind,
              isHidden: item.isHidden,
              isSymlink: item.isSymlink,
            }}
          />
        </div>
        <div className="get-info-name" title={item.name}>
          {item.name}
        </div>
        <div className="get-info-subtitle">
          {sizeSummary ? `${item.kindLabel} · ${sizeSummary}` : item.kindLabel}
        </div>
      </div>

      <div className="get-info-buttons">
        <button type="button" className="get-info-button primary" onClick={onOpen}>
          Open
        </button>
        {onOpenWith && openWithItems.length > 0 ? (
          <div ref={openWithRef} className="get-info-open-with">
            <button
              type="button"
              className="get-info-button pull-down"
              aria-haspopup="menu"
              aria-expanded={openWithMenuOpen}
              onClick={() => setOpenWithMenuOpen((value) => !value)}
            >
              Open With
              <span className="get-info-button-chevron">
                <svg viewBox="0 0 8 8" aria-hidden="true">
                  <path d="M1.5 3 4 5.5 6.5 3" />
                </svg>
              </span>
            </button>
            {openWithMenuOpen ? (
              // Same markup and styles as the right-click menu's Open With submenu.
              <div
                ref={openWithMenuRef}
                className="context-submenu get-info-open-with-menu"
                role="menu"
              >
                {openWithItems.map((entry) =>
                  entry.type === "separator" ? (
                    <div key={entry.key} className="context-menu-separator" />
                  ) : (
                    <button
                      key={entry.action.id}
                      type="button"
                      role="menuitem"
                      className="context-submenu-item"
                      onClick={() => {
                        setOpenWithMenuOpen(false);
                        onOpenWith(entry.action);
                      }}
                    >
                      {entry.action.label}
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="get-info-section">
        <h3 className="get-info-section-title">Information</h3>
        <dl className="get-info-meta">
          {metadataRows.map((row, index) => (
            <div
              key={row.label}
              className={`get-info-meta-row${index === metadataRows.length - 1 ? " last" : ""}`}
            >
              <dt className="get-info-meta-label">{row.label}</dt>
              <dd className={`get-info-meta-value${row.muted ? " muted" : ""}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="get-info-section">
        <h3 className="get-info-section-title">Quick Actions</h3>
        <div className="get-info-actions">
          {onQuickLook ? (
            <GetInfoActionButton
              label="Quick Look"
              shortcut={shortcutDisplay.label("quickLookSelection")}
              onClick={onQuickLook}
            >
              <InfoPanelGlyph name="quickLook" />
            </GetInfoActionButton>
          ) : null}
          {onEdit ? (
            <GetInfoActionButton
              label="Edit"
              shortcut={shortcutDisplay.label("editSelection")}
              onClick={onEdit}
            >
              <InfoPanelGlyph name="edit" />
            </GetInfoActionButton>
          ) : null}
          <GetInfoActionButton
            label={copied === "path" ? "Copied" : "Copy Path"}
            shortcut={shortcutDisplay.label("copyPath")}
            disabled={copyPathDisabled}
            onClick={() => void onCopyPath()}
          >
            <InfoPanelGlyph name={copied === "path" ? "check" : "copy"} />
          </GetInfoActionButton>
          {onCopyName ? (
            <GetInfoActionButton
              label={copied === "name" ? "Copied" : "Copy Name"}
              disabled={copyPathDisabled}
              onClick={() => void onCopyName()}
            >
              <InfoPanelGlyph name={copied === "name" ? "check" : "name"} />
            </GetInfoActionButton>
          ) : null}
          <GetInfoActionButton
            label="Open in Terminal"
            shortcut={shortcutDisplay.label("openInTerminal")}
            onClick={onOpenInTerminal}
          >
            <InfoPanelGlyph name="terminal" />
          </GetInfoActionButton>
          <GetInfoActionButton
            label="Show in Finder"
            shortcut={shortcutDisplay.label("showInFinder")}
            onClick={onShowInFinder}
          >
            <InfoPanelGlyph name="finder" />
          </GetInfoActionButton>
          {onToggleFavorite ? (
            <GetInfoActionButton
              label={isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              shortcut={shortcutDisplay.label("toggleFavorite")}
              onClick={onToggleFavorite}
            >
              <InfoPanelGlyph name="favorite" />
            </GetInfoActionButton>
          ) : null}
          {onRootTree ? (
            <GetInfoActionButton
              label="Root Tree Here"
              shortcut={shortcutDisplay.label("rootTreeAtSelection")}
              onClick={onRootTree}
            >
              <InfoPanelGlyph name="rootTree" />
            </GetInfoActionButton>
          ) : null}
        </div>
      </section>
    </div>
  );
}

const PENDING_VALUE = "—";
// Details usually arrive well within this; a spinner only shows when they don't.
const SPINNER_DELAY_MS = 300;

// One of the quick actions: an icon in a row of them, named (with its key) by its tooltip.
function GetInfoActionButton({
  children,
  label,
  shortcut,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  shortcut?: string | null;
  disabled?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="get-info-action"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="get-info-action-icon" aria-hidden="true">
        {children}
      </span>
    </button>
  );
}

// Finder phrases permissions from the owner's point of view; the octal code stays visible.
export function describeOwnerAccess(symbolic: string): string {
  const owner = symbolic.slice(-9, -6);
  const canRead = owner.includes("r");
  const canWrite = owner.includes("w");
  if (canRead && canWrite) {
    return "Read & Write";
  }
  if (canRead) {
    return "Read only";
  }
  if (canWrite) {
    return "Write only";
  }
  return "No access";
}

function getParentPath(path: string): string | null {
  const trimmed = path.replace(/\/+$/u, "");
  const index = trimmed.lastIndexOf("/");
  if (index < 0 || trimmed.length === 0) {
    return null;
  }
  return index === 0 ? "/" : trimmed.slice(0, index);
}

function getFolderLabel(path: string): string {
  return path === "/" ? "Macintosh HD" : (path.split("/").filter(Boolean).at(-1) ?? path);
}

const CALCULATING_DELAY_MS = 300;
function FolderSizeCell({
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
    const detail = formatFolderSizeDetail(entry.sizeBytes, entry.diskBytes, entry.fileCount);
    return (
      <span className="folder-size-value">
        <span className="folder-size-detail">
          <span>
            {detail.size}
            {detail.disk ? ` (${detail.disk})` : ""}
          </span>
          <span className="folder-size-items">{detail.items}</span>
        </span>
        <button
          type="button"
          className="folder-size-refresh-btn"
          onClick={onRecalculate}
          title="Calculate Size Again"
          aria-label="Recalculate folder size"
        >
          <InfoPanelGlyph name="refresh" />
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
        <span className="folder-size-spinner" />
        <button
          type="button"
          className="folder-size-cancel-btn"
          onClick={onCancel}
          title="Stop Calculating"
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

function InfoPanelGlyph({
  name,
}: {
  name:
    | "open"
    | "terminal"
    | "finder"
    | "quickLook"
    | "edit"
    | "name"
    | "favorite"
    | "rootTree"
    | "copy"
    | "check"
    | "close"
    | "refresh";
}) {
  // Inline glyphs keep the panel self-contained and visually consistent with its custom chrome.
  if (name === "open") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 4h6v6" />
        <path d="M10 14L20 4" />
        <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
      </svg>
    );
  }
  if (name === "terminal") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
        <path d="M7 9l3 3-3 3" />
        <path d="M13 15h4" />
      </svg>
    );
  }
  if (name === "quickLook") {
    // A page with arrows pointing out: it opens big for a quick look. The eye is Hidden Files'.
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M14 7h3v3M10 17H7v-3M17 7l-4 4M7 17l4-4" />
      </svg>
    );
  }
  if (name === "edit") {
    // The same square with a pencil as Edit in the menus and the toolbar.
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
        <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === "name") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7V5h16v2" />
        <path d="M12 5v14" />
        <path d="M9 19h6" />
      </svg>
    );
  }
  if (name === "favorite") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 17.27-5.18 3.05 1.39-5.88L3 9.97l6.01-.5L12 4l2.99 5.47 6.01.5-5.21 4.47 1.39 5.88Z" />
      </svg>
    );
  }
  if (name === "rootTree") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h8" />
        <path d="M8 5v12h6" />
        <path d="M8 11h6" />
        <path d="M17 9l3 2-3 2" />
        <path d="M17 15l3 2-3 2" />
      </svg>
    );
  }
  if (name === "finder") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <circle cx="11.5" cy="13" r="2.5" />
        <path d="M13.5 15l2.5 2.5" />
      </svg>
    );
  }
  if (name === "copy") {
    // Copy Path: the same link as in the menus.
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12l4 4L19 6" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 4v6h6" />
        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
      </svg>
    );
  }
  return (
    <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
