import { useEffect, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { APP_NAME } from "../shared/aboutInfo";
import { useCloseOnEscape, useWindowAppearance } from "./hooks/useWindowAppearance";
import { useFiletrailClient } from "./lib/filetrailClient";

type Acknowledgement = IpcResponse<"app:getAcknowledgements">["components"][number];

// The Acknowledgements window (`#acknowledgements`): the open-source software shipped
// inside the app, each with its license as shipped.
export function AcknowledgementsWindowApp() {
  const client = useFiletrailClient();
  const [components, setComponents] = useState<Acknowledgement[] | null>(null);
  const [failed, setFailed] = useState(false);
  useWindowAppearance(client);
  useCloseOnEscape();

  useEffect(() => {
    let cancelled = false;
    void client
      .invoke("app:getAcknowledgements", {})
      .then((response) => {
        if (!cancelled) {
          setComponents(response.components);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    document.title = "Acknowledgements";
    document.body.classList.add("page-window-body");
    return () => document.body.classList.remove("page-window-body");
  }, []);

  return (
    <main className="acknowledgements-window">
      <header className="page-window-titlebar acknowledgements-titlebar">Acknowledgements</header>
      <div className="acknowledgements-scroll">
        <p className="acknowledgements-intro">
          {APP_NAME} is built with the open-source software below. Each one is used under its own
          license.
        </p>
        {failed ? <p className="acknowledgements-intro">Unable to load the licenses.</p> : null}
        {components?.map((component) => (
          <details key={component.id} className="acknowledgement">
            <summary>
              <span className="acknowledgement-summary">
                <span className="acknowledgement-name">
                  {component.name}
                  {component.version ? (
                    <span className="acknowledgement-version"> {component.version}</span>
                  ) : null}
                </span>
                <span className="acknowledgement-license">{component.license}</span>
              </span>
            </summary>
            <div className="acknowledgement-body">
              <a className="page-window-link" href={component.url} target="_blank" rel="noreferrer">
                {component.url.replace(/^https:\/\/(www\.)?/, "")}
              </a>
              {component.text === null ? (
                <button
                  type="button"
                  className="page-window-button"
                  onClick={() =>
                    void client
                      .invoke("app:openAcknowledgementNotices", { id: component.id })
                      .catch(() => {})
                  }
                >
                  Open License Notices
                </button>
              ) : (
                <pre className="acknowledgement-text">{component.text}</pre>
              )}
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
