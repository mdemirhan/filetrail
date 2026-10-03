import { useEffect, useMemo, useRef, useState } from "react";

import { resolveShortcuts } from "../shared/shortcuts";
import { HelpView } from "./components/HelpView";
import { useElementSize } from "./hooks/useElementSize";
import { useWindowAppearance } from "./hooks/useWindowAppearance";
import { useFiletrailClient } from "./lib/filetrailClient";
import { HELP_TOPICS, type HelpTopicId } from "./lib/helpContent";
import { resolveSinglePanelLayout } from "./lib/responsiveLayout";
import { createShortcutDisplay } from "./lib/shortcutDisplay";
import { ShortcutDisplayProvider } from "./state/shortcutDisplayContext";

// The page named after "#help/" in the window's address, when it was opened on one.
function readRequestedTopic(): HelpTopicId | null {
  const requested = window.location.hash.replace(/^#help\/?/, "");
  return HELP_TOPICS.find((topic) => topic.id === requested)?.id ?? null;
}

// The Help window (`#help`): Help's topics beside the files instead of in their place. It
// follows the app's theme, accent and font, and shows each command with the keys it has now.
export function HelpWindowApp() {
  const client = useFiletrailClient();
  const { shortcutOverrides, returnKeyAction } = useWindowAppearance(client);
  const shortcutDisplay = useMemo(
    () => createShortcutDisplay(resolveShortcuts(shortcutOverrides), { returnKeyAction }),
    [shortcutOverrides, returnKeyAction],
  );
  // A page asked for from the app (⌘?, Keyboard Shortcuts) while the window is open.
  const [request, setRequest] = useState(() => ({
    topic: readRequestedTopic() ?? "navigation",
    id: 0,
  }));
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const { width } = useElementSize(bodyRef);

  useEffect(() => {
    const unsubscribe = client.onShowHelpTopic?.((topic) => {
      setRequest((current) => ({ topic, id: current.id + 1 }));
    });
    return () => unsubscribe?.();
  }, [client]);

  useEffect(() => {
    document.title = "File Trail Help";
    document.body.classList.add("help-window-body");
    return () => document.body.classList.remove("help-window-body");
  }, []);

  return (
    <ShortcutDisplayProvider value={shortcutDisplay}>
      <div className="help-window">
        {/* Under the traffic lights, across the top: where the window is dragged from. */}
        <div className="help-window-drag" aria-hidden="true" />
        <div ref={bodyRef} className="help-window-body-content">
          <HelpView
            key={request.id}
            layoutMode={width > 0 ? resolveSinglePanelLayout(width) : "wide"}
            initialTopic={request.topic}
            onTopicChange={(topic) => {
              // The address follows the page, so the app opens Help on it next time.
              window.history.replaceState(null, "", `#help/${topic}`);
            }}
            onCustomizeShortcuts={() => {
              void client.invoke("app:openSettingsWindow", { tab: "shortcuts" }).catch(() => {
                // Settings did not open; Help stays as it is.
              });
            }}
          />
        </div>
      </div>
    </ShortcutDisplayProvider>
  );
}
