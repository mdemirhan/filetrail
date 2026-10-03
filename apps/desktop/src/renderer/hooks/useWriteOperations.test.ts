import { describe, expect, it } from "vitest";

import { createToastEntry } from "../lib/toasts";
import {
  INITIAL_WRITE_OPERATIONS_STATE,
  type WriteOperationsState,
  writeOperationsReducer,
} from "./useWriteOperations";

describe("writeOperationsReducer", () => {
  it("patches a single field with a direct value", () => {
    const next = writeOperationsReducer(INITIAL_WRITE_OPERATIONS_STATE, {
      key: "actionNotice",
      value: { title: "Blocked", message: "Wait for the current write to finish." },
    });
    expect(next.actionNotice).toEqual({
      title: "Blocked",
      message: "Wait for the current write to finish.",
    });
    expect(next.toasts).toBe(INITIAL_WRITE_OPERATIONS_STATE.toasts);
    expect(INITIAL_WRITE_OPERATIONS_STATE.actionNotice).toBeNull();
  });

  it("supports functional updaters like useState setters", () => {
    const toast = createToastEntry("toast-1", { kind: "success", title: "Copied" });
    const withToast = writeOperationsReducer(INITIAL_WRITE_OPERATIONS_STATE, {
      key: "toasts",
      value: (current) => [...current, toast],
    });
    expect(withToast.toasts).toEqual([toast]);
    const cleared = writeOperationsReducer(withToast, {
      key: "toasts",
      value: (current) => current.filter((entry) => entry.id !== toast.id),
    });
    expect(cleared.toasts).toEqual([]);
  });

  it("returns the same state object when the value is unchanged", () => {
    const state: WriteOperationsState = {
      ...INITIAL_WRITE_OPERATIONS_STATE,
      renameDialogState: {
        sourcePath: "/tmp/a",
        currentName: "a",
        error: null,
        refusalCount: 0,
        inline: false,
        sessionId: 1,
      },
    };
    expect(
      writeOperationsReducer(state, {
        key: "renameDialogState",
        value: state.renameDialogState,
      }),
    ).toBe(state);
    expect(
      writeOperationsReducer(state, {
        key: "moveDialogState",
        value: (current) => current,
      }),
    ).toBe(state);
  });
});
