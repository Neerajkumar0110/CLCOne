#!/usr/bin/env bash
###############################################################################
# CLC InternX Code Lab — CareerLab branding for OpenVSCode Server
#
# What this fixes: OpenVSCode Server's branding (favicon, PWA icons, the
# "no file open" watermark, and a small corner badge) lives as plain files
# inside the extracted release at /opt/openvscode-server — NOT inside this
# git repo and NOT inside anything OpenVSCode Server itself persists. A
# fresh install (or a version upgrade that re-extracts a new release
# tarball over /opt/openvscode-server) wipes it. This script re-applies it
# in one idempotent step, from the assets committed alongside it here.
#
#   Run as root on the VPS, any time after (re)installing OpenVSCode Server:
#       bash /var/www/clccrm/deploy/vps/code-editor-branding/apply-branding.sh
#
# Safe to re-run — the workbench.html patch checks for its own marker
# before inserting, so re-running never double-inserts the badge.
###############################################################################
set -euo pipefail

OVSC_DIR="${OVSC_DIR:-/opt/openvscode-server}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -d "$OVSC_DIR" ] || { echo "!! $OVSC_DIR not found — install OpenVSCode Server first (see deploy/vps/README.md)"; exit 1; }

echo "==> Backing up original assets (first run only, never overwritten again)"
mkdir -p "$OVSC_DIR/resources/server/_orig-backup" "$OVSC_DIR/out/media/_orig-backup"
for f in code-192.png code-512.png favicon.ico; do
  [ -f "$OVSC_DIR/resources/server/_orig-backup/$f" ] || cp "$OVSC_DIR/resources/server/$f" "$OVSC_DIR/resources/server/_orig-backup/$f" 2>/dev/null || true
done
for f in letterpress-light.svg letterpress-dark.svg letterpress-hcLight.svg letterpress-hcDark.svg code-icon.svg; do
  [ -f "$OVSC_DIR/out/media/_orig-backup/$f" ] || cp "$OVSC_DIR/out/media/$f" "$OVSC_DIR/out/media/_orig-backup/$f" 2>/dev/null || true
done
[ -f "$OVSC_DIR/out/vs/code/browser/workbench/workbench.html.orig-backup" ] || \
  cp "$OVSC_DIR/out/vs/code/browser/workbench/workbench.html" "$OVSC_DIR/out/vs/code/browser/workbench/workbench.html.orig-backup"

echo "==> Installing CareerLab favicon / PWA icons / empty-editor watermark"
# letterpress-*.svg = the CRM collapsed-sidebar logo (C + CAREER LAB CONSULTING),
# logo-sidebar-expanded.png = the CRM expanded-sidebar wordmark (titlebar badge),
# code-icon.svg = stock blue VS Code icon replaced by the CareerLab C (Welcome tab etc.).
cp "$SRC_DIR/code-192.png" "$SRC_DIR/code-512.png" "$SRC_DIR/favicon.ico" "$SRC_DIR/logo-sidebar-expanded.png" "$OVSC_DIR/resources/server/"
cp "$SRC_DIR/letterpress-light.svg" "$SRC_DIR/letterpress-dark.svg" \
   "$SRC_DIR/letterpress-hcLight.svg" "$SRC_DIR/letterpress-hcDark.svg" "$SRC_DIR/code-icon.svg" "$OVSC_DIR/out/media/"

echo "==> Patching workbench.html: sidebar wordmark top-left, stock blue app icon hidden"
# Always re-patch from the pristine backup, so changing the badge here and re-running updates it.
WORKBENCH_HTML="$OVSC_DIR/out/vs/code/browser/workbench/workbench.html"
cp "$WORKBENCH_HTML.orig-backup" "$WORKBENCH_HTML"
python3 - "$WORKBENCH_HTML" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
old = '\t<body aria-label="">\n\t</body>'
badge = '''	<body aria-label="">
		<style>.monaco-workbench .part.titlebar .window-appicon:not(.codicon){display:none!important}</style>
		<img src="{{WORKBENCH_WEB_BASE_URL}}/resources/server/logo-sidebar-expanded.png" alt="Career Lab Consulting" title="CLC InternX Code Lab"
			style="position:fixed;top:5px;left:10px;height:24px;width:auto;z-index:2147483647;pointer-events:none;" />
	</body>'''
if content.count(old) != 1:
    print("!! workbench.html body marker not found as expected — skipping badge patch, check manually", file=sys.stderr)
    sys.exit(1)
content = content.replace(old, badge, 1)
with open(path, 'w') as f:
    f.write(content)
print("badge inserted")
PYEOF

echo "==> Restarting openvscode-server"
systemctl restart openvscode-server
sleep 1
systemctl is-active --quiet openvscode-server && echo "==> Done — openvscode-server is active" || { echo "!! openvscode-server failed to start"; exit 1; }
