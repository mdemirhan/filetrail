type ShortcutItem = {
  group: string;
  shortcut: string;
  description: string;
};

type ReferenceItem = {
  label: string;
  description: string;
};

export function HelpView({
  shortcutItems,
  referenceItems,
  layoutMode = "wide",
}: {
  shortcutItems: ShortcutItem[];
  referenceItems: ReferenceItem[];
  layoutMode?: "wide" | "narrow" | "compact";
}) {
  const shortcutGroups = groupShortcuts(shortcutItems);

  return (
    <div className="help-view" data-layout={layoutMode}>
      <div className="help-page">
        <header className="help-header">
          <div className="help-header-left">
            <span className="help-header-eyebrow">File Trail</span>
            <h2>Help &amp; Reference</h2>
            <p>Keyboard shortcuts and navigation guide</p>
          </div>
        </header>

        <div className="help-grid">
          <section className="help-card help-card-shortcuts">
            <div className="help-card-header">
              <div className="help-card-icon success" aria-hidden>
                ⌨
              </div>
              <div>
                <h3 className="help-card-title help-card-title-shortcuts">Keyboard Shortcuts</h3>
                <p className="help-card-description">
                  Navigate folders and control the app without leaving the keyboard.
                </p>
              </div>
            </div>
            <div className="help-shortcut-list">
              {shortcutGroups.map((group) => (
                <div key={group.name} className="help-shortcut-group">
                  <div className="help-group-label">{group.name}</div>
                  {group.items.map((item) => (
                    <div
                      key={`${item.group}-${item.shortcut}-${item.description}`}
                      className="help-shortcut-row"
                    >
                      <span className="help-shortcut-description">{item.description}</span>
                      <div className="help-shortcut-keys">
                        {shortcutParts(item.shortcut).map((part, index) => (
                          <span key={`${item.shortcut}-${part.key}`} className="help-key-fragment">
                            {index > 0 ? <span className="help-key-separator">+</span> : null}
                            <kbd className="help-key">{part.label}</kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="help-card help-card-reference">
            <div className="help-card-header">
              <div className="help-card-icon info" aria-hidden>
                i
              </div>
              <div>
                <h3 className="help-card-title help-card-title-search">Explorer Reference</h3>
                <p className="help-card-description">
                  Key interaction rules for navigation, path editing, and opening items.
                </p>
              </div>
            </div>
            <div className="help-syntax-section">
              <div className="help-syntax-block common">
                <div className="help-syntax-block-header">
                  <span className="help-group-label">Interaction</span>
                  <span className="help-syntax-tag common">Explorer</span>
                </div>
                {referenceItems.map((item) => (
                  <div key={item.label} className="help-syntax-row">
                    <span className="help-syntax-token">{item.label}</span>
                    <div>
                      <div className="help-syntax-description">{item.description}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="help-tip-box">
                <span className="help-tip-icon" aria-hidden>
                  i
                </span>
                <p className="help-tip-text">
                  <strong>Path Bar Editing</strong> uses live filesystem suggestions from the typed
                  parent folder, and <strong>Esc</strong> always returns it to clickable mode.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function groupShortcuts(shortcuts: ShortcutItem[]): Array<{ name: string; items: ShortcutItem[] }> {
  const map = new Map<string, ShortcutItem[]>();
  for (const item of shortcuts) {
    const existing = map.get(item.group);
    if (existing) {
      existing.push(item);
      continue;
    }
    map.set(item.group, [item]);
  }
  return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
}

function shortcutParts(shortcut: string): Array<{ key: string; label: string }> {
  const normalized = shortcut.endsWith("++") ? `${shortcut.slice(0, -2)}+Plus` : shortcut;
  const rawParts = normalized
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return rawParts.map((part, index) => ({
    key: `${part}-${index}`,
    label: part,
  }));
}
