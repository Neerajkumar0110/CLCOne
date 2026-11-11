#!/usr/bin/env bash
###############################################################################
# Installs (or repairs) the three ops-evidence cron jobs on the VPS — spec
# §18 / §20, LMS → Admin & Ops → Evidence:
#
#   daily   02:00  backup.sh         all 7 DBs + uploads  → ops:backup
#   Sunday  03:30  restore-drill.sh  latest backup restored into scratch DBs,
#                                    counts compared, scratch dropped → ops:restoreDrill
#   1st     04:15  loadTest.cjs      read-only GETs, p95 + error rate → ops:loadTest
#
# Every line runs the script through `bash` / `node` instead of executing the
# file directly: a git checkout from Windows drops the executable bit, which
# is exactly how the old "0 2 * * * .../backup.sh" line silently failed with
# "Permission denied" every night from 1 Oct 2026 on.
#
# Idempotent: removes any earlier line for these scripts, then adds the
# current ones; every other crontab line is kept as is.
#   bash /var/www/clccrm/deploy/vps/install-ops-crons.sh
###############################################################################
set -euo pipefail
APP_DIR="${APP_DIR:-/var/www/clccrm}"
BASE_URL="${BASE_URL:-https://clcone.careerlabconsulting.com}"

CURRENT=$(crontab -l 2>/dev/null || true)
KEEP=$(printf '%s\n' "$CURRENT" | grep -v -E 'deploy/vps/(backup|restore-drill)\.sh|scripts/loadTest\.cjs' || true)

NEW=$(cat <<EOF
$KEEP
0 2 * * * bash $APP_DIR/deploy/vps/backup.sh >> /var/log/clccrm-backup.log 2>&1
30 3 * * 0 bash $APP_DIR/deploy/vps/restore-drill.sh >> /var/log/clccrm-restore-drill.log 2>&1
15 4 1 * * cd $APP_DIR/backend && node scripts/loadTest.cjs --base $BASE_URL --concurrency 20 --requests 1000 >> /var/log/clccrm-loadtest.log 2>&1
EOF
)
printf '%s\n' "$NEW" | sed '/^$/d' | crontab -
echo "==> crontab now:"
crontab -l | grep -E 'backup\.sh|restore-drill\.sh|loadTest\.cjs'
