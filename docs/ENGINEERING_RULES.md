# File Trail Engineering Rules

## TypeScript

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `noFallthroughCasesInSwitch` stay enabled.
- Prefer explicit DTO types at IPC boundaries over inferred structural objects leaking through the app.

## Module Organization

- One primary export per module by default.
- Keep Node-only filesystem logic inside `packages/core`.
- The renderer imports desktop-safe helpers only through `@filetrail/contracts` and the preload bridge.

## Error Handling And Logging

- Expected navigation races use latest-request-wins guards instead of user-visible errors.
- Filesystem and IPC failures should surface as inline state in the relevant pane.
- Notifications are for information only: something finished, something was put on the clipboard, or a command did nothing and why ("Clipboard is empty"). They disappear by themselves and can be turned off, so nothing the user must see may depend on one.
- An action the user started that failed, or only partly worked, is reported in a modal dialog, never in a notification. The notification code has no error kind for this reason; do not add one.
- Debug and timing logs are opt-in and namespaced; uncaught operational failures should log with context.

## Testing

- Most tests should target mocked filesystem or mocked preload clients.
- Real filesystem tests should use temporary fixtures and cover only the boundary behavior that mocks cannot prove.
- Keep `bun run test` light on the disk: test disk images are sparse, and a test that writes large files (tens of MB or more) runs only with `canRunLargeFileTests`, in `bun run test:release` and `bun run ci`.
- Make test disks with `mountTestDiskImage`: each is a clone of a blank disk made once and kept in `node_modules/.cache/filetrail-test-disks`, so a disk costs milliseconds instead of a second.
- Don't wait for real time in tests: move a fake clock past a debounce, poll or delay (`vi.useFakeTimers({ shouldAdvanceTime: true })` and `vi.advanceTimersByTimeAsync`), or make the delay short where the tests mock it (the progress card's, in the App tests).
- Keep test files small enough to run side by side: one file runs on one worker, so a file that takes far longer than the rest sets the time of the whole run. The App tests share their mocks and harness through `apps/desktop/src/renderer/test/appMocks.tsx` and `appHarness.tsx`.
- Renderer tests should verify state transitions and visible behavior, not implementation details.

## File Operations

- A file-operation finding is fixed only when it clears the bar in `docs/FILE_OPERATION_RISKS.md`; cases below it go on that file's list of accepted risks instead of into the code.

## Avoid

- Cross-platform abstraction layers.
- Unvalidated IPC payloads.
- Synchronous heavy filesystem work in Electron main.
- Preloading large directory trees for convenience.
- Giant shared contexts that force broad rerenders for frequently changing explorer state.
