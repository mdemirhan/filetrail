import type { ComponentProps, ReactNode } from "react";

import { ContentPane } from "./ContentPane";

type ContentPaneProps = ComponentProps<typeof ContentPane>;

// The file list, showing the folder or search results in the same views; the Info Row sits
// between the list and the path bar.
export function SearchWorkspace({
  contentPaneProps,
  infoRow,
}: {
  contentPaneProps: ContentPaneProps;
  infoRow: ReactNode;
}) {
  return (
    <section className="main-shell">
      <ContentPane {...contentPaneProps} infoRow={infoRow} />
    </section>
  );
}
