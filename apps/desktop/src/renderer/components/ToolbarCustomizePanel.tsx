import { type PointerEvent as ReactPointerEvent, type RefObject, useId } from "react";

import { type ToolbarItemId, getToolbarItemDefinition } from "../../shared/toolbarItems";
import { PushButton } from "./PushButton";
import { ToolbarIcon } from "./ToolbarIcon";

// The panel under the toolbar while it is customized, as in Finder: the items that can be
// put in the toolbar, to drag into it or click to add at its far right. An item dragged out
// of the toolbar is let go over the panel (or anywhere away from the toolbar) to remove it;
// the panel says so with a red outline while that would happen.
export function ToolbarCustomizePanel({
  panelRef,
  items,
  draggedItemId,
  removing,
  onItemPointerDown,
  onAddItem,
  onRestoreDefaults,
  restoreDisabled,
  onDone,
}: {
  panelRef?: RefObject<HTMLDialogElement | null>;
  items: readonly ToolbarItemId[];
  // The palette item being dragged, faded where it was.
  draggedItemId: ToolbarItemId | null;
  // True while letting go would take the dragged item off the toolbar.
  removing: boolean;
  onItemPointerDown: (itemId: ToolbarItemId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  // A click (or Return or Space) on an item, not ended by a drag.
  onAddItem: (itemId: ToolbarItemId) => void;
  onRestoreDefaults: () => void;
  restoreDisabled: boolean;
  onDone: () => void;
}) {
  const titleId = useId();
  return (
    <dialog
      ref={panelRef}
      open
      className="toolbar-customize-panel"
      aria-modal="true"
      // Escape is the window's, which ends customizing or a drag that is under way.
      onCancel={(event) => event.preventDefault()}
      aria-labelledby={titleId}
      data-removing={removing || undefined}
      tabIndex={-1}
    >
      <h2 id={titleId} className="toolbar-customize-title">
        Drag items into the toolbar
      </h2>
      <p className="toolbar-customize-note">
        Drag an item out of the toolbar to remove it. Click an item to add it at the far right.
      </p>
      <div className="toolbar-customize-items">
        {items.map((itemId) => {
          const definition = getToolbarItemDefinition(itemId);
          return (
            <button
              key={itemId}
              type="button"
              className="toolbar-customize-item"
              data-toolbar-palette-item={itemId}
              data-dragged={draggedItemId === itemId || undefined}
              aria-label={`Add ${definition.label} to the toolbar`}
              onPointerDown={(event) => onItemPointerDown(itemId, event)}
              onClick={() => onAddItem(itemId)}
            >
              <span className="toolbar-customize-chip" data-item={itemId}>
                <ToolbarIcon name={definition.icon} />
              </span>
              <span className="toolbar-customize-label" aria-hidden="true">
                {definition.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="toolbar-customize-footer">
        <PushButton disabled={restoreDisabled} onClick={onRestoreDefaults}>
          Restore Defaults
        </PushButton>
        <PushButton variant="default" onClick={onDone}>
          Done
        </PushButton>
      </div>
    </dialog>
  );
}
