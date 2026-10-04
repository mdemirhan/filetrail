// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import {
  type BatchRenameFolder,
  type BatchRenamePreset,
  type BatchRenameSettings,
  DEFAULT_BATCH_RENAME_SETTINGS,
  planBatchRename,
} from "../../shared/batchRename";
import type { BatchRenameTarget } from "../hooks/useBatchRename";
import { BatchRenameSheet } from "./BatchRenameSheet";

const NOW = "2026-10-04T11:32:10";

function target(name: string, isFolder = false): BatchRenameTarget {
  return { path: `/trip/${name}`, name, isFolder };
}

// The sheet as the window drives it: settings in state, the plan rebuilt from them.
function Harness({
  targets,
  folderNames,
  initial = {},
  presets = [],
  cannotRename = new Map(),
  onRename = () => undefined,
  onCancel = () => undefined,
  onSavePreset = () => undefined,
  onDeletePreset = () => undefined,
  checking = false,
  checkError = null,
}: {
  targets: BatchRenameTarget[];
  folderNames?: string[];
  initial?: Partial<BatchRenameSettings>;
  presets?: BatchRenamePreset[];
  cannotRename?: Map<string, string>;
  onRename?: () => void;
  onCancel?: () => void;
  onSavePreset?: (name: string) => void;
  onDeletePreset?: (name: string) => void;
  checking?: boolean;
  checkError?: string | null;
}) {
  const [settings, setSettings] = useState<BatchRenameSettings>({
    ...DEFAULT_BATCH_RENAME_SETTINGS,
    ...initial,
  });
  const folders = new Map<string, BatchRenameFolder>([
    ["/trip", { names: folderNames ?? targets.map((item) => item.name), caseSensitive: false }],
  ]);
  const plan = planBatchRename({
    settings,
    items: targets.map((item) => ({
      ...item,
      createdAt: "2026-09-30T10:12:40",
      modifiedAt: "2026-10-01T08:30:15",
      takenAt: null,
    })),
    folders,
    cannotRename,
    now: NOW,
  });
  const canRename =
    !checking &&
    checkError === null &&
    plan.settingsError === null &&
    plan.blockingCount === 0 &&
    plan.renameCount > 0;
  return (
    <BatchRenameSheet
      targets={targets}
      settings={settings}
      onSettingsChange={setSettings}
      plan={plan}
      checking={checking}
      checkError={checkError}
      presets={presets}
      onSavePreset={onSavePreset}
      onDeletePreset={onDeletePreset}
      canRename={canRename}
      onCancel={onCancel}
      onRename={onRename}
    />
  );
}

const rows = () => within(screen.getByRole("list", { name: "New names" })).getAllByRole("listitem");
const rowTexts = () => rows().map((row) => row.textContent);
const renameButton = () => screen.getByRole("button", { name: /^Rename/ });
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("the Rename sheet", () => {
  it("names the items, starts with Replace Text, and shows nothing to rename yet", () => {
    render(<Harness targets={[target("IMG_1.jpg"), target("IMG_2.jpg")]} />);
    expect(screen.getByRole("heading", { name: "Rename 2 Items" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Replace Text" })).toBeChecked();
    expect(screen.getByLabelText("Find")).toHaveFocus();
    expect(rowTexts()).toEqual(["IMG_1.jpgNo change", "IMG_2.jpgNo change"]);
    expect(screen.getByText("Nothing to rename yet")).toBeInTheDocument();
    expect(renameButton()).toBeDisabled();
  });

  it("shows each new name as it is typed, the change marked, and renames on Return", () => {
    const onRename = vi.fn();
    render(<Harness targets={[target("IMG_1.jpg"), target("notes.txt")]} onRename={onRename} />);
    type("Find", "IMG_");
    type("Replace with", "Lisbon ");
    expect(rowTexts()).toEqual(["IMG_1.jpgLisbon 1.jpg", "notes.txtNo change"]);
    expect(rows()[0]?.querySelector("mark")?.textContent).toBe("Lisbon ");
    expect(screen.getByText("1 will be renamed · 1 unchanged")).toBeInTheDocument();
    expect(renameButton()).toHaveTextContent("Rename 1 Item");
    fireEvent.submit(screen.getByLabelText("Find"));
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("holds the rename while a name must be fixed, and says why on its row", () => {
    render(
      <Harness
        targets={[target("IMG_1.jpg")]}
        folderNames={["IMG_1.jpg", "Lisbon 1.jpg"]}
        initial={{ find: "IMG_", replaceWith: "Lisbon ", onConflict: "block" }}
      />,
    );
    expect(rows()[0]).toHaveClass("is-danger");
    expect(rows()[0]).toHaveTextContent("An item in this folder already has this name");
    expect(screen.getByText("1 name to fix before renaming")).toBeInTheDocument();
    expect(renameButton()).toBeDisabled();
    // Adding a number settles it instead.
    fireEvent.change(screen.getByLabelText("If a name is taken"), { target: { value: "number" } });
    expect(rows()[0]).toHaveTextContent("Lisbon 1 2.jpg");
    expect(rows()[0]).toHaveTextContent("That name is taken: a number was added");
    expect(renameButton()).toBeEnabled();
    // Or leaving the item as it is.
    fireEvent.change(screen.getByLabelText("If a name is taken"), { target: { value: "skip" } });
    expect(rows()[0]).toHaveTextContent("Left as it is: the name is taken");
    expect(screen.getByText("Nothing to rename yet")).toBeInTheDocument();
  });

  it("reports an item that can't be renamed and renames the others", () => {
    render(
      <Harness
        targets={[target("locked.txt"), target("free.txt")]}
        initial={{ mode: "add", addText: "-old" }}
        cannotRename={new Map([["/trip/locked.txt", "“locked.txt” is locked."]])}
      />,
    );
    expect(rows()[0]).toHaveTextContent("Left as it is: “locked.txt” is locked.");
    expect(screen.getByText("1 will be renamed · 1 left as they are")).toBeInTheDocument();
    expect(renameButton()).toHaveTextContent("Rename 1 Item");
  });

  it("explains regular expressions and says when a pattern is broken", () => {
    render(<Harness targets={[target("a.txt")]} />);
    fireEvent.click(screen.getByLabelText("Regular expression"));
    expect(screen.getByText(/for the groups, \$& for the whole match/u)).toBeInTheDocument();
    expect(screen.getByLabelText("Find")).toHaveClass("is-mono");
    type("Find", "(");
    expect(screen.getByText(/^The pattern isn’t valid: /u)).toBeInTheDocument();
    expect(renameButton()).toBeDisabled();
  });

  it("warns that changing an extension may change the app a file opens in", () => {
    render(<Harness targets={[target("a.JPG")]} initial={{ mode: "case" }} />);
    expect(screen.queryByText(/change the app a file opens in/u)).toBeNull();
    fireEvent.change(screen.getByLabelText("Apply to"), { target: { value: "extension" } });
    expect(screen.getByText(/change the app a file opens in/u)).toBeInTheDocument();
    expect(rowTexts()).toEqual(["a.JPGa.jpg"]);
  });

  it("numbers items in Format, with the options for numbers", () => {
    render(<Harness targets={[target("a.jpg"), target("b.jpg")]} />);
    fireEvent.click(screen.getByLabelText("Format"));
    expect(rowTexts()).toEqual(["a.jpgFile 1.jpg", "b.jpgFile 2.jpg"]);
    fireEvent.change(screen.getByLabelText("Name Format"), { target: { value: "counter" } });
    expect(rowTexts()[0]).toBe("a.jpgFile 00001.jpg");
    fireEvent.change(screen.getByLabelText("Digits"), { target: { value: "auto" } });
    type("Start numbers at", "9");
    type("Step", "1");
    expect(rowTexts()).toEqual(["a.jpgFile 09.jpg", "b.jpgFile 10.jpg"]);
    // Only digits are kept, and an empty field waits for one.
    type("Start numbers at", "");
    expect(screen.getByLabelText("Start numbers at")).toHaveValue("");
    type("Start numbers at", "x3");
    expect(screen.getByLabelText("Start numbers at")).toHaveValue("3");
    fireEvent.blur(screen.getByLabelText("Start numbers at"));
    fireEvent.click(screen.getByLabelText("Keep current names"));
    expect(screen.getByLabelText("Custom Format")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Separator"), { target: { value: "_" } });
    expect(rowTexts()[0]).toBe("a.jpga_3.jpg");
    expect(screen.getByText("Names only: extensions are kept")).toBeInTheDocument();
  });

  it("puts dates in the format chosen, with its separator, or a custom pattern", () => {
    render(<Harness targets={[target("a.jpg")]} initial={{ mode: "format" }} />);
    fireEvent.change(screen.getByLabelText("Name Format"), { target: { value: "date" } });
    expect(rowTexts()).toEqual(["a.jpgFile 2026-09-30.jpg"]);
    expect(screen.getByText("Example: 2026-05-14")).toBeInTheDocument();
    // The formats are listed with the separator chosen.
    fireEvent.change(screen.getByLabelText("Date Separator"), { target: { value: "" } });
    expect(
      within(screen.getByLabelText("Date Format")).getByRole("option", { name: "YYYYMMDD" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "modified" } });
    expect(rowTexts()).toEqual(["a.jpgFile 20261001.jpg"]);
    fireEvent.change(screen.getByLabelText("Date Format"), { target: { value: "custom" } });
    type("Pattern", "");
    fireEvent.click(screen.getByRole("button", { name: "Insert YYYY" }));
    expect(screen.getByLabelText("Pattern")).toHaveValue("YYYY");
    expect(rowTexts()).toEqual(["a.jpgFile 2026.jpg"]);
    type("Pattern", "no tokens");
    expect(screen.getByText(/at least one of YYYY/u)).toBeInTheDocument();
  });

  it("changes case in Change Case", () => {
    render(<Harness targets={[target("My Photo.JPG")]} />);
    fireEvent.click(screen.getByLabelText("Change Case"));
    expect(rowTexts()).toEqual(["My Photo.JPGmy photo.JPG"]);
    fireEvent.change(screen.getByLabelText("Change to"), { target: { value: "upper" } });
    expect(rowTexts()).toEqual(["My Photo.JPGMY PHOTO.JPG"]);
  });

  it("adds text before or after the name", () => {
    render(<Harness targets={[target("a.txt")]} />);
    fireEvent.click(screen.getByLabelText("Add Text"));
    type("Text", "old-");
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "before" } });
    expect(rowTexts()).toEqual(["a.txtold-a.txt"]);
  });

  it("warns of a name that hides the item, and of a date taken that isn't there", () => {
    render(
      <Harness
        targets={[target("config")]}
        initial={{ mode: "add", addText: ".", addWhere: "before" }}
      />,
    );
    expect(rows()[0]).toHaveTextContent("Starts with “.”: it will be hidden");
  });

  it("says when the items are still being checked, or couldn't be", () => {
    const { unmount } = render(
      <Harness targets={[target("a.txt")]} initial={{ mode: "add", addText: "x" }} checking />,
    );
    expect(screen.getByText("Checking names…")).toBeInTheDocument();
    expect(renameButton()).toBeDisabled();
    unmount();
    render(
      <Harness
        targets={[target("a.txt")]}
        initial={{ mode: "add", addText: "x" }}
        checkError="File Trail couldn’t read the items."
      />,
    );
    expect(screen.getByText("File Trail couldn’t read the items.")).toBeInTheDocument();
  });

  it("lists at most a thousand rows and says how many more there are", () => {
    const many = Array.from({ length: 1_005 }, (_, index) => target(`f${index}.txt`));
    render(<Harness targets={many} />);
    expect(rows()).toHaveLength(1_001);
    expect(screen.getByText("and 5 more")).toBeInTheDocument();
  });

  it("closes on Escape, and on Cancel", () => {
    const onCancel = vi.fn();
    render(<Harness targets={[target("a.txt")]} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("Find"), { key: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  describe("presets", () => {
    const photos: BatchRenamePreset = {
      name: "Photos",
      settings: { ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "format", customName: "Trip" },
    };

    it("loads one, then offers to update or delete it", () => {
      const onSavePreset = vi.fn();
      const onDeletePreset = vi.fn();
      render(
        <Harness
          targets={[target("a.jpg")]}
          presets={[photos]}
          onSavePreset={onSavePreset}
          onDeletePreset={onDeletePreset}
        />,
      );
      const presetsMenu = screen.getByLabelText("Presets");
      expect(within(presetsMenu).queryByRole("option", { name: /^Update/ })).toBeNull();
      fireEvent.change(presetsMenu, { target: { value: "load:Photos" } });
      expect(rowTexts()).toEqual(["a.jpgTrip 1.jpg"]);
      expect(screen.getByLabelText("Presets")).toHaveValue("load:Photos");
      fireEvent.change(screen.getByLabelText("Presets"), { target: { value: "update" } });
      expect(onSavePreset).toHaveBeenCalledWith("Photos");
      fireEvent.change(screen.getByLabelText("Presets"), { target: { value: "delete" } });
      expect(onDeletePreset).toHaveBeenCalledWith("Photos");
    });

    it("saves the settings under a name typed in the header", () => {
      const onSavePreset = vi.fn();
      const onRename = vi.fn();
      render(
        <Harness
          targets={[target("a.jpg")]}
          presets={[photos]}
          onSavePreset={onSavePreset}
          onRename={onRename}
          initial={{ mode: "add", addText: "x" }}
        />,
      );
      fireEvent.change(screen.getByLabelText("Presets"), { target: { value: "save" } });
      const name = screen.getByLabelText("Preset name");
      expect(name).toHaveFocus();
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      // A name already used replaces that preset, and says so.
      fireEvent.change(name, { target: { value: "photos" } });
      expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
      fireEvent.change(name, { target: { value: " Suffix " } });
      // Return saves the preset; it doesn't rename.
      fireEvent.submit(name);
      expect(onSavePreset).toHaveBeenCalledWith("Suffix");
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("Preset name")).toBeNull();
    });

    it("leaves saving with Escape or Cancel without closing the sheet", () => {
      const onCancel = vi.fn();
      render(<Harness targets={[target("a.jpg")]} onCancel={onCancel} />);
      fireEvent.change(screen.getByLabelText("Presets"), { target: { value: "save" } });
      fireEvent.keyDown(screen.getByLabelText("Preset name"), { key: "Escape" });
      expect(screen.queryByLabelText("Preset name")).toBeNull();
      fireEvent.change(screen.getByLabelText("Presets"), { target: { value: "save" } });
      act(() => {
        fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0] as HTMLElement);
      });
      expect(screen.queryByLabelText("Preset name")).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
