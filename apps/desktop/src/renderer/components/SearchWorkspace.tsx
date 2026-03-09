import type { ComponentProps, ReactNode } from "react";

import { ContentPane } from "./ContentPane";
import { SearchResultsPane } from "./SearchResultsPane";

type SearchResultsPaneProps = ComponentProps<typeof SearchResultsPane>;
type ContentPaneProps = ComponentProps<typeof ContentPane>;

export function SearchWorkspace({
  isSearchMode,
  searchResultsKey,
  searchResultsPaneProps,
  contentPaneProps,
  infoRow,
  statusLabel,
  statusPathLabel,
}: {
  isSearchMode: boolean;
  searchResultsKey?: string;
  searchResultsPaneProps: SearchResultsPaneProps;
  contentPaneProps: ContentPaneProps;
  infoRow: ReactNode;
  statusLabel: string;
  statusPathLabel: string;
}) {
  return (
    <section className="main-shell">
      {isSearchMode ? (
        <SearchResultsPane key={searchResultsKey} {...searchResultsPaneProps} />
      ) : (
        <ContentPane {...contentPaneProps} />
      )}
      {infoRow}
      <footer className="status-bar">
        <span>{statusLabel}</span>
        <span className="status-path">{statusPathLabel}</span>
      </footer>
    </section>
  );
}
