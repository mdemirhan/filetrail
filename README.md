# File Trail

File Trail is a macOS desktop file explorer built with Electron, React, TypeScript, and Bun.

At a high level, the project is focused on a native-feeling file browsing experience on macOS while
keeping the codebase in a modern web-style desktop stack. The repository is structured as a small
workspace: the desktop app lives under `apps/desktop`, and shared contracts/core filesystem logic
live under `packages/*`.

## Development

### Requirements

- macOS
- [Bun](https://bun.sh/)

### Install dependencies

```bash
bun install
```

### Run the desktop app locally

```bash
bun run desktop:start
```

This builds the desktop app, prepares the icon assets, and launches Electron.

### Useful local commands

```bash
bun run typecheck
bun run test
bun run lint
```

### Package the macOS app

```bash
bun run desktop:make:mac
```

This creates a macOS app bundle plus distributables under `apps/desktop/out`.

## Project layout

```text
apps/desktop   Electron main/preload/renderer code and packaging scripts
packages/*     Shared contracts and core filesystem/explorer logic
```
