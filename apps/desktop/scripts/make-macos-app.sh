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

echo "[1/6] Building macOS icon assets..."
bash ./scripts/build-app-icon.sh

echo "[2/6] Building native-fs addon for ${ARCH}..."
NATIVE_FS_DIR="${APP_DIR}/../../packages/native-fs"
(cd "${NATIVE_FS_DIR}" && npx node-gyp rebuild --arch="${ARCH}")
# Verify the addon loads correctly — only when building for the host arch,
# since the running node process cannot dlopen a cross-arch .node binary.
HOST_ARCH="$(uname -m)"
case "${HOST_ARCH}" in x86_64) HOST_ARCH="x64" ;; aarch64) HOST_ARCH="arm64" ;; esac
if [[ "${ARCH}" == "${HOST_ARCH}" ]]; then
  node -e "require('${NATIVE_FS_DIR}')" || {
    echo "native-fs addon failed to load after build." >&2
    exit 1
  }
else
  echo "  Skipping runtime verification (cross-arch build: host=${HOST_ARCH}, target=${ARCH})"
fi

echo "[3/6] Building app bundles..."
bun run build

echo "[4/6] Packaging macOS app for ${ARCH}..."
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

# Copy native-fs addon into the app bundle. The addon provides copyfile(3)
# with CoW clones and full metadata preservation. Required on macOS.
NATIVE_FS_SRC="${APP_DIR}/node_modules/@filetrail/native-fs"
NATIVE_FS_DST="${RESOURCES_APP}/node_modules/@filetrail/native-fs"
mkdir -p "${NATIVE_FS_DST}"
cp "${NATIVE_FS_SRC}/package.json" "${NATIVE_FS_DST}/package.json"
cp "${NATIVE_FS_SRC}/index.js" "${NATIVE_FS_DST}/index.js"
# Copy prebuilds if they exist, otherwise copy the node-gyp build output
if [[ -d "${NATIVE_FS_SRC}/prebuilds" ]]; then
  ditto "${NATIVE_FS_SRC}/prebuilds" "${NATIVE_FS_DST}/prebuilds"
elif [[ -d "${NATIVE_FS_SRC}/build/Release" ]]; then
  mkdir -p "${NATIVE_FS_DST}/build/Release"
  cp "${NATIVE_FS_SRC}/build/Release/native-fs.node" "${NATIVE_FS_DST}/build/Release/native-fs.node"
else
  echo "native-fs addon not found — prebuilds/ and build/Release/ both missing." >&2
  exit 1
fi
# node-gyp-build loader must be available at runtime
if [[ -d "${NATIVE_FS_SRC}/node_modules/node-gyp-build" ]]; then
  mkdir -p "${NATIVE_FS_DST}/node_modules"
  ditto "${NATIVE_FS_SRC}/node_modules/node-gyp-build" \
        "${NATIVE_FS_DST}/node_modules/node-gyp-build"
elif [[ -d "${APP_DIR}/node_modules/node-gyp-build" ]]; then
  mkdir -p "${RESOURCES_APP}/node_modules/node-gyp-build"
  ditto "${APP_DIR}/node_modules/node-gyp-build" \
        "${RESOURCES_APP}/node_modules/node-gyp-build"
else
  echo "node-gyp-build not found — required to load native-fs addon." >&2
  exit 1
fi

echo "[5/6] Ad-hoc code signing..."
# Ad-hoc signing gives the app a valid code signature so macOS does not block
# filesystem access to protected paths (e.g. ~/.Trash) for unsigned apps.
codesign --force --deep --sign - "${APP_BUNDLE}"

echo "[6/6] Building distributables..."
ZIP_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.zip"
DMG_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.dmg"

ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${ZIP_PATH}"
hdiutil create -volname "${APP_NAME}" -srcfolder "${APP_BUNDLE}" -ov -format UDZO "${DMG_PATH}" >/dev/null

echo "Done. Open artifacts in:"
echo "  ${APP_DIR}/out"
