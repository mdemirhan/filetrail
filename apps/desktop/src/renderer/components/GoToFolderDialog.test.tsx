// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import type { Place } from "../lib/places";
import { GoToFolderDialog } from "./GoToFolderDialog";

const HOME = "/Users/demo";

function place(path: string, name: string, score: number, options: Partial<Place> = {}): Place {
  return {
    path,
    name,
    displayPath: path.replace(HOME, "~"),
    isFavorite: false,
    isVisited: true,
    score,
    ...options,
  };
}

const PLACES: Place[] = [
  place("/Users/demo/src/filetrail", "filetrail", 9),
  place("/Users/demo/Downloads", "Downloads", 4, { isFavorite: true }),
  place("/Users/demo/src/render-farm", "render-farm", 2),
  place("/Users/demo/Desktop", "Desktop", 0, { isFavorite: true, isVisited: false }),
];

const NO_SUGGESTIONS = async () => ({ inputPath: "", basePath: null, suggestions: [] });

function renderDialog(props: Partial<ComponentProps<typeof GoToFolderDialog>> = {}) {
  return render(
    <GoToFolderDialog
      open
      currentPath="/Users/demo"
      places={PLACES}
      submitting={false}
      error={null}
      onClose={() => undefined}
      onSubmit={() => undefined}
      onRequestPathSuggestions={NO_SUGGESTIONS}
      {...props}
    />,
  );
}

const input = () => screen.getByLabelText("Folder name or path") as HTMLInputElement;
const rowNames = () =>
  Array.from(document.querySelectorAll(".go-to-folder-suggestion-name"), (row) => row.textContent);
const selectedName = () =>
  document.querySelector(".go-to-folder-suggestion.is-selected .go-to-folder-suggestion-name")
    ?.textContent ?? null;

describe("GoToFolderDialog", () => {
  it("opens empty, lists the folders in use and goes to the top one with Return", () => {
    const handleSubmit = vi.fn();
    renderDialog({ onSubmit: handleSubmit });

    expect(input()).toHaveFocus();
    expect(input().value).toBe("");
    expect(screen.getByText("Recent and favorite folders")).toBeInTheDocument();
    expect(rowNames()).toEqual(["filetrail", "Downloads", "render-farm", "Desktop"]);
    expect(selectedName()).toBe("filetrail");
    // Each row says where the folder is, with the home folder shown as "~".
    expect(screen.getAllByText("~/src")).toHaveLength(2);
    expect(screen.getAllByText("~")).toHaveLength(2);

    fireEvent.submit(document.getElementById("go-to-folder-form") as HTMLFormElement);
    expect(handleSubmit).toHaveBeenCalledWith("/Users/demo/src/filetrail");
  });

  it("finds a folder from a few letters, marks them, and opens the one chosen", () => {
    const handleSubmit = vi.fn();
    renderDialog({ onSubmit: handleSubmit });

    fireEvent.change(input(), { target: { value: "d" } });
    // Names starting with the text come first, the more used before the less; then a name
    // that only contains it. "filetrail" has no "d", and the "demo" of the home folder in
    // its path does not count.
    expect(rowNames()).toEqual(["Downloads", "Desktop", "render-farm"]);
    expect(selectedName()).toBe("Downloads");
    expect(screen.getByText("3 matches")).toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll(".go-to-folder-match"), (mark) => mark.textContent),
    ).toEqual(["D", "D", "d"]);

    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedName()).toBe("Desktop");
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    // The selection stops at the last folder.
    expect(selectedName()).toBe("render-farm");
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(selectedName()).toBe("Downloads");

    // Clicking a folder goes there at once.
    fireEvent.click(screen.getByTitle("/Users/demo/Desktop"));
    expect(handleSubmit).toHaveBeenCalledWith("/Users/demo/Desktop");

    fireEvent.change(input(), { target: { value: "zzz" } });
    expect(rowNames()).toEqual([]);
    expect(screen.getByText(/No folder you have opened has that name/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("forgets the selected folder with ⌘⌫, but not a favorite that was never opened", () => {
    const handleForget = vi.fn();
    renderDialog({ onForgetPlace: handleForget });

    fireEvent.keyDown(input(), { key: "Backspace", metaKey: true });
    expect(handleForget).toHaveBeenCalledWith("/Users/demo/src/filetrail");

    handleForget.mockClear();
    fireEvent.change(input(), { target: { value: "desk" } });
    expect(selectedName()).toBe("Desktop");
    fireEvent.keyDown(input(), { key: "Backspace", metaKey: true });
    expect(handleForget).not.toHaveBeenCalled();
  });

  it("completes a path folder by folder when the text starts with / or ~", async () => {
    vi.useFakeTimers();
    const handleSubmit = vi.fn();
    const handleRequestPathSuggestions = vi.fn(async (inputPath: string) => ({
      inputPath,
      basePath: "/Users",
      suggestions: inputPath.endsWith("/")
        ? [{ name: "src", path: "/Users/demo/src", isDirectory: true }]
        : [
            { name: "demo", path: "/Users/demo", isDirectory: true },
            { name: "desktop", path: "/Users/desktop", isDirectory: true },
          ],
    }));
    renderDialog({
      onSubmit: handleSubmit,
      onRequestPathSuggestions: handleRequestPathSuggestions,
    });
    const settle = async () => {
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      await act(async () => {});
    };

    // A name does not ask the disk for anything.
    fireEvent.change(input(), { target: { value: "de" } });
    await settle();
    expect(handleRequestPathSuggestions).not.toHaveBeenCalledWith("de");

    fireEvent.change(input(), { target: { value: "/Users/de" } });
    // The opened folders are not offered for a path.
    expect(rowNames()).toEqual([]);
    await settle();
    expect(handleRequestPathSuggestions).toHaveBeenLastCalledWith("/Users/de");
    expect(rowNames()).toEqual(["demo", "desktop"]);
    expect(screen.getByText("2 matches")).toBeInTheDocument();
    // Nothing is selected until ↓, so Return opens the path as typed.
    expect(selectedName()).toBeNull();

    // Tab completes with the first folder and moves on to what is inside it.
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(input().value).toBe("/Users/demo/");
    await settle();
    expect(rowNames()).toEqual(["src"]);

    // ↓ and Return put the selected folder into the field; Return again opens it.
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(selectedName()).toBe("src");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(input().value).toBe("/Users/demo/src");
    expect(handleSubmit).not.toHaveBeenCalled();
    fireEvent.submit(document.getElementById("go-to-folder-form") as HTMLFormElement);
    expect(handleSubmit).toHaveBeenCalledWith("/Users/demo/src");
    vi.useRealTimers();
  });

  it("opens a typed path without choosing a completion", () => {
    const handleSubmit = vi.fn();
    renderDialog({ onSubmit: handleSubmit });

    fireEvent.change(input(), { target: { value: " ~/Documents " } });
    fireEvent.submit(document.getElementById("go-to-folder-form") as HTMLFormElement);
    expect(handleSubmit).toHaveBeenCalledWith("~/Documents");
  });

  it("refocuses the input when reopened and starts empty again", () => {
    const view = renderDialog();
    fireEvent.change(input(), { target: { value: "down" } });
    const props = {
      currentPath: "/Users/demo",
      places: PLACES,
      submitting: false,
      error: null,
      onClose: () => undefined,
      onSubmit: () => undefined,
      onRequestPathSuggestions: NO_SUGGESTIONS,
    };
    view.rerender(<GoToFolderDialog open={false} {...props} />);
    expect(screen.queryByLabelText("Folder name or path")).toBeNull();
    view.rerender(<GoToFolderDialog open {...props} />);
    expect(input()).toHaveFocus();
    expect(input().value).toBe("");
  });

  it("reclaims focus when it escapes outside the dialog", async () => {
    vi.useFakeTimers();
    render(
      <>
        <button type="button">Outside</button>
        <GoToFolderDialog
          open
          currentPath="/Users/demo"
          places={PLACES}
          submitting={false}
          error={null}
          onClose={() => undefined}
          onSubmit={() => undefined}
          onRequestPathSuggestions={NO_SUGGESTIONS}
        />
      </>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Outside" }).focus();
      vi.advanceTimersByTime(20);
    });
    expect(input()).toHaveFocus();
    vi.useRealTimers();
  });

  it("clears the text with the ✕ and says how to type a path when there is nothing to list", () => {
    renderDialog({ places: [] });
    expect(screen.getByText(/Folders you open are listed here/u)).toBeInTheDocument();

    fireEvent.change(input(), { target: { value: "/nowhere" } });
    expect(screen.getByText("No folders match this path")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(input().value).toBe("");
    expect(screen.getByText(/Folders you open are listed here/u)).toBeInTheDocument();
  });

  it("closes on escape and shows an error from the last attempt", () => {
    const handleClose = vi.fn();
    renderDialog({ onClose: handleClose, error: "That folder no longer exists." });

    expect(screen.getByText("That folder no longer exists.")).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("is the Move To box too, where Return never acts on a folder nobody chose", async () => {
    const handleSubmit = vi.fn();
    const handleBrowse = vi.fn().mockResolvedValue("/Users/demo/Picked");
    renderDialog({
      title: "Move To",
      inputAriaLabel: "Destination folder",
      submitLabel: "Move",
      selectFirstPlace: false,
      onBrowse: handleBrowse,
      onSubmit: handleSubmit,
    });
    const field = screen.getByLabelText("Destination folder") as HTMLInputElement;
    const form = document.getElementById("go-to-folder-form") as HTMLFormElement;

    expect(screen.getByRole("dialog", { name: "Move To" })).toBeInTheDocument();
    // The folders in use are offered, but none is selected yet.
    expect(rowNames()).toEqual(["filetrail", "Downloads", "render-farm", "Desktop"]);
    expect(selectedName()).toBeNull();
    expect(screen.getByRole("button", { name: "Move" })).toBeDisabled();
    fireEvent.submit(form);
    expect(handleSubmit).not.toHaveBeenCalled();

    // Typing chooses the best match, and Return then moves there.
    fireEvent.change(field, { target: { value: "down" } });
    expect(selectedName()).toBe("Downloads");
    fireEvent.submit(form);
    expect(handleSubmit).toHaveBeenCalledWith("/Users/demo/Downloads");

    // Choose… puts the picked folder into the field as a path.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Choose…" }));
    });
    expect(handleBrowse).toHaveBeenCalledWith("/Users/demo");
    expect(field.value).toBe("/Users/demo/Picked");
    fireEvent.submit(form);
    expect(handleSubmit).toHaveBeenLastCalledWith("/Users/demo/Picked");
  });
});
