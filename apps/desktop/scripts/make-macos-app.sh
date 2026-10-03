#!/usr/bin/env bash

set -Eeuo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only supports macOS." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required. Install bun first." >&2
  exit 1
fi

usage() {
  cat <<EOF
Usage: make-macos-app.sh [--notarize | --adhoc]

Builds File Trail.app for Apple Silicon and signs it with the Developer ID Application
certificate.

  --notarize  Also have Apple notarize the app, and make a ZIP and a disk image of it to
              share; the disk image is notarized too, and the tickets are stapled. Other
              Macs open a downloaded app only once it is notarized.
  --adhoc     Sign ad hoc instead, for a build that only runs on this Mac.

The output of the tools each step runs goes to out/make-macos-app.log; the end of it is
shown when a step fails.

Environment:
  MACOS_SIGN_CERT       The Developer ID Application certificate (.cer). Its private key
                        must be in the keychain. Default:
                        ${DEFAULT_SIGN_CERT}
  MACOS_SIGN_IDENTITY   A keychain identity (name or SHA-1) to sign with instead of the
                        certificate file.
  MACOS_NOTARY_PROFILE  The notarytool keychain profile --notarize uses. Default:
                        ${DEFAULT_NOTARY_PROFILE}. Create it once with:
                        xcrun notarytool store-credentials ${DEFAULT_NOTARY_PROFILE} --apple-id <email>
                          --team-id <team ID> (it asks for an app-specific password)
EOF
}

DEFAULT_SIGN_CERT="${HOME}/Documents/Apple Developer Certificates/developerID_application.cer"
DEFAULT_NOTARY_PROFILE="filetrail"
ADHOC=0
NOTARIZE=0
for arg in "$@"; do
  case "${arg}" in
    --adhoc) ADHOC=1 ;;
    --notarize) NOTARIZE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument '${arg}'." >&2; usage >&2; exit 1 ;;
  esac
done
if [[ "${ADHOC}" == 1 && "${NOTARIZE}" == 1 ]]; then
  echo "--adhoc and --notarize do not go together: ad-hoc signed apps cannot be notarized." >&2
  exit 1
fi
NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-${DEFAULT_NOTARY_PROFILE}}"

# File Trail ships for Apple Silicon only. Electron's app template, the native-fs addon and
# the check that the addon loads all come from the build machine, so the build runs on one.
# A shell under Rosetta reports x86_64 here as well.
ARCH="arm64"
if [[ "$(uname -m)" != "${ARCH}" ]]; then
  echo "File Trail builds for Apple Silicon only. Build on an Apple Silicon Mac, outside Rosetta." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

if [[ ! -d "./node_modules/electron/dist/Electron.app" ]]; then
  echo "Missing Electron app template. Run 'bun install' in repository root first." >&2
  exit 1
fi
if [[ "$(lipo -archs ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron)" != "${ARCH}" ]]; then
  echo "The Electron app template is not an ${ARCH} build. Reinstall Electron on this Mac." >&2
  exit 1
fi

# The signing identity is settled before building, so a missing certificate fails in seconds.
if [[ "${ADHOC}" == 1 ]]; then
  SIGN_IDENTITY="-"
  echo "Signing ad hoc: the app runs on this Mac only."
elif [[ -n "${MACOS_SIGN_IDENTITY:-}" ]]; then
  SIGN_IDENTITY="${MACOS_SIGN_IDENTITY}"
  echo "Signing as: ${SIGN_IDENTITY}"
else
  SIGN_CERT="${MACOS_SIGN_CERT:-${DEFAULT_SIGN_CERT}}"
  if [[ ! -f "${SIGN_CERT}" ]]; then
    echo "Signing certificate not found: ${SIGN_CERT}" >&2
    echo "Set MACOS_SIGN_CERT to the Developer ID Application .cer, or pass --adhoc for a build for this Mac only." >&2
    exit 1
  fi
  SIGN_CERT_SUBJECT="$(openssl x509 -inform der -in "${SIGN_CERT}" -noout -subject)"
  if [[ "${SIGN_CERT_SUBJECT}" != *"Developer ID Application:"* ]]; then
    echo "${SIGN_CERT} is not a Developer ID Application certificate:" >&2
    echo "  ${SIGN_CERT_SUBJECT}" >&2
    exit 1
  fi
  if ! openssl x509 -inform der -in "${SIGN_CERT}" -noout -checkend 0 >/dev/null; then
    echo "The certificate in ${SIGN_CERT} has expired." >&2
    exit 1
  fi
  # codesign takes the certificate's SHA-1 as the identity, which picks this certificate even
  # when the keychain holds others with the same name. The private key never leaves the
  # keychain: the .cer only says which identity to use.
  SIGN_IDENTITY="$(openssl x509 -inform der -in "${SIGN_CERT}" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"
  if [[ "$(security find-identity -v -p codesigning)" != *"${SIGN_IDENTITY}"* ]]; then
    if [[ "$(security find-identity -p codesigning)" == *"${SIGN_IDENTITY}"* ]]; then
      echo "The keychain has the Developer ID identity, but macOS does not trust it yet." >&2
      echo "Install Apple's \"Developer ID - G2\" intermediate certificate from" >&2
      echo "https://www.apple.com/certificateauthority/ and run this again." >&2
    else
      echo "The Developer ID identity is not in the keychain." >&2
      echo "Double-click ${SIGN_CERT} to add it to the login keychain. Its private key must be" >&2
      echo "there too: it is made on the Mac that created the certificate signing request." >&2
      echo "On another Mac, import a .p12 exported from that Mac's keychain instead." >&2
    fi
    exit 1
  fi
  SIGN_CERT_NAME="${SIGN_CERT_SUBJECT#*CN=}"
  echo "Signing as: ${SIGN_CERT_NAME%%,*}"
fi

# Each step prints one line: its name, then how it went. The tools a step runs write to the
# log instead, and a failure shows the end of the log.
mkdir -p "${APP_DIR}/out"
LOG_FILE="${APP_DIR}/out/make-macos-app.log"
STEP_COUNT=5
if [[ "${NOTARIZE}" == 1 ]]; then
  STEP_COUNT=8
fi
# shellcheck source=lib/steps.sh
source "${SCRIPT_DIR}/lib/steps.sh"

step "Building macOS icon assets"
run bash ./scripts/build-app-icon.sh
step_done

step "Building the native-fs addon"
NATIVE_FS_DIR="${APP_DIR}/../../packages/native-fs"
run bash -c 'cd "$1" && npx node-gyp rebuild --arch="$2"' _ "${NATIVE_FS_DIR}" "${ARCH}"
if ! run node -e "require('${NATIVE_FS_DIR}')"; then
  fail "The native-fs addon does not load after the build." log
fi
step_done

step "Building the app"
run bun run build
step_done

step "Packaging File Trail.app"
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
  # The template carries Electron's own version; Finder and the About panel read these.
  APP_VERSION="$(node -p "require('./package.json').version")"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "${PLIST}" >/dev/null 2>&1 || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_VERSION}" "${PLIST}" >/dev/null 2>&1 || true
  # Empty Trash asks Finder through osascript. macOS shows this text when it asks the user
  # to allow that; without it, a signed app is refused without being asked.
  /usr/libexec/PlistBuddy -c "Add :NSAppleEventsUsageDescription string File Trail asks Finder to empty the Trash." "${PLIST}" >/dev/null 2>&1 || \
    /usr/libexec/PlistBuddy -c "Set :NSAppleEventsUsageDescription File Trail asks Finder to empty the Trash." "${PLIST}"
fi

# Electron takes an app whose executable is still named "Electron" for a development run:
# `app.isPackaged` is false, and the View menu gets Developer Tools. The executable is
# named after the app instead. The helper apps keep their names; Electron looks for
# "Electron Helper" first.
mv "${APP_BUNDLE}/Contents/MacOS/Electron" "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${APP_NAME}" "${PLIST}"

if [[ -f "${ICON_ICNS}" ]]; then
  cp "${ICON_ICNS}" "${APP_BUNDLE}/Contents/Resources/${APP_SLUG}.icns"
  if [[ -f "${PLIST}" ]]; then
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile ${APP_SLUG}.icns" "${PLIST}" >/dev/null 2>&1 || \
      /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string ${APP_SLUG}.icns" "${PLIST}" >/dev/null 2>&1 || true
  fi
  # The template's own icon is no longer referred to.
  rm -f "${APP_BUNDLE}/Contents/Resources/electron.icns"
fi

# Chromium's license notices ship beside Electron's app, not inside it. The Acknowledgements
# window opens them from here; the other licenses are in dist/assets/licenses.
CHROMIUM_NOTICES="${APP_DIR}/node_modules/electron/dist/LICENSES.chromium.html"
if [[ ! -f "${CHROMIUM_NOTICES}" ]]; then
  fail "Missing Chromium license notices: ${CHROMIUM_NOTICES}"
fi
cp "${CHROMIUM_NOTICES}" "${APP_BUNDLE}/Contents/Resources/LICENSES.chromium.html"

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
  fail "native-fs addon not found — prebuilds/ and build/Release/ both missing."
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
  fail "node-gyp-build not found — required to load native-fs addon."
fi

# The template's files, and so the app itself, are dated 1 January 1980. macOS keeps an
# app's icon by its path and date, so without a new date a rebuilt app that replaces an
# older copy can go on showing the older copy's icon.
touch "${APP_BUNDLE}"
step_done

if [[ "${SIGN_IDENTITY}" != "-" ]]; then
  step "Signing with the Developer ID"
  # Real identity signing with the hardened runtime and a secure timestamp,
  # both of which are required for notarization. Signing is done inside-out
  # (Apple discourages --deep for distribution): standalone bundled binaries
  # first, then framework internals, frameworks, helper apps, and finally the
  # outer bundle. The helper apps and the main executable run V8, whose JIT
  # needs the allow-jit entitlement under the hardened runtime.
  ENTITLEMENTS_PLIST="${SCRIPT_DIR}/entitlements.mac.plist"
  if [[ ! -f "${ENTITLEMENTS_PLIST}" ]]; then
    fail "Missing entitlements plist: ${ENTITLEMENTS_PLIST}"
  fi
  sign() {
    run codesign --force --options runtime --timestamp --sign "${SIGN_IDENTITY}" "$@"
  }
  # Standalone Mach-O binaries under Resources: the native-fs addon and the
  # vendored fd search binary. Notarization rejects unsigned executables.
  while IFS= read -r -d '' binary; do
    sign "${binary}"
  done < <(find "${APP_BUNDLE}/Contents/Resources" -type f \( -name '*.node' -o -name 'fd' \) -print0)
  # Framework-internal libraries and auxiliary executables.
  while IFS= read -r -d '' binary; do
    sign "${binary}"
  done < <(find "${APP_BUNDLE}/Contents/Frameworks" -type f \( -name '*.dylib' -o -name 'chrome_crashpad_handler' -o -name 'ShipIt' \) -print0)
  while IFS= read -r -d '' framework; do
    sign "${framework}"
  done < <(find "${APP_BUNDLE}/Contents/Frameworks" -maxdepth 1 -name '*.framework' -print0)
  while IFS= read -r -d '' helper; do
    sign --entitlements "${ENTITLEMENTS_PLIST}" "${helper}"
  done < <(find "${APP_BUNDLE}/Contents/Frameworks" -maxdepth 1 -name '*Helper*.app' -print0)
  sign --entitlements "${ENTITLEMENTS_PLIST}" "${APP_BUNDLE}"
  run codesign --verify --deep --strict "${APP_BUNDLE}"
  step_done "signed and verified"
else
  # Ad-hoc signing gives the app a valid code signature, which Apple Silicon needs to run
  # it. It grants no privacy access: listing ~/.Trash needs Full Disk Access with any
  # signature, and an ad-hoc grant is lost on the next build because it names this exact
  # build, where a Developer ID grant names the signing identity and survives updates.
  step "Signing ad hoc"
  run codesign --force --deep --sign - "${APP_BUNDLE}"
  step_done
fi

# notarize <file> [<target>]: sends a signed zip or disk image to Apple, waits for the
# result, and staples the ticket to <target> (the file itself when not given).
notarize() {
  local result status id
  RUNNING="notarytool submit $(basename "$1")"
  RUN_LOG_START="$(stat -f %z "${LOG_FILE}")"
  # notarytool's exit status does not say whether Apple accepted the file; the status does.
  result="$(xcrun notarytool submit "$1" --keychain-profile "${NOTARY_PROFILE}" --wait \
    --output-format json 2>>"${LOG_FILE}")" || true
  RUNNING=""
  echo "${result}" >>"${LOG_FILE}"
  status="$(plutil -extract status raw -o - - <<<"${result}" 2>/dev/null)" || status=""
  if [[ -z "${status}" ]]; then
    fail "notarytool could not submit $(basename "$1") with keychain profile '${NOTARY_PROFILE}'." log
  fi
  if [[ "${status}" != "Accepted" ]]; then
    id="$(plutil -extract id raw -o - - <<<"${result}")"
    fail "Apple did not accept $(basename "$1"): ${status}. For the reasons, run:
  xcrun notarytool log ${id} --keychain-profile ${NOTARY_PROFILE}"
  fi
  run xcrun stapler staple "${2:-$1}"
}

if [[ "${NOTARIZE}" == 1 ]]; then
  step "Notarizing the app (a few minutes)"
  NOTARIZE_ZIP="${OUT_DIR}/${APP_SLUG}-${ARCH}-notarize.zip"
  run ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${NOTARIZE_ZIP}"
  notarize "${NOTARIZE_ZIP}" "${APP_BUNDLE}"
  rm -f "${NOTARIZE_ZIP}"
  run spctl --assess --type execute "${APP_BUNDLE}"
  step_done "accepted and stapled"

  # Only a notarized build is shared, so only it gets a ZIP and a disk image.
  step "Building the ZIP and the disk image"
  ZIP_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.zip"
  DMG_PATH="${OUT_DIR}/${APP_SLUG}-${ARCH}.dmg"
  run ditto -c -k --sequesterRsrc --keepParent "${APP_BUNDLE}" "${ZIP_PATH}"
  run hdiutil create -volname "${APP_NAME}" -srcfolder "${APP_BUNDLE}" -ov -format UDZO "${DMG_PATH}"
  # Gatekeeper checks a downloaded disk image before it looks at the app inside.
  run codesign --force --timestamp --sign "${SIGN_IDENTITY}" "${DMG_PATH}"
  step_done

  step "Notarizing the disk image (a few minutes)"
  notarize "${DMG_PATH}"
  run spctl --assess --type open --context context:primary-signature "${DMG_PATH}"
  step_done "accepted and stapled"
fi

echo
if [[ "${NOTARIZE}" == 1 ]]; then
  echo "Built, signed and notarized: ready to share."
elif [[ "${SIGN_IDENTITY}" != "-" ]]; then
  echo "Built and signed, not notarized: other Macs will not open it from a download."
  echo "Use 'bun run desktop:make:mac:notarized' for a build to share."
else
  echo "Built and signed ad hoc: for this Mac only."
fi
echo "  ${APP_BUNDLE}"
if [[ "${NOTARIZE}" == 1 ]]; then
  echo "  ${ZIP_PATH}"
  echo "  ${DMG_PATH}"
fi
