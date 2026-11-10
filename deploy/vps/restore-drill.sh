#!/usr/bin/env bash
###############################################################################
# CLC CRM — weekly restore drill (spec §18 "tested restore procedure").
# "A backup nobody has ever restored is not a backup": this restores the
# LATEST backup.sh archive of each database below into a scratch database
# "<db>__restore_drill" on the same cluster, compares every collection's
# document count with the live database (backend/scripts/restoreDrill.cjs),
# drops the scratch databases and reports OK / FAILED to
# LMS → Admin & Ops → Evidence.
#
# Never touches a live database: mongorestore only writes into the
# "__restore_drill" namespace (--nsFrom/--nsTo), and restoreDrill.cjs only
# drops databases whose name ends in "__restore_drill".
#
# One-time setup (as root on the VPS), after backup.sh's own cron line:
#   chmod +x /var/www/clccrm/deploy/vps/restore-drill.sh
#   crontab -e
#   # add: 30 3 * * 0 /var/www/clccrm/deploy/vps/restore-drill.sh >> /var/log/clccrm-restore-drill.log 2>&1
#
# Manual run:   bash /var/www/clccrm/deploy/vps/restore-drill.sh
# Other DBs:    DRILL_DBS="lmsDb coreDb salesDb" bash .../restore-drill.sh
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/clccrm}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/clccrm}"
DRILL_DBS="${DRILL_DBS:-lmsDb coreDb}"

fail() {
    echo "!! $1"
    ( cd "$APP_DIR/backend" && node scripts/opsReport.cjs restoreDrill fail "$1" ) || true
    exit 1
}

DATABASE=$(grep -E '^DATABASE=' "$APP_DIR/backend/.env" | head -1 | cut -d= -f2-)
[ -n "$DATABASE" ] || fail "DATABASE not found in backend/.env"
command -v mongorestore >/dev/null 2>&1 || fail "mongorestore not installed (see backup.sh header)"

for db in $DRILL_DBS; do
    ARCHIVE=$(ls -1t "$BACKUP_DIR"/clccrm-"$db"-*.gz 2>/dev/null | head -1 || true)
    [ -n "$ARCHIVE" ] || fail "no backup archive for $db in $BACKUP_DIR — is backup.sh running?"
    AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$ARCHIVE") ) / 3600 ))
    [ "$AGE_H" -le 48 ] || fail "latest $db backup is ${AGE_H}h old ($ARCHIVE)"
    echo "==> Restoring $ARCHIVE into ${db}__restore_drill"
    # never echo $DATABASE — it carries the DB password
    mongorestore --uri="$DATABASE" --gzip --archive="$ARCHIVE" \
        --nsFrom="${db}.*" --nsTo="${db}__restore_drill.*" --drop --quiet \
        || fail "mongorestore failed for $db"
done

echo "==> Verifying counts and dropping the scratch databases"
cd "$APP_DIR/backend"
# shellcheck disable=SC2086
node scripts/restoreDrill.cjs $DRILL_DBS
