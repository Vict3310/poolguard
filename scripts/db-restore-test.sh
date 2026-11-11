#!/usr/bin/env bash
# Proves a backup is restorable: restores it into a throwaway database on the same
# server, compares row counts with the source for every table, then drops it.
#
#   DATABASE_URL=postgresql://... bash scripts/db-restore-test.sh backups/poolguard-XXXX.dump
#
# The source database is only read. The scratch database is named
# poolguard_restore_test_<pid> and is always dropped on exit.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the source database}"
DUMP="${1:?Pass the .dump file to test}"
BIN="${PG_BIN:+$PG_BIN/}"
for tool in psql pg_restore; do
  command -v "${BIN}$tool" >/dev/null 2>&1 || { echo "$tool not found (set PG_BIN or install postgresql-client)" >&2; exit 1; }
done

if [[ -f "$DUMP.sha256" ]]; then
  ( cd "$(dirname "$DUMP")" && sha256sum --check --quiet "$(basename "$DUMP").sha256" )
  echo "Checksum OK"
fi

SRC="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
SCRATCH="poolguard_restore_test_$$"
# Same server, different database name.
BASE="${SRC%%\?*}"; QUERY=""; [[ "$SRC" == *\?* ]] && QUERY="?${SRC#*\?}"
TARGET="${BASE%/*}/$SCRATCH$QUERY"
ADMIN="${BASE%/*}/postgres$QUERY"

cleanup() { "${BIN}psql" "$ADMIN" -qAtc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${BIN}psql" "$ADMIN" -qAtc "CREATE DATABASE \"$SCRATCH\""
"${BIN}pg_restore" --no-owner --no-privileges --exit-on-error --dbname="$TARGET" "$DUMP"
echo "Restored into $SCRATCH"

COUNT_SQL="SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1"
fail=0; tables=0
while read -r table; do
  [[ -z "$table" ]] && continue
  tables=$((tables + 1))
  a="$("${BIN}psql" "$SRC" -qAtc "SELECT count(*) FROM \"$table\"")"
  b="$("${BIN}psql" "$TARGET" -qAtc "SELECT count(*) FROM \"$table\"")"
  if [[ "$a" == "$b" ]]; then printf '  ✓ %-28s %s rows\n' "$table" "$b"; else printf '  ✗ %-28s source %s, restored %s\n' "$table" "$a" "$b"; fail=1; fi
done < <("${BIN}psql" "$SRC" -qAtc "$COUNT_SQL")

MIGRATIONS="$("${BIN}psql" "$TARGET" -qAtc 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL' 2>/dev/null || echo 0)"
echo "Applied migrations in restored copy: $MIGRATIONS"

if [[ "$fail" -ne 0 ]]; then
  echo "Restore test FAILED: row counts differ (writes during the test also cause this; rerun on a quiet database)." >&2
  exit 1
fi
echo "Restore test passed: $tables tables match."
