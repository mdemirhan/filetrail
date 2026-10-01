import { type CSSProperties, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import type {
  ActionLogAction,
  ActionLogEntry,
  ActionLogItem,
  ActionLogStatus,
} from "@filetrail/contracts";

import type { AccentMode, ThemeMode } from "../../shared/appPreferences";
import { generateAccentTokens } from "../lib/accent";
import { withAlpha } from "../lib/colorUtils";
import { formatDateTime } from "../lib/formatting";
import { resolveThemeCssBase } from "../lib/themeVariants";
import { VIEW_PAGE_BG, VIEW_TEXT } from "../lib/viewColors";
import { uiMonoFontStack as mono, uiSansFontStack as sans } from "../lib/viewFonts";

// The Action Log follows the Font preference; paths and codes are monospaced.
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
  // Track which item category sections are collapsed per entry.
  // Key format: `${entryId}:${category}`. Default: failures expanded, others collapsed.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [copyFeedback, setCopyFeedback] = useState<{
    entryId: string;
    status: "copied" | "failed";
  } | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const palette = resolveActionLogTheme(theme, accent);
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
          entry.initiator ? formatInitiatorLabel(entry.initiator) : "",
          entry.requestedDestinationPath ?? "",
          entry.sourceSummary ?? "",
          entry.destinationSummary ?? "",
          ...entry.sourcePaths,
          ...entry.destinationPaths,
          ...entry.items.flatMap((item) => [
            item.error ?? "",
            formatChildFailureLabel(item) ?? "",
            item.skipReason ? formatSkipReasonLabel(item.skipReason) : "",
          ]),
          ...Object.entries(entry.metadata).flatMap(([key, value]) => [key, String(value)]),
          ...entry.runtimeConflicts.flatMap((conflict) => [
            conflict.sourcePath,
            conflict.destinationPath,
            formatConflictClassLabel(conflict.conflictClass),
            formatRuntimeConflictReasonLabel(conflict.reason),
            conflict.resolution
              ? formatRuntimeResolutionLabel(conflict.resolution, conflict.reason)
              : "",
          ]),
        ]
          .join("\n")
          .toLowerCase()
          .includes(deferredQuery);
      }),
    [actionFilter, deferredQuery, entries, statusFilter],
  );

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

  // One column template for the header and every row, so the columns line up.
  const columnTemplate =
    layoutMode === "narrow"
      ? "16px 92px 104px minmax(0, 1fr) auto"
      : "16px 104px 124px minmax(0, 1fr) auto";
  const summaryText = [
    hasActiveFilters
      ? `${filteredEntries.length} of ${formatCount(entries.length, "entry", "entries")}`
      : formatCount(entries.length, "entry", "entries"),
    totalFailed > 0 ? formatCount(totalFailed, "failed item", "failed items") : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <section
      className="action-log-view"
      data-layout={layoutMode}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflowX: "hidden",
        overflowY: "auto",
        padding: 0,
        background: palette.pageBg,
        color: palette.textPrimary,
        fontFamily: sans,
      }}
    >
      {/* A filter strip like the one above search results, then a plain table. */}
      <div
        role="toolbar"
        aria-label="Action log filters"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "6px",
          padding: "6px 12px",
          borderBottom: `1px solid ${palette.line}`,
          background: palette.pageBg,
          fontSize: "12px",
        }}
      >
        <span
          style={{
            position: "relative",
            display: "block",
            flex: "1 1 220px",
            maxWidth: "360px",
            minWidth: 0,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "8px",
              top: "50%",
              display: "inline-flex",
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <SearchIcon color={palette.textMuted} />
          </span>
          <input
            aria-label="Search action log"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by path, action or error"
            spellCheck={false}
            style={inputStyle(palette, true)}
          />
        </span>
        <select
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value as "all" | ActionLogAction)}
          style={inputStyle(palette, false)}
        >
          {ACTION_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by result"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "all" | ActionLogStatus)}
          style={inputStyle(palette, false)}
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActionFilter("all");
              setStatusFilter("all");
            }}
            style={buttonStyle(palette)}
          >
            Reset Filters
          </button>
        ) : null}
        <span style={{ flex: "1 1 auto" }} />
        <span
          aria-label="Action log summary"
          style={{
            color: palette.textMuted,
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {summaryText}
        </span>
        <button type="button" onClick={onRefresh} disabled={loading} style={buttonStyle(palette)}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <div role="alert" style={{ padding: "10px 16px", color: palette.error, fontSize: "12px" }}>
          Unable to load Action Log. {error}
        </div>
      ) : null}
      {!error && !loading && filteredEntries.length === 0 ? (
        <div
          style={{
            display: "flex",
            flex: "1 1 auto",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            padding: "32px 16px",
            textAlign: "center",
          }}
        >
          <strong style={{ fontSize: "13px", fontWeight: 600 }}>
            {entries.length === 0 ? "No actions yet" : "No matching actions"}
          </strong>
          <span style={{ color: palette.textMuted, fontSize: "12px" }}>
            {entries.length === 0
              ? "No action history has been recorded yet."
              : "No actions match the current filters."}
          </span>
        </div>
      ) : null}

      {filteredEntries.length > 0 ? (
        <section aria-label="Action log entries">
          {layoutMode !== "compact" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: columnTemplate,
                alignItems: "center",
                columnGap: "12px",
                height: "26px",
                padding: "0 46px 0 12px",
                borderBottom: `1px solid ${palette.line}`,
                color: palette.textSecondary,
                fontSize: "11px",
                fontWeight: 500,
              }}
            >
              <span />
              <span>Time</span>
              <span>Action</span>
              <span>Item</span>
              <span style={{ textAlign: "right" }}>Result</span>
            </div>
          ) : null}

          {filteredEntries.map((entry, index) => {
            const expanded = expandedIds[entry.id] ?? false;
            return (
              <article key={entry.id}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "stretch",
                    // Alternating rows, as in the details view of the file list.
                    background: expanded
                      ? palette.expandedRowBg
                      : index % 2 === 1
                        ? palette.stripeBg
                        : "transparent",
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
                      minWidth: 0,
                      border: 0,
                      background: "transparent",
                      color: "inherit",
                      padding: "0",
                      cursor: "default",
                      textAlign: "left",
                      font: "inherit",
                    }}
                    aria-expanded={expanded}
                  >
                    {layoutMode === "compact" ? (
                      <div style={{ display: "grid", gap: "2px", padding: "6px 0 6px 12px" }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "13px",
                          }}
                        >
                          <DisclosureIcon expanded={expanded} color={palette.textMuted} />
                          <span>{formatActionLabel(entry.action)}</span>
                          <span style={{ color: palette.textMuted, fontSize: "11px" }}>
                            {formatRelativeTime(entry.occurredAt)}
                          </span>
                          <span style={{ flex: "1 1 auto" }} />
                          <ResultBadge entry={entry} palette={palette} align="end" />
                        </div>
                        <div style={{ minWidth: 0, paddingLeft: "24px" }}>
                          <PathCell entry={entry} palette={palette} />
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: columnTemplate,
                          alignItems: "center",
                          columnGap: "12px",
                          minHeight: "28px",
                          padding: "0 0 0 12px",
                          fontSize: "13px",
                        }}
                      >
                        <DisclosureIcon expanded={expanded} color={palette.textMuted} />
                        <span
                          style={{
                            color: palette.textSecondary,
                            fontSize: "12px",
                            fontVariantNumeric: "tabular-nums",
                            whiteSpace: "nowrap",
                          }}
                          title={formatDateTime(entry.occurredAt)}
                        >
                          {formatRelativeTime(entry.occurredAt)}
                        </span>
                        <span style={{ whiteSpace: "nowrap" }}>
                          {formatActionLabel(entry.action)}
                        </span>
                        <span style={{ minWidth: 0, overflow: "hidden" }}>
                          <PathCell entry={entry} palette={palette} />
                        </span>
                        <span style={{ justifySelf: "end" }}>
                          <ResultBadge entry={entry} palette={palette} align="end" />
                        </span>
                      </div>
                    )}
                  </button>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: "6px",
                      minWidth: "46px",
                      padding: "0 12px 0 6px",
                    }}
                  >
                    {copyFeedback?.entryId === entry.id ? (
                      <span
                        style={{
                          color:
                            copyFeedback.status === "failed" ? palette.error : palette.textMuted,
                          fontSize: "11px",
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
                      padding: "10px 16px 14px 40px",
                      borderBottom: `1px solid ${palette.line}`,
                      background: palette.expandedRowBg,
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
                        gap: "12px 20px",
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
                          entry.initiator
                            ? `Initiated via: ${formatInitiatorLabel(entry.initiator)}`
                            : null,
                          entry.requestedDestinationPath
                            ? `Requested destination: ${entry.requestedDestinationPath}`
                            : null,
                          `Timestamp: ${formatDateTime(entry.occurredAt)}`,
                        ]
                          .filter((value): value is string => value !== null)
                          .join("\n")}
                        palette={palette}
                      />
                    </div>

                    {entry.error ? (
                      <div style={{ marginTop: "12px" }}>
                        <DetailStat
                          label="Failure Detail"
                          value={entry.error}
                          palette={palette}
                          tone="error"
                        />
                      </div>
                    ) : null}

                    {entry.runtimeConflicts.length > 0 ? (
                      <div style={{ marginTop: "14px" }}>
                        <div style={sectionTitleStyle(palette)}>Runtime Conflicts</div>
                        <div style={{ marginTop: "4px" }}>
                          {entry.runtimeConflicts.map((conflict) => (
                            <div
                              key={`${entry.id}-${conflict.conflictId}`}
                              style={{
                                display: "grid",
                                gap: "6px",
                                padding: "8px 0",
                                borderTop: `1px solid ${palette.line}`,
                              }}
                            >
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                <span style={chipStyle(palette)}>
                                  {formatConflictClassLabel(conflict.conflictClass)}
                                </span>
                                <span style={chipStyle(palette)}>
                                  {formatRuntimeConflictReasonLabel(conflict.reason)}
                                </span>
                                <span style={chipStyle(palette)}>
                                  Resolution:{" "}
                                  {conflict.resolution
                                    ? formatRuntimeResolutionLabel(
                                        conflict.resolution,
                                        conflict.reason,
                                      )
                                    : "None"}
                                </span>
                              </div>
                              <div>
                                <div style={fieldLabelStyle(palette)}>Source</div>
                                <div style={pathValueStyle(palette)}>{conflict.sourcePath}</div>
                              </div>
                              <div>
                                <div style={fieldLabelStyle(palette)}>Destination</div>
                                <div style={pathValueStyle(palette)}>
                                  {conflict.destinationPath}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {Object.keys(entry.metadata).length > 0 ? (
                      <div style={{ marginTop: "14px" }}>
                        <div style={sectionTitleStyle(palette)}>Metadata</div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                            marginTop: "6px",
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
                      <div style={{ marginTop: "14px" }}>
                        <div style={sectionTitleStyle(palette)}>Items</div>
                        {(
                          [
                            {
                              key: "failed",
                              label: "Failures",
                              items: entry.items.filter((i) => i.status === "failed"),
                            },
                            {
                              key: "skipped",
                              label: "Skipped",
                              items: entry.items.filter((i) => i.status === "skipped"),
                            },
                            {
                              key: "completed",
                              label: "Succeeded",
                              items: entry.items.filter((i) => i.status === "completed"),
                            },
                            {
                              key: "cancelled",
                              label: "Cancelled",
                              items: entry.items.filter((i) => i.status === "cancelled"),
                            },
                          ] as const
                        )
                          .filter((cat) => cat.items.length > 0)
                          .map((cat) => {
                            const sectionKey = `${entry.id}:${cat.key}`;
                            // Failures expanded by default, others collapsed
                            const isCollapsed =
                              collapsedSections[sectionKey] ?? cat.key !== "failed";
                            return (
                              <div key={cat.key} style={{ marginTop: "4px" }}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedSections((prev) => ({
                                      ...prev,
                                      [sectionKey]: !isCollapsed,
                                    }))
                                  }
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "4px 0",
                                    background: "none",
                                    border: "none",
                                    cursor: "default",
                                    color: palette.textSecondary,
                                    fontSize: "12px",
                                    fontWeight: 500,
                                    fontFamily: sans,
                                  }}
                                >
                                  <DisclosureIcon
                                    expanded={!isCollapsed}
                                    color={palette.textMuted}
                                  />
                                  {cat.label} ({cat.items.length})
                                </button>
                                {!isCollapsed ? (
                                  <div style={{ paddingLeft: "22px" }}>
                                    {cat.items.map((item, itemIndex) => (
                                      <ItemRow
                                        key={`${entry.id}-${cat.key}-${itemIndex}`}
                                        item={item}
                                        layoutMode={layoutMode}
                                        palette={palette}
                                      />
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// Colors come from the root theme tokens, so the view follows the theme like the file list.
function resolveActionLogTheme(theme: ThemeMode, accent: AccentMode) {
  const accentTokens = generateAccentTokens(accent, theme);
  const isLight = resolveThemeCssBase(theme) === "light";

  return {
    pageBg: VIEW_PAGE_BG,
    line: "var(--border-light)",
    inputBg: "var(--bg-input)",
    inputBorder: "var(--border)",
    buttonBg: "var(--bg-elevated)",
    // The same stripe as odd rows of the details view.
    stripeBg: "color-mix(in srgb, var(--neutral-ink) 3.5%, transparent)",
    expandedRowBg: withAlpha(accentTokens.solid, isLight ? 0.05 : 0.08),
    textPrimary: VIEW_TEXT.primary,
    textSecondary: VIEW_TEXT.secondary,
    textMuted: VIEW_TEXT.muted,
    success: isLight ? "#1f8a55" : "#68d29a",
    warning: isLight ? "#8b6a1f" : "#f0c46a",
    error: isLight ? "#bf3f4f" : "#ff8e9d",
  };
}

type ActionLogPalette = ReturnType<typeof resolveActionLogTheme>;

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
  if (action === "delete_immediately") {
    return "Delete Immediately";
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

function formatInitiatorLabel(initiator: ActionLogEntry["initiator"]): string {
  if (initiator === "drag_drop") {
    return "Drag and drop";
  }
  if (initiator === "move_dialog") {
    return "Move dialog";
  }
  if (initiator === "clipboard") {
    return "Clipboard paste";
  }
  return "Unknown";
}

function formatSkipReasonLabel(
  skipReason: NonNullable<ActionLogEntry["items"][number]["skipReason"]>,
): string {
  if (skipReason === "planned_conflict_policy") {
    return "Skipped by planned conflict policy";
  }
  return "Skipped after runtime conflict resolution";
}

function formatSourceKindLabel(kind: NonNullable<ActionLogItem["sourceKind"]>): string {
  if (kind === "directory") return "Folder";
  if (kind === "symlink") return "Symlink";
  return "File";
}

function formatConflictClassLabel(
  conflictClass: ActionLogEntry["runtimeConflicts"][number]["conflictClass"],
): string {
  if (conflictClass === "directory_conflict") {
    return "Folder conflict";
  }
  if (conflictClass === "type_mismatch") {
    return "Type mismatch";
  }
  return "File conflict";
}

function formatRuntimeConflictReasonLabel(
  reason: ActionLogEntry["runtimeConflicts"][number]["reason"],
): string {
  if (reason === "destination_changed") {
    return "Destination changed";
  }
  if (reason === "destination_created") {
    return "Destination created";
  }
  if (reason === "destination_deleted") {
    return "Destination deleted";
  }
  if (reason === "source_changed") {
    return "Source changed";
  }
  if (reason === "trash_unavailable") {
    return "Trash unavailable";
  }
  return "Source deleted";
}

function formatRuntimeResolutionLabel(
  resolution: NonNullable<ActionLogEntry["runtimeConflicts"][number]["resolution"]>,
  reason: ActionLogEntry["runtimeConflicts"][number]["reason"],
): string {
  if (resolution === "keep_both") {
    return "Keep both";
  }
  if (resolution === "merge") {
    return "Merge";
  }
  if (resolution === "overwrite") {
    // Without a Trash, replacing meant deleting the existing item for good.
    return reason === "trash_unavailable" ? "Deleted permanently" : "Overwrite";
  }
  return "Skip";
}

// A folder whose only problem is failures inside it has no error of its own.
function formatChildFailureLabel(item: ActionLogItem): string | null {
  const count = item.childFailureCount ?? 0;
  if (count === 0) {
    return null;
  }
  return `${count.toLocaleString()} ${count === 1 ? "item" : "items"} inside failed`;
}

function formatSummary(entry: ActionLogEntry): string {
  if (
    entry.summary.totalItemCount === 0 &&
    entry.summary.failedItemCount === 0 &&
    entry.summary.skippedItemCount === 0 &&
    entry.summary.cancelledItemCount === 0
  ) {
    return "No items";
  }
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

function resolveStatusColor(
  status: ActionLogStatus | "skipped",
  palette: ActionLogPalette,
): string {
  if (status === "completed") {
    return palette.success;
  }
  if (status === "failed") {
    return palette.error;
  }
  return status === "skipped" ? palette.textMuted : palette.warning;
}

// The outcome as plain text: the status word in its color, then the item counts.
function ResultBadge({
  entry,
  palette,
  align = "start",
}: {
  entry: ActionLogEntry;
  palette: ActionLogPalette;
  align?: "start" | "end";
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        justifyContent: align === "end" ? "flex-end" : "flex-start",
        alignItems: "baseline",
        gap: "6px",
        fontSize: "12px",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: resolveStatusColor(entry.status, palette) }}>
        {formatActionStatusLabel(entry.status)}
      </span>
      <span style={{ color: palette.textMuted }}>{formatSummary(entry)}</span>
    </span>
  );
}

function ItemRow({
  item,
  layoutMode,
  palette,
}: {
  item: ActionLogItem;
  layoutMode: LayoutMode;
  palette: ActionLogPalette;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          layoutMode === "compact"
            ? "1fr"
            : layoutMode === "narrow"
              ? "110px minmax(0, 1fr)"
              : "110px minmax(0, 1fr) minmax(0, 1fr)",
        gap: "4px 16px",
        padding: "6px 0",
        borderTop: `1px solid ${palette.line}`,
      }}
    >
      <div>
        <div style={fieldLabelStyle(palette)}>
          {item.sourceKind ? formatSourceKindLabel(item.sourceKind) : "Item"}
        </div>
        <div
          style={{
            marginTop: "2px",
            color: resolveStatusColor(item.status, palette),
            fontSize: "12px",
          }}
        >
          {formatActionStatusLabel(item.status)}
        </div>
      </div>
      <div>
        <div style={fieldLabelStyle(palette)}>Source</div>
        <div style={pathValueStyle(palette)}>{item.sourcePath ?? "None"}</div>
      </div>
      {layoutMode === "narrow" ? null : (
        <div>
          <div style={fieldLabelStyle(palette)}>Destination</div>
          <div style={pathValueStyle(palette)}>{item.destinationPath ?? "None"}</div>
          <ItemProblem item={item} palette={palette} />
        </div>
      )}
      {layoutMode === "narrow" && item.destinationPath ? (
        <div>
          <div style={fieldLabelStyle(palette)}>Destination</div>
          <div style={pathValueStyle(palette)}>{item.destinationPath}</div>
          <ItemProblem item={item} palette={palette} />
        </div>
      ) : null}
    </div>
  );
}

function ItemProblem({
  item,
  palette,
}: {
  item: ActionLogItem;
  palette: ActionLogPalette;
}) {
  const problems = [item.error, formatChildFailureLabel(item)].filter(Boolean);
  if (problems.length === 0) {
    return null;
  }
  return (
    <div style={{ marginTop: "4px", color: palette.error, fontSize: "12px" }}>
      {problems.join(" · ")}
    </div>
  );
}

function PathCell({
  entry,
  palette,
}: {
  entry: ActionLogEntry;
  palette: ActionLogPalette;
}) {
  const source = entry.sourceSummary ?? entry.sourcePaths[0] ?? null;
  const destination = entry.destinationSummary ?? entry.destinationPaths[0] ?? null;

  if (source && destination) {
    return (
      <span style={{ display: "flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
        <span style={{ ...rowPathStyle(palette), flexShrink: 1 }}>{source}</span>
        <ArrowIcon color={palette.textMuted} />
        <span style={{ ...rowPathStyle(palette), flexShrink: 1 }}>{destination}</span>
      </span>
    );
  }

  return <span style={rowPathStyle(palette)}>{source ?? destination ?? "None"}</span>;
}

// A labeled value in the expanded details: plain text, no card around it.
function DetailStat({
  label,
  value,
  palette,
  tone = "default",
  monoText = false,
}: {
  label: string;
  value: string;
  palette: ActionLogPalette;
  tone?: "default" | "muted" | "error";
  monoText?: boolean;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={fieldLabelStyle(palette)}>{label}</div>
      <pre
        style={{
          margin: "3px 0 0",
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

// Buttons and fields match the bar above search results: 22px tall, 12px text.
function buttonStyle(palette: ActionLogPalette): CSSProperties {
  return {
    height: "22px",
    padding: "0 10px",
    border: `1px solid ${palette.inputBorder}`,
    borderRadius: "6px",
    background: palette.buttonBg,
    color: palette.textPrimary,
    fontFamily: sans,
    fontSize: "12px",
    whiteSpace: "nowrap",
    cursor: "default",
  };
}

function inputStyle(palette: ActionLogPalette, withSearchPadding: boolean): CSSProperties {
  return {
    width: withSearchPadding ? "100%" : "auto",
    height: "22px",
    border: withSearchPadding ? "0" : `1px solid ${palette.inputBorder}`,
    borderRadius: "6px",
    background: withSearchPadding ? palette.inputBg : palette.buttonBg,
    color: palette.textPrimary,
    padding: withSearchPadding ? "0 8px 0 26px" : "0 6px",
    fontFamily: sans,
    fontSize: "12px",
    outline: "none",
  };
}

function fieldLabelStyle(palette: ActionLogPalette): CSSProperties {
  return {
    color: palette.textMuted,
    fontFamily: sans,
    fontSize: "11px",
  };
}

function sectionTitleStyle(palette: ActionLogPalette): CSSProperties {
  return {
    color: palette.textSecondary,
    fontFamily: sans,
    fontSize: "11px",
    fontWeight: 600,
  };
}

// The item in a table row: plain interface text, cut with an ellipsis when it is long.
function rowPathStyle(palette: ActionLogPalette): CSSProperties {
  return {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: palette.textSecondary,
    fontSize: "12px",
    minWidth: 0,
  };
}

function pathValueStyle(palette: ActionLogPalette): CSSProperties {
  return {
    marginTop: "2px",
    fontSize: "12px",
    lineHeight: 1.45,
    wordBreak: "break-word",
    color: palette.textSecondary,
    fontFamily: mono,
  };
}

function chipStyle(palette: ActionLogPalette): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 7px",
    borderRadius: "5px",
    border: `1px solid ${palette.line}`,
    color: palette.textPrimary,
    fontSize: "11px",
  };
}

function copyButtonStyle(palette: ActionLogPalette): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "22px",
    height: "22px",
    border: "0",
    borderRadius: "5px",
    background: "transparent",
    color: palette.textMuted,
    cursor: "default",
    flexShrink: 0,
  };
}

function SearchIcon({ color }: { color: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="12"
      height="12"
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

// The disclosure triangle of a row or section, pointing right when closed and down when open.
function DisclosureIcon({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        flexShrink: 0,
        transform: expanded ? "rotate(90deg)" : "none",
        transition: "transform 0.12s ease",
      }}
    >
      <path
        d="M3.5 2l3 3-3 3"
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
  if (entry.initiator) {
    lines.push(`Initiated via: ${formatInitiatorLabel(entry.initiator)}`);
  }
  if (entry.requestedDestinationPath) {
    lines.push(`Requested destination: ${entry.requestedDestinationPath}`);
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
    const categories: Array<{ label: string; items: ActionLogItem[] }> = [
      { label: "Failures", items: entry.items.filter((i) => i.status === "failed") },
      { label: "Skipped", items: entry.items.filter((i) => i.status === "skipped") },
      { label: "Succeeded", items: entry.items.filter((i) => i.status === "completed") },
      { label: "Cancelled", items: entry.items.filter((i) => i.status === "cancelled") },
    ];
    for (const cat of categories) {
      if (cat.items.length === 0) continue;
      lines.push("", `${cat.label} (${cat.items.length}):`);
      for (const item of cat.items) {
        const kindTag = item.sourceKind ? `[${formatSourceKindLabel(item.sourceKind)}] ` : "";
        lines.push(`- ${kindTag}${item.sourcePath ?? "None"} -> ${item.destinationPath ?? "None"}`);
        if (item.skipReason) {
          lines.push(`  Skip reason: ${formatSkipReasonLabel(item.skipReason)}`);
        }
        if (item.error) {
          lines.push(`  Error: ${item.error}`);
        }
        const childFailures = formatChildFailureLabel(item);
        if (childFailures) {
          lines.push(`  ${childFailures}`);
        }
      }
    }
  }
  if (entry.runtimeConflicts.length > 0) {
    lines.push("", "Runtime Conflicts:");
    for (const conflict of entry.runtimeConflicts) {
      lines.push(
        `- ${formatConflictClassLabel(conflict.conflictClass)}: ${formatRuntimeConflictReasonLabel(conflict.reason)}`,
      );
      lines.push(`  Source: ${conflict.sourcePath}`);
      lines.push(`  Destination: ${conflict.destinationPath}`);
      lines.push(
        `  Resolution: ${conflict.resolution ? formatRuntimeResolutionLabel(conflict.resolution, conflict.reason) : "None"}`,
      );
    }
  }
  return lines.join("\n");
}
