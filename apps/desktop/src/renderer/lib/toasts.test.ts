import { createToastEntry, enqueueToast } from "./toasts";

describe("toasts", () => {
  it("drops the oldest visible toast when a fourth toast is queued", () => {
    const first = createToastEntry("toast-1", { kind: "info", title: "First" }, 0);
    const second = createToastEntry("toast-2", { kind: "info", title: "Second" }, 0);
    const third = createToastEntry("toast-3", { kind: "info", title: "Third" }, 0);
    const fourth = createToastEntry("toast-4", { kind: "info", title: "Fourth" }, 0);

    const queued = enqueueToast(enqueueToast(enqueueToast([first], second), third), fourth);

    expect(queued.map((toast) => toast.id)).toEqual(["toast-2", "toast-3", "toast-4"]);
  });
});
