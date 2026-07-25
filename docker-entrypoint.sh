#!/bin/sh
# Container entrypoint. Starts the app, wrapped in Litestream replication when
# an offsite replica is configured.
#
# Replication is opt-in: with LITESTREAM_REPLICA_URL unset the app starts
# exactly as it did before, so a box without bucket credentials still boots.
set -eu

DB_PATH="${DATA_DIR:-/data}/imago.db"

if [ -z "${LITESTREAM_REPLICA_URL:-}" ]; then
  echo "litestream: LITESTREAM_REPLICA_URL not set, starting without replication"
  exec "$@"
fi

# Disaster recovery: an empty volume plus an existing replica means we lost the
# box, so pull the database back down before serving. Both guards make this a
# no-op in the normal case (database present) and on the very first deploy
# (no backups yet) rather than failing the boot.
if [ ! -f "$DB_PATH" ]; then
  echo "litestream: no database at $DB_PATH, attempting restore from replica"
  litestream restore -if-db-not-exists -if-replica-exists -o "$DB_PATH" "$LITESTREAM_REPLICA_URL" \
    && echo "litestream: restore step finished" \
    || echo "litestream: no replica to restore from, starting fresh"
fi

# Replicate continuously, supervising the app. Litestream exits when the child
# exits, so Docker's restart policy still governs the container lifecycle.
#
# -exec takes a single command STRING, so "$*" (not "$@") is what it wants.
# That flattens the arguments, which is fine for the CMD this image ships
# (node server.js) but means CMD should stay simple words with no quoted
# arguments.
echo "litestream: replicating $DB_PATH"
exec litestream replicate -exec "$*"
