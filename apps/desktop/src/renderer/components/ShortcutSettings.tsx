import { useMemo, useState } from "react";

import type { ReturnKeyAction } from "../../shared/appPreferences";
import {
  SHORTCUTS_PER_COMMAND,
  SHORTCUT_COMMANDS,
  SHORTCUT_GROUPS,
  SHORTCUT_GROUP_LABELS,
  type ShortcutBindings,
  type ShortcutCommandDefinition,
  type ShortcutCommandId,
  type ShortcutGroup,
  type ShortcutOverrides,
  type ShortcutRefusal,
  assignShortcut,
  checkShortcutAssignment,
  getShortcutCommand,
  isShortcutCustomized,
  isShortcutUsedByMacOSByDefault,
  removeShortcut,
  resetShortcut,
  resolveShortcuts,
  shortcutFromKeyboardEvent,
  toShortcutOverrides,
} from "../../shared/shortcuts";
import { formatShortcut } from "../lib/shortcutLabels";
import { ActionButton, SectionCard, type SettingsControlTheme } from "./SettingsControls";

type Slot = { id: ShortcutCommandId; index: number };

// What is said under a row: why a key was refused, something to know about the key just
// given, or the question whether to take a key from the command that has it.
type RowNote =
  | { id: ShortcutCommandId; kind: "refused" | "info"; text: string }
  | { id: ShortcutCommandId; kind: "conflict"; index: number; shortcut: string; other: string };

const ROW_HINTS: Partial<Record<ShortcutCommandId, string>> = {
  openSelectedItem: "Does what a double-click does.",
  toggleFavorite: "Removes the folder when it is a favorite already.",
};

const STANDARD_GROUP_NOTE =
  "The same in every Mac app, or shared with text fields. They can not be changed here.";

function describeRefusal(refusal: ShortcutRefusal, shortcut: string): string {
  const keys = formatShortcut(shortcut);
  switch (refusal.reason) {
    case "needsCommandOrControl":
      return `${keys} on its own types into the file list. Add ⌘ or ⌃.`;
    case "needsModifier":
      return `${keys} on its own moves around the list. Add ⌘, ⌃ or ⌥.`;
    case "fixedCommand":
      return `${keys} is ${withoutEllipsis(getShortcutCommand(refusal.command).label)}, which can not be changed.`;
    case "cancelsDialogs":
      return `${keys} cancels a dialog, as Esc does.`;
    case "macOS":
      return `macOS keeps ${keys} for itself.`;
  }
}

function withoutEllipsis(label: string): string {
  return label.replace(/…$/, "");
}

// Settings → Shortcuts: every command with its keys. Click a key and press the new one;
// Esc cancels and ⌫ removes the key. Each change is saved as it is made.
export function ShortcutSettings({
  overrides,
  returnKeyAction,
  theme,
  onChange,
}: {
  overrides: ShortcutOverrides;
  returnKeyAction: ReturnKeyAction;
  theme: SettingsControlTheme;
  onChange: (overrides: ShortcutOverrides) => void;
}) {
  const bindings = useMemo(() => resolveShortcuts(overrides).bindings, [overrides]);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<Slot | null>(null);
  const [note, setNote] = useState<RowNote | null>(null);
  const anyCustomized = SHORTCUT_COMMANDS.some((command) =>
    isShortcutCustomized(bindings, command.id),
  );

  const save = (next: ShortcutBindings) => onChange(toShortcutOverrides(next));

  const give = (slot: Slot, shortcut: string) => {
    save(assignShortcut(bindings, slot.id, slot.index, shortcut));
    setRecording(null);
    setNote(
      isShortcutUsedByMacOSByDefault(shortcut)
        ? {
            id: slot.id,
            kind: "info",
            text: `macOS may use ${formatShortcut(shortcut)} itself, for Mission Control. It works here once that is switched off in System Settings → Keyboard → Keyboard Shortcuts.`,
          }
        : null,
    );
  };

  const press = (slot: Slot, shortcut: string) => {
    const result = checkShortcutAssignment(bindings, slot.id, shortcut);
    if (result.status === "unchanged") {
      setRecording(null);
      setNote(null);
      return;
    }
    if (result.status === "refused") {
      // Recording goes on, so another key can be tried straight away.
      setNote({ id: slot.id, kind: "refused", text: describeRefusal(result.refusal, shortcut) });
      return;
    }
    if (result.status === "conflict") {
      setRecording(null);
      setNote({
        id: slot.id,
        kind: "conflict",
        index: slot.index,
        shortcut,
        other: withoutEllipsis(getShortcutCommand(result.command).label),
      });
      return;
    }
    give(slot, shortcut);
  };

  const remove = (slot: Slot) => {
    save(removeShortcut(bindings, slot.id, slot.index));
    setRecording(null);
    setNote(null);
  };

  const reset = (id: ShortcutCommandId) => {
    const result = resetShortcut(bindings, id);
    save(result.bindings);
    setRecording(null);
    setNote(
      result.takenFrom.length > 0
        ? {
            id,
            kind: "info",
            text: `Taken back from ${result.takenFrom
              .map((other) => withoutEllipsis(getShortcutCommand(other).label))
              .join(" and ")}.`,
          }
        : null,
    );
  };

  const needle = query.trim().toLowerCase();
  const matchesQuery = (command: ShortcutCommandDefinition, id: ShortcutCommandId) =>
    needle.length === 0 ||
    [
      command.label,
      SHORTCUT_GROUP_LABELS[command.group],
      ...bindings[id].flatMap((shortcut) => [shortcut, formatShortcut(shortcut)]),
    ].some((text) => text.toLowerCase().includes(needle));
  const groups = SHORTCUT_GROUPS.map((group) => ({
    group,
    commands: SHORTCUT_COMMANDS.filter(
      (command) => command.group === group && matchesQuery(command, command.id),
    ),
  })).filter((entry) => entry.commands.length > 0);

  return (
    <div className="shortcut-settings">
      <div className="shortcut-settings-bar">
        <label className="shortcut-settings-search-field">
          <svg className="help-filter-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            type="text"
            className="shortcut-settings-search"
            value={query}
            placeholder="Search by command or key"
            aria-label="Search shortcuts"
            spellCheck={false}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Escape clears the search first; with nothing to clear it closes Settings.
              if (event.key === "Escape" && query.length > 0) {
                event.preventDefault();
                setQuery("");
              }
            }}
          />
        </label>
        <ActionButton
          label="Reset All"
          ariaLabel="Reset All Shortcuts"
          theme={theme}
          disabled={!anyCustomized}
          onClick={() => {
            onChange({});
            setRecording(null);
            setNote(null);
          }}
        />
      </div>
      <p className="shortcut-settings-intro">
        Click a key and press the new one. Esc cancels, and ⌫ removes the key.
      </p>
      {groups.length === 0 ? (
        <p className="shortcut-settings-empty">No command or key matches “{query.trim()}”.</p>
      ) : null}
      {groups.map(({ group, commands }) => (
        <SectionCard key={group} title={groupTitle(group)} theme={theme}>
          {group === "standard" ? (
            <p className="shortcut-row-hint shortcut-group-note">{STANDARD_GROUP_NOTE}</p>
          ) : null}
          {commands.map((command) => (
            <ShortcutRow
              key={command.id}
              command={command}
              id={command.id}
              shortcuts={bindings[command.id]}
              customized={isShortcutCustomized(bindings, command.id)}
              hint={
                command.id === "renameSelection" && returnKeyAction === "rename"
                  ? "Return renames too: Settings → Files."
                  : ROW_HINTS[command.id]
              }
              recordingIndex={recording?.id === command.id ? recording.index : null}
              note={note?.id === command.id ? note : null}
              onRecord={(index) => {
                setRecording(index === null ? null : { id: command.id, index });
                setNote(null);
              }}
              onPress={(index, shortcut) => press({ id: command.id, index }, shortcut)}
              onRemove={(index) => remove({ id: command.id, index })}
              onReset={() => reset(command.id)}
              onReassign={(index, shortcut) => give({ id: command.id, index }, shortcut)}
              onDismissNote={() => setNote(null)}
            />
          ))}
        </SectionCard>
      ))}
    </div>
  );
}

function groupTitle(group: ShortcutGroup): string {
  return group === "standard" ? "Standard shortcuts" : SHORTCUT_GROUP_LABELS[group];
}

function ShortcutRow({
  command,
  id,
  shortcuts,
  customized,
  hint,
  recordingIndex,
  note,
  onRecord,
  onPress,
  onRemove,
  onReset,
  onReassign,
  onDismissNote,
}: {
  command: ShortcutCommandDefinition;
  id: ShortcutCommandId;
  shortcuts: readonly string[];
  customized: boolean;
  hint: string | undefined;
  recordingIndex: number | null;
  note: RowNote | null;
  onRecord: (index: number | null) => void;
  onPress: (index: number, shortcut: string) => void;
  onRemove: (index: number) => void;
  onReset: () => void;
  onReassign: (index: number, shortcut: string) => void;
  onDismissNote: () => void;
}) {
  const label = withoutEllipsis(command.label);
  if (command.fixed) {
    return (
      <div className="shortcut-row fixed">
        <div className="shortcut-row-line">
          <span className="shortcut-row-label">{label}</span>
          <span className="shortcut-row-keys">
            {shortcuts.map((shortcut) => (
              <span key={shortcut} className="shortcut-slot-key fixed">
                {formatShortcut(shortcut)}
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }
  // The keys the command has, then one empty place while there is room for another.
  const slotCount = Math.min(shortcuts.length + 1, SHORTCUTS_PER_COMMAND);
  return (
    <div className="shortcut-row" data-command={id}>
      <div className="shortcut-row-line">
        <span className="shortcut-row-text">
          <span className="shortcut-row-label">{label}</span>
          {hint ? <span className="shortcut-row-hint">{hint}</span> : null}
        </span>
        <span className="shortcut-row-keys">
          {customized ? (
            <button
              type="button"
              className="shortcut-row-reset"
              aria-label={`Reset ${label}`}
              onClick={onReset}
            >
              Reset
            </button>
          ) : null}
          {Array.from({ length: slotCount }, (_, index) => {
            const shortcut = shortcuts[index];
            const recording = recordingIndex === index;
            const place = index === 0 ? "shortcut" : "alternate shortcut";
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: a key's place is what identifies it.
              <span key={index} className="shortcut-slot">
                <button
                  type="button"
                  className={`shortcut-slot-key${shortcut ? "" : " empty"}${recording ? " recording" : ""}`}
                  aria-label={
                    recording
                      ? `Press the ${place} for ${label}`
                      : shortcut
                        ? `${label}, ${place}: ${formatShortcut(shortcut)}. Change`
                        : `Add ${index === 0 ? "a" : "an alternate"} shortcut for ${label}`
                  }
                  onClick={() => onRecord(recording ? null : index)}
                  onBlur={() => {
                    if (recording) {
                      onRecord(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (!recording) {
                      // ⌫ on a key removes it without recording first.
                      if (shortcut && (event.key === "Backspace" || event.key === "Delete")) {
                        event.preventDefault();
                        onRemove(index);
                      }
                      return;
                    }
                    // Tab leaves the key, as it leaves any control.
                    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                      return;
                    }
                    // Everything else is the answer, and must not reach the menu or close
                    // the window.
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.repeat) {
                      return;
                    }
                    const pressed = shortcutFromKeyboardEvent(event.nativeEvent);
                    if (!pressed) {
                      return;
                    }
                    if (pressed === "Esc") {
                      onRecord(null);
                      return;
                    }
                    if (pressed === "Backspace") {
                      if (shortcut) {
                        onRemove(index);
                      } else {
                        onRecord(null);
                      }
                      return;
                    }
                    onPress(index, pressed);
                  }}
                >
                  {recording ? "Press keys…" : shortcut ? formatShortcut(shortcut) : "+"}
                </button>
                {shortcut && !recording ? (
                  <button
                    type="button"
                    className="shortcut-slot-clear"
                    aria-label={`Remove ${formatShortcut(shortcut)} from ${label}`}
                    tabIndex={-1}
                    onClick={() => onRemove(index)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            );
          })}
        </span>
      </div>
      {note ? (
        <output className={`shortcut-row-note ${note.kind}`}>
          {note.kind === "conflict" ? (
            <>
              <span>
                {formatShortcut(note.shortcut)} is used by {note.other}.
              </span>
              <span className="shortcut-row-note-actions">
                <button
                  type="button"
                  className="shortcut-note-button primary"
                  onClick={() => onReassign(note.index, note.shortcut)}
                >
                  Reassign
                </button>
                <button type="button" className="shortcut-note-button" onClick={onDismissNote}>
                  Cancel
                </button>
              </span>
            </>
          ) : (
            <span>{note.text}</span>
          )}
        </output>
      ) : null}
    </div>
  );
}
