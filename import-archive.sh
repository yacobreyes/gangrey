#!/usr/bin/env bash
# One-command Gangrey archive import. Runs the whole pipeline server-side —
# no browser tab to babysit:
#
#   Phase 1  Build the date map (exact publication dates from archived RSS feeds)
#   Phase 2  Import every story from the Wayback Machine (batched, resumable)
#   Phase 3  Collapse duplicate captures
#
#   ./import-archive.sh           # run everything
#   ./import-archive.sh --dry     # phase 1 + a parse-only import (no writes)
#
# Long-running (~30-60 min): run it under nohup or tmux so SSH drops don't kill it:
#   nohup ./import-archive.sh > import.log 2>&1 &
#   tail -f import.log
#
# Auth: uses CRON_SECRET from .env.selfhost (the import API accepts it as a
# bearer token in place of an admin browser session).
set -euo pipefail
cd "$(dirname "$0")"

BASE="http://localhost:3000"
DRY=""
[ "${1:-}" = "--dry" ] && DRY="&dry=1"

secret="$(grep -E '^CRON_SECRET=' .env.selfhost 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [ -z "$secret" ]; then
  echo "ERROR: CRON_SECRET is not set in .env.selfhost (add one: openssl rand -hex 32, then ./deploy.sh)"
  exit 1
fi
AUTH=(-H "Authorization: Bearer $secret")

# Tiny JSON field reader (python3 ships with Ubuntu).
jf() { python3 -c "import sys,json;d=json.load(sys.stdin);v=d.get('$1');print('' if v is None else v)"; }

get() { curl -fsS --max-time 90 "${AUTH[@]}" "$1"; }

echo "== Phase 1: building the date map from archived RSS feeds =="
offset=0
while :; do
  out="$(get "$BASE/api/admin/import-gangrey?buildfeeds=1&offset=$offset&limit=30")" || { echo "  network blip at offset $offset — retrying in 5s"; sleep 5; continue; }
  err="$(echo "$out" | jf error)"; [ -n "$err" ] && { echo "  ERROR: $err"; exit 1; }
  echo "  feeds: $(echo "$out" | jf processedSnapshots)/$(echo "$out" | jf totalCaptures) snapshots · $(echo "$out" | jf totalMapped) exact dates"
  [ "$(echo "$out" | jf done)" = "True" ] && break
  offset="$(echo "$out" | jf nextOffset)"
done
echo "== Date map complete =="

echo "== Phase 2: importing stories${DRY:+ (DRY RUN — no writes)} =="
offset=0
fails=0
while :; do
  out="$(get "$BASE/api/admin/import-gangrey?offset=$offset&limit=10$DRY")" || {
    fails=$((fails+1))
    [ $fails -ge 8 ] && { echo "  giving up after 8 consecutive failures at offset $offset — rerun to resume"; exit 1; }
    echo "  batch failed at offset $offset — retry $fails/8 in 10s"; sleep 10; continue
  }
  fails=0
  err="$(echo "$out" | jf error)"; [ -n "$err" ] && { echo "  ERROR: $err"; exit 1; }
  echo "  imported: $(echo "$out" | jf processed)/$(echo "$out" | jf total) processed · $(echo "$out" | jf written) written this batch"
  [ "$(echo "$out" | jf done)" = "True" ] && break
  offset="$(echo "$out" | jf nextOffset)"
done
echo "== Import complete =="

if [ -z "$DRY" ]; then
  echo "== Phase 3: collapsing duplicates =="
  out="$(curl -fsS --max-time 90 "${AUTH[@]}" -X POST "$BASE/api/admin/import-gangrey/dedup")"
  echo "  deleted $(echo "$out" | jf deleted) duplicates · kept $(echo "$out" | jf kept)"
  echo "== All done. Archive count: $(get "$BASE/api/admin/import-gangrey/count" | jf count) stories =="
else
  echo "== Dry run complete — nothing was written. Rerun without --dry to import for real. =="
fi
