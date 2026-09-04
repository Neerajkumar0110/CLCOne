#!/usr/bin/env bash
###############################################################################
# CLC CRM — redeploy latest code on the VPS (run after the initial setup.sh)
#   bash /var/www/clccrm/deploy/vps/deploy.sh
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/clccrm}"
BRANCH="${BRANCH:-main}"

echo "==> pulling origin/$BRANCH"
git -C "$APP_DIR" fetch origin "$BRANCH"
git -C "$APP_DIR" reset --hard "origin/$BRANCH"

echo "==> backend deps"
cd "$APP_DIR/backend"
npm ci --omit=dev || npm install --omit=dev

echo "==> frontend build"
cd "$APP_DIR/frontend"
npm ci || npm install
NODE_OPTIONS=--max-old-space-size=1536 npm run build

echo "==> restart"
pm2 restart clccrm-api --update-env
systemctl reload nginx

echo "==> deployed. pm2 logs clccrm-api --lines 30"
