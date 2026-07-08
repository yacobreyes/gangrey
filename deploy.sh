#!/usr/bin/env bash
# Zero-downtime deploy for gangrey.org.
#
# The old container keeps serving traffic through the whole build; we only swap
# to the new image at the very end (a second or two of downtime instead of the
# ~8 minutes a Next.js build takes on this box). Run it from the repo root:
#
#     ./deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"

# --- Guard: this box needs swap or the build OOM-kills itself -----------------
# A Next.js 16 + sharp build peaks well above the 4 GB of RAM on this VPS. With
# no swap the kernel kills the build mid-compile, leaving the old container up
# and your changes undeployed (exactly the failure we hit once). Refuse to build
# until swap exists, and print how to add it.
if [ "$(swapon --show --noheadings 2>/dev/null | wc -l)" -eq 0 ]; then
  echo "ERROR: no swap is active — the build will likely run out of memory and be killed."
  echo
  echo "Add 4 GB of swap once (persists across reboots), then re-run ./deploy.sh:"
  echo
  echo "  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile \\"
  echo "    && sudo mkswap /swapfile && sudo swapon /swapfile \\"
  echo "    && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  echo
  exit 1
fi

echo "==> Pulling latest code…"
git pull --ff-only

# Export NEXT_PUBLIC_* build args from .env.selfhost so `docker compose build`
# can bake them in (build args aren't read from env_file). We extract only those
# lines rather than `source`-ing the file — sourcing executes it as a shell
# script, which breaks on values containing spaces or '@' (e.g. an email).
if [ -f .env.selfhost ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      NEXT_PUBLIC_*=*) export "${line%%$'\r'}" ;;
    esac
  done < .env.selfhost
fi

echo "==> Building new image (old container keeps serving)…"
docker compose build

echo "==> Swapping to the new image…"
docker compose up -d

echo "==> Waiting for the app to answer…"
live=0
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://localhost:3000; then
    live=1
    break
  fi
  sleep 2
done

if [ "$live" -ne 1 ]; then
  echo "WARNING: app did not return 200 within 60s — check: docker compose logs --tail=40 imago"
  exit 1
fi

# --- Pre-generate every image derivative (both WebP and JPEG) -----------------
# The /media route encodes each size/format on first request and caches it to
# the /data volume. Without this pass the FIRST visitor after a deploy pays for
# a cold sharp encode of every image on the page — the "why is it still slow"
# problem. Warming both formats here means real traffic only ever hits the warm
# disk cache. Idempotent and safe to re-run; the cache survives deploys, so this
# only fills gaps (new stories, new sizes) after the first full run.
CRON_SECRET="$(grep -E '^CRON_SECRET=' .env.selfhost 2>/dev/null | head -1 | cut -d= -f2-)"
if [ -n "${CRON_SECRET:-}" ]; then
  echo "==> Warming image cache (WebP + JPEG) — this can take a few minutes on first run…"
  offset=0
  while :; do
    resp="$(curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
      "http://localhost:3000/api/admin/warm-images?offset=${offset}&limit=200" || true)"
    [ -z "$resp" ] && { echo "    (warm request failed — skipping; images will warm on first view)"; break; }
    echo "    $resp"
    case "$resp" in
      *'"done":true'*) echo "==> Image cache warm."; break ;;
    esac
    offset="$(printf '%s' "$resp" | sed -n 's/.*"nextOffset":\([0-9]*\).*/\1/p')"
    [ -z "$offset" ] && break
  done
else
  echo "==> Skipping image warm (CRON_SECRET not found in .env.selfhost)."
fi

echo "==> Live. Deploy complete."
exit 0
