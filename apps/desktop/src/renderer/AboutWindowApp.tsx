import { useEffect, useRef, useState } from "react";

import {
  APP_COPYRIGHT,
  APP_ISSUES_URL,
  APP_NAME,
  APP_REPOSITORY_URL,
  APP_TAGLINE,
  type AboutInfo,
  formatAboutDetails,
  formatAppVersion,
} from "../shared/aboutInfo";
import { PushButton } from "./components/PushButton";
import { useCloseOnEscape, useWindowAppearance } from "./hooks/useWindowAppearance";
import { useFiletrailClient } from "./lib/filetrailClient";

const COPIED_NOTE_MS = 1500;

// The About window (`#about`): what the app is, the versions a bug report needs, and the
// way to the project and to the licenses of the software inside it.
export function AboutWindowApp() {
  const client = useFiletrailClient();
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useWindowAppearance(client);
  useCloseOnEscape();

  useEffect(() => {
    let cancelled = false;
    void client
      .invoke("app:getAboutInfo", {})
      .then((response) => {
        if (!cancelled) {
          setInfo(response);
        }
      })
      .catch(() => {
        // The window still names the app; the rows stay empty.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    document.title = `About ${APP_NAME}`;
    document.body.classList.add("page-window-body");
    return () => {
      document.body.classList.remove("page-window-body");
      if (copiedTimer.current) {
        clearTimeout(copiedTimer.current);
      }
    };
  }, []);

  async function copyDetails() {
    if (!info) {
      return;
    }
    try {
      await client.invoke("system:copyText", { text: formatAboutDetails(info) });
    } catch {
      return;
    }
    setCopied(true);
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current);
    }
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_NOTE_MS);
  }

  const rows: Array<[label: string, value: string]> = info
    ? [
        ["Version", formatAppVersion(info)],
        ["macOS", `${info.macosVersion}, ${info.architecture}`],
        ["Electron", info.electronVersion],
        ["Search", `fd ${info.fdVersion}`],
      ]
    : [];

  return (
    <main className="about-window">
      <div className="page-window-titlebar" />
      <header className="about-header">
        {/* The app's own icon file, copied beside the page by the build. */}
        <img className="about-icon" src="../assets/icons/filetrail.svg" alt="" />
        <div>
          <h1 className="about-name">{APP_NAME}</h1>
          <p className="about-tagline">{APP_TAGLINE}</p>
        </div>
      </header>
      <dl className="about-details">
        {rows.map(([label, value]) => (
          <div key={label} className="about-detail">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="about-actions">
        <PushButton disabled={!info} onClick={() => void copyDetails()}>
          {copied ? "Copied" : "Copy Details"}
        </PushButton>
        {/* Links that look like the push button beside them. */}
        <a className="push-button" href={APP_REPOSITORY_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <a className="push-button" href={APP_ISSUES_URL} target="_blank" rel="noreferrer">
          Report an Issue
        </a>
      </div>
      <footer className="about-footer">
        <button
          type="button"
          className="page-window-link"
          onClick={() => void client.invoke("app:openAcknowledgementsWindow", {}).catch(() => {})}
        >
          Acknowledgements
        </button>
        <span>{APP_COPYRIGHT}</span>
      </footer>
    </main>
  );
}
