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
  return (
    <section className="main-shell">
      {isSearchMode ? (
        <SearchResultsPane {...searchResultsPaneProps} />
      ) : (
        <ContentPane {...contentPaneProps} />
      )}
      {infoRow}
    </section>
  );
}
