#!/usr/bin/env sh
# Restore a gzip dump produced by backup.sh. DESTRUCTIVE — overwrites current data.
#   Usage:  DATABASE_URL=postgres://user:pass@host:5432/hew_erp ./scripts/restore.sh <file.sql.gz>
set -eu
: "${DATABASE_URL:?set DATABASE_URL (postgres://user:pass@host:port/db)}"
FILE="${1:?usage: ./scripts/restore.sh <file.sql.gz>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
gunzip -c "$FILE" | psql "$DATABASE_URL"
echo "✓ Restored from $FILE"
