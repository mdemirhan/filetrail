import type { IpcResponse } from "@filetrail/contracts";

import { compactPath, formatDateTime, formatSize } from "../lib/formatting";
import { ToolbarIcon } from "./ToolbarIcon";

export function PropertiesDrawer({
  open,
  loading,
  item,
  onClose,
  onOpenExternally,
}: {
  open: boolean;
  loading: boolean;
  item: IpcResponse<"item:getProperties">["item"] | null;
  onClose: () => void;
  onOpenExternally: () => void;
}) {
  return (
    <aside className={`properties-drawer${open ? " open" : ""}`}>
      <div className="drawer-header">
        <strong>Properties</strong>
        <button type="button" className="tb-btn" onClick={onClose}>
          Close
        </button>
      </div>
      {!open ? null : loading ? (
        <div className="drawer-loading">Loading properties...</div>
      ) : item ? (
        <div className="drawer-content">
          <div className="drawer-title">{item.name}</div>
          <div className="drawer-path" title={item.path}>
            {compactPath(item.path)}
          </div>
          <button
            type="button"
            className="drawer-open-button"
            onClick={onOpenExternally}
            title={`Open ${item.name} in macOS`}
          >
            <ToolbarIcon name="open" />
            Open in macOS
          </button>
          <dl className="property-grid">
            <div>
              <dt>Kind</dt>
              <dd>{item.kindLabel}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatSize(item.sizeBytes, item.sizeStatus)}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd>{formatDateTime(item.modifiedAt)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDateTime(item.createdAt)}</dd>
            </div>
            <div>
              <dt>Hidden</dt>
              <dd>{item.isHidden ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Symlink</dt>
              <dd>{item.isSymlink ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd title={item.path}>{item.path}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="drawer-empty">Select an item to inspect its properties.</div>
      )}
    </aside>
  );
}
