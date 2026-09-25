#!/usr/bin/env bash
###############################################################################
# CLC CRM — daily MongoDB backup (spec §17/§18 "backups, restore testing,
# disaster-recovery procedure" + "daily automated backups plus tested restore
# procedure") — previously nothing in this repo/deployment did this at all.
#
# One-time setup (as root on the VPS):
#   chmod +x /var/www/clccrm/deploy/vps/backup.sh
#   crontab -e
#   # add: 0 2 * * * /var/www/clccrm/deploy/vps/backup.sh >> /var/log/clccrm-backup.log 2>&1
#
# Manual run:
#   bash /var/www/clccrm/deploy/vps/backup.sh
#
# Restore (TEST THIS ON A SCRATCH DATABASE FIRST, never straight into
# production without a reason):
#   mongorestore --uri="$DATABASE" --gzip --archive=/var/backups/clccrm/clccrm-YYYYmmdd-HHMMSS.gz --drop
#
# Requires the MongoDB Database Tools (mongodump/mongorestore) — install with:
#   curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
#   echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
#   sudo apt-get update && sudo apt-get install -y mongodb-database-tools
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/clccrm}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/clccrm}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Pull DATABASE (the Mongo connection string) out of backend/.env without
# sourcing the whole file (it may contain other shell-unsafe values).
DATABASE=$(grep -E '^DATABASE=' "$APP_DIR/backend/.env" | head -1 | cut -d= -f2-)
if [ -z "$DATABASE" ]; then
    echo "!! DATABASE not found in $APP_DIR/backend/.env — aborting."
    exit 1
fi

if ! command -v mongodump >/dev/null 2>&1; then
    echo "!! mongodump not installed — see the header comment in this script for install steps."
    exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/clccrm-$STAMP.gz"

echo "==> Backing up to $ARCHIVE"
mongodump --uri="$DATABASE" --gzip --archive="$ARCHIVE"
echo "==> Backup complete: $(du -h "$ARCHIVE" | cut -f1)"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'clccrm-*.gz' -mtime "+$RETENTION_DAYS" -print -delete
