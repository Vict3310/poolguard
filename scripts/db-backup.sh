#!/usr/bin/env bash
# Logical backup of the PoolGuard database (pg_dump custom format).
#
#   DATABASE_URL=postgresql://... bash scripts/db-backup.sh [out-dir]
#
# Writes poolguard-<UTC timestamp>.dump plus a .sha256 next to it, then keeps the
# newest $BACKUP_KEEP dumps (default 14). Needs pg_dump with a major version >= the
# server's. Set PG_BIN to a directory holding pg_dump if it is not on PATH.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to back up}"
OUT_DIR="${1:-${BACKUP_DIR:-./backups}}"
KEEP="${BACKUP_KEEP:-14}"
PG_DUMP="${PG_BIN:+$PG_BIN/}pg_dump"

command -v "$PG_DUMP" >/dev/null 2>&1 || { echo "pg_dump not found (set PG_BIN or install postgresql-client)" >&2; exit 1; }

# Prisma URLs may carry ?schema=public, which libpq rejects.
URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/poolguard-$STAMP.dump"

umask 077
"$PG_DUMP" --format=custom --no-owner --no-privileges --compress=6 --file="$FILE" "$URL"
( cd "$OUT_DIR" && sha256sum "$(basename "$FILE")" > "$(basename "$FILE").sha256" )

SIZE="$(wc -c <"$FILE" | tr -d ' ')"
echo "Backup written: $FILE (${SIZE} bytes)"

# Retention: newest $KEEP dumps survive.
ls -1t "$OUT_DIR"/poolguard-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old" "$old.sha256"
  echo "Pruned $old"
done
