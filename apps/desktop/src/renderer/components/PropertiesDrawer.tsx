import type { IpcResponse } from "@filetrail/contracts";

import { FileIcon } from "../lib/fileIcons";
import { compactPath, formatDateTime, formatSize } from "../lib/formatting";

export function PropertiesDrawer({
  open,
  loading,
  item,
  itemCount,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  item: IpcResponse<"item:getProperties">["item"] | null;
  itemCount: number | null;
  onClose: () => void;
}) {
  return (
    <aside className={`properties-drawer${open ? " open" : ""}`}>
      <div className="drawer-header">
        <strong>Inspector</strong>
        <button
          type="button"
          className="drawer-close"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>
      {!open ? null : loading ? (
        <div className="drawer-loading">Loading properties...</div>
      ) : item ? (
        <div className="drawer-content">
          <div className="drawer-hero">
            <div className="drawer-hero-icon">
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
            <div className="drawer-title">{item.name}</div>
            <div className="drawer-kind-badge">{item.kindLabel}</div>
          </div>
          <dl className="property-grid">
            {item.kind === "directory" ? (
              <div>
                <dt>Items</dt>
                <dd>{itemCount === null ? "—" : `${itemCount} items`}</dd>
              </div>
            ) : null}
            <div>
              <dt>Size</dt>
              <dd>{formatSize(item.sizeBytes, item.sizeStatus)}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatDateTime(item.modifiedAt)}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd className="property-path" title={item.path}>
                {compactPath(item.path)}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="drawer-empty">Select an item to inspect its properties.</div>
      )}
    </aside>
  );
}
