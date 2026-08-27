#!/usr/bin/env sh
# Postgres backup → timestamped gzip dump. Keeps the latest 30.
#   Usage:  DATABASE_URL=postgres://user:pass@host:5432/hew_erp ./scripts/backup.sh [out_dir]
#   Local PostgreSQL: pg_dump --no-owner "$DATABASE_URL" | gzip > hew_erp.sql.gz
set -eu
: "${DATABASE_URL:?set DATABASE_URL (postgres://user:pass@host:port/db)}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/hew_erp-$STAMP.sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
echo "✓ Backup written: $FILE"
# Retention: keep the 30 most-recent dumps, prune the rest.
ls -1t "$OUT_DIR"/hew_erp-*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
