import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import { createEarlyWriteOperationEvents } from "./earlyWriteOperationEvents";

function progress(
  operationId: string,
  status: WriteOperationProgressEvent["status"],
  completedItemCount = 0,
): WriteOperationProgressEvent {
  return {
    operationId,
    action: "paste",
    status,
    completedItemCount,
    totalItemCount: 100_000,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    result: null,
  };
}

// A start request whose reply the test sends.
function startRequest() {
  let reply: (operationId: string) => void = () => undefined;
  let refuse: (error: Error) => void = () => undefined;
  const response = new Promise<string>((resolveReply, rejectReply) => {
    reply = resolveReply;
    refuse = rejectReply;
  });
  return { send: () => response, reply, refuse };
}

describe("createEarlyWriteOperationEvents", () => {
  it("keeps nothing of other windows' operations while this window starts none", () => {
    const early = createEarlyWriteOperationEvents();

    for (let count = 0; count < 1_000; count += 1) {
      early.note(progress("other-op", "running", count));
    }
    early.note(progress("other-op", "completed", 1_000));

    expect(early.size()).toBe(0);
    expect(early.take("other-op")).toEqual([]);
  });

  it("keeps the newest progress and the end of an operation while a start waits", async () => {
    const early = createEarlyWriteOperationEvents();
    const request = startRequest();
    const started = early.whileStarting(request.send);

    early.note(progress("op-1", "queued"));
    for (let count = 0; count < 1_000; count += 1) {
      early.note(progress("op-1", "running", count));
    }
    early.note(progress("op-1", "completed", 1_000));
    expect(early.size()).toBe(2);
    request.reply("op-1");

    expect(early.take(await started)).toEqual([
      progress("op-1", "running", 999),
      progress("op-1", "completed", 1_000),
    ]);
    expect(early.size()).toBe(0);
  });

  it("keeps only the newest few operations", async () => {
    const early = createEarlyWriteOperationEvents();
    const request = startRequest();
    const started = early.whileStarting(request.send);

    for (let index = 1; index <= 10; index += 1) {
      early.note(progress(`op-${index}`, "running"));
      early.note(progress(`op-${index}`, "completed"));
    }
    expect(early.size()).toBe(8);
    request.reply("op-10");

    expect(early.take(await started)).toEqual([
      progress("op-10", "running"),
      progress("op-10", "completed"),
    ]);
    expect(early.take("op-7")).toEqual([]);
  });

  it("lets go of what it kept when the start is refused", async () => {
    const early = createEarlyWriteOperationEvents();
    const request = startRequest();
    const started = early.whileStarting(request.send);
    early.note(progress("other-op", "running"));

    request.refuse(new Error("Another write operation is already running."));

    await expect(started).rejects.toThrow("Another write operation is already running.");
    expect(early.size()).toBe(0);
  });

  it("forgets an operation it heard of in another way", async () => {
    const early = createEarlyWriteOperationEvents();
    const request = startRequest();
    void early.whileStarting(request.send);
    early.note(progress("op-1", "running"));
    early.note(progress("op-2", "running"));

    early.forget("op-1");

    expect(early.size()).toBe(1);
    request.reply("op-2");
  });
});
