import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useKeepInViewport } from "../hooks/useKeepInViewport";
import {
  type ClipboardItem,
  type ClipboardSummary,
  groupClipboardItemsByFolder,
} from "../lib/copyPasteClipboard";
import { FileIcon } from "../lib/fileIcons";
import { placeDropdownMenu } from "../lib/menuPlacement";
import { useShortcutDisplay } from "../state/shortcutDisplayContext";
import { ToolbarIcon } from "./ToolbarIcon";

// Every row of the list is this tall (see `.clipboard-menu-row`), so the rows on screen can
// be worked out from how far the list is scrolled: a clipboard may hold thousands of items,
// and only the ones in view are drawn.
export const CLIPBOARD_MENU_ROW_HEIGHT = 24;
const CLIPBOARD_MENU_VISIBLE_ROWS = 10;
const CLIPBOARD_MENU_OVERSCAN_ROWS = 4;

type ClipboardMenuRow =
  | { type: "heading"; label: string; parentPath: string }
  | { type: "item"; item: ClipboardItem; itemIndex: number };

// The toolbar's clipboard button, there while files or folders are waiting to be pasted. It
// says how many, and clicking it lists them under the folders they came from: an item can be
// shown in its folder or taken off the clipboard, and the clipboard can be emptied.
export function ClipboardButton({
  summary,
  open,
  onOpenChange,
  onRevealItem,
  onRemoveItem,
  onClear,
}: {
  summary: ClipboardSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRevealItem: (path: string) => void;
  onRemoveItem: (path: string) => void;
  onClear: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<ReturnType<typeof placeDropdownMenu> | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // The row the arrow keys are on: an item, or Clear Clipboard after the last of them. The
  // keyboard focus itself stays where it was, so nothing has to be given back on closing.
  const [activeIndex, setActiveIndex] = useState(-1);
  const shortcutDisplay = useShortcutDisplay();
  const pasteShortcut = shortcutDisplay.label("paste");
  useKeepInViewport(menuRef, open && menuStyle !== null);

  const { items } = summary;
  const rows = useMemo(() => {
    const result: ClipboardMenuRow[] = [];
    let itemIndex = 0;
    for (const group of groupClipboardItemsByFolder(items)) {
      result.push({ type: "heading", label: group.label, parentPath: group.parentPath });
      for (const item of group.items) {
        result.push({ type: "item", item, itemIndex });
        itemIndex += 1;
      }
    }
    return result;
  }, [items]);
  // In the order the list shows them, which is the order the arrow keys go through.
  const orderedItems = useMemo(
    () => rows.flatMap((row) => (row.type === "item" ? [row.item] : [])),
    [rows],
  );
  const clearIndex = orderedItems.length;

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        setMenuStyle(placeDropdownMenu({ anchor: rect, viewportWidth: window.innerWidth }));
      }
    };
    place();
    setActiveIndex(-1);
    setScrollTop(0);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Keeps the arrow keys' row in view.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list || activeIndex < 0 || activeIndex >= clearIndex) {
      return;
    }
    const rowIndex = rows.findIndex((row) => row.type === "item" && row.itemIndex === activeIndex);
    if (rowIndex < 0) {
      return;
    }
    // The heading pinned over the top of the list covers one row.
    const top = (rowIndex - 1) * CLIPBOARD_MENU_ROW_HEIGHT;
    const bottom = (rowIndex + 1) * CLIPBOARD_MENU_ROW_HEIGHT;
    if (top < list.scrollTop) {
      list.scrollTop = Math.max(0, top);
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [activeIndex, clearIndex, open, rows]);

  const stateRef = useRef({ orderedItems, activeIndex, clearIndex });
  stateRef.current = { orderedItems, activeIndex, clearIndex };
  const actionsRef = useRef({ onOpenChange, onRevealItem, onRemoveItem, onClear });
  actionsRef.current = { onOpenChange, onRevealItem, onRemoveItem, onClear };

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = () => actionsRef.current.onOpenChange(false);
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (menuRef.current?.contains(target) || buttonRef.current?.contains(target))
      ) {
        return;
      }
      close();
    };
    // While the list is open the keyboard belongs to it: the keys are taken here, before
    // the file list's shortcuts see them.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        close();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const state = stateRef.current;
      if (event.key === "Escape" || event.key === "Tab") {
        close();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(Math.max(0, Math.min(state.clearIndex, state.activeIndex + step)));
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        setActiveIndex(event.key === "Home" ? 0 : state.clearIndex);
        return;
      }
      const activeItem = state.orderedItems[state.activeIndex];
      if (event.key === "Enter" || event.key === " ") {
        if (state.activeIndex === state.clearIndex) {
          actionsRef.current.onClear();
        } else if (activeItem) {
          close();
          actionsRef.current.onRevealItem(activeItem.path);
        }
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && activeItem) {
        // The row keeps its place: the next item moves up under the keys.
        actionsRef.current.onRemoveItem(activeItem.path);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  const firstVisibleRow = Math.max(
    0,
    Math.min(rows.length - 1, Math.floor(scrollTop / CLIPBOARD_MENU_ROW_HEIGHT)),
  );
  const startRow = Math.max(0, firstVisibleRow - CLIPBOARD_MENU_OVERSCAN_ROWS);
  const endRow = Math.min(
    rows.length,
    firstVisibleRow + CLIPBOARD_MENU_VISIBLE_ROWS + CLIPBOARD_MENU_OVERSCAN_ROWS,
  );
  // The folder of whatever is at the top of the list, kept in view while its items scroll.
  const pinnedHeading = findHeading(rows, firstVisibleRow);
  const cut = summary.mode === "cut";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`tb-btn tb-btn-icon clipboard-button${open ? " active" : ""}`}
        title={summary.label}
        aria-label={`Clipboard: ${summary.countLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <ToolbarIcon name={cut ? "cut" : "copy"} />
        <span className="clipboard-button-count">{summary.count.toLocaleString("en-US")}</span>
      </button>
      {open && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              className="toolbar-menu clipboard-menu"
              role="menu"
              aria-label="Clipboard"
              style={menuStyle}
            >
              <div className="clipboard-menu-header">
                <span className="clipboard-menu-title">{summary.countLabel}</span>
                <span className="clipboard-menu-hint">
                  {pasteShortcut ? `Paste with ${pasteShortcut}` : "Ready to paste"}
                </span>
              </div>
              {summary.breakdown ? (
                <div className="clipboard-menu-breakdown">{summary.breakdown}</div>
              ) : null}
              <hr className="toolbar-menu-separator" />
              <div className="clipboard-menu-list-shell">
                <div
                  ref={listRef}
                  // A list long enough to scroll keeps its remove buttons clear of the scrollbar.
                  className={`clipboard-menu-list${
                    rows.length > CLIPBOARD_MENU_VISIBLE_ROWS ? " clipboard-menu-list-scrolls" : ""
                  }`}
                  style={{
                    maxHeight: `${CLIPBOARD_MENU_VISIBLE_ROWS * CLIPBOARD_MENU_ROW_HEIGHT}px`,
                  }}
                  onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                >
                  <div
                    style={{
                      paddingTop: `${startRow * CLIPBOARD_MENU_ROW_HEIGHT}px`,
                      paddingBottom: `${(rows.length - endRow) * CLIPBOARD_MENU_ROW_HEIGHT}px`,
                    }}
                  >
                    {rows.slice(startRow, endRow).map((row) =>
                      row.type === "heading" ? (
                        <div
                          key={`heading:${row.parentPath}`}
                          className="toolbar-menu-heading clipboard-menu-row clipboard-menu-heading"
                          title={row.parentPath}
                        >
                          {row.label}
                        </div>
                      ) : (
                        <div
                          key={row.item.path}
                          className={`toolbar-menu-item clipboard-menu-row clipboard-menu-item${
                            row.itemIndex === activeIndex ? " active" : ""
                          }`}
                          onMouseMove={() => setActiveIndex(row.itemIndex)}
                        >
                          <button
                            type="button"
                            className="clipboard-menu-item-main"
                            role="menuitem"
                            aria-current={row.itemIndex === activeIndex ? "true" : undefined}
                            tabIndex={-1}
                            title={row.item.path}
                            // The list never takes the keyboard focus (see `activeIndex`).
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onOpenChange(false);
                              onRevealItem(row.item.path);
                            }}
                          >
                            <FileIcon entry={row.item.entry} />
                            <span className="clipboard-menu-item-name">{row.item.name}</span>
                          </button>
                          <button
                            type="button"
                            className="clipboard-menu-item-remove"
                            aria-label={`Remove ${row.item.name} from the clipboard`}
                            title="Remove from Clipboard"
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => onRemoveItem(row.item.path)}
                          >
                            <ToolbarIcon name="close" />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                {pinnedHeading ? (
                  <div
                    className="toolbar-menu-heading clipboard-menu-row clipboard-menu-heading clipboard-menu-pinned-heading"
                    title={pinnedHeading.parentPath}
                    aria-hidden="true"
                  >
                    {pinnedHeading.label}
                  </div>
                ) : null}
              </div>
              <hr className="toolbar-menu-separator" />
              <button
                type="button"
                className={`toolbar-menu-item clipboard-menu-clear${
                  activeIndex === clearIndex ? " active" : ""
                }`}
                role="menuitem"
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActiveIndex(clearIndex)}
                onClick={onClear}
              >
                <span className="toolbar-menu-label">Clear Clipboard</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function findHeading(
  rows: ClipboardMenuRow[],
  fromIndex: number,
): Extract<ClipboardMenuRow, { type: "heading" }> | null {
  for (let index = Math.min(fromIndex, rows.length - 1); index >= 0; index -= 1) {
    const row = rows[index];
    if (row?.type === "heading") {
      return row;
    }
  }
  return null;
}
