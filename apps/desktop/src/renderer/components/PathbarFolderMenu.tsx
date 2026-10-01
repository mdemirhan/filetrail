import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useKeepInViewport } from "../hooks/useKeepInViewport";

export type PathbarFolder = { path: string; name: string };

// A folder with more subfolders than this lists the ones around the ticked folder and says
// how many are left out; the path bar's menu is for stepping sideways, not for browsing
// thousands of folders.
export const PATHBAR_FOLDER_MENU_LIMIT = 300;

// A separator of the path bar. Clicking it lists the folders inside the folder to its left,
// with the one the path goes through ticked, so a neighbouring folder is one click away.
export function PathbarFolderMenu({
  parentPath,
  parentLabel,
  activePath,
  onRequestFolders,
  onNavigatePath,
}: {
  /** The folder whose subfolders are listed: the path bar segment left of the separator. */
  parentPath: string;
  parentLabel: string;
  /** The subfolder the path goes through, ticked in the list. */
  activePath: string;
  onRequestFolders: (path: string) => Promise<PathbarFolder[]>;
  onNavigatePath: (path: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef(0);
  const [menu, setMenu] = useState<{
    left: number;
    bottom: number;
    folders: PathbarFolder[] | null;
    failed: boolean;
  } | null>(null);
  const open = menu !== null;
  const folders = menu?.folders ?? null;
  useKeepInViewport(menuRef, open);

  function close() {
    requestRef.current += 1;
    setMenu(null);
  }

  function toggle() {
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    // The path bar sits at the foot of the window, so its menus open upward.
    const position = { left: rect.left - 6, bottom: window.innerHeight - rect.top + 6 };
    const requestId = ++requestRef.current;
    setMenu({ ...position, folders: null, failed: false });
    onRequestFolders(parentPath).then(
      (result) => {
        if (requestRef.current === requestId) {
          setMenu({ ...position, folders: result, failed: false });
        }
      },
      () => {
        if (requestRef.current === requestId) {
          setMenu({ ...position, folders: [], failed: true });
        }
      },
    );
  }

  // Leaving the folder closes the menu, and so does whatever closes any other menu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closes when the path changes under it.
  useEffect(() => {
    requestRef.current += 1;
    setMenu(null);
  }, [parentPath, activePath]);

  // The ticked folder starts in view and has the keyboard.
  useLayoutEffect(() => {
    if (!folders) {
      return;
    }
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const active = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const target = active ?? items?.[0];
    target?.scrollIntoView?.({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [folders]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const closeMenu = () => {
      requestRef.current += 1;
      setMenu(null);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || buttonRef.current?.contains(target))
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [],
      );
      const focusedIndex = items.indexOf(document.activeElement as HTMLElement);
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.key === "Escape") {
        consume();
        closeMenu();
        buttonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        closeMenu();
        return;
      }
      if (items.length === 0) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        consume();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex =
          focusedIndex === -1
            ? step === 1
              ? 0
              : items.length - 1
            : Math.max(0, Math.min(items.length - 1, focusedIndex + step));
        items[nextIndex]?.focus();
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        consume();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus();
        return;
      }
      // A letter jumps to the next folder starting with it, as in any macOS menu.
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const letter = event.key.toLocaleLowerCase();
        const startsWithLetter = (item: HTMLElement) =>
          (item.textContent ?? "").trim().toLocaleLowerCase().startsWith(letter);
        const next =
          items.slice(focusedIndex + 1).find(startsWithLetter) ?? items.find(startsWithLetter);
        if (next) {
          consume();
          next.focus();
        }
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [open]);

  const { shownFolders, hiddenBefore, hiddenAfter } = limitFolders(folders ?? [], activePath);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`pathbar-separator pathbar-separator-button${open ? " active" : ""}`}
        aria-label={`Folders in ${parentLabel}`}
        title={`Folders in ${parentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        // A double-click on the path bar edits the path; not from here.
        onDoubleClick={(event) => event.stopPropagation()}
      >
        ›
      </button>
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu pathbar-folder-menu"
              role="menu"
              aria-label={`Folders in ${parentLabel}`}
              style={{
                position: "fixed",
                left: `${menu.left}px`,
                bottom: `${menu.bottom}px`,
                top: "auto",
                right: "auto",
              }}
            >
              {folders === null ? (
                <div className="pathbar-folder-menu-note">Loading…</div>
              ) : menu.failed ? (
                <div className="pathbar-folder-menu-note">This folder could not be read.</div>
              ) : folders.length === 0 ? (
                <div className="pathbar-folder-menu-note">No folders</div>
              ) : (
                <>
                  {hiddenBefore > 0 ? (
                    <div className="pathbar-folder-menu-note">
                      {formatHiddenFolders(hiddenBefore)} above
                    </div>
                  ) : null}
                  {shownFolders.map((folder) => {
                    const checked = folder.path === activePath;
                    return (
                      <button
                        key={folder.path}
                        type="button"
                        className="toolbar-menu-item"
                        role="menuitemradio"
                        aria-checked={checked}
                        tabIndex={-1}
                        title={folder.path}
                        onClick={() => {
                          close();
                          if (!checked) {
                            onNavigatePath(folder.path);
                          }
                        }}
                      >
                        <span className="toolbar-menu-check" aria-hidden="true">
                          {checked ? "✓" : ""}
                        </span>
                        <span className="toolbar-menu-label">{folder.name}</span>
                      </button>
                    );
                  })}
                  {hiddenAfter > 0 ? (
                    <div className="pathbar-folder-menu-note">
                      {formatHiddenFolders(hiddenAfter)} below
                    </div>
                  ) : null}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function limitFolders(folders: PathbarFolder[], activePath: string) {
  if (folders.length <= PATHBAR_FOLDER_MENU_LIMIT) {
    return { shownFolders: folders, hiddenBefore: 0, hiddenAfter: 0 };
  }
  const activeIndex = Math.max(
    0,
    folders.findIndex((folder) => folder.path === activePath),
  );
  const start = Math.max(
    0,
    Math.min(
      folders.length - PATHBAR_FOLDER_MENU_LIMIT,
      activeIndex - Math.floor(PATHBAR_FOLDER_MENU_LIMIT / 2),
    ),
  );
  return {
    shownFolders: folders.slice(start, start + PATHBAR_FOLDER_MENU_LIMIT),
    hiddenBefore: start,
    hiddenAfter: folders.length - start - PATHBAR_FOLDER_MENU_LIMIT,
  };
}

function formatHiddenFolders(count: number): string {
  return `${count} more ${count === 1 ? "folder" : "folders"}`;
}
