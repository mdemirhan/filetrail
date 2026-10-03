import type { ComponentProps, ReactNode } from "react";

import { ContentPane } from "./ContentPane";
import { SearchResultsPane } from "./SearchResultsPane";

type SearchResultsPaneProps = ComponentProps<typeof SearchResultsPane>;
type ContentPaneProps = ComponentProps<typeof ContentPane>;

export function SearchWorkspace({
  isSearchMode,
  searchResultsPaneProps,
  contentPaneProps,
  infoRow,
}: {
  isSearchMode: boolean;
  searchResultsPaneProps: SearchResultsPaneProps;
  contentPaneProps: ContentPaneProps;
  infoRow: ReactNode;
}) {
  // In a folder the Info Row sits above the path bar (inside the pane); search results have
  // no path bar, so there it is the bottom row.
  return (
    <section className="main-shell">
      {isSearchMode ? (
        <>
          <SearchResultsPane {...searchResultsPaneProps} />
          {infoRow}
        </>
      ) : (
        <ContentPane {...contentPaneProps} infoRow={infoRow} />
      )}
    </section>
  );
}
