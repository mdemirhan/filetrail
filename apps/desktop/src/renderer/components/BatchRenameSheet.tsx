import { type ReactNode, useId, useRef, useState } from "react";

import {
  BATCH_RENAME_DATE_FORMATS,
  type BatchRenameApplyTo,
  type BatchRenameCase,
  type BatchRenameDateFormat,
  type BatchRenameDateSeparator,
  type BatchRenameDateSource,
  type BatchRenameMode,
  type BatchRenameNameFormat,
  type BatchRenameOnConflict,
  type BatchRenamePlan,
  type BatchRenamePlanItem,
  type BatchRenamePreset,
  type BatchRenameSeparator,
  type BatchRenameSettings,
  DATE_TOKENS,
  type NameSegment,
  describeDateFormat,
  formatDate,
} from "../../shared/batchRename";
import type { BatchRenameTarget } from "../hooks/useBatchRename";
import { PushButton } from "./PushButton";
import { useDialogFocus } from "./useDialogFocus";

// Rows drawn in the preview; the counts below it always cover every item.
const PREVIEW_ROW_LIMIT = 1_000;
// The date the example under the date options is written for.
const EXAMPLE_DATE = "2026-05-14T18:02:11";

const MODES: ReadonlyArray<{ id: BatchRenameMode; label: string }> = [
  { id: "replace", label: "Replace Text" },
  { id: "add", label: "Add Text" },
  { id: "format", label: "Format" },
  { id: "case", label: "Change Case" },
];

/**
 * The Rename sheet for several items: Finder's Replace Text, Add Text and Format, and
 * Change Case, with every item's new name shown before anything is renamed, and names that
 * can't be used held back or settled as the person chooses.
 */
export function BatchRenameSheet({
  targets,
  settings,
  onSettingsChange,
  plan,
  checking,
  checkError,
  presets,
  onSavePreset,
  onDeletePreset,
  canRename,
  onCancel,
  onRename,
}: {
  targets: readonly BatchRenameTarget[];
  settings: BatchRenameSettings;
  onSettingsChange: (settings: BatchRenameSettings) => void;
  plan: BatchRenamePlan;
  /** The items are being read (their dates, their folders' names). */
  checking: boolean;
  checkError: string | null;
  presets: readonly BatchRenamePreset[];
  onSavePreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  canRename: boolean;
  onCancel: () => void;
  onRename: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const modeGroupName = useId();
  const [savingPreset, setSavingPreset] = useState(false);
  const presetsRef = useRef<HTMLSelectElement | null>(null);
  // Back from naming a preset, the keyboard goes to the Presets pop-up the name was asked
  // from: the field it was in is gone, and Escape or Tab must still reach the sheet.
  function stopSavingPreset() {
    setSavingPreset(false);
    requestAnimationFrame(() => presetsRef.current?.focus());
  }
  const [presetName, setPresetName] = useState("");
  // The preset last loaded or saved, offered for Update and Delete while it exists.
  const [currentPresetName, setCurrentPresetName] = useState<string | null>(null);
  useDialogFocus(dialogRef, firstFieldRef);

  const set = <K extends keyof BatchRenameSettings>(key: K, value: BatchRenameSettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });
  const currentPreset = presets.find((preset) => preset.name === currentPresetName) ?? null;
  const matchesCurrentPreset =
    currentPreset !== null && JSON.stringify(currentPreset.settings) === JSON.stringify(settings);
  const presetNameTaken = presets.some(
    (preset) => preset.name.toLowerCase() === presetName.trim().toLowerCase(),
  );

  function choosePreset(value: string) {
    if (value.startsWith("load:")) {
      const preset = presets.find((candidate) => candidate.name === value.slice(5));
      if (preset) {
        setCurrentPresetName(preset.name);
        onSettingsChange(preset.settings);
      }
    } else if (value === "save") {
      setPresetName(currentPreset?.name ?? "");
      setSavingPreset(true);
    } else if (value === "update" && currentPreset) {
      onSavePreset(currentPreset.name);
    } else if (value === "delete" && currentPreset) {
      onDeletePreset(currentPreset.name);
      setCurrentPresetName(null);
    }
  }

  function savePreset() {
    const name = presetName.trim();
    if (name.length === 0) {
      return;
    }
    onSavePreset(name);
    setCurrentPresetName(name);
    stopSavingPreset();
  }

  const count = targets.length;
  return (
    <div className="modal-scrim is-sheet" role="presentation">
      <dialog
        ref={dialogRef}
        className="batch-rename-sheet"
        aria-labelledby={titleId}
        aria-modal="true"
        open
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (savingPreset) {
            stopSavingPreset();
            return;
          }
          onCancel();
        }}
      >
        <form
          className="batch-rename-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (savingPreset) {
              savePreset();
            } else if (canRename) {
              onRename();
            }
          }}
        >
          <header className="batch-rename-header">
            <h2 id={titleId} className="batch-rename-title">
              {/* One item comes here only to be tried again after a rename of several. */}
              {`Rename ${count.toLocaleString()} ${count === 1 ? "Item" : "Items"}`}
            </h2>
            {savingPreset ? (
              <div className="batch-rename-preset-save">
                <input
                  className="batch-rename-field"
                  aria-label="Preset name"
                  placeholder="Preset name"
                  value={presetName}
                  maxLength={80}
                  // biome-ignore lint/a11y/noAutofocus: the field is what the person just asked for.
                  autoFocus
                  onChange={(event) => setPresetName(event.currentTarget.value)}
                />
                <PushButton onClick={stopSavingPreset}>Cancel</PushButton>
                <PushButton
                  variant="default"
                  type="submit"
                  disabled={presetName.trim().length === 0}
                >
                  {presetNameTaken ? "Replace" : "Save"}
                </PushButton>
              </div>
            ) : (
              <span className="batch-rename-popup batch-rename-presets">
                <select
                  ref={presetsRef}
                  aria-label="Presets"
                  value={matchesCurrentPreset ? `load:${currentPreset?.name}` : ""}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    event.currentTarget.value = "";
                    choosePreset(value);
                  }}
                >
                  <option value="" hidden>
                    Presets
                  </option>
                  {presets.length > 0 ? (
                    <optgroup label="Presets">
                      {presets.map((preset) => (
                        <option key={preset.name} value={`load:${preset.name}`}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="Manage">
                    <option value="save">Save as Preset…</option>
                    {currentPreset ? (
                      <>
                        <option value="update">{`Update “${currentPreset.name}”`}</option>
                        <option value="delete">{`Delete “${currentPreset.name}”`}</option>
                      </>
                    ) : null}
                  </optgroup>
                </select>
                <PopupChevron />
              </span>
            )}
          </header>

          <div className="batch-rename-modes">
            {/* Radio buttons, as the conflict choice is: Tab lands on the chosen mode, and
                the arrow keys move between them. */}
            <div className="segmented" role="radiogroup" aria-label="How to rename">
              {MODES.map((mode) => (
                <label
                  key={mode.id}
                  className={`segmented-item${settings.mode === mode.id ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={modeGroupName}
                    value={mode.id}
                    checked={settings.mode === mode.id}
                    onChange={() => set("mode", mode.id)}
                  />
                  {mode.label}
                </label>
              ))}
            </div>
          </div>

          <div className="batch-rename-options">
            {settings.mode === "replace" ? (
              <ReplaceOptions settings={settings} set={set} firstFieldRef={firstFieldRef} />
            ) : settings.mode === "add" ? (
              <AddOptions settings={settings} set={set} firstFieldRef={firstFieldRef} />
            ) : settings.mode === "format" ? (
              <FormatOptions settings={settings} set={set} firstFieldRef={firstFieldRef} />
            ) : (
              <CaseOptions settings={settings} set={set} />
            )}
            <div className="batch-rename-grid">
              {settings.mode === "format" ? (
                <>
                  <span className="batch-rename-label">Apply to</span>
                  <span className="batch-rename-note">Names only: extensions are kept</span>
                </>
              ) : (
                <>
                  <Label htmlFor="batch-rename-apply-to">Apply to</Label>
                  <Popup
                    id="batch-rename-apply-to"
                    value={settings.applyTo}
                    onChange={(value) => set("applyTo", value as BatchRenameApplyTo)}
                    options={[
                      ["name", "Name"],
                      ["extension", "Extension"],
                      ["both", "Name and Extension"],
                    ]}
                  />
                </>
              )}
              <Label htmlFor="batch-rename-on-conflict">If a name is taken</Label>
              <Popup
                id="batch-rename-on-conflict"
                value={settings.onConflict}
                onChange={(value) => set("onConflict", value as BatchRenameOnConflict)}
                options={[
                  ["number", "Add a number"],
                  ["skip", "Skip those items"],
                  ["block", "Don’t rename"],
                ]}
              />
              {settings.mode !== "format" && settings.applyTo !== "name" ? (
                <p className="batch-rename-warning batch-rename-wide">
                  Changing an extension can change the app a file opens in.
                </p>
              ) : null}
            </div>
          </div>

          <BatchRenamePreview targets={targets} plan={plan} checking={checking} />

          <footer className="batch-rename-footer">
            <Summary plan={plan} checking={checking} checkError={checkError} />
            <PushButton onClick={onCancel}>Cancel</PushButton>
            <PushButton variant="default" type="submit" disabled={!canRename || savingPreset}>
              {plan.renameCount > 0 && canRename
                ? `Rename ${plan.renameCount.toLocaleString()} ${plan.renameCount === 1 ? "Item" : "Items"}`
                : "Rename"}
            </PushButton>
          </footer>
        </form>
      </dialog>
    </div>
  );
}

type SetSetting = <K extends keyof BatchRenameSettings>(
  key: K,
  value: BatchRenameSettings[K],
) => void;

function ReplaceOptions({
  settings,
  set,
  firstFieldRef,
}: {
  settings: BatchRenameSettings;
  set: SetSetting;
  firstFieldRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="batch-rename-grid">
      <Label htmlFor="batch-rename-find">Find</Label>
      <TextField
        id="batch-rename-find"
        inputRef={firstFieldRef}
        value={settings.find}
        mono={settings.useRegex}
        onChange={(value) => set("find", value)}
      />
      <Label htmlFor="batch-rename-replace">Replace with</Label>
      <TextField
        id="batch-rename-replace"
        value={settings.replaceWith}
        mono={settings.useRegex}
        onChange={(value) => set("replaceWith", value)}
      />
      <span />
      <div className="batch-rename-checks batch-rename-wide">
        <Checkbox
          label="Match case"
          checked={settings.matchCase}
          onChange={(checked) => set("matchCase", checked)}
        />
        <Checkbox
          label="Regular expression"
          checked={settings.useRegex}
          onChange={(checked) => set("useRegex", checked)}
        />
        {settings.useRegex ? (
          <span className="batch-rename-note">
            In Replace with, $1, $2… or $&lt;name&gt; for the groups, $&amp; for the whole match
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AddOptions({
  settings,
  set,
  firstFieldRef,
}: {
  settings: BatchRenameSettings;
  set: SetSetting;
  firstFieldRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="batch-rename-grid">
      <Label htmlFor="batch-rename-add-text">Text</Label>
      <TextField
        id="batch-rename-add-text"
        inputRef={firstFieldRef}
        value={settings.addText}
        onChange={(value) => set("addText", value)}
      />
      <Label htmlFor="batch-rename-add-where">Where</Label>
      <Popup
        id="batch-rename-add-where"
        value={settings.addWhere}
        onChange={(value) => set("addWhere", value as "after" | "before")}
        options={[
          ["after", "after name"],
          ["before", "before name"],
        ]}
      />
    </div>
  );
}

function FormatOptions({
  settings,
  set,
  firstFieldRef,
}: {
  settings: BatchRenameSettings;
  set: SetSetting;
  firstFieldRef: React.RefObject<HTMLInputElement | null>;
}) {
  const customPatternRef = useRef<HTMLInputElement | null>(null);
  const isDate = settings.nameFormat === "date";
  const isCustomDate = isDate && settings.dateFormat === "custom";

  function insertToken(token: string) {
    const field = customPatternRef.current;
    const pattern = settings.customDatePattern;
    const start = field?.selectionStart ?? pattern.length;
    const end = field?.selectionEnd ?? start;
    set("customDatePattern", `${pattern.slice(0, start)}${token}${pattern.slice(end)}`);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  return (
    <div className="batch-rename-grid">
      <Label htmlFor="batch-rename-name-format">Name Format</Label>
      <Popup
        id="batch-rename-name-format"
        value={settings.nameFormat}
        onChange={(value) => set("nameFormat", value as BatchRenameNameFormat)}
        options={[
          ["index", "Name and Index"],
          ["counter", "Name and Counter"],
          ["date", "Name and Date"],
        ]}
      />
      <Label htmlFor="batch-rename-format-where">Where</Label>
      <Popup
        id="batch-rename-format-where"
        value={settings.formatWhere}
        onChange={(value) => set("formatWhere", value as "after" | "before")}
        options={[
          ["after", "after name"],
          ["before", "before name"],
        ]}
      />

      <Label htmlFor="batch-rename-custom-name">Custom Format</Label>
      <TextField
        id="batch-rename-custom-name"
        inputRef={firstFieldRef}
        value={settings.customName}
        disabled={settings.keepNames}
        onChange={(value) => set("customName", value)}
      />
      <span />
      <Checkbox
        label="Keep current names"
        checked={settings.keepNames}
        onChange={(checked) => set("keepNames", checked)}
      />

      {isDate ? (
        <>
          <Label htmlFor="batch-rename-date-source">Date</Label>
          <Popup
            id="batch-rename-date-source"
            value={settings.dateSource}
            onChange={(value) => set("dateSource", value as BatchRenameDateSource)}
            options={[
              ["created", "Date Created"],
              ["modified", "Date Modified"],
              ["taken", "Date Taken"],
              ["today", "Today"],
            ]}
          />
          <Label htmlFor="batch-rename-date-format">Date Format</Label>
          <Popup
            id="batch-rename-date-format"
            value={settings.dateFormat}
            onChange={(value) => set("dateFormat", value as BatchRenameDateFormat)}
            options={[
              ...BATCH_RENAME_DATE_FORMATS.map((format): [string, string] => [
                format.id,
                describeDateFormat(format.id, settings.dateSeparator),
              ]),
              ["custom", "Custom…"],
            ]}
          />
          {isCustomDate ? (
            <>
              <Label htmlFor="batch-rename-date-pattern">Pattern</Label>
              <div className="batch-rename-wide batch-rename-pattern">
                <TextField
                  id="batch-rename-date-pattern"
                  inputRef={customPatternRef}
                  value={settings.customDatePattern}
                  mono
                  onChange={(value) => set("customDatePattern", value)}
                />
                <div className="batch-rename-tokens">
                  <span className="batch-rename-note">Insert</span>
                  {DATE_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      className="batch-rename-token"
                      aria-label={`Insert ${token}`}
                      onClick={() => insertToken(token)}
                    >
                      {token}
                    </button>
                  ))}
                  <span className="batch-rename-note">Anything else is kept as typed</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <Label htmlFor="batch-rename-date-separator">Date Separator</Label>
              <Popup
                id="batch-rename-date-separator"
                value={settings.dateSeparator}
                onChange={(value) => set("dateSeparator", value as BatchRenameDateSeparator)}
                options={[
                  ["-", "Hyphen  -"],
                  ["_", "Underscore  _"],
                  [".", "Dot  ."],
                  [" ", "Space"],
                  ["", "None"],
                ]}
              />
              <span className="batch-rename-wide-pair" />
            </>
          )}
          <span />
          <p className="batch-rename-note batch-rename-wide">
            {`Example: ${formatDate(EXAMPLE_DATE, settings)}`}
          </p>
        </>
      ) : (
        <>
          <Label htmlFor="batch-rename-start">Start numbers at</Label>
          <NumberField
            id="batch-rename-start"
            value={settings.startAt}
            least={0}
            onChange={(value) => set("startAt", value)}
          />
          <Label htmlFor="batch-rename-step">Step</Label>
          <NumberField
            id="batch-rename-step"
            value={settings.step}
            least={1}
            onChange={(value) => set("step", value)}
          />
          {settings.nameFormat === "counter" ? (
            <>
              <Label htmlFor="batch-rename-digits">Digits</Label>
              <Popup
                id="batch-rename-digits"
                value={String(settings.digits)}
                onChange={(value) =>
                  set("digits", value === "auto" ? "auto" : (Number(value) as 2 | 3 | 4 | 5))
                }
                options={[
                  ["auto", "As many as needed"],
                  ["2", "2"],
                  ["3", "3"],
                  ["4", "4"],
                  ["5", "5"],
                ]}
              />
            </>
          ) : null}
        </>
      )}
      <Label htmlFor="batch-rename-separator">Separator</Label>
      <Popup
        id="batch-rename-separator"
        value={settings.separator}
        onChange={(value) => set("separator", value as BatchRenameSeparator)}
        options={[
          [" ", "Space"],
          ["-", "Hyphen  -"],
          ["_", "Underscore  _"],
          ["", "None"],
        ]}
      />
    </div>
  );
}

function CaseOptions({ settings, set }: { settings: BatchRenameSettings; set: SetSetting }) {
  return (
    <div className="batch-rename-grid">
      <Label htmlFor="batch-rename-case">Change to</Label>
      <Popup
        id="batch-rename-case"
        value={settings.caseStyle}
        onChange={(value) => set("caseStyle", value as BatchRenameCase)}
        options={[
          ["lower", "lowercase"],
          ["upper", "UPPERCASE"],
          ["title", "Title Case"],
        ]}
      />
    </div>
  );
}

function BatchRenamePreview({
  targets,
  plan,
  checking,
}: {
  targets: readonly BatchRenameTarget[];
  plan: BatchRenamePlan;
  checking: boolean;
}) {
  const shown = targets.slice(0, PREVIEW_ROW_LIMIT);
  return (
    <div className="batch-rename-preview">
      <div className="batch-rename-preview-head" aria-hidden="true">
        <span />
        <span>Name</span>
        <span />
        <span>New Name</span>
      </div>
      <ul className="batch-rename-rows" aria-label="New names" aria-busy={checking}>
        {shown.map((target, index) => (
          <PreviewRow
            key={target.path}
            target={target}
            planItem={plan.items[index] ?? { status: "unchanged" }}
          />
        ))}
        {targets.length > shown.length ? (
          <li className="batch-rename-row is-more">
            {`and ${(targets.length - shown.length).toLocaleString()} more`}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function PreviewRow({
  target,
  planItem,
}: {
  target: BatchRenameTarget;
  planItem: BatchRenamePlanItem;
}) {
  const note = describeRow(planItem);
  const tone =
    planItem.status === "problem"
      ? planItem.problem.kind === "invalid" || planItem.problem.kind === "taken"
        ? "is-danger"
        : "is-muted"
      : "";
  return (
    <li className={`batch-rename-row ${tone}`} title={target.path}>
      <ItemGlyph isFolder={target.isFolder} />
      <span className="batch-rename-old" title={target.name}>
        {target.name}
      </span>
      <svg className="batch-rename-arrow" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 6h8M7 3l3 3-3 3" />
      </svg>
      <span className="batch-rename-new">
        {planItem.status === "unchanged" ? (
          <span className="batch-rename-unchanged">No change</span>
        ) : (
          <span className="batch-rename-name">
            <Segments segments={planItem.segments} />
          </span>
        )}
        {note ? <span className={`batch-rename-row-note ${note.tone}`}>{note.text}</span> : null}
      </span>
    </li>
  );
}

function describeRow(
  planItem: BatchRenamePlanItem,
): { text: string; tone: "is-danger" | "is-muted" | "is-warning" } | null {
  if (planItem.status === "rename") {
    if (planItem.becomesHidden) {
      return { text: "Starts with “.”: it will be hidden", tone: "is-warning" };
    }
    if (planItem.addedNumber !== null) {
      return { text: "That name is taken: a number was added", tone: "is-muted" };
    }
    if (planItem.usedCreatedForTaken) {
      return { text: "No date taken: the date created is used", tone: "is-muted" };
    }
    return null;
  }
  if (planItem.status === "unchanged") {
    return null;
  }
  const { problem } = planItem;
  switch (problem.kind) {
    case "invalid":
      return { text: problem.message, tone: "is-danger" };
    case "taken":
      return {
        text: problem.byItemInBatch
          ? "Another item here would get this name"
          : "An item in this folder already has this name",
        tone: "is-danger",
      };
    case "skippedTaken":
      return { text: "Left as it is: the name is taken", tone: "is-muted" };
    case "cannotRename":
      return { text: `Left as it is: ${problem.message}`, tone: "is-muted" };
  }
}

function Segments({ segments }: { segments: NameSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments never move; they are rebuilt.
          <mark key={index} className="batch-rename-changed">
            {segment.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments never move; they are rebuilt.
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Summary({
  plan,
  checking,
  checkError,
}: {
  plan: BatchRenamePlan;
  checking: boolean;
  checkError: string | null;
}) {
  let text: ReactNode;
  let danger = false;
  if (checkError) {
    text = checkError;
    danger = true;
  } else if (plan.settingsError) {
    text = plan.settingsError;
    danger = true;
  } else if (checking) {
    text = "Checking names…";
  } else if (plan.blockingCount > 0) {
    text = `${plan.blockingCount.toLocaleString()} ${plan.blockingCount === 1 ? "name" : "names"} to fix before renaming`;
    danger = true;
  } else if (plan.renameCount === 0) {
    text = "Nothing to rename yet";
  } else {
    const parts = [`${plan.renameCount.toLocaleString()} will be renamed`];
    if (plan.skippedCount > 0) {
      parts.push(`${plan.skippedCount.toLocaleString()} left as they are`);
    }
    if (plan.unchangedCount > 0) {
      parts.push(`${plan.unchangedCount.toLocaleString()} unchanged`);
    }
    text = parts.join(" · ");
  }
  return <output className={`batch-rename-summary${danger ? " is-danger" : ""}`}>{text}</output>;
}

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label className="batch-rename-label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

function TextField({
  id,
  value,
  onChange,
  inputRef,
  mono = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      ref={inputRef}
      className={`batch-rename-field${mono ? " is-mono" : ""}`}
      value={value}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      maxLength={255}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function NumberField({
  id,
  value,
  least,
  onChange,
}: {
  id: string;
  value: number;
  least: number;
  onChange: (value: number) => void;
}) {
  // What is typed is kept as typed (it may be empty for a moment); the setting takes the
  // nearest whole number allowed.
  const [draft, setDraft] = useState(String(value));
  // The draft while it says the setting (or is being emptied to type another); the setting
  // when it was changed some other way (a preset loaded).
  const shown = draft === "" || Math.max(least, Number(draft)) === value ? draft : String(value);
  return (
    <input
      id={id}
      className="batch-rename-field is-number"
      inputMode="numeric"
      value={shown}
      onChange={(event) => {
        const text = event.currentTarget.value.replace(/[^\d]/gu, "").slice(0, 9);
        setDraft(text);
        if (text.length > 0) {
          onChange(Math.max(least, Number(text)));
        }
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="batch-rename-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}

function Popup({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <span className="batch-rename-popup">
      <select id={id} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map(([optionValue, label]) => (
          <option key={optionValue} value={optionValue}>
            {label}
          </option>
        ))}
      </select>
      <PopupChevron />
    </span>
  );
}

function PopupChevron() {
  return (
    <svg className="batch-rename-popup-chevron" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 4.75 6 2.25l2.5 2.5M3.5 7.25 6 9.75l2.5-2.5" />
    </svg>
  );
}

function ItemGlyph({ isFolder }: { isFolder: boolean }) {
  return isFolder ? (
    <svg className="batch-rename-glyph" viewBox="0 0 18 18" aria-hidden="true">
      <path
        className="copy-paste-glyph-folder"
        d="M2 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h7a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"
      />
    </svg>
  ) : (
    <svg className="batch-rename-glyph" viewBox="0 0 18 18" aria-hidden="true">
      <path
        className="copy-paste-glyph-file"
        d="M4.5 2h6l3 3v10a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"
      />
      <path className="copy-paste-glyph-file-fold" d="M10.5 2v3h3" />
    </svg>
  );
}
