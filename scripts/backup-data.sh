#!/bin/bash
# Nightly backup for self-hosted Imago: snapshots the SQLite db + media folder
# into dated tarballs under DATA_DIR/backups, keeping the last 14.
# Cron example:  0 4 * * * /path/to/repo/scripts/backup-data.sh
set -euo pipefail
DATA_DIR="${DATA_DIR:-./data}"
BACKUP_DIR="$DATA_DIR/backups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
# sqlite3 .backup is safe against concurrent writes; fall back to cp if absent.
if command -v sqlite3 >/dev/null && [ -f "$DATA_DIR/imago.db" ]; then
  sqlite3 "$DATA_DIR/imago.db" ".backup '$BACKUP_DIR/imago-$STAMP.db'"
else
  cp "$DATA_DIR/imago.db" "$BACKUP_DIR/imago-$STAMP.db" 2>/dev/null || true
fi
tar -czf "$BACKUP_DIR/media-$STAMP.tar.gz" -C "$DATA_DIR" media 2>/dev/null || true
# The /recording bundle's live copy holds hand-tuned audio timings and text
# edits that exist ONLY here (the repo ships just the pristine seed), so snapshot
# it too. Compresses ~7MB → a few hundred KB.
if [ -f "$DATA_DIR/recording.html" ]; then
  gzip -c "$DATA_DIR/recording.html" > "$BACKUP_DIR/recording-$STAMP.html.gz" 2>/dev/null || true
fi
ls -1t "$BACKUP_DIR"/imago-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/media-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$BACKUP_DIR"/recording-*.html.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "backup done: $STAMP"
