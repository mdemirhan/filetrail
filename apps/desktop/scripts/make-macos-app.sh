#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install bun first." >&2
  exit 1
fi

ARCH_INPUT="${1:-$(uname -m)}"
case "${ARCH_INPUT}" in
  x64|arm64)
    ARCH="${ARCH_INPUT}"
    ;;
  x86_64)
    ARCH="x64"
    ;;
  aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported arch '${ARCH_INPUT}'. Use x64 or arm64." >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

if [[ ! -d "./node_modules/electron/dist/Electron.app" ]]; then
  echo "Missing Electron app template. Run 'bun install' in repository root first." >&2
  exit 1
fi

echo "[1/4] Building macOS icon assets..."
bash ./scripts/build-app-icon.sh

echo "[2/4] Building app bundles..."
bun run build

echo "[3/4] Packaging macOS app for ${ARCH}..."
APP_NAME="File Trail"
APP_SLUG="FileTrail"
OUT_DIR="${APP_DIR}/out/${APP_SLUG}-darwin-${ARCH}"
APP_BUNDLE="${OUT_DIR}/${APP_NAME}.app"
ELECTRON_APP="${APP_DIR}/node_modules/electron/dist/Electron.app"
RESOURCES_APP="${APP_BUNDLE}/Contents/Resources/app"
ICON_ICNS="${APP_DIR}/assets/icons/build/filetrail.icns"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

ditto "${ELECTRON_APP}" "${APP_BUNDLE}"

PLIST="${APP_BUNDLE}/Contents/Info.plist"
if [[ -f "${PLIST}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "${PLIST}" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "${PLIST}" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.filetrail.desktop" "${PLIST}" >/dev/null 2>&1 || true
fi

if [[ -f "${ICON_ICNS}" ]]; then
  cp "${ICON_ICNS}" "${APP_BUNDLE}/Contents/Resources/${APP_SLUG}.icns"
  if [[ -f "${PLIST}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile ${APP_SLUG}.icns" "${PLIST}" >/dev/null 2>&1 || \
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string ${APP_SLUG}.icns" "${PLIST}" >/dev/null 2>&1 || true
  fi
fi

mkdir -p "${RESOURCES_APP}"
cp "${APP_DIR}/package.json" "${RESOURCES_APP}/package.json"
ditto "${APP_DIR}/dist" "${RESOURCES_APP}/dist"

echo "[4/4] Building distributables..."
ZIP_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.zip"
DMG_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.dmg"

ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${ZIP_PATH}"
hdiutil create -volname "${APP_NAME}" -srcfolder "${APP_BUNDLE}" -ov -format UDZO "${DMG_PATH}" >/dev/null

echo "Done. Open artifacts in:"
echo "  ${APP_DIR}/out"
