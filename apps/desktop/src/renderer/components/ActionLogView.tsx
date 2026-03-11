import { type CSSProperties, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type { ActionLogAction, ActionLogEntry, ActionLogStatus } from "@filetrail/contracts";

import type { AccentMode, ThemeMode } from "../../shared/appPreferences";
import { generateAccentTokens } from "../lib/accent";
import { withAlpha } from "../lib/colorUtils";
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
  const [copyFeedback, setCopyFeedback] = useState<{
    entryId: string;
    status: "copied" | "failed";
  } | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const palette = resolveActionLogTheme(theme, accent);
  const controlHeight = layoutMode === "compact" ? 38 : 40;
  const hasActiveFilters =
    query.trim().length > 0 || actionFilter !== "all" || statusFilter !== "all";

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
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
      }),
    [actionFilter, deferredQuery, entries, statusFilter],
  );

  const totalFailed = entries.reduce((count, entry) => count + entry.summary.failedItemCount, 0);
  const latestEntry = entries[0] ?? null;

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
        padding:
          layoutMode === "compact"
            ? "24px 14px 22px"
            : layoutMode === "narrow"
              ? "28px 18px 24px"
              : "30px 20px 26px",
        background: palette.pageBg,
        color: palette.textPrimary,
        fontFamily: sans,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: layoutMode === "wide" ? "1200px" : "100%",
          margin: "0 auto",
        }}
      >
        <div
          className="action-log-page-header"
          style={{
            display: "flex",
            alignItems: layoutMode === "compact" ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: "14px",
            flexDirection: layoutMode === "compact" ? "column" : "row",
            marginBottom: "18px",
          }}
        >
          <div className="action-log-page-header-left">
            <span
              className="action-log-page-eyebrow"
              style={{
                margin: 0,
                color: palette.accentText,
                fontFamily: mono,
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              File Trail
            </span>
            <h1
              style={{
                margin: "4px 0 0",
                fontSize: "20px",
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                color: palette.textPrimary,
              }}
            >
              Action Log
            </h1>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            style={refreshButtonStyle(palette, controlHeight)}
          >
            <RefreshIcon color={palette.accentText} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
            padding: layoutMode === "compact" ? "10px 12px" : "11px 14px",
            borderRadius: "12px",
            background: palette.summaryBg,
            border: `1px solid ${palette.line}`,
            boxShadow: palette.shadow,
            marginBottom: "14px",
            color: palette.textSecondary,
            fontSize: "11.5px",
          }}
          aria-label="Action log summary"
        >
          <SummaryMetric label="Entries" value={String(entries.length)} palette={palette} />
          <SummarySeparator palette={palette} />
          <SummaryMetric label="Visible" value={String(filteredEntries.length)} palette={palette} />
          <SummarySeparator palette={palette} />
          <SummaryMetric
            label="Failed items"
            value={String(totalFailed)}
            palette={palette}
            highlight={totalFailed > 0 ? "error" : "none"}
          />
          <SummarySeparator palette={palette} />
          <SummaryMetric
            label="Latest"
            value={latestEntry ? formatRelativeTime(latestEntry.occurredAt) : "No entries"}
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
                  : "minmax(220px, 1.8fr) 160px 160px auto",
            gap: "10px",
            alignItems: "end",
            marginBottom: "12px",
          }}
        >
          <label style={fieldLabelStyle(palette)}>
            Search
            <span style={{ position: "relative", display: "block", marginTop: "6px" }}>
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "10px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: palette.textMuted,
                  pointerEvents: "none",
                }}
              >
                <SearchIcon color={palette.textMuted} />
              </span>
              <input
                aria-label="Search action log"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by path, action, error..."
                style={inputStyle(palette, controlHeight, true)}
              />
            </span>
          </label>
          <label style={fieldLabelStyle(palette)}>
            Action
            <select
              aria-label="Filter by action"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value as "all" | ActionLogAction)}
              style={inputStyle(palette, controlHeight, false)}
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
              style={inputStyle(palette, controlHeight, false)}
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setActionFilter("all");
                setStatusFilter("all");
              }}
              style={secondaryButtonStyle(palette, controlHeight, hasActiveFilters)}
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
            {entries.length === 0
              ? "No action history has been recorded yet."
              : "No actions match the current filters."}
          </div>
        ) : null}

        <section
          aria-label="Action log entries"
          style={{
            borderRadius: "14px",
            overflow: "hidden",
            border: `1px solid ${palette.line}`,
            background: palette.tableBg,
            boxShadow: palette.shadow,
          }}
        >
          {layoutMode !== "compact" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  layoutMode === "narrow"
                    ? "100px 92px minmax(0, 1fr) 110px 46px"
                    : "110px 104px minmax(0, 1fr) 132px 46px",
                gap: "0",
                padding: "9px 14px",
                borderBottom: `1px solid ${palette.line}`,
                background: palette.headerBg,
                color: palette.textMuted,
                fontFamily: mono,
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              <span>Time</span>
              <span>Action</span>
              <span>Path</span>
              <span style={{ textAlign: "right" }}>Result</span>
              <span />
            </div>
          ) : null}

          {filteredEntries.map((entry, index) => {
            const expanded = expandedIds[entry.id] ?? false;
            const showRowBorder = index < filteredEntries.length - 1 || expanded;
            return (
              <article
                key={entry.id}
                style={{ borderBottom: showRowBorder ? `1px solid ${palette.line}` : "none" }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      layoutMode === "compact" ? "1fr auto" : "minmax(0, 1fr) auto",
                    alignItems: "stretch",
                    background: expanded ? palette.expandedRowBg : "transparent",
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
                      style={
                        layoutMode === "compact"
                          ? {
                              display: "grid",
                              gridTemplateColumns: "1fr",
                              gap: "10px",
                              padding: "12px 14px",
                            }
                          : {
                              display: "grid",
                              gridTemplateColumns:
                                layoutMode === "narrow"
                                  ? "100px 92px minmax(0, 1fr) 110px 46px"
                                  : "110px 104px minmax(0, 1fr) 132px 46px",
                              gap: "0",
                              alignItems: "center",
                              padding: "10px 14px",
                            }
                      }
                    >
                      {layoutMode === "compact" ? (
                        <>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "10px",
                            }}
                          >
                            <span
                              style={{
                                color: palette.textSecondary,
                                fontSize: "11px",
                                fontFamily: mono,
                              }}
                            >
                              {formatRelativeTime(entry.occurredAt)}
                            </span>
                            <ActionBadge action={entry.action} palette={palette} />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <PathCell entry={entry} palette={palette} />
                          </div>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: "10px",
                            }}
                          >
                            <ResultBadge entry={entry} palette={palette} />
                            <span
                              style={{
                                color: palette.textMuted,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                              }}
                            >
                              <DetailIcon
                                color={expanded ? palette.accentText : palette.textMuted}
                              />
                              <span style={{ fontSize: "11px", fontFamily: mono }}>
                                {expanded ? "Hide" : "Details"}
                              </span>
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <span
                            style={{
                              color: palette.textSecondary,
                              fontSize: "11px",
                              fontFamily: mono,
                            }}
                          >
                            {formatRelativeTime(entry.occurredAt)}
                          </span>
                          <span>
                            <ActionBadge action={entry.action} palette={palette} />
                          </span>
                          <span style={{ minWidth: 0, overflow: "hidden" }}>
                            <PathCell entry={entry} palette={palette} />
                          </span>
                          <span style={{ justifySelf: "end" }}>
                            <ResultBadge entry={entry} palette={palette} align="end" />
                          </span>
                          <span
                            style={{
                              display: "flex",
                              justifyContent: "center",
                              color: expanded ? palette.accentText : palette.textMuted,
                            }}
                          >
                            <DetailIcon color={expanded ? palette.accentText : palette.textMuted} />
                          </span>
                        </>
                      )}
                    </div>
                  </button>

                  <div
                    style={{
                      display: "flex",
                      alignItems: layoutMode === "compact" ? "flex-start" : "center",
                      gap: "8px",
                      padding: layoutMode === "compact" ? "12px 14px 12px 0" : "10px 14px 10px 0",
                    }}
                  >
                    {copyFeedback?.entryId === entry.id ? (
                      <span
                        style={{
                          color:
                            copyFeedback.status === "failed" ? palette.error : palette.textMuted,
                          fontSize: "11px",
                          fontFamily: mono,
                          letterSpacing: "0.02em",
                          whiteSpace: "nowrap",
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
                      padding: "12px 14px 14px",
                      background: palette.detailBg,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          layoutMode === "compact"
                            ? "1fr"
                            : layoutMode === "narrow"
                              ? "repeat(2, minmax(0, 1fr))"
                              : "repeat(4, minmax(0, 1fr))",
                        gap: "10px",
                      }}
                    >
                      <DetailStat label="Summary" value={entry.message} palette={palette} />
                      <DetailStat
                        label="Source"
                        value={entry.sourceSummary ?? "None"}
                        palette={palette}
                        tone="muted"
                        monoText
                      />
                      <DetailStat
                        label="Destination"
                        value={entry.destinationSummary ?? "None"}
                        palette={palette}
                        monoText
                      />
                      <DetailStat
                        label="Operation"
                        value={[
                          `Result: ${formatActionStatusLabel(entry.status)}`,
                          `Items: ${formatSummary(entry)}`,
                          entry.durationMs !== null ? `Duration: ${entry.durationMs} ms` : null,
                          entry.operationId ? `Operation ID: ${entry.operationId}` : null,
                          `Timestamp: ${formatDateTime(entry.occurredAt)}`,
                        ]
                          .filter((value): value is string => value !== null)
                          .join("\n")}
                        palette={palette}
                      />
                    </div>

                    {entry.error ? (
                      <div style={{ marginTop: "10px" }}>
                        <DetailStat
                          label="Failure Detail"
                          value={entry.error}
                          palette={palette}
                          tone="error"
                        />
                      </div>
                    ) : null}

                    {Object.keys(entry.metadata).length > 0 ? (
                      <div style={{ marginTop: "12px" }}>
                        <div style={sectionTitleStyle(palette)}>Metadata</div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px",
                            marginTop: "8px",
                          }}
                        >
                          {Object.entries(entry.metadata).map(([key, value]) => (
                            <span key={key} style={chipStyle(palette)}>
                              {key}: {String(value)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {entry.items.length > 0 ? (
                      <div style={{ marginTop: "12px" }}>
                        <div style={sectionTitleStyle(palette)}>Items</div>
                        <div style={{ display: "grid", gap: "8px", marginTop: "8px" }}>
                          {entry.items.map((item, itemIndex) => (
                            <div
                              key={`${entry.id}-${itemIndex}`}
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  layoutMode === "compact"
                                    ? "1fr"
                                    : layoutMode === "narrow"
                                      ? "110px minmax(0, 1fr)"
                                      : "110px minmax(0, 1fr) minmax(0, 1fr)",
                                gap: "10px",
                                padding: "10px",
                                borderRadius: "10px",
                                border: `1px solid ${palette.line}`,
                                background: palette.itemBg,
                              }}
                            >
                              <div>
                                <div style={eyebrowStyle(palette)}>Item</div>
                                <div style={{ marginTop: "6px" }}>
                                  <StatusBadge status={item.status} palette={palette} compact />
                                </div>
                              </div>
                              <div>
                                <div style={eyebrowStyle(palette)}>Source</div>
                                <div style={pathValueStyle(palette)}>
                                  {item.sourcePath ?? "None"}
                                </div>
                              </div>
                              {layoutMode === "narrow" ? null : (
                                <div>
                                  <div style={eyebrowStyle(palette)}>Destination</div>
                                  <div style={pathValueStyle(palette)}>
                                    {item.destinationPath ?? "None"}
                                  </div>
                                  {item.error ? (
                                    <div
                                      style={{
                                        marginTop: "8px",
                                        color: palette.error,
                                        fontSize: "12px",
                                      }}
                                    >
                                      {item.error}
                                    </div>
                                  ) : null}
                                </div>
                              )}
                              {layoutMode === "narrow" && item.destinationPath ? (
                                <div>
                                  <div style={eyebrowStyle(palette)}>Destination</div>
                                  <div style={pathValueStyle(palette)}>{item.destinationPath}</div>
                                  {item.error ? (
                                    <div
                                      style={{
                                        marginTop: "8px",
                                        color: palette.error,
                                        fontSize: "12px",
                                      }}
                                    >
                                      {item.error}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>
    </section>
  );
}

function resolveActionLogTheme(theme: ThemeMode, accent: AccentMode) {
  const variant = getThemeVariant(theme);
  const accentTokens = generateAccentTokens(accent, theme);
  const isLight = resolveThemeCssBase(theme) === "light";
  const textPrimary = variant?.text.primary ?? (isLight ? "#1d2432" : "#eef2f8");
  const textSecondary = variant?.text.secondary ?? (isLight ? "#4b566a" : "#b7c1d3");
  const textMuted = variant?.text.muted ?? (isLight ? "#7b8496" : "#8792a6");
  const baseCard = variant?.surfaces.card ?? (isLight ? "#fbfcff" : "#1a1f27");
  const border =
    variant?.surfaces.cardBorder ?? (isLight ? "rgba(17, 24, 39, 0.08)" : "rgba(255,255,255,0.08)");
  const success = isLight ? "#1f8a55" : "#68d29a";
  const warning = isLight ? "#8b6a1f" : "#f0c46a";
  const error = isLight ? "#bf3f4f" : "#ff8e9d";

  return {
    pageBg: variant?.surfaces.page ?? (isLight ? "#eef2f7" : "#12161d"),
    tableBg: baseCard,
    summaryBg: withAlpha(baseCard, isLight ? 0.92 : 1),
    headerBg: isLight ? "rgba(255,255,255,0.54)" : "rgba(255,255,255,0.02)",
    detailBg: isLight ? "rgba(255,255,255,0.58)" : "rgba(9, 12, 17, 0.42)",
    itemBg: isLight ? "rgba(255,255,255,0.84)" : "rgba(255,255,255,0.03)",
    inputBg: variant?.controls.inputBg ?? baseCard,
    inputBorder: variant?.controls.inputBorder ?? border,
    line: border,
    textPrimary,
    textSecondary,
    textMuted,
    textPlaceholder: variant?.text.placeholder ?? textMuted,
    accentSoft: accentTokens.softBg,
    accentStrong: accentTokens.solid,
    accentBorder: accentTokens.border,
    accentText: accentTokens.pathCrumbHover,
    rowHoverBg: accentTokens.softBg,
    expandedRowBg: withAlpha(accentTokens.solid, isLight ? 0.04 : 0.06),
    actionHoverBg: accentTokens.actionHoverBg,
    success,
    warning,
    error,
    successBg: withAlpha(success, isLight ? 0.12 : 0.18),
    warningBg: withAlpha(warning, isLight ? 0.14 : 0.16),
    errorBg: withAlpha(error, isLight ? 0.1 : 0.16),
    successBorder: withAlpha(success, isLight ? 0.22 : 0.28),
    warningBorder: withAlpha(warning, isLight ? 0.2 : 0.24),
    errorBorder: withAlpha(error, isLight ? 0.22 : 0.3),
    shadow: isLight ? "0 18px 36px rgba(15, 23, 42, 0.08)" : "0 18px 36px rgba(0, 0, 0, 0.22)",
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

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60_000));
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  if (diffDay < 7) {
    return `${diffDay}d ago`;
  }
  return formatDateTime(value);
}

function resolveActionTone(
  action: ActionLogAction,
  palette: ReturnType<typeof resolveActionLogTheme>,
): { bg: string; border: string; color: string } {
  if (action === "trash") {
    return {
      bg: palette.errorBg,
      border: palette.errorBorder,
      color: palette.error,
    };
  }
  if (action === "new_folder" || action === "duplicate") {
    return {
      bg: palette.successBg,
      border: palette.successBorder,
      color: palette.success,
    };
  }
  if (action === "move_to") {
    return {
      bg: palette.warningBg,
      border: palette.warningBorder,
      color: palette.warning,
    };
  }
  if (action === "rename") {
    return {
      bg: palette.accentSoft,
      border: palette.accentBorder,
      color: palette.accentText,
    };
  }
  return {
    bg: withAlpha(palette.accentStrong, 0.1),
    border: withAlpha(palette.accentStrong, 0.22),
    color: palette.accentText,
  };
}

function ActionBadge({
  action,
  palette,
}: {
  action: ActionLogAction;
  palette: ReturnType<typeof resolveActionLogTheme>;
}) {
  const tone = resolveActionTone(action, palette);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        color: tone.color,
      }}
    >
      {formatActionLabel(action)}
    </span>
  );
}

function ResultBadge({
  entry,
  palette,
  align = "start",
}: {
  entry: ActionLogEntry;
  palette: ReturnType<typeof resolveActionLogTheme>;
  align?: "start" | "end";
}) {
  const statusColor =
    entry.status === "completed"
      ? palette.success
      : entry.status === "failed"
        ? palette.error
        : palette.warning;

  return (
    <span
      style={{
        display: "inline-flex",
        justifyContent: align === "end" ? "flex-end" : "flex-start",
        alignItems: "center",
        gap: "7px",
        width: "100%",
        fontSize: "11px",
        color: palette.textSecondary,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "999px",
          background: statusColor,
          boxShadow: `0 0 0 3px ${withAlpha(statusColor, 0.12)}`,
          flexShrink: 0,
        }}
      />
      <span style={{ color: statusColor, fontWeight: 600 }}>
        {formatActionStatusLabel(entry.status)}
      </span>
      <span style={{ color: palette.textMuted }}>{formatSummary(entry)}</span>
    </span>
  );
}

function StatusBadge({
  status,
  palette,
  compact = false,
}: {
  status: ActionLogStatus | "completed" | "failed" | "cancelled" | "partial" | "skipped";
  palette: ReturnType<typeof resolveActionLogTheme>;
  compact?: boolean;
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
  const background =
    status === "completed"
      ? palette.successBg
      : status === "failed"
        ? palette.errorBg
        : status === "cancelled"
          ? palette.warningBg
          : palette.accentSoft;
  const border =
    status === "completed"
      ? palette.successBorder
      : status === "failed"
        ? palette.errorBorder
        : status === "cancelled"
          ? palette.warningBorder
          : palette.accentBorder;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        borderRadius: "999px",
        padding: compact ? "4px 8px" : "4px 10px",
        background,
        border: `1px solid ${border}`,
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

function PathCell({
  entry,
  palette,
}: {
  entry: ActionLogEntry;
  palette: ReturnType<typeof resolveActionLogTheme>;
}) {
  const source = entry.sourceSummary ?? entry.sourcePaths[0] ?? null;
  const destination = entry.destinationSummary ?? entry.destinationPaths[0] ?? null;

  if (source && destination) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
        <span style={{ ...sourcePathTextStyle(palette), flexShrink: 1 }}>{source}</span>
        <ArrowIcon color={palette.textMuted} />
        <span style={{ ...destinationPathTextStyle(palette), flexShrink: 1 }}>{destination}</span>
      </span>
    );
  }

  return <span style={sourcePathTextStyle(palette)}>{source ?? destination ?? "None"}</span>;
}

function SummaryMetric({
  label,
  value,
  palette,
  highlight = "none",
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof resolveActionLogTheme>;
  highlight?: "none" | "error";
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
      <span
        style={{
          color: highlight === "error" ? palette.error : palette.textPrimary,
          fontSize: "13px",
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </span>
  );
}

function SummarySeparator({ palette }: { palette: ReturnType<typeof resolveActionLogTheme> }) {
  return <span style={{ color: palette.textMuted, opacity: 0.6 }}>·</span>;
}

function DetailStat({
  label,
  value,
  palette,
  tone = "default",
  monoText = false,
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof resolveActionLogTheme>;
  tone?: "default" | "muted" | "error";
  monoText?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: "10px",
        padding: "12px",
        border: `1px solid ${palette.line}`,
        background: palette.itemBg,
      }}
    >
      <div style={eyebrowStyle(palette)}>{label}</div>
      <pre
        style={{
          margin: "8px 0 0",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: monoText ? mono : sans,
          fontSize: "12px",
          lineHeight: 1.5,
          color:
            tone === "error"
              ? palette.error
              : tone === "muted"
                ? palette.textSecondary
                : palette.textPrimary,
        }}
      >
        {value}
      </pre>
    </div>
  );
}

function refreshButtonStyle(
  palette: ReturnType<typeof resolveActionLogTheme>,
  height: number,
): CSSProperties {
  return {
    minHeight: `${height}px`,
    display: "inline-flex",
    alignItems: "center",
    gap: "7px",
    borderRadius: "8px",
    padding: "0 14px",
    border: `1px solid ${palette.accentBorder}`,
    background: palette.accentSoft,
    color: palette.accentText,
    fontWeight: 600,
    fontSize: "12px",
    cursor: "pointer",
  };
}

function secondaryButtonStyle(
  palette: ReturnType<typeof resolveActionLogTheme>,
  height: number,
  active: boolean,
): CSSProperties {
  return {
    minHeight: `${height}px`,
    borderRadius: "8px",
    padding: "0 12px",
    border: `1px solid ${active ? palette.accentBorder : palette.line}`,
    background: active ? palette.accentSoft : palette.inputBg,
    color: active ? palette.accentText : palette.textSecondary,
    fontWeight: 500,
    fontSize: "12px",
    cursor: "pointer",
  };
}

function inputStyle(
  palette: ReturnType<typeof resolveActionLogTheme>,
  height: number,
  withSearchPadding: boolean,
): CSSProperties {
  return {
    width: "100%",
    minHeight: `${height}px`,
    height: `${height}px`,
    borderRadius: "8px",
    border: `1px solid ${palette.inputBorder}`,
    background: palette.inputBg,
    color: palette.textPrimary,
    padding: withSearchPadding ? "0 12px 0 32px" : "0 12px",
    fontFamily: sans,
    fontSize: "12px",
    outline: "none",
    appearance: "none",
  };
}

function fieldLabelStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    fontSize: "10px",
    color: palette.textMuted,
    display: "block",
    fontFamily: mono,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
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
    border: `1px solid ${tone === "error" ? palette.errorBorder : palette.line}`,
    background: tone === "error" ? palette.errorBg : palette.summaryBg,
    color: tone === "error" ? palette.error : palette.textMuted,
    fontSize: "13px",
  };
}

function sectionTitleStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    fontFamily: mono,
    fontSize: "10px",
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

function sourcePathTextStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: palette.textSecondary,
    fontFamily: mono,
    fontSize: "11px",
    minWidth: 0,
  };
}

function destinationPathTextStyle(
  palette: ReturnType<typeof resolveActionLogTheme>,
): CSSProperties {
  return {
    ...sourcePathTextStyle(palette),
    color: palette.textPrimary,
  };
}

function pathValueStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    marginTop: "4px",
    fontSize: "12px",
    lineHeight: 1.45,
    wordBreak: "break-word",
    color: palette.textSecondary,
    fontFamily: mono,
  };
}

function chipStyle(palette: ReturnType<typeof resolveActionLogTheme>): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 9px",
    borderRadius: "999px",
    border: `1px solid ${palette.line}`,
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
    borderRadius: "8px",
    border: `1px solid ${palette.line}`,
    background: palette.itemBg,
    color: palette.textMuted,
    cursor: "pointer",
    flexShrink: 0,
  };
}

function SearchIcon({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.5" />
      <path d="M11 11l3.5 3.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="10"
      viewBox="0 0 12 10"
      fill="none"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M1 5h10M8.5 2.5L11 5l-2.5 2.5"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DetailIcon({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
    >
      <circle cx="8" cy="8" r="1" fill={color} />
      <circle cx="8" cy="4" r="1" fill={color} />
      <circle cx="8" cy="12" r="1" fill={color} />
    </svg>
  );
}

function RefreshIcon({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M13.5 8a5.5 5.5 0 11-1.5-3.8"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M13.5 2.5v2.5H11"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatActionLogEntryForClipboard(entry: ActionLogEntry): string {
  const lines = [
    "Action Log Entry",
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
