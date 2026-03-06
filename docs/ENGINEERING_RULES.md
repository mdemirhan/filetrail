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
- Debug and timing logs are opt-in and namespaced; uncaught operational failures should log with context.

## Testing

- Most tests should target mocked filesystem or mocked preload clients.
- Real filesystem tests should use temporary fixtures and cover only the boundary behavior that mocks cannot prove.
- Renderer tests should verify state transitions and visible behavior, not implementation details.

## Avoid

- Cross-platform abstraction layers.
- Unvalidated IPC payloads.
- Synchronous heavy filesystem work in Electron main.
- Preloading large directory trees for convenience.
- Giant shared contexts that force broad rerenders for frequently changing explorer state.
