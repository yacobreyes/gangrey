#!/usr/bin/env bash
# Nightly snapshot of everything the CMS owns: the SQLite database and all
# uploaded media. Both live under ./data (mounted into the container), so a
# backup is just a consistent copy of that folder.
#
# Usage:
#   ./backup.sh            # take one snapshot now
#   ./backup.sh --install  # install a nightly cron job (3:15am) that runs this
#
# Snapshots land in ./backups as timestamped tarballs; the last 14 are kept.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
DATA="$ROOT/data"
DEST="$ROOT/backups"
KEEP=14

install_cron() {
  local line="15 3 * * * $ROOT/backup.sh >> $ROOT/backups/backup.log 2>&1"
  mkdir -p "$DEST"
  # Replace any existing entry for this script, then add the current one.
  ( crontab -l 2>/dev/null | grep -v -F "$ROOT/backup.sh" ; echo "$line" ) | crontab -
  echo "Installed nightly backup at 3:15am. Current crontab:"
  crontab -l | grep -F "$ROOT/backup.sh"
  exit 0
}

[ "${1:-}" = "--install" ] && install_cron

mkdir -p "$DEST"
# Use the DB's own date (from the environment) is unavailable here, so stamp
# with the system clock at run time.
stamp="$(date +%Y-%m-%d_%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

db="$DATA/imago.db"
if [ -f "$db" ]; then
  # A live SQLite DB (WAL mode) can't be safely copied with cp mid-write.
  # sqlite3's online .backup takes a consistent snapshot even while the app
  # is running. Fall back to a plain copy only if sqlite3 isn't installed.
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$db" ".backup '$work/imago.db'"
  else
    echo "WARNING: sqlite3 not found — copying the DB file directly (install sqlite3 for a guaranteed-consistent hot backup: apt-get install -y sqlite3)."
    cp "$db" "$work/imago.db"
  fi
else
  echo "WARNING: no database found at $db"
fi

# Media is write-once (uploads never mutate in place), so a plain copy is safe.
if [ -d "$DATA/media" ]; then
  cp -a "$DATA/media" "$work/media"
fi

tar -czf "$DEST/gangrey-$stamp.tar.gz" -C "$work" .
echo "Snapshot written: $DEST/gangrey-$stamp.tar.gz ($(du -h "$DEST/gangrey-$stamp.tar.gz" | cut -f1))"

# Prune to the most recent $KEEP snapshots.
ls -1t "$DEST"/gangrey-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Keeping the $KEEP most recent snapshots in $DEST."
