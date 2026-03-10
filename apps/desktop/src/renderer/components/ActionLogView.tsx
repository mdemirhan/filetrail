import { type CSSProperties, useDeferredValue, useEffect, useRef, useState } from "react";

import type { ActionLogAction, ActionLogEntry, ActionLogStatus } from "@filetrail/contracts";

import type { AccentMode, ThemeMode } from "../../shared/appPreferences";
import { generateAccentTokens } from "../lib/accent";
import { formatDateTime } from "../lib/formatting";
import { getThemeVariant, resolveThemeCssBase } from "../lib/themeVariants";
import { uiMonoFontStack as mono, uiSansFontStack as sans } from "../lib/viewFonts";
import { ToolbarIcon } from "./ToolbarIcon";

type LayoutMode = "wide" | "narrow" | "compact";

const ACTION_FILTER_OPTIONS: Array<{ value: "all" | ActionLogAction; label: string }> = [
  { value: "all", label: "All actions" },
  { value: "open", label: "Open" },
  { value: "open_with", label: "Open With" },
  { value: "open_in_terminal", label: "Open in Terminal" },
  { value: "paste", label: "Paste" },
  { value: "move_to", label: "Move" },
  { value: "duplicate", label: "Duplicate" },
  { value: "trash", label: "Trash" },
  { value: "rename", label: "Rename" },
  { value: "new_folder", label: "New Folder" },
];

const STATUS_FILTER_OPTIONS: Array<{ value: "all" | ActionLogStatus; label: string }> = [
  { value: "all", label: "All results" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "partial", label: "Partial" },
  { value: "cancelled", label: "Cancelled" },
];

export function ActionLogView({
  entries,
  loading,
  error,
  theme,
  accent,
  layoutMode = "wide",
  onCopyEntryText,
  onRefresh,
}: {
  entries: ReadonlyArray<ActionLogEntry>;
  loading: boolean;
  error: string | null;
  theme: ThemeMode;
  accent: AccentMode;
  layoutMode?: LayoutMode;
  onCopyEntryText: (text: string) => Promise<void> | void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | ActionLogAction>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ActionLogStatus>("all");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<{ entryId: string; status: "copied" | "failed" } | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const palette = resolveActionLogTheme(theme, accent);
  const controlHeight = layoutMode === "compact" ? 38 : 40;
  const filteredEntries = entries.filter((entry) => {
    if (actionFilter !== "all" && entry.action !== actionFilter) {
      return false;
    }
    if (statusFilter !== "all" && entry.status !== statusFilter) {
      return false;
    }
    if (!deferredQuery) {
      return true;
    }
    return [
      entry.title,
      entry.message,
      entry.error ?? "",
      entry.sourceSummary ?? "",
      entry.destinationSummary ?? "",
      ...entry.sourcePaths,
      ...entry.destinationPaths,
      ...entry.items.map((item) => item.error ?? ""),
    ]
      .join("\n")
      .toLowerCase()
      .includes(deferredQuery);
  });
  const totalFailed = entries.reduce((count, entry) => count + entry.summary.failedItemCount, 0);

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  function showCopyFeedback(entryId: string, status: "copied" | "failed") {
    if (copyFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
    setCopyFeedback({ entryId, status });
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopyFeedback((current) => (current?.entryId === entryId ? null : current));
      copyFeedbackTimeoutRef.current = null;
    }, 1800);
  }

  async function handleCopyEntry(entry: ActionLogEntry) {
    try {
      await onCopyEntryText(formatActionLogEntryForClipboard(entry));
      showCopyFeedback(entry.id, "copied");
    } catch {
      showCopyFeedback(entry.id, "failed");
    }
  }

  return (
    <section
      className="action-log-view"
      data-layout={layoutMode}
      style={{
        minHeight: 0,
        height: "100%",
        overflowX: "hidden",
        overflowY: "auto",
        padding: layoutMode === "compact" ? "16px 16px 24px" : "20px 20px 28px",
        background: palette.pageBg,
        color: palette.textPrimary,
        fontFamily: sans,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: layoutMode === "compact" ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: "12px",
          flexDirection: layoutMode === "compact" ? "column" : "row",
          marginBottom: "14px",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: mono,
              fontSize: "10px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: palette.kicker,
              marginBottom: "6px",
            }}
          >
            Action History
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: layoutMode === "compact" ? "25px" : "30px",
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
            }}
          >
            Action Log
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              maxWidth: "720px",
              color: palette.textMuted,
              lineHeight: 1.4,
              fontSize: "13px",
            }}
          >
            Review file mutations and launch actions with readable status, source, destination, and full failure detail.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          style={controlButtonStyle(palette, true, controlHeight)}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          padding: layoutMode === "compact" ? "10px 12px" : "11px 14px",
          borderRadius: "14px",
          background: palette.cardBg,
          border: `1px solid ${palette.border}`,
          boxShadow: palette.shadow,
          marginBottom: "14px",
          color: palette.textMuted,
          fontSize: "12px",
        }}
        aria-label="Action log summary"
      >
        <SummaryMetric label="Entries" value={String(entries.length)} palette={palette} />
        <SummarySeparator palette={palette} />
        <SummaryMetric label="Visible" value={String(filteredEntries.length)} palette={palette} />
        <SummarySeparator palette={palette} />
        <SummaryMetric label="Failed items" value={String(totalFailed)} palette={palette} />
        <SummarySeparator palette={palette} />
        <SummaryMetric
          label="Latest"
          value={entries[0] ? formatDateTime(entries[0].occurredAt) : "No entries"}
          palette={palette}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            layoutMode === "compact"
              ? "1fr"
              : layoutMode === "narrow"
                ? "minmax(0, 1fr) minmax(0, 1fr)"
                : "minmax(220px, 1.6fr) 176px 176px auto",
          gap: "10px",
          alignItems: "end",
          padding: "10px",
          borderRadius: "14px",
          background: palette.filterBg,
          border: `1px solid ${palette.border}`,
          boxShadow: palette.shadow,
          marginBottom: "14px",
        }}
      >
        <label style={fieldLabelStyle(palette)}>
          Search
          <input
            aria-label="Search action log"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Path, error, destination, summary"
            style={inputStyle(palette, controlHeight)}
          />
        </label>
        <label style={fieldLabelStyle(palette)}>
          Action
          <select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value as "all" | ActionLogAction)}
            style={inputStyle(palette, controlHeight)}
          >
            {ACTION_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label style={fieldLabelStyle(palette)}>
          Result
          <select
            aria-label="Filter by result"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | ActionLogStatus)}
            style={inputStyle(palette, controlHeight)}
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActionFilter("all");
              setStatusFilter("all");
            }}
            style={controlButtonStyle(palette, false, controlHeight)}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {error ? (
        <div style={noticeStyle(palette, "error")}>Unable to load Action Log. {error}</div>
      ) : null}
      {!error && !loading && filteredEntries.length === 0 ? (
        <div style={noticeStyle(palette, "empty")}>
          {entries.length === 0 ? "No action history has been recorded yet." : "No actions match the current filters."}
        </div>
      ) : null}

      <div
        role="table"
        aria-label="Action log entries"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {filteredEntries.map((entry) => {
          const expanded = expandedIds[entry.id] ?? false;
          return (
            <article
              key={entry.id}
              style={{
                borderRadius: "14px",
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                boxShadow: palette.shadow,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  alignItems: "stretch",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedIds((current) => ({
                      ...current,
                      [entry.id]: !expanded,
                    }))
                  }
                  style={{
                    width: "100%",
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                    padding: "0",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                  aria-expanded={expanded}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        layoutMode === "compact"
                          ? "1fr"
                          : "minmax(140px, 180px) minmax(120px, 150px) minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(140px, 180px) auto",
                      gap: "10px",
                      alignItems: "center",
                      padding: "11px 14px",
                    }}
                  >
                    <div>
                      <div style={eyebrowStyle(palette)}>Time</div>
                      <div style={valueStyle}>{formatDateTime(entry.occurredAt)}</div>
                    </div>
                    <div>
                      <div style={eyebrowStyle(palette)}>Action</div>
                      <div style={valueStyle}>{formatActionLabel(entry.action)}</div>
                    </div>
                    <div>
                      <div style={eyebrowStyle(palette)}>Source</div>
                      <div style={truncateValueStyle}>{entry.sourceSummary ?? "None"}</div>
                    </div>
                    <div>
                      <div style={eyebrowStyle(palette)}>Destination</div>
                      <div style={truncateValueStyle}>{entry.destinationSummary ?? "None"}</div>
                    </div>
                    <div>
                      <div style={eyebrowStyle(palette)}>Result</div>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <StatusBadge status={entry.status} palette={palette} />
                        <span style={{ color: palette.textMuted, fontSize: "11px" }}>
                          {formatSummary(entry)}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        justifySelf: layoutMode === "compact" ? "start" : "end",
                        color: palette.textMuted,
                        fontSize: "11px",
                        fontFamily: mono,
                      }}
                    >
                      {expanded ? "Hide" : "Details"}
                    </div>
                  </div>
                </button>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 14px 10px 0",
                  }}
                >
                  {copyFeedback?.entryId === entry.id ? (
                    <span
                      style={{
                        color: copyFeedback.status === "failed" ? palette.error : palette.textMuted,
                        fontSize: "11px",
                        fontFamily: mono,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {copyFeedback.status === "failed" ? "Copy failed" : "Copied"}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyEntry(entry);
                    }}
                    aria-label={`Copy action log row for ${entry.title}`}
                    title="Copy action log row"
                    style={copyButtonStyle(palette)}
                  >
                    <ToolbarIcon name="copy" />
                  </button>
                </div>
              </div>
              {expanded ? (
                <div
                  style={{
                    borderTop: `1px solid ${palette.border}`,
                    padding: "12px",
                    display: "grid",
                    gap: "12px",
                    background: palette.detailBg,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: layoutMode === "compact" ? "1fr" : "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <DetailBlock label="Summary" value={entry.message} palette={palette} />
                    <DetailBlock
                      label="Operation"
                      value={[
                        `Result: ${formatActionStatusLabel(entry.status)}`,
                        entry.durationMs !== null ? `Duration: ${entry.durationMs} ms` : null,
                        entry.operationId ? `Operation ID: ${entry.operationId}` : null,
                      ]
                        .filter((value): value is string => value !== null)
                        .join("\n")}
                      palette={palette}
                    />
                  </div>

                  {entry.error ? (
                    <DetailBlock label="Failure Detail" value={entry.error} palette={palette} tone="error" />
                  ) : null}

                  {Object.keys(entry.metadata).length > 0 ? (
                    <div>
                      <div style={sectionTitleStyle(palette)}>Metadata</div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {Object.entries(entry.metadata).map(([key, value]) => (
                          <span key={key} style={chipStyle(palette)}>
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <div style={sectionTitleStyle(palette)}>Items</div>
                    <div style={{ display: "grid", gap: "8px" }}>
                      {entry.items.map((item, index) => (
                        <div
                          key={`${entry.id}-${index}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: layoutMode === "compact" ? "1fr" : "minmax(120px, 140px) minmax(0, 1fr) minmax(0, 1fr)",
                            gap: "8px",
                            padding: "10px",
                            borderRadius: "10px",
                            border: `1px solid ${palette.border}`,
                            background: palette.itemBg,
                          }}
                        >
                          <div>
                            <div style={eyebrowStyle(palette)}>Item</div>
                            <StatusBadge status={item.status} palette={palette} />
                          </div>
                          <div>
                            <div style={eyebrowStyle(palette)}>Source</div>
                            <div style={pathValueStyle}>{item.sourcePath ?? "None"}</div>
                          </div>
                          <div>
                            <div style={eyebrowStyle(palette)}>Destination</div>
                            <div style={pathValueStyle}>{item.destinationPath ?? "None"}</div>
                            {item.error ? (
                              <div style={{ marginTop: "8px", color: palette.error, fontSize: "12px" }}>
                                {item.error}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function resolveActionLogTheme(theme: ThemeMode, accent: AccentMode) {
  const variant = getThemeVariant(theme);
  const accentTokens = generateAccentTokens(accent, theme);
  const isLight = resolveThemeCssBase(theme) === "light";
  return {
    pageBg: variant?.surfaces.page ?? (isLight ? "#eef1f7" : "#141820"),
    cardBg: variant?.surfaces.card ?? (isLight ? "#f7f9fc" : "#1a1f29"),
    detailBg: isLight ? "rgba(255,255,255,0.6)" : "rgba(8,10,15,0.35)",
    itemBg: isLight ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.03)",
    filterBg: variant?.surfaces.card ?? (isLight ? "#f7f9fc" : "#1a1f29"),
    border: variant?.surfaces.cardBorder ?? (isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)"),
    shadow: isLight ? "0 16px 32px rgba(26, 39, 68, 0.08)" : "0 16px 32px rgba(0, 0, 0, 0.24)",
    textPrimary: variant?.text.primary ?? (isLight ? "#192234" : "#eef2ff"),
    textMuted: variant?.text.muted ?? (isLight ? "#61708e" : "#8f9ab3"),
    kicker: accentTokens.solid,
    accentSoft: accentTokens.softBg,
    accentBorder: accentTokens.border,
    accentText: accentTokens.pathCrumbHover,
    success: isLight ? "#177a4d" : "#6fe0a6",
    warning: isLight ? "#8e5c00" : "#ffd27a",
    error: isLight ? "#b02a37" : "#ff9aa5",
  };
}

function formatActionLabel(action: ActionLogAction): string {
  if (action === "open_with") {
    return "Open With";
  }
  if (action === "open_in_terminal") {
    return "Open in Terminal";
  }
  if (action === "move_to") {
    return "Move";
  }
  if (action === "new_folder") {
    return "New Folder";
  }
  if (action === "trash") {
    return "Trash";
  }
  if (action === "paste") {
    return "Paste";
  }
  if (action === "duplicate") {
    return "Duplicate";
  }
  if (action === "rename") {
    return "Rename";
  }
  return "Open";
}

function formatActionStatusLabel(status: ActionLogStatus | "skipped"): string {
  if (status === "partial") {
    return "Partial";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  if (status === "skipped") {
    return "Skipped";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Completed";
}

function formatSummary(entry: ActionLogEntry): string {
  const parts = [`${entry.summary.completedItemCount}/${entry.summary.totalItemCount}`];
  if (entry.summary.failedItemCount > 0) {
    parts.push(`${entry.summary.failedItemCount} failed`);
  }
  if (entry.summary.skippedItemCount > 0) {
    parts.push(`${entry.summary.skippedItemCount} skipped`);
  }
  if (entry.summary.cancelledItemCount > 0) {
    parts.push(`${entry.summary.cancelledItemCount} cancelled`);
  }
  return parts.join(" · ");
}

function StatusBadge({
  status,
  palette,
}: {
  status: ActionLogStatus | "completed" | "failed" | "cancelled" | "partial" | "skipped";
  palette: ReturnType<typeof resolveActionLogTheme>;
}) {
  const color =
    status === "completed"
      ? palette.success
      : status === "failed"
        ? palette.error
        : status === "cancelled"
          ? palette.warning
          : status === "skipped"
            ? palette.textMuted
            : palette.warning;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        borderRadius: "999px",
        padding: "4px 10px",
        background: palette.accentSoft,
        border: `1px solid ${palette.accentBorder}`,
        color,
        fontFamily: mono,
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {formatActionStatusLabel(status)}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  palette,
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof resolveActionLogTheme>;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "6px",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ ...eyebrowStyle(palette), fontSize: "10px" }}>{label}</span>
      <span style={{ color: palette.textPrimary, fontSize: "13px", fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function SummarySeparator({ palette }: { palette: ReturnType<typeof resolveActionLogTheme> }) {
  return <span style={{ color: palette.textMuted, opacity: 0.6 }}>·</span>;
}

function DetailBlock({
  label,
  value,
  palette,
  tone = "default",
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof resolveActionLogTheme>;
  tone?: "default" | "error";
}) {
  return (
    <div
      style={{
        borderRadius: "14px",
        padding: "14px",
        border: `1px solid ${palette.border}`,
        background: palette.itemBg,
      }}
    >
      <div style={sectionTitleStyle(palette)}>{label}</div>
      <pre
        style={{
          margin: "8px 0 0",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: sans,
          fontSize: "13px",
          lineHeight: 1.55,
          color: tone === "error" ? palette.error : palette.textPrimary,
        }}
      >
        {value}
      </pre>
    </div>
  );
}

function controlButtonStyle(
  palette: ReturnType<typeof resolveActionLogTheme>,
  primary: boolean,
  height: number,
): CSSProperties {
  return {
    minHeight: `${height}px`,
    borderRadius: "11px",
    padding: "0 14px",
    border: `1px solid ${primary ? palette.accentBorder : palette.border}`,
    background: primary ? palette.accentSoft : palette.cardBg,
    color: primary ? palette.accentText : palette.textPrimary,
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
  };
}

function inputStyle(palette: ReturnType<typeof resolveActionLogTheme>, height: number): CSSProperties {
  return {
    width: "100%",
    marginTop: "6px",
    minHeight: `${height}px`,
    borderRadius: "11px",
    border: `1px solid ${palette.border}`,
    background: palette.cardBg,
    color: palette.textPrimary,
    padding: "0 12px",
    fontFamily: sans,
    fontSize: "13px",
  };
}

function fieldLabelStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    fontSize: "11px",
    color: palette.textMuted,
    display: "block",
  };
}

function noticeStyle(
  palette: ReturnType<typeof resolveActionLogTheme>,
  tone: "error" | "empty",
): CSSProperties {
  return {
    padding: "14px 16px",
    marginBottom: "12px",
    borderRadius: "12px",
    border: `1px solid ${tone === "error" ? palette.error : palette.border}`,
    background: tone === "error" ? palette.accentSoft : palette.cardBg,
    color: tone === "error" ? palette.error : palette.textMuted,
    fontSize: "13px",
  };
}

function sectionTitleStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    fontFamily: mono,
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: palette.textMuted,
  };
}

function eyebrowStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    fontFamily: mono,
    fontSize: "9px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: palette.textMuted,
  };
}

const valueStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  fontWeight: 600,
};

const truncateValueStyle: CSSProperties = {
  ...valueStyle,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const pathValueStyle: CSSProperties = {
  marginTop: "4px",
  fontSize: "12px",
  lineHeight: 1.4,
  wordBreak: "break-word",
};

function chipStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 9px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.itemBg,
    color: palette.textPrimary,
    fontSize: "11px",
  };
}

function copyButtonStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "9px",
    border: `1px solid ${palette.border}`,
    background: palette.itemBg,
    color: palette.textMuted,
    cursor: "pointer",
    flexShrink: 0,
  };
}

function formatActionLogEntryForClipboard(entry: ActionLogEntry): string {
  const lines = [
    `Action Log Entry`,
    `Time: ${formatDateTime(entry.occurredAt)}`,
    `Action: ${formatActionLabel(entry.action)}`,
    `Result: ${formatActionStatusLabel(entry.status)}`,
    `Summary: ${formatSummary(entry)}`,
    `Title: ${entry.title}`,
    `Message: ${entry.message}`,
    `Source: ${entry.sourceSummary ?? "None"}`,
    `Destination: ${entry.destinationSummary ?? "None"}`,
  ];

  if (entry.durationMs !== null) {
    lines.push(`Duration: ${entry.durationMs} ms`);
  }
  if (entry.operationId) {
    lines.push(`Operation ID: ${entry.operationId}`);
  }
  if (entry.error) {
    lines.push(`Error: ${entry.error}`);
  }
  if (entry.sourcePaths.length > 0) {
    lines.push("", "Source Items:");
    for (const path of entry.sourcePaths) {
      lines.push(`- ${path}`);
    }
  }
  if (entry.destinationPaths.length > 0) {
    lines.push("", "Destination Items:");
    for (const path of entry.destinationPaths) {
      lines.push(`- ${path}`);
    }
  }
  if (Object.keys(entry.metadata).length > 0) {
    lines.push("", "Metadata:");
    for (const [key, value] of Object.entries(entry.metadata)) {
      lines.push(`- ${key}: ${String(value)}`);
    }
  }
  if (entry.items.length > 0) {
    lines.push("", "Per-item Results:");
    for (const item of entry.items) {
      lines.push(
        `- [${formatActionStatusLabel(item.status)}] ${item.sourcePath ?? "None"} -> ${item.destinationPath ?? "None"}`,
      );
      if (item.error) {
        lines.push(`  Error: ${item.error}`);
      }
    }
  }
  return lines.join("\n");
}
