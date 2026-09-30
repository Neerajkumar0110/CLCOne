#!/usr/bin/env bash
###############################################################################
# CLC CRM — daily MongoDB + uploaded-files backup (spec §17/§18 "backups,
# restore testing, disaster-recovery procedure" + "daily automated backups
# plus tested restore procedure") — previously nothing in this repo/
# deployment did this at all, for either the database or the uploads folder.
#
# Covers TWO things that live in completely different places and both need
# their own backup:
#   1. MongoDB (Atlas — external, survives a VPS rebuild on its own, but a
#      bad write/delete in the app itself still needs a restore point). The
#      app actually splits its data into 7 separate logical databases on the
#      same cluster (see backend/src/config/multiDb.js's DB_MAP) — the
#      connection string itself has no database segment, so a plain
#      `mongodump --uri=...` with no --db targets whatever Mongo treats as
#      the default ("test", always empty here) and silently backs up
#      nothing real. This loops over the actual 7 databases by name instead.
#   2. backend/src/public/uploads/ — plain files on THIS box's local disk,
#      never committed to git (see backend/.gitignore), so they do NOT
#      survive a fresh `git clone` / VPS rebuild / disk loss. This is not
#      hypothetical: on 2026-09-29 the uploads/material/ directory was wiped
#      (cause unclear — not this script, not deploy.sh's `git reset --hard`,
#      which never touches untracked files) and 2 real candidate-facing
#      Study Material PDFs were permanently lost with no way to recover them,
#      because nothing was backing this folder up. This script exists so
#      that doesn't happen silently again.
#
# One-time setup (as root on the VPS):
#   chmod +x /var/www/clccrm/deploy/vps/backup.sh
#   crontab -e
#   # add: 0 2 * * * /var/www/clccrm/deploy/vps/backup.sh >> /var/log/clccrm-backup.log 2>&1
#
# Manual run:
#   bash /var/www/clccrm/deploy/vps/backup.sh
#
# Restore one logical database (TEST THIS ON A SCRATCH DATABASE FIRST, never
# straight into production without a reason) — e.g. for lmsDb:
#   mongorestore --uri="$DATABASE" --db=lmsDb --gzip --archive=/var/backups/clccrm/clccrm-lmsDb-YYYYmmdd-HHMMSS.gz --drop
#
# Restore uploads (safe to run straight into production — it only adds
# files back, `tar -x` will not delete anything that's already there):
#   tar -xzf /var/backups/clccrm/clccrm-uploads-YYYYmmdd-HHMMSS.tar.gz -C /var/www/clccrm/backend/src/public/
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
UPLOADS_DIR="$APP_DIR/backend/src/public/uploads"

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

# Mirrors backend/src/config/multiDb.js's DB_MAP — keep in sync by hand
# (same constraint every other duplicate of this list in the repo already
# lives with, e.g. backend/scripts/dedupePermissionRecords.cjs).
DBS="coreDb salesDb marketingDb lmsDb financeDb hrmsDb operationDb"
for db in $DBS; do
    ARCHIVE="$BACKUP_DIR/clccrm-$db-$STAMP.gz"
    echo "==> Backing up database '$db' to $ARCHIVE"
    # mongodump refuses --db when the URI itself already names a database
    # (ours is pinned to "/test" — see multiDb.js's own header comment on
    # why that default connection is never the real data) — swap that one
    # path segment for the real db name instead of passing both. Never
    # echo $DB_URI/$DATABASE anywhere — it carries the DB password.
    DB_URI=$(printf '%s' "$DATABASE" | sed -E "s#(/)[A-Za-z0-9_-]*(\?)#\1${db}\2#")
    mongodump --uri="$DB_URI" --gzip --archive="$ARCHIVE"
    echo "==> '$db' backup complete: $(du -h "$ARCHIVE" | cut -f1)"
done

if [ -d "$UPLOADS_DIR" ]; then
    UPLOADS_ARCHIVE="$BACKUP_DIR/clccrm-uploads-$STAMP.tar.gz"
    echo "==> Backing up uploaded files to $UPLOADS_ARCHIVE"
    tar -czf "$UPLOADS_ARCHIVE" -C "$APP_DIR/backend/src/public" uploads
    echo "==> Uploads backup complete: $(du -h "$UPLOADS_ARCHIVE" | cut -f1)"
else
    echo "!! $UPLOADS_DIR does not exist — skipping uploads backup."
fi

echo "==> Pruning backups older than $RETENTION_DAYS days"
# 'clccrm-*.gz' already matches both clccrm-<stamp>.gz (DB) and
# clccrm-uploads-<stamp>.tar.gz (uploads) — one pattern covers both.
find "$BACKUP_DIR" -name 'clccrm-*.gz' -mtime "+$RETENTION_DAYS" -print -delete
