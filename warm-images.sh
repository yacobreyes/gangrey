#!/usr/bin/env bash
# One-time (safe to re-run) bulk pre-generation of every story's image
# derivatives, so no reader ever waits on a cold sharp resize. Loops the
# /api/admin/warm-images endpoint in batches until it reports done.
#
# Run on the server (where the app + CRON_SECRET env are available):
#   CRON_SECRET=... ./warm-images.sh
# or it will read CRON_SECRET from the environment / .env.selfhost.
set -euo pipefail

BASE="${BASE:-http://localhost:3000}"
LIMIT="${LIMIT:-300}"

# Pull CRON_SECRET from .env.selfhost if not already set.
if [ -z "${CRON_SECRET:-}" ] && [ -f .env.selfhost ]; then
  CRON_SECRET="$(grep -E '^CRON_SECRET=' .env.selfhost | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
fi
if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET not set (env or .env.selfhost). Aborting." >&2
  exit 1
fi

offset=0
while : ; do
  resp="$(curl -sS -X POST "$BASE/api/admin/warm-images?offset=$offset&limit=$LIMIT" \
    -H "Authorization: Bearer $CRON_SECRET")"
  echo "$resp"
  done="$(printf '%s' "$resp" | grep -o '"done":[a-z]*' | cut -d: -f2)"
  next="$(printf '%s' "$resp" | grep -o '"nextOffset":[0-9]*' | cut -d: -f2)"
  [ "$done" = "true" ] && { echo "All image derivatives warmed."; break; }
  offset="${next:-$((offset + LIMIT))}"
done
