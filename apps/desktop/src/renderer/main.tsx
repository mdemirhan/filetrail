import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/fira-code/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@fontsource/lexend/700.css";

import { AboutWindowApp } from "./AboutWindowApp";
import { AcknowledgementsWindowApp } from "./AcknowledgementsWindowApp";
import { App } from "./App";
import { SettingsWindowApp } from "./SettingsWindowApp";
import { createRendererLogger, installGlobalRendererErrorHandlers } from "./lib/logging";
import { installScrollbarVisibility } from "./lib/scrollbarVisibility";
import { installTitleTooltips } from "./lib/titleTooltips";
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
logger.info("renderer boot", {
  strictMode: true,
  platform: navigator.platform,
});

// The same bundle serves every window; the address says which one this is: the explorer
// (nothing), Settings (`#settings`, or `#settings/shortcuts` to open on a tab), About
// (`#about`) or Acknowledgements (`#acknowledgements`).
const hash = window.location.hash;
const page = /^#settings(\/|$)/.test(hash) ? (
  <SettingsWindowApp />
) : hash === "#about" ? (
  <AboutWindowApp />
) : hash === "#acknowledgements" ? (
  <AcknowledgementsWindowApp />
) : null;
// The explorer window is created with a translucent macOS material behind it (see
// `createWindow` in main.ts); this class lets the sidebar show it through.
if (!page) {
  document.body.classList.add("vibrant-window");
}

createRoot(rootElement).render(<StrictMode>{page ?? <App />}</StrictMode>);
