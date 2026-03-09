import { type ReactNode, useEffect, useMemo, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { FileIcon } from "../lib/fileIcons";
import { formatDateTime, formatSize, pathSegments, splitPermissionMode } from "../lib/formatting";

type ItemProperties = IpcResponse<"item:getProperties">["item"];

// The info panel is display-only. It reflects the selected item and exposes a small action
// set, but it does not own filesystem state itself.
export function InfoPanel({
  loading,
  item,
  onClose,
  onNavigateToPath,
  onOpen,
  onOpenInTerminal,
  onCopyPath,
  copyPathDisabled = false,
}: {
  loading: boolean;
  item: ItemProperties | null;
  onClose: () => void;
  onNavigateToPath: (path: string) => void;
  onOpen: () => void;
  onOpenInTerminal: () => void;
  onCopyPath: () => Promise<boolean> | boolean;
  copyPathDisabled?: boolean | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const permissionParts = useMemo(() => splitPermissionMode(item?.permissionMode ?? null), [item]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  async function handleCopyPath() {
    if (await onCopyPath()) {
      setCopied(true);
    }
  }

  return (
    <aside className="get-info-panel">
      <div className="get-info-header">
        <strong>Get Info</strong>
        <button
          type="button"
          className="get-info-close"
          onClick={onClose}
          aria-label="Close Toggle Info Panel"
        >
          <InfoPanelGlyph name="close" />
        </button>
      </div>
      {loading ? (
        <div className="get-info-loading">Loading Info Panel…</div>
      ) : item ? (
        <GetInfoPanelContent
          copied={copied}
          item={item}
          permissionParts={permissionParts}
          copyPathDisabled={copyPathDisabled}
          onCopyPath={handleCopyPath}
          onNavigateToPath={onNavigateToPath}
          onOpen={onOpen}
          onOpenInTerminal={onOpenInTerminal}
        />
      ) : (
        <div className="get-info-empty">Select a file or folder to show its info.</div>
      )}
    </aside>
  );
}

function GetInfoPanelContent({
  copied,
  item,
  permissionParts,
  copyPathDisabled,
  onCopyPath,
  onNavigateToPath,
  onOpen,
  onOpenInTerminal,
}: {
  copied: boolean;
  item: ItemProperties;
  permissionParts: { symbolic: string; octal: string } | null;
  copyPathDisabled: boolean;
  onCopyPath: () => Promise<void>;
  onNavigateToPath: (path: string) => void;
  onOpen: () => void;
  onOpenInTerminal: () => void;
}) {
  const directoryLike = item.kind === "directory" || item.kind === "symlink_directory";
  // Display rules:
  // - folders show `-` for size because recursive folder sizing is deferred
  // - missing timestamps/permissions stay visually muted to distinguish them from real values
  const metadataRows = [
    {
      label: "Size",
      value: directoryLike ? "-" : formatSize(item.sizeBytes, item.sizeStatus),
      muted: directoryLike,
    },
    {
      label: "Created",
      value: formatDateTime(item.createdAt),
      muted: item.createdAt === null,
    },
    {
      label: "Modified",
      value: formatDateTime(item.modifiedAt),
      muted: item.modifiedAt === null,
    },
    {
      label: "Permissions",
      value: permissionParts
        ? `${permissionParts.symbolic} (${permissionParts.octal})`
        : "Unavailable",
      muted: permissionParts === null,
    },
  ];
  const segments = pathSegments(item.path);

  return (
    <div className="get-info-content">
      <div className="get-info-hero">
        <div className="get-info-hero-icon">
          <FileIcon
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
        <div className="get-info-name">{item.name}</div>
        <div className="get-info-kind-badge">{item.kindLabel}</div>
      </div>

      <div className="get-info-actions">
        <GetInfoActionButton label="Open" onClick={onOpen}>
          <InfoPanelGlyph name="open" />
        </GetInfoActionButton>
        <GetInfoActionButton label="Terminal" onClick={onOpenInTerminal}>
          <InfoPanelGlyph name="terminal" />
        </GetInfoActionButton>
        <GetInfoActionButton
          label={copied ? "Copied" : "Copy Path"}
          disabled={copyPathDisabled}
          onClick={() => void onCopyPath()}
        >
          <InfoPanelGlyph name={copied ? "check" : "copy"} />
        </GetInfoActionButton>
      </div>

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

      <div className="get-info-path-card">
        <div className="get-info-path-header">
          <span>Path</span>
        </div>
        <div className="get-info-breadcrumbs">
          {/* Ancestor segments remain clickable; the current segment is plain text. */}
          {segments.map((segment, index) => {
            const isCurrent = index === segments.length - 1;
            return (
              <span key={segment.path} className="get-info-breadcrumb-item">
                {isCurrent ? (
                  <span className="get-info-current-crumb">{segment.label}</span>
                ) : (
                  <button
                    type="button"
                    className="get-info-crumb"
                    onClick={() => onNavigateToPath(segment.path)}
                  >
                    {segment.label}
                  </button>
                )}
                {isCurrent ? null : <span className="get-info-separator">/</span>}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GetInfoActionButton({
  children,
  label,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled?: boolean | undefined;
  onClick: () => void;
}) {
  return (
    <button type="button" className="get-info-action" onClick={onClick} disabled={disabled}>
      <span className="get-info-action-icon" aria-hidden="true">
        {children}
      </span>
      <span className="get-info-action-label">{label}</span>
    </button>
  );
}

function InfoPanelGlyph({
  name,
}: {
  name: "open" | "terminal" | "copy" | "check" | "close";
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
  if (name === "copy") {
    return (
      <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
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
  return (
    <svg className="get-info-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}
