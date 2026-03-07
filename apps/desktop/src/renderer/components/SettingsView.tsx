export function SettingsView({
  restoreLastVisitedFolderOnStartup,
  onRestoreLastVisitedFolderOnStartupChange,
}: {
  restoreLastVisitedFolderOnStartup: boolean;
  onRestoreLastVisitedFolderOnStartupChange: (value: boolean) => void;
}) {
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

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-storage" aria-hidden>
              ::
            </div>
            <div>
              <h3>Startup</h3>
              <p>Restore explorer context and behavior when File Trail launches.</p>
            </div>
          </div>
          <div className="settings-section-body">
            <label className="settings-checkbox-card">
              <input
                type="checkbox"
                className="settings-checkbox-card-input"
                checked={restoreLastVisitedFolderOnStartup}
                onChange={(event) =>
                  onRestoreLastVisitedFolderOnStartupChange(event.currentTarget.checked)
                }
              />
              <span className="settings-checkbox-card-copy">
                <span className="settings-checkbox-card-title">
                  Restore last visited folder on startup
                </span>
                <span className="settings-checkbox-card-description">
                  Reopen the last folder you navigated to instead of always starting at your home
                  folder.
                </span>
              </span>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
