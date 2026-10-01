import type { ExplorerTabItem } from "../hooks/useExplorerTabs";
import { ToolbarIcon } from "./ToolbarIcon";

// The row of tabs under the toolbar. It is only shown while there is more than one tab.
export function TabStrip({
  tabs,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: {
  tabs: readonly ExplorerTabItem[];
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}) {
  return (
    <div className="tab-strip" style={{ gridColumn: "3 / -1", gridRow: "2" }}>
      <div className="tab-strip-tabs" role="tablist" aria-label="Tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-strip-tab${tab.active ? " active" : ""}`}
            role="tab"
            aria-selected={tab.active}
            tabIndex={-1}
            title={tab.tooltip}
            // The click must not take the keyboard away from the file list.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelectTab(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                onCloseTab(tab.id);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              }
            }}
          >
            <button
              type="button"
              className="tab-strip-close"
              aria-label={`Close ${tab.label}`}
              title="Close Tab (⌘W)"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              <ToolbarIcon name="close" />
            </button>
            {tab.kind === "search" ? (
              <span
                className={`tab-strip-search${tab.searching ? " searching" : ""}`}
                aria-hidden="true"
              >
                <ToolbarIcon name="search" />
              </span>
            ) : null}
            <span className="tab-strip-label">{tab.label}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="tab-strip-new"
        aria-label="New Tab"
        title="New Tab (⌘T)"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onNewTab}
      >
        <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" role="presentation">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
