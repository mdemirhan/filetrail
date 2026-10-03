import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { useKeepInViewport } from "../hooks/useKeepInViewport";
import { MenuCheck } from "./MenuCheck";

export type PathbarFolder = { path: string; name: string };

// A folder with more subfolders than this lists the ones around the ticked folder and says
// how many are left out; the path bar's menu is for stepping sideways, not for browsing
// thousands of folders.
export const PATHBAR_FOLDER_MENU_LIMIT = 300;

// A separator of the path bar. Clicking it lists the folders inside the folder to its left,
// with the one the path goes through ticked, so a neighbouring folder is one click away.
const MENU_LOADING_DELAY_MS = 300;

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
  // The row the arrow keys are on. The keyboard focus itself stays in the file list, so
  // nothing has to be given back when the menu closes.
  const [activeIndex, setActiveIndex] = useState(-1);
  const open = menu !== null;
  const folders = menu?.folders ?? null;
  // The folders usually arrive at once: the menu then opens with them, rather than as a
  // "Loading…" line that is replaced a moment later. A slow folder shows the line.
  const waiting = open && folders === null && !menu?.failed;
  const showLoading = useDelayedFlag(waiting, MENU_LOADING_DELAY_MS);
  const menuShown = open && (!waiting || showLoading);
  useKeepInViewport(menuRef, menuShown);

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

  const { shownFolders, hiddenBefore, hiddenAfter } = limitFolders(folders ?? [], activePath);
  const shownFoldersRef = useRef(shownFolders);
  shownFoldersRef.current = shownFolders;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const chooseRef = useRef<(folder: PathbarFolder) => void>(() => undefined);
  chooseRef.current = (folder) => {
    close();
    if (folder.path !== activePath) {
      onNavigatePath(folder.path);
    }
  };

  // The arrow keys start on the ticked folder, which starts in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the list arrives; it reads the list as it then is.
  useLayoutEffect(() => {
    if (!folders) {
      return;
    }
    const tickedIndex = shownFoldersRef.current.findIndex((folder) => folder.path === activePath);
    setActiveIndex(tickedIndex >= 0 ? tickedIndex : 0);
    menuRef.current
      ?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?.scrollIntoView?.({ block: "center" });
  }, [folders]);

  useLayoutEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    menuRef.current
      ?.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
      [activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

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
    // While the menu is open the keyboard belongs to it: the keys are taken here, before
    // the file list's shortcuts see them.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        closeMenu();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const items = shownFoldersRef.current;
      const current = activeIndexRef.current;
      if (event.key === "Escape" || event.key === "Tab") {
        closeMenu();
        return;
      }
      if (items.length === 0) {
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(Math.max(0, Math.min(items.length - 1, current + step)));
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        setActiveIndex(event.key === "Home" ? 0 : items.length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        const folder = items[current];
        if (folder) {
          chooseRef.current(folder);
        }
        return;
      }
      // A letter jumps to the next folder starting with it, as in any macOS menu.
      if (event.key.length === 1) {
        const letter = event.key.toLocaleLowerCase();
        const startsWithLetter = (folder: PathbarFolder) =>
          folder.name.toLocaleLowerCase().startsWith(letter);
        const after = items.findIndex(
          (folder, index) => index > current && startsWithLetter(folder),
        );
        const next = after >= 0 ? after : items.findIndex(startsWithLetter);
        if (next >= 0) {
          setActiveIndex(next);
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
      {menu && menuShown
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
                <div className="pathbar-folder-menu-note">Can’t Read This Folder</div>
              ) : folders.length === 0 ? (
                <div className="pathbar-folder-menu-note">No Folders</div>
              ) : (
                <>
                  {hiddenBefore > 0 ? (
                    <div className="pathbar-folder-menu-note">
                      {formatHiddenFolders(hiddenBefore)} above
                    </div>
                  ) : null}
                  {shownFolders.map((folder, index) => {
                    const checked = folder.path === activePath;
                    return (
                      <button
                        key={folder.path}
                        type="button"
                        className={`toolbar-menu-item${index === activeIndex ? " active" : ""}`}
                        role="menuitemradio"
                        aria-checked={checked}
                        aria-current={index === activeIndex ? "true" : undefined}
                        tabIndex={-1}
                        title={folder.path}
                        // The menu never takes the keyboard focus (see `activeIndex`).
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setActiveIndex(index)}
                        onClick={() => chooseRef.current(folder)}
                      >
                        <MenuCheck checked={checked} />
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
