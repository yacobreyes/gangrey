#!/usr/bin/env bash
# Restore the Imago database from the offsite Litestream replica.
#
#   ./restore.sh                              # newest available state
#   ./restore.sh 2026-07-25T14:30:00Z         # state as of that UTC moment
#
# Restores to a SIDE FILE and prints how to swap it in. It never overwrites the
# live database on its own: in a real incident you want to inspect the restored
# copy before committing to it.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.selfhost ]; then
  echo "ERROR: .env.selfhost not found — it holds the bucket credentials." >&2
  exit 1
fi

# Export only the LITESTREAM_* lines rather than sourcing the file, which would
# execute it and break on values containing spaces or '@'.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    LITESTREAM_*=*) export "${line%%$'\r'}" ;;
  esac
done < .env.selfhost

if [ -z "${LITESTREAM_REPLICA_URL:-}" ]; then
  echo "ERROR: LITESTREAM_REPLICA_URL is not set in .env.selfhost." >&2
  echo "Replication is not configured, so there is nothing to restore from." >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="./data/imago.restored-${STAMP}.db"
TS="${1:-}"

echo "==> Restoring from ${LITESTREAM_REPLICA_URL}"
if [ -n "$TS" ]; then
  echo "==> Point in time: $TS"
  docker compose run --rm --no-deps --entrypoint litestream imago \
    restore -timestamp "$TS" -o "/data/$(basename "$OUT")" "$LITESTREAM_REPLICA_URL"
else
  echo "==> Point in time: latest"
  docker compose run --rm --no-deps --entrypoint litestream imago \
    restore -o "/data/$(basename "$OUT")" "$LITESTREAM_REPLICA_URL"
fi

echo
echo "Restored to: $OUT"
echo
echo "Inspect it first, e.g.:"
echo "  sqlite3 $OUT 'SELECT COUNT(*) FROM posts;'"
echo
echo "If it looks right, swap it in:"
echo "  docker compose stop imago"
echo "  mv ./data/imago.db ./data/imago.db.broken-${STAMP}"
echo "  mv $OUT ./data/imago.db"
echo "  rm -f ./data/imago.db-wal ./data/imago.db-shm"
echo "  docker compose up -d"
