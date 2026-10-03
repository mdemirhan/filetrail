#!/usr/bin/env bash

set -Eeuo pipefail

usage() {
  cat <<EOF
Usage: start.sh [--verbose] [<app arguments>]

Builds File Trail from source and starts it.

Each build step prints one line, and the tools it runs write to out/start.log; the end of
the log is shown when a step fails. Once File Trail starts, what it prints shows here.

  --verbose  Also show everything the build tools print.

Other arguments go to the app, such as --folder <path> or --user-data-dir=<path>.
EOF
}

VERBOSE=0
APP_ARGS=()
while (($# > 0)); do
  case "$1" in
    --verbose) VERBOSE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) APP_ARGS+=("$1") ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
NATIVE_FS_DIR="${APP_DIR}/../../packages/native-fs"

cd "${APP_DIR}"

if [[ "${VERBOSE}" == 1 ]]; then
  bash ./scripts/build-app-icon.sh
  (cd "${NATIVE_FS_DIR}" && npx node-gyp rebuild)
  bun run build
else
  mkdir -p "${APP_DIR}/out"
  LOG_FILE="${APP_DIR}/out/start.log"
  STEP_COUNT=3
  # shellcheck source=lib/steps.sh
  source "${SCRIPT_DIR}/lib/steps.sh"

  step "Building macOS icon assets"
  run bash ./scripts/build-app-icon.sh
  step_done

  step "Building the native-fs addon"
  run bash -c 'cd "$1" && npx node-gyp rebuild' _ "${NATIVE_FS_DIR}"
  if ! run node -e "require('${NATIVE_FS_DIR}')"; then
    fail "The native-fs addon does not load after the build." log
  fi
  step_done

  step "Building the app"
  run bun run build
  step_done
fi

# Electron runs without its node_modules/.bin launcher, which reports Control-C as
# "exited with signal SIGINT" and fails the script.
ELECTRON="$(node -p "require('electron')")"
echo "Starting File Trail"
trap - ERR
# Control-C stops File Trail; the script then ends as quietly as when File Trail quits.
trap ':' INT
status=0
"${ELECTRON}" . ${APP_ARGS[@]+"${APP_ARGS[@]}"} || status=$?
case "${status}" in
  0 | 130 | 143) exit 0 ;;
esac
echo "File Trail exited with status ${status}." >&2
exit "${status}"
