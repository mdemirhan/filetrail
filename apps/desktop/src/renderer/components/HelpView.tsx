import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  HELP_SHORTCUT_GROUPS,
  HELP_TOPICS,
  type HelpRow,
  type HelpTopic,
  type HelpTopicId,
  type ShownShortcut,
  fillShortcutMentions,
  getHelpTopic,
  listShortcuts,
  searchHelp,
} from "../lib/helpContent";
import type { ShortcutDisplay } from "../lib/shortcutDisplay";
import { shortcutParts } from "../lib/shortcutLabels";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";

// Help is a list of topics beside one readable column, like the sidebar and Settings. Each
// topic explains an area and ends with its shortcuts; "Keyboard shortcuts" lists them all,
// with the keys they have now, and leads to Settings → Shortcuts to change them.
// Typing in "Search help" replaces the page with matches from every topic. Styling is in
// styles.css (`.help-*`) on the app's theme tokens, so Help follows theme, accent and font.
export function HelpView({
  layoutMode = "wide",
  initialTopic = "navigation",
  onTopicChange,
  onCustomizeShortcuts,
}: {
  layoutMode?: "wide" | "narrow" | "compact";
  initialTopic?: HelpTopicId;
  /** Told the page on screen, so that Help can open on it next time. */
  onTopicChange?: (topic: HelpTopicId) => void;
  /** Opens Settings → Shortcuts. */
  onCustomizeShortcuts?: () => void;
}) {
  const shortcuts = useShortcutDisplay();
  const [activeTopicId, setActiveTopicId] = useState<HelpTopicId>(initialTopic);
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searching = query.trim().length > 0;

  const onTopicChangeRef = useRef(onTopicChange);
  onTopicChangeRef.current = onTopicChange;
  useEffect(() => {
    onTopicChangeRef.current?.(activeTopicId);
  }, [activeTopicId]);

  // A new page starts at its top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when the page shown changes.
  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [activeTopicId, searching]);

  return (
    <div className="help-view" data-layout={layoutMode}>
      <nav className="help-sidebar" aria-label="Help topics">
        <label className="help-filter">
          <svg className="help-filter-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="text"
            className="help-filter-input"
            value={query}
            placeholder="Search help"
            aria-label="Search help"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Escape clears the search first; with nothing to clear it leaves Help as usual.
              if (event.key === "Escape" && query.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </label>
        <div className="help-topics">
          {HELP_TOPICS.map((topic) => (
            <button
              key={topic.id}
              type="button"
              className="help-topic"
              aria-current={!searching && topic.id === activeTopicId ? "page" : undefined}
              onClick={() => {
                setQuery("");
                setActiveTopicId(topic.id);
              }}
            >
              <TopicIcon id={topic.id} />
              <span>{topic.title}</span>
            </button>
          ))}
        </div>
      </nav>
      <div ref={contentRef} className="help-content">
        <article className="help-page">
          {searching ? (
            <SearchResultsPage query={query.trim()} shortcuts={shortcuts} />
          ) : activeTopicId === "shortcuts" ? (
            <ShortcutsPage shortcuts={shortcuts} onCustomize={onCustomizeShortcuts} />
          ) : (
            <TopicPage topic={getHelpTopic(activeTopicId)} shortcuts={shortcuts} />
          )}
        </article>
      </div>
    </div>
  );
}

function TopicPage({ topic, shortcuts }: { topic: HelpTopic; shortcuts: ShortcutDisplay }) {
  const topicShortcuts = listShortcuts(shortcuts).filter((item) => item.group === topic.id);
  return (
    <>
      <h1>{topic.title}</h1>
      <p className="help-intro">{renderInline(topic.intro, shortcuts)}</p>
      {topic.sections.map((section) => (
        <section key={section.title} className="help-section">
          <h2>{section.title}</h2>
          <div className="help-rows">
            {section.rows.map((row) => (
              <RowItem key={row.label} row={row} shortcuts={shortcuts} />
            ))}
          </div>
          {section.note ? (
            <p className="help-note">{renderInline(section.note, shortcuts)}</p>
          ) : null}
        </section>
      ))}
      {topicShortcuts.length > 0 ? (
        <section className="help-section">
          <h2>Shortcuts</h2>
          <ShortcutList items={topicShortcuts} />
        </section>
      ) : null}
    </>
  );
}

function ShortcutsPage({
  shortcuts,
  onCustomize,
}: {
  shortcuts: ShortcutDisplay;
  onCustomize: (() => void) | undefined;
}) {
  const topic = getHelpTopic("shortcuts");
  const shownShortcuts = listShortcuts(shortcuts);
  return (
    <>
      <h1>{topic.title}</h1>
      <p className="help-intro">{topic.intro}</p>
      {onCustomize ? (
        <button type="button" className="help-action" onClick={onCustomize}>
          Customize…
        </button>
      ) : null}
      <div className="help-shortcut-columns">
        {HELP_SHORTCUT_GROUPS.map((group) => (
          <section key={group} className="help-section help-shortcut-group">
            <h2>{getHelpTopic(group).title}</h2>
            <ShortcutList items={shownShortcuts.filter((item) => item.group === group)} />
          </section>
        ))}
      </div>
    </>
  );
}

function SearchResultsPage({ query, shortcuts }: { query: string; shortcuts: ShortcutDisplay }) {
  const results = searchHelp(query, shortcuts);
  return (
    <>
      <h1>Results for “{query}”</h1>
      {results.length === 0 ? (
        <p className="help-intro">Nothing in Help matches. Try a shorter or different word.</p>
      ) : null}
      {results.map(({ topic, rows, shortcuts: topicShortcuts }) => (
        <section key={topic.id} className="help-section">
          <h2>{topic.title}</h2>
          {rows.length > 0 ? (
            <div className="help-rows">
              {rows.map(({ section, row }) => (
                <RowItem key={`${section}:${row.label}`} row={row} shortcuts={shortcuts} />
              ))}
            </div>
          ) : null}
          {topicShortcuts.length > 0 ? <ShortcutList items={topicShortcuts} /> : null}
        </section>
      ))}
    </>
  );
}

function RowItem({ row, shortcuts }: { row: HelpRow; shortcuts: ShortcutDisplay }) {
  return (
    <div className="help-row">
      <div className="help-row-label">
        {row.code ? <code className="help-code">{row.label}</code> : row.label}
      </div>
      <div className="help-row-description">{renderInline(row.description, shortcuts)}</div>
    </div>
  );
}

function ShortcutList({ items }: { items: readonly ShownShortcut[] }) {
  return (
    <div className="help-rows">
      {items.map((item) => (
        <div key={`${item.shortcut}:${item.description}`} className="help-shortcut-row">
          <span>{item.description}</span>
          <Keys keys={shortcutParts(item.shortcut)} />
        </div>
      ))}
    </div>
  );
}

function Keys({ keys }: { keys: string[] }) {
  const occurrences = new Map<string, number>();
  return (
    <span className="help-keys">
      {keys.map((key) => {
        const count = occurrences.get(key) ?? 0;
        occurrences.set(key, count + 1);
        return (
          <kbd key={`${key}:${count}`} className="help-key">
            {key}
          </kbd>
        );
      })}
    </span>
  );
}

// `text in backticks` is shown as code and `{newTab}` as that command's key; everything
// else is plain text.
function renderInline(text: string, shortcuts: ShortcutDisplay): ReactNode[] {
  return fillShortcutMentions(text, shortcuts)
    .split("`")
    .map((part, index) =>
      index % 2 === 1 ? (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a fixed string never reorder.
        <code key={index} className="help-code">
          {part}
        </code>
      ) : (
        part
      ),
    );
}

function TopicIcon({ id }: { id: HelpTopicId }) {
  return (
    <svg className="help-topic-icon" viewBox="0 0 24 24" aria-hidden="true">
      {id === "navigation" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m15.5 8.5-2 5-5 2 2-5z" />
        </>
      ) : id === "files" ? (
        <>
          <path d="M8 3.5h6l4 4V17a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 17V5A1.5 1.5 0 0 1 8 3.5z" />
          <path d="M14 3.5V8h4" />
        </>
      ) : id === "search" ? (
        <>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </>
      ) : id === "views" ? (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M9.5 5v14" />
        </>
      ) : (
        <>
          <rect x="2.5" y="6.5" width="19" height="11" rx="2.5" />
          <path d="M6.5 10.5h.01M10 10.5h.01M13.5 10.5h.01M17 10.5h.01M8 14h8" />
        </>
      )}
    </svg>
  );
}
