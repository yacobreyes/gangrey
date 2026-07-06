#!/usr/bin/env bash
# Drives scheduled publishing on the self-hosted box: hits the publish endpoint,
# which flips due scheduled posts to published and sends due scheduled
# newsletters. Vercel's cron doesn't exist here, so a system cron runs this.
#
#   ./publish-cron.sh            # run one pass now
#   ./publish-cron.sh --install  # install a cron that runs it every 5 minutes
#
# Requires CRON_SECRET set in .env.selfhost (any long random string; the same
# value the app checks). Generate one with: openssl rand -hex 32
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

if [ "${1:-}" = "--install" ]; then
  line="*/5 * * * * $ROOT/publish-cron.sh >> $ROOT/publish-cron.log 2>&1"
  ( crontab -l 2>/dev/null | grep -v -F "$ROOT/publish-cron.sh" ; echo "$line" ) | crontab -
  echo "Installed: scheduled-publish check every 5 minutes."
  crontab -l | grep -F "$ROOT/publish-cron.sh"
  exit 0
fi

secret="$(grep -E '^CRON_SECRET=' .env.selfhost 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [ -z "$secret" ]; then
  echo "ERROR: CRON_SECRET is not set in .env.selfhost. Add e.g. CRON_SECRET=$(openssl rand -hex 32 2>/dev/null || echo 'a-long-random-string')"
  exit 1
fi

# Hit the app directly on localhost (skips Caddy/TLS). The endpoint is a no-op
# when nothing is due.
curl -fsS -H "Authorization: Bearer $secret" http://localhost:3000/api/cron/publish
echo
