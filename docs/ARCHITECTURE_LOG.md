# File Trail Architecture Log

## 2026-03-06

- File Trail is intentionally macOS-only. Path handling, titlebar behavior, keyboard shortcuts, and shell integration are allowed to be macOS-specific.
- Browsing is live-scan only. There is no app-managed search index or SQLite metadata cache in MVP.
- The Electron main process stays thin. Filesystem work runs through a long-lived worker thread and narrow, Zod-validated IPC contracts.
- The renderer shell follows Code Trail's titlebar/toolbar pattern and token-driven theming, but uses denser, utility-oriented explorer panels instead of message-driven layouts.
- Direct path entry is provided through a toolbar-native location sheet rather than a persistent breadcrumb/address bar. This preserves the required capability without forcing visible chrome that conflicts with the Code Trail-derived shell.
- Folder size remains deferred in MVP UI, but the contract surface is reserved for async job-based computation so the feature can be added without breaking properties APIs later.
