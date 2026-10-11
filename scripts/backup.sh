#!/usr/bin/env bash
# Usage: MONGO_URL=... DB_NAME=... BACKUP_DIR=/var/backups/votesecure BACKUP_STATUS_FILE=... ./backup.sh
set -euo pipefail
: "${MONGO_URL:?}" "${DB_NAME:?}" "${BACKUP_DIR:?}" "${BACKUP_STATUS_FILE:?}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BACKUP_DIR/$DB_NAME-$TS.archive.gz"
mkdir -p "$BACKUP_DIR"
if mongodump --uri="$MONGO_URL" --db="$DB_NAME" --archive="$OUT" --gzip; then
  SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
  printf '{"last_backup":"%s","file":"%s","sha256":"%s","ok":true}\n' "$TS" "$(basename "$OUT")" "$SHA" > "$BACKUP_STATUS_FILE"
else
  printf '{"last_backup_attempt":"%s","ok":false}\n' "$TS" > "$BACKUP_STATUS_FILE"
  exit 1
fi
# Restore (into an empty database): mongorestore --uri="$MONGO_URL" --archive=<file> --gzip --nsInclude="$DB_NAME.*"
