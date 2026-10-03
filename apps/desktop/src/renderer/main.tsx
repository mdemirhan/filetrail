import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AboutWindowApp } from "./AboutWindowApp";
import { AcknowledgementsWindowApp } from "./AcknowledgementsWindowApp";
import { App } from "./App";
import { HelpWindowApp } from "./HelpWindowApp";
import { SettingsWindowApp } from "./SettingsWindowApp";
import { createRendererLogger, installGlobalRendererErrorHandlers } from "./lib/logging";
import { installScrollbarVisibility } from "./lib/scrollbarVisibility";
import { installTitleTooltips } from "./lib/titleTooltips";
import { installWindowActivity } from "./lib/windowActivity";
import "./styles.css";

const logger = createRendererLogger("filetrail.renderer");

installGlobalRendererErrorHandlers("filetrail.renderer");

const rootElement = document.getElementById("root");
if (!rootElement) {
  logger.error("renderer bootstrap failed", new Error("Missing root element"));
  throw new Error("Missing root element");
}

document.body.classList.add("platform-macos");
installTitleTooltips();
installScrollbarVisibility();
installWindowActivity();
logger.info("renderer boot", {
  strictMode: true,
  platform: navigator.platform,
});

// The same bundle serves every window; the address says which one this is: the explorer
// (nothing), Settings (`#settings`, or `#settings/shortcuts` to open on a tab), About
// (`#about`), Acknowledgements (`#acknowledgements`) or Help (`#help`, `#help/search`).
const hash = window.location.hash;
const page = /^#settings(\/|$)/.test(hash) ? (
  <SettingsWindowApp />
) : hash === "#about" ? (
  <AboutWindowApp />
) : hash === "#acknowledgements" ? (
  <AcknowledgementsWindowApp />
) : /^#help(\/|$)/.test(hash) ? (
  <HelpWindowApp />
) : null;
// The explorer window is created with a translucent macOS material behind it (see
// `createWindow` in main.ts); this class lets the sidebar show it through.
if (!page) {
  document.body.classList.add("vibrant-window");
}

createRoot(rootElement).render(<StrictMode>{page ?? <App />}</StrictMode>);
