#!/usr/bin/env bash
# Usage: scripts/screenshot.sh <light|dark|system> <out.png> [vault]   (Grok Bot)
set -e
cd "$(dirname "$0")/.."
THEME=$1; OUT=$2; VAULT=${3:-$PWD/test/fixtures/sample-vault}
UD=$(mktemp -d)
echo "{\"theme\":\"$THEME\"}" > "$UD/settings.json"
CLICK='(n)=>{const r=[...document.querySelectorAll(".row.folder")].find(e=>e.dataset.rel===n); r&&r.click(); return !!r}'
JS="($CLICK)('Projects');;($CLICK)('Projects/Nexus Vault');;($CLICK)('Daily Notes');;[...document.querySelectorAll('.row')].find(e=>e.dataset.rel==='Projects/Nexus Vault/Ideas.md')?.click()"
NEXUS_USER_DATA="$UD" NEXUS_VAULT_OPEN="$VAULT" NEXUS_SCREENSHOT="$OUT" NEXUS_SCREENSHOT_JS="$JS" \
  timeout 60 xvfb-run -a -s "-screen 0 1400x900x24" ./node_modules/.bin/electron --no-sandbox . 2>&1 | grep -v -E "dbus|Fontconfig|viz_main|gpu" || true
cat "$UD/settings.json"; rm -rf "$UD"
