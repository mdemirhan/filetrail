export function SettingsView() {
  return (
    <div className="settings-view">
      <div className="settings-page">
        <header className="settings-page-header">
          <div className="settings-page-header-left">
            <span className="settings-page-eyebrow">File Trail</span>
            <h2>Settings</h2>
            <p>Application preferences and configuration</p>
          </div>
        </header>

        <section className="settings-section settings-status-card">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-storage" aria-hidden>
              ::
            </div>
            <div>
              <h3>Settings</h3>
              <p>This page is ready, but there are no configurable File Trail settings yet.</p>
            </div>
          </div>
          <div className="settings-section-body">
            <p className="empty-state">Settings will appear here as app preferences are added.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
