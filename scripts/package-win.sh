#!/usr/bin/env bash
# Build a slim Windows x64 zip split into 62 MB parts (Grok Bot).
# Usage: scripts/package-win.sh   -> dist/Nexus-Vault-<ver>-Windows.zip(.001/.002) + .sha256
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
NAME="Nexus-Vault-${VER}-Windows"
npm run build
rm -rf dist/win-unpacked
npx electron-builder --win dir --x64
STAGE=$(mktemp -d)
cp -a dist/win-unpacked "$STAGE/Nexus Vault"
# Slim: keep only en-US locale, drop the big Chromium license HTML (LICENSE.electron.txt stays).
find "$STAGE/Nexus Vault/locales" -type f ! -name 'en-US.pak' -delete
rm -f "$STAGE/Nexus Vault/LICENSES.chromium.html"
rm -f "dist/${NAME}.zip" dist/${NAME}.zip.0*
(cd "$STAGE" && zip -qr -9 "${OLDPWD}/dist/${NAME}.zip" "Nexus Vault")
rm -rf "$STAGE"
(cd dist && split -b 62m -d -a 3 --numeric-suffixes=1 "${NAME}.zip" "${NAME}.zip." && sha256sum "${NAME}.zip" ${NAME}.zip.0* > "${NAME}.sha256" && ls -l ${NAME}.zip* && cat "${NAME}.sha256")
