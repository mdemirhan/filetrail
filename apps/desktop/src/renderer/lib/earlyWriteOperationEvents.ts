import type { WriteOperationProgressEvent } from "@filetrail/contracts";

// Only the latest few operations can be the one a start request is waiting for.
const MAX_OPERATIONS = 4;

// The events of an operation this window may have started but doesn't know the id of yet:
// one that reports progress, or even finishes, before its start request returns. They are
// kept only while a start request is waiting, since an idle window hears every operation
// other windows run, and none of those is its own. Of each operation only its newest
// progress and its end are kept: what the window shows once it knows the id.
export function createEarlyWriteOperationEvents() {
  const kept = new Map<
    string,
    { latest: WriteOperationProgressEvent | null; end: WriteOperationProgressEvent | null }
  >();
  let startsWaiting = 0;

  return {
    // Sends a request that starts an operation, keeping events meanwhile. When it fails,
    // nothing kept can be its operation's.
    async whileStarting<T>(start: () => Promise<T>): Promise<T> {
      startsWaiting += 1;
      let started = false;
      try {
        const response = await start();
        started = true;
        return response;
      } finally {
        startsWaiting -= 1;
        if (!started && startsWaiting === 0) {
          kept.clear();
        }
      }
    },
    // An event of an operation whose id this window doesn't know.
    note(event: WriteOperationProgressEvent): void {
      if (startsWaiting === 0) {
        return;
      }
      const events = kept.get(event.operationId) ?? { latest: null, end: null };
      if (isTerminal(event.status)) {
        events.end = event;
      } else {
        events.latest = event;
      }
      kept.set(event.operationId, events);
      while (kept.size > MAX_OPERATIONS) {
        kept.delete(kept.keys().next().value as string);
      }
    },
    // What was kept of the operation this window has just learned it started, in the order
    // it happened; everything else kept was another window's.
    take(operationId: string): WriteOperationProgressEvent[] {
      const events = kept.get(operationId);
      kept.clear();
      return [events?.latest ?? null, events?.end ?? null].filter(
        (event): event is WriteOperationProgressEvent => event !== null,
      );
    },
    // An operation this window has heard of in another way (it took it over).
    forget(operationId: string): void {
      kept.delete(operationId);
    },
    // How many events are kept, for tests.
    size(): number {
      let count = 0;
      for (const events of kept.values()) {
        count += (events.latest ? 1 : 0) + (events.end ? 1 : 0);
      }
      return count;
    },
  };
}

function isTerminal(status: WriteOperationProgressEvent["status"]): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "partial"
  );
}
