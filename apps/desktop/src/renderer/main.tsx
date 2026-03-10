import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";
import "@fontsource/fira-code/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";

import { App } from "./App";
import { createRendererLogger, installGlobalRendererErrorHandlers } from "./lib/logging";
import "./styles.css";

const logger = createRendererLogger("filetrail.renderer");

installGlobalRendererErrorHandlers("filetrail.renderer");

const rootElement = document.getElementById("root");
if (!rootElement) {
  logger.error("renderer bootstrap failed", new Error("Missing root element"));
  throw new Error("Missing root element");
}

document.body.classList.add("platform-macos");
logger.info("renderer boot", {
  strictMode: true,
  platform: navigator.platform,
});

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
