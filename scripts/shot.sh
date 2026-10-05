#!/usr/bin/env bash
# Usage: scripts/shot.sh <theme> <vault> "<js steps>"   (Grok Bot). Steps: JS ;; SHOT path ;; WAIT ms
cd "$(dirname "$0")/.."
THEME=$1; VAULT=$2; JS=$3
UD=${NEXUS_UD:-$(mktemp -d)}
[ -f "$UD/settings.json" ] || echo "{\"theme\":\"$THEME\",\"layout\":{\"treeWidth\":230,\"notePanelWidth\":340}}" > "$UD/settings.json"
NEXUS_USER_DATA="$UD" NEXUS_VAULT_OPEN="$VAULT" NEXUS_SCREENSHOT="-" NEXUS_SCREENSHOT_JS="$JS" \
  timeout 90 xvfb-run -a -s "-screen 0 1600x1000x24" ./node_modules/.bin/electron --no-sandbox . 2>&1 | grep -v -E "dbus|Fontconfig|viz_main|gpu|GLES|vaapi" || true
